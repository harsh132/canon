import {
  gasEstimateForShield,
  gasEstimateForShieldBaseToken,
  gasEstimateForUnprovenTransfer,
  gasEstimateForUnprovenUnshield,
  gasEstimateForUnprovenUnshieldBaseToken,
  generateTransferProof,
  generateUnshieldBaseTokenProof,
  generateUnshieldProof,
  getShieldPrivateKeySignatureMessage,
  populateProvedTransfer,
  populateProvedUnshield,
  populateProvedUnshieldBaseToken,
  populateShield,
  populateShieldBaseToken,
  validateRailgunAddress,
  calculateBroadcasterFeeERC20Amount,
} from '@railgun-community/wallet';
import {
  EVMGasType,
  NETWORK_CONFIG,
  TXIDVersion,
  calculateGasPrice,
  type FeeTokenDetails,
  type RailgunERC20AmountRecipient,
  type TransactionGasDetails,
} from '@railgun-community/shared-models';
import { Contract, getAddress, keccak256, parseUnits, type TransactionRequest } from 'ethers';
import type { SendIntent, SendKind, SendPlan } from '../shared/protocol';
import { isHexAddress, isZk } from '../shared/format';
import { tokensOn } from '../shared/networks';
import { recordActivity, signerFor } from './book';
import { CHAIN_ID, NETWORK, WETH, getProvider } from './config';
import { currentWalletId, spendable, sync } from './railgun';
import { pickBroadcaster, submitViaBroadcaster } from './broadcaster';
import { isName, resolveName, sponsorRelay } from './ens';
import { emit, state } from './state';
import type { Unlocked } from './vault';

// One Send. Source and recipient kind decide the operation; the user never picks it.
//   public  -> 0x   send
//   public  -> 0zk  shield     ("Make private")
//   private -> 0zk  transfer   ("Send privately")
//   private -> 0x   unshield   ("Make public")
// ETH by default (private WETH, which leaves as ETH). Any listed or custom
// ERC-20 on the private network takes the same four paths as itself.

const V2 = TXIDVersion.V2_PoseidonMerkle;

const ERC20 = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
];

const kindOf = (from: SendIntent['from'], to: string): SendKind => {
  if (isZk(to)) {
    if (!validateRailgunAddress(to.trim())) throw new Error('Not a valid 0zk address');
    return from === 'private' ? 'transfer' : 'shield';
  }
  if (isHexAddress(to)) return from === 'private' ? 'unshield' : 'send';
  throw new Error('Enter a 0x or 0zk address');
};

