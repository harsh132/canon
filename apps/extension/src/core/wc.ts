import { Core } from '@walletconnect/core';
import { WalletKit, type IWalletKit, type WalletKitTypes } from '@reown/walletkit';
import { buildApprovedNamespaces, getSdkError } from '@walletconnect/utils';
import { getBytes, isHexString, toUtf8String, type TransactionRequest } from 'ethers';
import type { Verification, WcProposalView, WcRequestView } from '../shared/protocol';
import { bind, bindingFor, createAccount, indexOfAddress, nextIndex, recordActivity, signerFor, accounts } from './book';
import { CAIP_CHAIN, WC_PROJECT_ID, getProvider } from './config';
import { dappKeyFor } from './dapp-origin';
import { emit, state } from './state';

// Every dapp gets its own public address. A first contact gets a fresh HD
// index labelled with the dapp's name; a reconnect gets the address it saw
// before. Nothing is auto-approved.

const METHODS = ['personal_sign', 'eth_signTypedData', 'eth_signTypedData_v3', 'eth_signTypedData_v4', 'eth_sendTransaction'];
const EVENTS = ['accountsChanged', 'chainChanged'];

let kit: IWalletKit | null = null;
let proposal: WalletKitTypes.SessionProposal | null = null;
let chosen: number | 'new' | null = null;
const requests: WalletKitTypes.SessionRequest[] = [];

let isUnlocked = (): boolean => false;
let prompt = (): void => {};

export const configureWc = (opts: { isUnlocked: () => boolean; prompt: () => void }): void => {
  isUnlocked = opts.isUnlocked;
  prompt = opts.prompt;
};

const sessionAddress = (topic: string): string | null =>
  kit?.getActiveSessions()[topic]?.namespaces?.eip155?.accounts?.[0]?.split(':')[2] ?? null;

const identify = (p: WalletKitTypes.SessionProposal) => {
  const meta = p.params.proposer.metadata;
  const verified = p.verifyContext?.verified;
  const attestedKey = dappKeyFor(verified?.origin);
  const key = attestedKey ?? dappKeyFor(meta?.url);
  const v = verified?.validation;
  const verification: Verification = verified?.isScam
    ? 'SCAM'
    : v === 'VALID' || v === 'INVALID' || v === 'UNKNOWN'
      ? v
      : 'UNKNOWN';
  return { key, attested: attestedKey !== null, verification, name: meta?.name || key || 'Unknown app', icon: meta?.icons?.[0] ?? null };
};

const chainsOf = (ns: Record<string, { chains?: string[] }> | undefined): string[] =>
  Object.entries(ns ?? {}).flatMap(([k, v]) => [...(k.includes(':') ? [k] : []), ...(v.chains ?? [])]);

const proposalView = (): WcProposalView | null => {
  if (!proposal) return null;
  const id = identify(proposal);
  const required = chainsOf(proposal.params.requiredNamespaces);
  const optional = chainsOf(proposal.params.optionalNamespaces);
  const ours = [...required, ...optional].includes(CAIP_CHAIN) || (required.length === 0 && optional.length === 0);
  const missing = required.filter((c) => c !== CAIP_CHAIN);
  const problem = id.verification === 'SCAM'
    ? 'Flagged as a scam'
    : missing.length
      ? `Needs ${missing.join(', ')}`
      : !ours
        ? 'No Sepolia in request'
        : undefined;

  let account: WcProposalView['account'] = null;
  if (isUnlocked()) {
    const bound = id.key ? bindingFor(id.key) : null;
    const pick = chosen ?? (bound && accounts().some((a) => a.index === bound.index) ? bound.index : 'new');
    if (pick === 'new') {
      const index = nextIndex();
      account = { index, address: signerFor(index).address, label: id.name.slice(0, 32), isNew: true };
    } else {
      const rec = accounts().find((a) => a.index === pick);
      if (rec) account = { index: rec.index, address: signerFor(rec.index).address, label: rec.label, isNew: false };
    }
  }
  return {
    id: proposal.id,
    name: id.name,
    origin: id.key,
    attested: id.attested,
    verification: id.verification,
    icon: id.icon,
    canApprove: !problem,
    problem,
    account,
  };
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
  const raw = params[1] ?? params[0];
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== 'object') throw new Error('Malformed typed data');
  return parsed as TypedData;
};

