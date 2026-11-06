import {
  gasEstimateForShieldBaseToken,
  gasEstimateForUnprovenTransfer,
  gasEstimateForUnprovenUnshieldBaseToken,
  generateTransferProof,
  generateUnshieldBaseTokenProof,
  getShieldPrivateKeySignatureMessage,
  populateProvedTransfer,
  populateProvedUnshieldBaseToken,
  populateShieldBaseToken,
  validateRailgunAddress,
  calculateBroadcasterFeeERC20Amount,
} from '@railgun-community/wallet';
import { EVMGasType, TXIDVersion, calculateGasPrice, type TransactionGasDetails } from '@railgun-community/shared-models';
import { getAddress, keccak256, parseEther, type TransactionRequest } from 'ethers';
import type { SendIntent, SendKind, SendPlan } from '../shared/protocol';
import { isHexAddress, isZk } from '../shared/format';
import { recordActivity, signerFor, isHardware } from './book';
import { NETWORK, WETH, getProvider } from './config';
import { currentWalletId, spendable, sync } from './railgun';
import { pickBroadcaster, submitViaBroadcaster } from './broadcaster';
import { assurePOI } from './poi-assurance';
import { isName, resolveName, sponsorRelay } from './ens';
import { emit, state } from './state';
import type { Unlocked } from './vault';

// One Send. Source and recipient kind decide the operation; the user never picks it.
//   public  -> 0x   send
//   public  -> 0zk  shield     ("Make private")
//   private -> 0zk  transfer   ("Send privately")
//   private -> 0x   unshield   ("Make public")

const V2 = TXIDVersion.V2_PoseidonMerkle;

const kindOf = (from: SendIntent['from'], to: string): SendKind => {
  if (isZk(to)) {
    if (!validateRailgunAddress(to.trim())) throw new Error('Not a valid 0zk address');
    return from === 'private' ? 'transfer' : 'shield';
  }
  if (isHexAddress(to)) return from === 'private' ? 'unshield' : 'send';
  throw new Error('Enter a 0x or 0zk address');
};

const parseAmount = (s: string): bigint => {
  let v: bigint;
  try {
    v = parseEther(s.trim() || '0');
  } catch {
    throw new Error('Not an amount');
  }
  if (v <= 0n) throw new Error('Enter an amount');
  return v;
};

const fees = async () => {
  const f = await getProvider().getFeeData();
  return {
    maxFeePerGas: f.maxFeePerGas ?? 2_000_000_000n,
    maxPriorityFeePerGas: f.maxPriorityFeePerGas ?? 1_000_000_000n,
  };
};

const gasDetails = async (gasEstimate: bigint): Promise<TransactionGasDetails> => ({
  evmGasType: EVMGasType.Type2,
  gasEstimate,
  ...(await fees()),
});

// Deterministic per account, as RAILGUN specifies: sign a fixed message, hash it.
const shieldKey = async (index: number): Promise<string> =>
  keccak256(await signerFor(index).signMessage(getShieldPrivateKeySignatureMessage()));

type Prepared = SendPlan & { run: () => Promise<string> };

// A private send spends notes. Until it is mined and re-scanned, the engine
// still sees them as unspent and would build a second proof over them.
let settling: Promise<unknown> = Promise.resolve();

