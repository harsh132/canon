// Signing shared by WalletConnect and the injected provider. Only these
// methods are ever signed; eth_sign (blind digest signing) is not one of them.
import { getBytes, isHexString, toUtf8String, type TransactionRequest } from 'ethers';
import { isSiteAccount, recordActivity, signerFor } from './book';
import { sponsoredExecute } from './smart';
import { CHAIN_ID, getProvider } from './config';

export const SIGN_METHODS = ['personal_sign', 'eth_signTypedData', 'eth_signTypedData_v3', 'eth_signTypedData_v4', 'eth_sendTransaction', 'wallet_sendCalls'];

export class RpcError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

/** An EIP-7702 delegation installs code on the account. Never signed. */
export const isDelegation = (method: string, params: unknown[]): boolean => {
  if (method !== 'eth_sendTransaction') return false;
  const tx = params?.[0] as Record<string, unknown> | undefined;
  return Boolean(tx && ('authorizationList' in tx || tx.type === '0x4' || tx.type === 4));
};

const decodeMessage = (raw: unknown): string => {
  if (typeof raw !== 'string') throw new Error('Malformed request');
  if (!isHexString(raw)) return raw;
  try {
    return toUtf8String(raw);
  } catch {
    return raw;
  }
};

type TypedData = { domain: Record<string, unknown>; types: Record<string, unknown>; message: Record<string, unknown>; primaryType?: string };
const typedData = (params: unknown[]): TypedData => {
  // v3/v4 put the address first; legacy v1 puts it second. Take whichever is the payload.
  const raw = typeof params[0] === 'string' && /^0x[0-9a-fA-F]{40}$/.test(params[0]) ? params[1] : (params[1] ?? params[0]);
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== 'object') throw new Error('Malformed typed data');
  return parsed as TypedData;
};

export const summarize = (method: string, params: unknown[]): { title: string; detail: string; isTransaction: boolean } => {
  try {
    if (method === 'personal_sign') return { title: 'Sign message', detail: decodeMessage(params[0]), isTransaction: false };
    if (method.startsWith('eth_signTypedData')) {
      const d = typedData(params);
      return { title: `Sign ${d.primaryType ?? 'data'}`, detail: JSON.stringify(d.message ?? {}, null, 2).slice(0, 1200), isTransaction: false };
    }
    if (method === 'eth_sendTransaction') {
      const tx = (params[0] ?? {}) as { to?: string; value?: string; data?: string };
      return {
        title: 'Send transaction',
        isTransaction: true,
        detail: [
          `to ${tx.to ?? 'new contract'}`,
          `value ${tx.value ? BigInt(tx.value).toString() : '0'} wei`,
          tx.data && tx.data !== '0x' ? `data ${tx.data.slice(0, 66)}…` : 'no data',
        ].join('\n'),
      };
    }
    if (method === 'wallet_sendCalls') {
      const calls = ((params[0] ?? {}) as { calls?: { to?: string; value?: string; data?: string }[] }).calls ?? [];
      return {
        title: calls.length === 1 ? 'Send transaction' : `Send ${calls.length} calls`,
        isTransaction: true,
        detail: calls
          .map((c, i) => `${i + 1}. to ${c.to ?? '?'}  value ${c.value ? BigInt(c.value).toString() : '0'} wei  ${c.data && c.data !== '0x' ? `data ${c.data.slice(0, 10)}…` : 'no data'}`)
          .join('\n'),
      };
    }
  } catch (e) {
    return { title: method, detail: (e as Error).message, isTransaction: false };
  }
  return { title: method, detail: '', isTransaction: false };
};

export const execute = async (index: number, method: string, params: unknown[], dapp: string): Promise<unknown> => {
  if (isDelegation(method, params)) throw new RpcError(4001, 'Pangolin does not sign account delegations');
  const signer = signerFor(index);
  if (method === 'personal_sign') {
    const raw = params[0] as string;
    return signer.signMessage(isHexString(raw) ? getBytes(raw) : raw);
  }
  if (method.startsWith('eth_signTypedData')) {
    const d = typedData(params);
    const types = { ...d.types };
    delete types.EIP712Domain;
    return signer.signTypedData(d.domain as never, types as never, d.message as never);
  }
  // Site addresses: gas sponsored through EIP-7702 + Calibur (smart.ts).
  if (method === 'eth_sendTransaction' && isSiteAccount(index)) {
    const p = params[0] as { to?: string; value?: string; data?: string };
    if (!p.to) throw new RpcError(4200, 'Contract creation is not supported from a site address');
    const hash = await sponsoredExecute(signer, [{ to: p.to, value: BigInt(p.value ?? 0), data: p.data ?? '0x' }]);
    await recordActivity({ id: hash, kind: 'dapp', label: dapp, hash, at: Date.now(), status: 'pending' }).catch(() => {});
    return hash;
  }
  // EIP-5792: a batch runs atomically as one Calibur call. The batch id is the transaction hash.
  if (method === 'wallet_sendCalls') {
    if (!isSiteAccount(index)) throw new RpcError(5700, 'Batched calls need a site address');
    const req = (params[0] ?? {}) as { chainId?: string; calls?: { to?: string; value?: string; data?: string }[] };
    if (req.chainId && BigInt(req.chainId) !== BigInt(CHAIN_ID)) throw new RpcError(5710, 'Sepolia only');
    const calls = (req.calls ?? []).map((c) => {
      if (!c.to) throw new RpcError(4200, 'Contract creation is not supported');
      return { to: c.to, value: BigInt(c.value ?? 0), data: c.data ?? '0x' };
    });
    const hash = await sponsoredExecute(signer, calls);
    await recordActivity({ id: hash, kind: 'dapp', label: dapp, hash, at: Date.now(), status: 'pending' }).catch(() => {});
    return { id: hash };
  }
  if (method === 'eth_sendTransaction') {
    const p = params[0] as TransactionRequest & { gas?: string };
    const tx: TransactionRequest = { ...p };
    delete (tx as Record<string, unknown>).gas;
    delete (tx as Record<string, unknown>).from;
    if (p.gas) tx.gasLimit = BigInt(p.gas);
    const sent = await signer.connect(getProvider()).sendTransaction(tx);
    await recordActivity({ id: sent.hash, kind: 'dapp', label: dapp, hash: sent.hash, at: Date.now(), status: 'pending' }).catch(() => {});
    return sent.hash;
  }
  throw new RpcError(4200, `${method} is not supported`);
};