const requestView = (): WcRequestView | null => {
  const r = requests[0];
  if (!r) return null;
  const { method, params } = r.params.request as { method: string; params: unknown[] };
  const address = sessionAddress(r.topic);
  const index = address && isUnlocked() ? indexOfAddress(address) : null;
  const label = index != null ? accounts().find((a) => a.index === index)?.label ?? '' : '';
  const dapp = kit?.getActiveSessions()[r.topic]?.peer.metadata.name ?? 'App';
  let title = method;
  let detail = '';
  let isTransaction = false;
  try {
    if (method === 'personal_sign') {
      title = 'Sign message';
      detail = decodeMessage(params[0]);
    } else if (method.startsWith('eth_signTypedData')) {
      const d = typedData(params);
      title = `Sign ${d.primaryType ?? 'data'}`;
      detail = JSON.stringify(d.message ?? {}, null, 2).slice(0, 1200);
    } else if (method === 'eth_sendTransaction') {
      const tx = (params[0] ?? {}) as { to?: string; value?: string; data?: string };
      title = 'Send transaction';
      isTransaction = true;
      detail = [
        `to ${tx.to ?? 'new contract'}`,
        `value ${tx.value ? BigInt(tx.value).toString() : '0'} wei`,
        tx.data && tx.data !== '0x' ? `data ${tx.data.slice(0, 66)}…` : 'no data',
      ].join('\n');
    }
  } catch (e) {
    detail = String((e as Error).message);
  }
  return {
    id: r.id,
    topic: r.topic,
    dapp,
    method,
    title,
    detail,
    isTransaction,
    account: index != null && address ? { index, address, label } : null,
  };
};

export const refreshWc = (): void => {
  if (!kit) return;
  state.wc.sessions = Object.values(kit.getActiveSessions()).map((s) => ({
    topic: s.topic,
    name: s.peer.metadata.name,
    url: s.peer.metadata.url,
    icon: s.peer.metadata.icons?.[0] ?? null,
    address: s.namespaces.eip155?.accounts?.[0]?.split(':')[2] ?? '',
  }));
  state.wc.proposal = proposalView();
  state.wc.request = requestView();
  emit();
};

const respondError = async (r: WalletKitTypes.SessionRequest, code: number, message: string) => {
  await kit?.respondSessionRequest({ topic: r.topic, response: { id: r.id, jsonrpc: '2.0', error: { code, message } } }).catch(() => {});
};

export const startWc = async (): Promise<void> => {
  if (!WC_PROJECT_ID || kit) return;
  try {
    const core = new Core({ projectId: WC_PROJECT_ID, telemetryEnabled: false });
    kit = await WalletKit.init({
      core,
      metadata: {
        name: 'Pangolin',
        description: 'Private wallet',
        url: location.origin,
        icons: [],
      },
    });
  } catch (e) {
    state.wc.error = (e as Error).message;
    emit();
    return;
  }
  kit.on('session_proposal', (p) => {
    proposal = p;
    chosen = null;
    refreshWc();
    prompt();
  });
  kit.on('session_request', (r) => {
    const { method, params } = r.params.request as { method: string; params: unknown[] };
    const tx = method === 'eth_sendTransaction' ? (params?.[0] as Record<string, unknown> | undefined) : undefined;
    // An EIP-7702 delegation installs code on the account. Never signed.
    if (tx && ('authorizationList' in tx || tx.type === '0x4' || tx.type === 4)) {
      void respondError(r, 4001, 'Pangolin does not sign account delegations');
      return;
    }
    if (!METHODS.includes(method)) {
      void respondError(r, -32601, `${method} is not supported`);
      return;
    }
    requests.push(r);
    refreshWc();
    prompt();
  });
  kit.on('session_delete', () => refreshWc());
  state.wc.ready = true;
  refreshWc();
};