const prepare = async (intent: SendIntent, u: Unlocked): Promise<Prepared> => {
  const typed = intent.to.trim();
  const resolved = isName(typed) ? await resolveName(typed) : null;
  const to = resolved?.address ?? typed;
  const kind = kindOf(intent.from, to);
  // RAILGUN unshields ETH through RelayAdapt7702, whose throwaway keys would have to live on the device.
  if (kind === 'unshield' && intent.from === 'private' && isHardware()) throw new Error('Making ETH public is not supported on a hardware wallet yet');
  const amount = parseAmount(intent.amount);
  const gasFrom = intent.from === 'private' ? (intent.gasFrom ?? 0) : intent.from;
  const payer = signerFor(gasFrom).connect(getProvider());
  const weth = { tokenAddress: WETH, amount };
  const { maxFeePerGas } = await fees();

  const track = (hash: string, label: string): string => {
    const entry = { id: hash, kind, label, amount: intent.amount, hash, at: Date.now(), status: 'pending' as const };
    void recordActivity(entry).catch(() => {});
    state.activity = [entry, ...state.activity.filter((a) => a.id !== entry.id)];
    emit();
    // Capped: a relayed transaction can be replaced under a new hash, and an
    // unbounded wait here would block every later private send.
    const settled = getProvider()
      .waitForTransaction(hash, 1, 10 * 60_000)
      .then(
        async (r) => {
          const done = { ...entry, status: r?.status === 1 ? ('done' as const) : ('failed' as const) };
          await recordActivity(done).catch(() => {});
          state.activity = state.activity.map((a) => (a.id === done.id ? done : a));
          emit();
          if (kind !== 'send') await sync();
        },
        () => {},
      );
    if (kind === 'transfer' || kind === 'unshield') settling = settled;
    return hash;
  };

  const broadcast = async (tx: TransactionRequest, label: string): Promise<string> => track((await payer.sendTransaction(tx)).hash, label);

  const withProof = async <T>(label: string, fn: (cb: (p: number) => void) => Promise<T>): Promise<T> => {
    state.proof = { label, progress: 0 };
    emit();
    try {
      return await fn((p) => {
        state.proof = { label, progress: p / 100 };
        emit();
      });
    } finally {
      state.proof = null;
      emit();
    }
  };

  // Gas for private sends: Pangolin's sponsor (default), a RAILGUN broadcaster, or Main.
  const viaBroadcaster = intent.from === 'private' && intent.via === 'broadcaster';
  const viaSponsor = intent.from === 'private' && (intent.via ?? 'sponsor') === 'sponsor';
  const base = { kind, from: intent.from, to, amount, symbol: 'ETH', gasFrom: intent.from === 'private' && !viaBroadcaster && !viaSponsor ? gasFrom : null, broadcasterFee: null, ...(resolved ? { name: typed.toLowerCase(), resolvedVia: resolved.via } : {}) };

  switch (kind) {
    case 'send': {
      const tx = { to: getAddress(to), value: amount };
      const gas = await getProvider().estimateGas({ ...tx, from: payer.address });
      return { ...base, gasFee: gas * maxFeePerGas, needsProof: false, run: () => broadcast(tx, `Sent to ${to.slice(0, 10)}…`) };
    }

    case 'shield': {
      const key = await shieldKey(gasFrom);
      const { gasEstimate } = await gasEstimateForShieldBaseToken(V2, NETWORK, to, key, weth, payer.address);
      return {
        ...base,
        gasFee: gasEstimate * maxFeePerGas,
        needsProof: false,
        run: async () => {
          const { transaction } = await populateShieldBaseToken(V2, NETWORK, to, key, weth, await gasDetails(gasEstimate));
          return broadcast(transaction, to === state.railgunAddress ? 'Made private' : 'Sent privately from public');
        },
      };
    }

    case 'transfer':
    case 'unshield': {
      await settling;
      if (amount > spendable()) throw new Error('More than your spendable private balance');
      const id = currentWalletId();
      const recipientsB = [{ ...weth, recipientAddress: to }];
      if (viaBroadcaster || viaSponsor) {
        // Unshielding to ETH goes through the Relay Adapt contract; the broadcaster must support it.
        const useRelayAdapt = kind === 'unshield';
        const b = viaBroadcaster ? pickBroadcaster(WETH, useRelayAdapt) : null;
        if (viaBroadcaster && !b) throw new Error('No broadcaster online yet. Retry, or pick another gas route');
        // The sponsor charges nothing on testnet. Its "fee" is 1 wei to this wallet,
        // placed first, so this wallet can submit the send's POIs like a broadcaster.
        const feeToken = { tokenAddress: WETH, feePerUnitGas: b?.feePerUnitGas ?? 0n };
        // Broadcasters commit to one minimum gas price, so the SDK requires type-1 gas here.
        const gasPrice = (await getProvider().getFeeData()).gasPrice ?? 1_000_000_000n;
        const t1 = (gasEstimate: bigint): TransactionGasDetails => ({ evmGasType: EVMGasType.Type1, gasEstimate, gasPrice });
        const { gasEstimate } =
          kind === 'transfer'
            ? await gasEstimateForUnprovenTransfer(V2, NETWORK, id, u.railgunKey, undefined, recipientsB, [], t1(0n), feeToken, false)
            : await gasEstimateForUnprovenUnshieldBaseToken(V2, NETWORK, to, id, u.railgunKey, weth, t1(0n), feeToken, false);
        const gd = t1(gasEstimate);
        const { amount: feeAmount } = await calculateBroadcasterFeeERC20Amount(feeToken, gd);
        if (amount + (b ? feeAmount : 1n) > spendable()) throw new Error('Amount plus broadcaster fee exceeds your private balance');
        const fee = b
          ? { tokenAddress: WETH, amount: feeAmount, recipientAddress: b.railgunAddress }
          : { tokenAddress: WETH, amount: 1n, recipientAddress: state.railgunAddress as string };
        const minGas = calculateGasPrice(gd);
        return {
          ...base,
          symbol: 'WETH',
          gasFee: 0n,
          broadcasterFee: b ? feeAmount : 0n,
          needsProof: true,
          run: async () => {
            let populated;
            if (kind === 'transfer') {
              await withProof('Proving', (cb) =>
                generateTransferProof(V2, NETWORK, id, u.railgunKey, false, undefined, recipientsB, [], fee, false, minGas, cb),
              );
              populated = await populateProvedTransfer(V2, NETWORK, id, false, undefined, recipientsB, [], fee, false, minGas, gd);
            } else {
              await withProof('Proving', (cb) =>
                generateUnshieldBaseTokenProof(V2, NETWORK, to, id, u.railgunKey, weth, fee, false, minGas, cb),
              );
              populated = await populateProvedUnshieldBaseToken(V2, NETWORK, to, id, weth, fee, false, minGas, gd);
            }
            const hash = b
              ? await submitViaBroadcaster({
                  to: populated.transaction.to as string,
                  data: populated.transaction.data as string,
                  broadcaster: b,
                  nullifiers: populated.nullifiers ?? [],
                  overallBatchMinGasPrice: minGas,
                  useRelayAdapt,
                  pois: populated.preTransactionPOIsPerTxidLeafPerList,
                })
              : await sponsorRelay(
                  populated.transaction.to as string,
                  populated.transaction.data as string,
                  minGas,
                  (populated.transaction as { authorizationList?: Parameters<typeof sponsorRelay>[3] }).authorizationList,
                );
            if (!b) {
              void assurePOI({
                txHash: hash,
                transaction: populated.transaction,
                useRelayAdapt,
                pois: populated.preTransactionPOIsPerTxidLeafPerList,
              });
            }
            return track(hash, kind === 'transfer' ? `Sent privately to ${to.slice(0, 10)}…` : `Made public to ${to.slice(0, 10)}…`);
          },
        };
      }
      const og = await gasDetails(0n);
      const recipients = [{ ...weth, recipientAddress: to }];
      const { gasEstimate } =
        kind === 'transfer'
          ? await gasEstimateForUnprovenTransfer(V2, NETWORK, id, u.railgunKey, undefined, recipients, [], og, undefined, true)
          : await gasEstimateForUnprovenUnshieldBaseToken(V2, NETWORK, to, id, u.railgunKey, weth, og, undefined, true);
      return {
        ...base,
        symbol: 'WETH',
        gasFee: gasEstimate * maxFeePerGas,
        needsProof: true,
        run: async () => {
          if (kind === 'transfer') {
            await withProof('Proving', (cb) =>
              generateTransferProof(V2, NETWORK, id, u.railgunKey, false, undefined, recipients, [], undefined, true, undefined, cb),
            );
            const { transaction } = await populateProvedTransfer(
              V2, NETWORK, id, false, undefined, recipients, [], undefined, true, undefined, await gasDetails(gasEstimate),
            );
            return broadcast(transaction, `Sent privately to ${to.slice(0, 10)}…`);
          }
          await withProof('Proving', (cb) =>
            generateUnshieldBaseTokenProof(V2, NETWORK, to, id, u.railgunKey, weth, undefined, true, undefined, cb),
          );
          const { transaction } = await populateProvedUnshieldBaseToken(
            V2, NETWORK, to, id, weth, undefined, true, undefined, await gasDetails(gasEstimate),
          );
          return broadcast(transaction, `Made public to ${to.slice(0, 10)}…`);
        },
      };
    }
  }
};

export const planSend = async (intent: SendIntent, u: Unlocked): Promise<SendPlan> => {
  const { run: _run, ...plan } = await prepare(intent, u);
  return plan;
};

export const executeSend = async (intent: SendIntent, u: Unlocked): Promise<{ hash: string }> => {
  const p = await prepare(intent, u);
  return { hash: await p.run() };
};