const parseAmount = (s: string, decimals: number): bigint => {
  let v: bigint;
  try {
    v = parseUnits(s.trim() || '0', decimals);
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
  const isEth = !intent.token || intent.token.toLowerCase() === WETH.toLowerCase();
  const token = isEth ? null : (tokensOn(CHAIN_ID, state.tokens).find((t) => t.address.toLowerCase() === intent.token!.toLowerCase()) ?? null);
  if (!isEth && !token) throw new Error('Not a token in your list');
  const amount = parseAmount(intent.amount, token?.decimals ?? 18);
  const gasFrom = intent.from === 'private' ? (intent.gasFrom ?? 0) : intent.from;
  const payer = signerFor(gasFrom).connect(getProvider());
  // What moves: WETH (as ETH) or the token. Fees are always in WETH.
  const asset = { tokenAddress: token?.address ?? WETH, amount };
  const erc20 = token ? new Contract(token.address, ERC20, payer) : null;
  const { maxFeePerGas } = await fees();
  if (erc20 && intent.from !== 'private' && ((await erc20.balanceOf(payer.address)) as bigint) < amount) {
    throw new Error(`More than this account's ${token!.symbol}`);
  }

  const track = (hash: string, label: string): string => {
    const entry = { id: hash, kind, label, amount: token ? `${intent.amount} ${token.symbol}` : intent.amount, hash, at: Date.now(), status: 'pending' as const };
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

  // Gas for private sends: Canon's sponsor (default), a RAILGUN broadcaster, or Main.
  const viaBroadcaster = intent.from === 'private' && intent.via === 'broadcaster';
  const viaSponsor = intent.from === 'private' && (intent.via ?? 'sponsor') === 'sponsor';
  const base = { kind, from: intent.from, to, amount, symbol: token?.symbol ?? 'ETH', gasFrom: intent.from === 'private' && !viaBroadcaster && !viaSponsor ? gasFrom : null, broadcasterFee: null, ...(resolved ? { name: typed.toLowerCase(), resolvedVia: resolved.via } : {}) };

  switch (kind) {
    case 'send': {
      const tx = erc20
        ? { to: token!.address, data: erc20.interface.encodeFunctionData('transfer', [getAddress(to), amount]) }
        : { to: getAddress(to), value: amount };
      const gas = await getProvider().estimateGas({ ...tx, from: payer.address });
      return { ...base, gasFee: gas * maxFeePerGas, needsProof: false, run: () => broadcast(tx, `Sent to ${to.slice(0, 10)}…`) };
    }

    case 'shield': {
      const key = await shieldKey(gasFrom);
      const label = to === state.railgunAddress ? 'Made private' : 'Sent privately from public';
      if (erc20) {
        // An ERC-20 shield pulls the token, so RAILGUN needs an allowance first: exactly this amount.
        const rcpt = [{ ...asset, recipientAddress: to }];
        const spender = NETWORK_CONFIG[NETWORK].proxyContract;
        const approve = { to: token!.address, data: erc20.interface.encodeFunctionData('approve', [spender, amount]) };
        const needsApprove = ((await erc20.allowance(payer.address, spender)) as bigint) < amount;
        // ponytail: a shield cannot be simulated before its approval exists, so the fee shown then
        // assumes a typical ERC-20 shield; the real estimate runs once the approval lands.
        const shieldGas = needsApprove ? 900_000n : (await gasEstimateForShield(V2, NETWORK, key, rcpt, [], payer.address)).gasEstimate;
        const approveGas = needsApprove ? await getProvider().estimateGas({ ...approve, from: payer.address }) : 0n;
        return {
          ...base,
          gasFee: (shieldGas + approveGas) * maxFeePerGas,
          needsProof: false,
          run: async () => {
            if (needsApprove) await (await payer.sendTransaction(approve)).wait();
            const { gasEstimate } = await gasEstimateForShield(V2, NETWORK, key, rcpt, [], payer.address);
            const { transaction } = await populateShield(V2, NETWORK, key, rcpt, [], await gasDetails(gasEstimate));
            return broadcast(transaction, label);
          },
        };
      }
      const { gasEstimate } = await gasEstimateForShieldBaseToken(V2, NETWORK, to, key, asset, payer.address);
      return {
        ...base,
        gasFee: gasEstimate * maxFeePerGas,
        needsProof: false,
        run: async () => {
          const { transaction } = await populateShieldBaseToken(V2, NETWORK, to, key, asset, await gasDetails(gasEstimate));
          return broadcast(transaction, label);
        },
      };
    }

    case 'transfer':
    case 'unshield': {
      await settling;
      if (amount > spendable(asset.tokenAddress)) throw new Error('More than your spendable private balance');
      const id = currentWalletId();
      const recipients = [{ ...asset, recipientAddress: to }];
      // ETH leaves through Relay Adapt, unwrapped; any other token is a plain ERC-20 unshield.
      type Fee = RailgunERC20AmountRecipient | undefined;
      const unshieldEstimate = (gd: TransactionGasDetails, feeToken: FeeTokenDetails | undefined, pub: boolean) =>
        token
          ? gasEstimateForUnprovenUnshield(V2, NETWORK, id, u.railgunKey, recipients, [], gd, feeToken, pub)
          : gasEstimateForUnprovenUnshieldBaseToken(V2, NETWORK, to, id, u.railgunKey, asset, gd, feeToken, pub);
      const unshieldProve = (fee: Fee, pub: boolean, minGas: bigint | undefined, cb: (p: number) => void) =>
        token
          ? generateUnshieldProof(V2, NETWORK, id, u.railgunKey, recipients, [], fee, pub, minGas, cb)
          : generateUnshieldBaseTokenProof(V2, NETWORK, to, id, u.railgunKey, asset, fee, pub, minGas, cb);
      const unshieldPopulate = (fee: Fee, pub: boolean, minGas: bigint | undefined, gd: TransactionGasDetails) =>
        token
          ? populateProvedUnshield(V2, NETWORK, id, recipients, [], fee, pub, minGas, gd)
          : populateProvedUnshieldBaseToken(V2, NETWORK, to, id, asset, fee, pub, minGas, gd);
      if (viaBroadcaster || viaSponsor) {
        // Unshielding to ETH goes through the Relay Adapt contract; the broadcaster must support it.
        const useRelayAdapt = kind === 'unshield' && !token;
        const b = viaBroadcaster ? pickBroadcaster(WETH, useRelayAdapt) : null;
        if (viaBroadcaster && !b) throw new Error('No broadcaster online yet. Retry, or pick another gas route');
        // A broadcaster takes a fee note in private WETH. The sponsor charges nothing on
        // testnet. In broadcaster mode the SDK's Relay Adapt dummy proofs need a fee note,
        // so WETH made public as ETH carries 1 wei to this wallet; other sponsored sends
        // carry none and estimate as public-wallet ones, because the SDK's dummy fee would
        // need private WETH. The sponsor sets the gas itself.
        const feeToken = b || useRelayAdapt ? { tokenAddress: WETH, feePerUnitGas: b?.feePerUnitGas ?? 0n } : undefined;
        // Broadcasters commit to one minimum gas price, so the SDK requires type-1 gas here.
        const gasPrice = (await getProvider().getFeeData()).gasPrice ?? 1_000_000_000n;
        const t1 = (gasEstimate: bigint): TransactionGasDetails => ({ evmGasType: EVMGasType.Type1, gasEstimate, gasPrice });
        const { gasEstimate } =
          kind === 'transfer'
            ? await gasEstimateForUnprovenTransfer(V2, NETWORK, id, u.railgunKey, undefined, recipients, [], t1(0n), feeToken, !feeToken)
            : await unshieldEstimate(t1(0n), feeToken, !feeToken);
        const gd = t1(gasEstimate);
        const feeAmount = b && feeToken ? (await calculateBroadcasterFeeERC20Amount(feeToken, gd)).amount : 0n;
        const fee = b
          ? { tokenAddress: WETH, amount: feeAmount, recipientAddress: b.railgunAddress }
          : useRelayAdapt
            ? { tokenAddress: WETH, amount: 1n, recipientAddress: state.railgunAddress as string }
            : undefined;
        const feeNeed = fee?.amount ?? 0n;
        if (token ? feeNeed > spendable() : amount + feeNeed > spendable()) {
          throw new Error(token ? 'The fee is paid in private ETH, and there is too little' : 'Amount plus broadcaster fee exceeds your private balance');
        }
        const minGas = calculateGasPrice(gd);
        return {
          ...base,
          symbol: token?.symbol ?? 'WETH',
          gasFee: 0n,
          broadcasterFee: b ? feeAmount : 0n,
          needsProof: true,
          run: async () => {
            let populated;
            if (kind === 'transfer') {
              await withProof('Proving', (cb) =>
                generateTransferProof(V2, NETWORK, id, u.railgunKey, false, undefined, recipients, [], fee, false, minGas, cb),
              );
              populated = await populateProvedTransfer(V2, NETWORK, id, false, undefined, recipients, [], fee, false, minGas, gd);
            } else {
              await withProof('Proving', (cb) => unshieldProve(fee, false, minGas, cb));
              populated = await unshieldPopulate(fee, false, minGas, gd);
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
            return track(hash, kind === 'transfer' ? `Sent privately to ${to.slice(0, 10)}…` : `Made public to ${to.slice(0, 10)}…`);
          },
        };
      }
      const og = await gasDetails(0n);
      const { gasEstimate } =
        kind === 'transfer'
          ? await gasEstimateForUnprovenTransfer(V2, NETWORK, id, u.railgunKey, undefined, recipients, [], og, undefined, true)
          : await unshieldEstimate(og, undefined, true);
      return {
        ...base,
        symbol: token?.symbol ?? 'WETH',
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
          await withProof('Proving', (cb) => unshieldProve(undefined, true, undefined, cb));
          const { transaction } = await unshieldPopulate(undefined, true, undefined, await gasDetails(gasEstimate));
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