const needKit = (): IWalletKit => {
  if (!kit) throw new Error(WC_PROJECT_ID ? 'WalletConnect is starting' : 'No WalletConnect project id');
  return kit;
};

export const pair = async (uri: string): Promise<void> => {
  if (!uri.trim().startsWith('wc:')) throw new Error('Paste a wc: link');
  await needKit().pair({ uri: uri.trim() });
};

export const chooseAccount = (index: number | 'new'): void => {
  chosen = index;
  refreshWc();
};

export const approveProposal = async (): Promise<void> => {
  const k = needKit();
  const view = proposalView();
  if (!proposal || !view) throw new Error('Nothing to approve');
  if (!view.account) throw new Error('Unlock first');
  if (!view.canApprove) throw new Error(view.problem ?? 'Cannot connect');
  const namespaces = buildApprovedNamespaces({
    proposal: proposal.params,
    supportedNamespaces: {
      eip155: { chains: [CAIP_CHAIN], methods: METHODS, events: EVENTS, accounts: [`${CAIP_CHAIN}:${view.account.address}`] },
    },
  });
  // Mint before approving: a live session must never sign as an address the book lacks.
  if (view.account.isNew) await createAccount(view.account.label, view.account.index);
  await k.approveSession({ id: proposal.id, namespaces });
  if (view.origin) {
    await bind(view.origin, { index: view.account.index, name: view.name, icon: view.icon, verification: view.verification }).catch(
      () => {},
    );
  }
  proposal = null;
  chosen = null;
  refreshWc();
};

export const rejectProposal = async (): Promise<void> => {
  if (proposal) await needKit().rejectSession({ id: proposal.id, reason: getSdkError('USER_REJECTED') }).catch(() => {});
  proposal = null;
  chosen = null;
  refreshWc();
};

export const approveRequest = async (): Promise<void> => {
  const k = needKit();
  const r = requests[0];
  const view = requestView();
  if (!r || !view) throw new Error('Nothing to approve');
  if (!view.account) throw new Error('Unlock first');
  const signer = signerFor(view.account.index);
  const { method, params } = r.params.request as { method: string; params: unknown[] };
  let result: string;
  if (method === 'personal_sign') {
    const raw = params[0] as string;
    result = await signer.signMessage(isHexString(raw) ? getBytes(raw) : raw);
  } else if (method.startsWith('eth_signTypedData')) {
    const d = typedData(params);
    const types = { ...d.types };
    delete types.EIP712Domain;
    result = await signer.signTypedData(d.domain as never, types as never, d.message as never);
  } else {
    const tx = { ...(params[0] as TransactionRequest) };
    delete (tx as Record<string, unknown>).gas;
    const p = params[0] as { gas?: string };
    if (p.gas) tx.gasLimit = BigInt(p.gas);
    const sent = await signer.connect(getProvider()).sendTransaction(tx);
    result = sent.hash;
    await recordActivity({ id: sent.hash, kind: 'dapp', label: view.dapp, hash: sent.hash, at: Date.now(), status: 'pending' }).catch(() => {});
  }
  await k.respondSessionRequest({ topic: r.topic, response: { id: r.id, jsonrpc: '2.0', result } });
  requests.shift();
  refreshWc();
};

export const rejectRequest = async (): Promise<void> => {
  const r = requests.shift();
  if (r) await respondError(r, 4001, 'User rejected');
  refreshWc();
};

export const disconnect = async (topic: string): Promise<void> => {
  // The binding stays: reconnecting must hand back the same address.
  await needKit().disconnectSession({ topic, reason: getSdkError('USER_DISCONNECTED') });
  refreshWc();
};

export const hasPending = (): boolean => Boolean(proposal || requests.length);
