import {
  ArtifactStore,
  createRailgunWallet,
  generatePOIsForWallet,
  refreshReceivePOIsForWallet,
  refreshSpentPOIsForWallet,
  getTXOsSpentPOIStatusInfoForWallet,
  getTXOsReceivedPOIStatusInfoForWallet,
  getChainTxidsStillPendingSpentPOIs,
  getLatestRailgunTxidData,
  POINodeRequest,
  setOnWalletPOIProofProgressCallback,
  getProver,
  loadProvider,
  loadWalletByID,
  refreshBalances,
  setLoggers,
  setOnBalanceUpdateCallback,
  setOnTXIDMerkletreeScanCallback,
  setOnUTXOMerkletreeScanCallback,
  startRailgunEngine,
  walletForID,
} from '@railgun-community/wallet';
import { CommitmentType, POI, WalletBalanceBucket, type SnarkJSGroth16 } from '@railgun-community/engine';
import { NETWORK_CONFIG, RailgunWalletBalanceBucket, TXIDVersion, type RailgunBalancesEvent } from '@railgun-community/shared-models';
import leveljs from 'level-js';
import localforage from 'localforage';
import brotliDecompress from 'brotli/decompress';
import { groth16 } from 'snarkjs';
import { Contract } from 'ethers';
import { SHIELD_HOLD_MS, pendingEta } from '../shared/eta';
import type { TokenBalance } from '../shared/protocol';
import { CHAIN, CHAIN_ID, DEV, FORK, NETWORK, POI_NODES, RPC_URL, WETH, getProvider } from './config';
import { checkToken, tokensOn } from '../shared/networks';
import { emit, state } from './state';
import { saveRailgunWalletId, type Unlocked } from './vault';

const artifacts = localforage.createInstance({ name: 'railgun-artifacts' });
// A circuit's witness generator is code, so it ships in the package (scripts/build.mjs, which
// checks it against the SDK's hashes) and is never downloaded: its path always "exists", and a
// copy an older Canon downloaded is ignored. Proving keys and vkeys are data the SDK
// downloads and hash-checks, then keeps here. SDK paths end in "<variant>/wasm".
const bundledWasm = (path: string) => /\/wasm$/.test(path);
const wasmCache = new Map<string, Promise<Buffer>>();
const readBundledWasm = (path: string) => {
  const variant = path.split('/').at(-2)!;
  let p = wasmCache.get(variant);
  if (!p) {
    p = fetch(new URL(`/artifacts/${variant}.wasm.br`, location.href))
      .then((r) => {
        if (!r.ok) throw new Error(`Circuit ${variant} is not in this build`);
        return r.arrayBuffer();
      })
      .then((b) => Buffer.from(brotliDecompress(Buffer.from(b))));
    p.catch(() => wasmCache.delete(variant));
    wasmCache.set(variant, p);
  }
  return p;
};
const artifactStore = new ArtifactStore(
  async (path) => (bundledWasm(path) ? readBundledWasm(path) : artifacts.getItem<string | Buffer>(path)),
  async (_dir, path, item) => {
    if (!bundledWasm(path)) await artifacts.setItem(path, item);
  },
  async (path) => bundledWasm(path) || (await artifacts.getItem(path)) != null,
);

