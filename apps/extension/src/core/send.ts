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
} from '@railgun-community/wallet';
import { EVMGasType, TXIDVersion, type TransactionGasDetails } from '@railgun-community/shared-models';
import { getAddress, keccak256, parseEther, type TransactionRequest } from 'ethers';
import type { SendIntent, SendKind, SendPlan } from '../shared/protocol';
import { isHexAddress, isZk } from '../shared/format';
import { recordActivity, signerFor } from './book';
import { NETWORK, WETH, getProvider } from './config';
import { currentWalletId, spendable, sync } from './railgun';
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

const prepare = async (intent: SendIntent, u: Unlocked): Promise<Prepared> => {
  const to = intent.to.trim();
  const kind = kindOf(intent.from, to);
  const amount = parseAmount(intent.amount);
  const gasFrom = intent.from === 'private' ? (intent.gasFrom ?? 0) : intent.from;
  const payer = signerFor(gasFrom).connect(getProvider());
  const weth = { tokenAddress: WETH, amount };
  const { maxFeePerGas } = await fees();

  const broadcast = async (tx: TransactionRequest, label: string): Promise<string> => {
    const sent = await payer.sendTransaction(tx);
    const entry = { id: sent.hash, kind, label, amount: intent.amount, hash: sent.hash, at: Date.now(), status: 'pending' as const };
    await recordActivity(entry);
    state.activity = [entry, ...state.activity.filter((a) => a.id !== entry.id)];
    emit();
    void sent.wait().then(
      async (r) => {
        const done = { ...entry, status: r?.status === 1 ? ('done' as const) : ('failed' as const) };
        await recordActivity(done).catch(() => {});
        state.activity = state.activity.map((a) => (a.id === done.id ? done : a));
        emit();
        if (kind !== 'send') void sync();
      },
      () => {},
    );
    return sent.hash;
  };

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

  const base = { kind, from: intent.from, to, amount, symbol: 'ETH', gasFrom: intent.from === 'private' ? gasFrom : null };

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
      if (amount > spendable()) throw new Error('More than your spendable private balance');
      const id = currentWalletId();
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