// snarkjs spreads proving over blob: workers, which MV3's extension CSP may
// refuse. Probe once; fall back to one thread rather than hang.
const blobWorkersAllowed = (): boolean => {
  try {
    const url = URL.createObjectURL(new Blob([''], { type: 'text/javascript' }));
    new Worker(url).terminate();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
};

// "missing a commitment or unshield" is the TXID tree waiting for the UTXO tree: it passes.
const BENIGN = ['Failed to decrypt', 'Could not decrypt', 'Stopping queue of Railgun TXIDs - missing a commitment'];
// The TXID tree's data source broke its hash chain (seen on Sepolia's squid from index 4188).
// Until it is fixed, the SDK cannot prove this wallet's spends, so pending notes may not clear.
const TXID_STALL = 'Stopping queue of Railgun TXIDs - Invalid verification hash';
// Set by the engine's error (engine-wide: a scan already running makes refreshBalances skip
// its own, so a sync cannot tell by itself). Cleared by a sync that finds the local tree caught
// up with the POI node's validated index: the tree is healthy then, however it recovered.
const markTxidStall = (): void => {
  if (state.txidStalled) return;
  state.txidStalled = true;
  emit();
};
const txidCaughtUp = async (): Promise<boolean> => {
  const [local, node] = await Promise.all([
    getLatestRailgunTxidData(TXIDVersion.V2_PoseidonMerkle, NETWORK),
    new POINodeRequest(POI_NODES).getLatestValidatedRailgunTxid(TXIDVersion.V2_PoseidonMerkle, CHAIN),
  ]).catch(() => [null, null] as const);
  return local != null && node?.validatedTxidIndex != null && local.txidIndex >= node.validatedTxidIndex;
};
const describe = (err: unknown, depth = 0): string => {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  const head = `${err.name}: ${err.message}`;
  return cause == null || depth > 4 ? head : `${head} <- ${describe(cause, depth + 1)}`;
};

// FORK ONLY. No PPOI aggregator watches a local fork, so every shield would sit
// in ShieldPending forever. Treat unspent notes as spendable and build no POI
// proofs. Runs only in a CANON_FORK=1 build; never for a real network.
const patchPoiForFork = (): void => {
  const poi = POI as unknown as Record<string, unknown>;
  poi.lists = [];
  poi.getActiveListKeys = () => [];
  poi.getAllListKeys = () => [];
  poi.getBalanceBucket = (txo: { spendtxid: unknown }) =>
    txo.spendtxid !== false ? WalletBalanceBucket.Spent : WalletBalanceBucket.Spendable;
  console.warn('[railgun] FORK MODE: POI checks disabled');
};

let booted: Promise<void> | null = null;
// Set by the engine when a scan stops early (e.g. a load-balanced RPC node behind head).
let scanIncomplete = false;

export const bootEngine = (): Promise<void> =>
  (booted ??= (async () => {
    state.engine = { status: 'starting' };
    emit();
    setLoggers(
      (m: string) => DEV && console.log('[railgun]', m),
      (e: string | Error) => {
        const msg = describe(e);
        if (msg.includes(TXID_STALL)) markTxidStall();
        if (!BENIGN.some((b) => msg.includes(b))) console.error('[railgun]', msg);
      },
    );
    if (FORK) delete (NETWORK_CONFIG[NETWORK] as { poi?: unknown }).poi;
    // shouldDebug true in every build: without it the SDK connects no engine logger at all, so a
    // production build never sees engine errors such as the TXID stall. The log function above
    // still prints only in dev.
    await startRailgunEngine('canon', leveljs('canon-railgun'), true, artifactStore, false, false, POI_NODES);
    if (FORK) patchPoiForFork();

    const singleThread = !blobWorkersAllowed();
    console.log('[railgun] prover threads:', singleThread ? 'single' : 'multi');
    const prover = {
      fullProve: (input: never, wasm: never, zkey: never, logger: never) =>
        (groth16.fullProve as (...a: unknown[]) => Promise<unknown>)(input, wasm, zkey, logger, undefined, {
          singleThread,
        }),
      verify: groth16.verify,
    } as unknown as SnarkJSGroth16;
    getProver().setSnarkJSGroth16(prover);

    setOnUTXOMerkletreeScanCallback((e) => {
      if (e.scanStatus === 'Incomplete') scanIncomplete = true;
      if (state.sync.status !== 'syncing') return;
      state.sync = { ...state.sync, progress: Math.max(state.sync.progress, e.progress * 0.9) };
      emit();
    });
    setOnTXIDMerkletreeScanCallback(() => {});
    setOnBalanceUpdateCallback(onBalances);
    setOnWalletPOIProofProgressCallback((e) => {
      state.proof = e.progress >= 100 || e.status === 'AllProofsCompleted' ? null : { label: 'Proof of innocence', progress: e.progress / 100 };
      emit();
    });

    await loadProvider(
      // A single provider needs weight 2 to meet the fallback quorum.
      { chainId: CHAIN.id, providers: [{ provider: RPC_URL, priority: 1, weight: 2, maxLogsPerBatch: 1, stallTimeout: 2500 }] },
      NETWORK,
      5 * 60_000,
    );
    state.engine = { status: 'ready' };
    emit();
  })().catch((err: unknown) => {
    booted = null;
    state.engine = { status: 'error', error: describe(err) };
    emit();
    throw err;
  }));

// --- balances -------------------------------------------------------------

const PENDING = new Set<string>([
  RailgunWalletBalanceBucket.ShieldPending,
  RailgunWalletBalanceBucket.ProofSubmitted,
  RailgunWalletBalanceBucket.MissingInternalPOI,
  RailgunWalletBalanceBucket.MissingExternalPOI,
]);

const buckets = new Map<string, Map<string, bigint>>();
const tokenMeta = new Map<string, { symbol: string; decimals: number }>([
  [WETH.toLowerCase(), { symbol: 'WETH', decimals: 18 }],
]);

// Anyone can send a note of any token, so a token's own symbol is checked
// (checkToken) before it is shown: a fake "WETH" must not pass as the real one.
const metaFor = async (token: string) => {
  const key = token.toLowerCase();
  const listed = tokensOn(CHAIN_ID, state.tokens).find((t) => t.address.toLowerCase() === key);
  if (listed) return { symbol: listed.symbol, decimals: listed.decimals };
  const known = tokenMeta.get(key);
  if (known) return known;
  const c = new Contract(token, ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'], getProvider());
  const meta = await Promise.all([c.symbol(), c.decimals()])
    .then(([symbol, decimals]) => {
      const t = checkToken(CHAIN_ID, token, symbol, decimals);
      return { symbol: t.symbol, decimals: t.decimals };
    })
    .catch(() => ({ symbol: `${token.slice(0, 6)}…`, decimals: 18 }));
  tokenMeta.set(key, meta);
  return meta;
};

let walletId: string | null = null;

const onBalances = (ev: RailgunBalancesEvent): void => {
  if (ev.railgunWalletID !== walletId) return;
  buckets.set(ev.balanceBucket, new Map(ev.erc20Amounts.map((a) => [a.tokenAddress.toLowerCase(), a.amount])));
  void rebuildBalances();
};

// The wallet's own notes carry the shield's block time and their POI bucket, so
// this needs no network call. Runs only when a balance changes.
const readPendingEta = async () => {
  try {
    const txos = await walletForID(currentWalletId()).TXOs(TXIDVersion.V2_PoseidonMerkle, CHAIN);
    const notes = txos
      .filter((t) => PENDING.has(POI.getBalanceBucket(t)))
      .map((t) => ({
        shield: t.commitmentType === CommitmentType.ShieldCommitment || t.commitmentType === CommitmentType.LegacyGeneratedCommitment,
        at: t.timestamp ?? 0,
      }));
    return pendingEta(notes, SHIELD_HOLD_MS[CHAIN.id]);
  } catch {
    return null;
  }
};

const rebuildBalances = async (): Promise<void> => {
  const totals = new Map<string, { spendable: bigint; pending: bigint }>();
  for (const [bucket, amounts] of buckets) {
    const isSpendable = bucket === RailgunWalletBalanceBucket.Spendable;
    if (!isSpendable && !PENDING.has(bucket)) continue;
    for (const [token, amount] of amounts) {
      const t = totals.get(token) ?? { spendable: 0n, pending: 0n };
      if (isSpendable) t.spendable += amount;
      else t.pending += amount;
      totals.set(token, t);
    }
  }
  const list: TokenBalance[] = [];
  for (const [token, t] of totals) {
    if (t.spendable === 0n && t.pending === 0n) continue;
    list.push({ token, ...(await metaFor(token)), ...t });
  }
  if (!list.some((b) => b.token === WETH.toLowerCase())) {
    list.unshift({ token: WETH.toLowerCase(), symbol: 'WETH', decimals: 18, spendable: 0n, pending: 0n });
  }
  state.pendingEta = list.some((b) => b.pending > 0n) ? await readPendingEta() : null;
  state.privateBalances = list.sort((a, b) => (a.token === WETH.toLowerCase() ? -1 : b.token === WETH.toLowerCase() ? 1 : 0));
  emit();
};

// Dev-only window into proof-of-innocence state, for scripts/poi-probe.mjs.
if (DEV) {
  (globalThis as Record<string, unknown>).__railgunDebug = {
    buckets: () => Object.fromEntries([...buckets].map(([k, v]) => [k, Object.fromEntries([...v].map(([t, a]) => [t, a.toString()]))])),
    spent: () => getTXOsSpentPOIStatusInfoForWallet(TXIDVersion.V2_PoseidonMerkle, NETWORK, currentWalletId()),
    received: () => getTXOsReceivedPOIStatusInfoForWallet(TXIDVersion.V2_PoseidonMerkle, NETWORK, currentWalletId()),
    pendingTxids: () => getChainTxidsStillPendingSpentPOIs(TXIDVersion.V2_PoseidonMerkle, NETWORK, currentWalletId()),
    generate: () => generatePOIsForWallet(NETWORK, currentWalletId()),
  };
}

export const spendable = (token = WETH): bigint =>
  state.privateBalances.find((b) => b.token === token.toLowerCase())?.spendable ?? 0n;

// --- wallet ---------------------------------------------------------------

export const openRailgunWallet = async (u: Unlocked, imported: boolean): Promise<void> => {
  await bootEngine();
  let info = u.record.railgunWalletId
    ? await loadWalletByID(u.railgunKey, u.record.railgunWalletId, false).catch(() => null)
    : null;
  if (!info) {
    // A new phrase cannot have history, so its scan starts at today's block.
    const from = imported ? NETWORK_CONFIG[NETWORK].deploymentBlock : await getProvider().getBlockNumber();
    info = await createRailgunWallet(u.railgunKey, u.mnemonic, { [NETWORK]: from });
    await saveRailgunWalletId(u.record, info.id);
  }
  walletId = info.id;
  state.railgunAddress = info.railgunAddress;
  emit();
};

export const closeRailgunWallet = (): void => {
  walletId = null;
  buckets.clear();
  state.railgunAddress = null;
  state.privateBalances = [];
  state.pendingEta = null;
  state.sync = { status: 'idle', progress: 0 };
};

export const currentWalletId = (): string => {
  if (!walletId) throw new Error('Wallet is locked');
  return walletId;
};

let syncing: Promise<void> | null = null;

/** Scans on demand only. Background polling would itself mark the user as active. */
export const sync = (): Promise<void> =>
  (syncing ??= (async () => {
    const id = currentWalletId();
    state.sync = { status: 'syncing', progress: 0.02 };
    emit();
    let last: unknown;
    // The engine only retries its own timeouts; any other RPC blip aborts a scan.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        scanIncomplete = false;
        await refreshBalances(CHAIN, [id]);
        if (state.txidStalled && (await txidCaughtUp())) state.txidStalled = false;
        if (scanIncomplete) throw new Error('Scan stopped early');
        // Notes from our own private sends stay pending until this wallet proves
        // them clean and submits that to the PPOI node. Do it now, while open,
        // rather than waiting on the engine's background trigger.
        await generatePOIsForWallet(NETWORK, id).catch((e) => console.warn('[railgun] POI generation', describe(e)));
        // Ask the PPOI node for our notes' current status, as a broadcaster does
        // before checking spendability. Without this, cleared notes can stay
        // "pending" in the wallet's cache.
        await refreshReceivePOIsForWallet(TXIDVersion.V2_PoseidonMerkle, NETWORK, id).catch((e) => console.warn('[railgun] receive POIs', describe(e)));
        await refreshSpentPOIsForWallet(TXIDVersion.V2_PoseidonMerkle, NETWORK, id).catch((e) => console.warn('[railgun] spent POIs', describe(e)));
        await refreshBalances(CHAIN, [id]);
        state.sync = { status: 'done', progress: 1, at: Date.now() };
        emit();
        return;
      } catch (err) {
        last = err;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    state.sync = { status: 'error', progress: 0, error: describe(last) };
    emit();
  })().finally(() => {
    syncing = null;
  }));
