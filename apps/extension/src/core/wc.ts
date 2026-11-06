import { Core } from '@walletconnect/core';
import { WalletKit, type IWalletKit, type WalletKitTypes } from '@reown/walletkit';
import { buildApprovedNamespaces, getSdkError } from '@walletconnect/utils';
import type { Verification, WcProposalView, WcRequestView } from '../shared/protocol';
import { bind, bindingFor, createAccount, indexOfAddress, previewAccount, signerFor, accounts } from './book';
import { SIGN_METHODS, execute, isDelegation, summarize } from './sign';
import { CAIP_CHAIN, DEV, WC_PROJECT_ID } from './config';
import { dappKeyFor } from './dapp-origin';
import * as browser from './dapp';
import { iconFor } from './icons';
import { emit, state } from './state';

// Every dapp gets its own public address. A first contact gets a fresh HD
// index labelled with the dapp's name; a reconnect gets the address it saw
// before. Nothing is auto-approved.

const METHODS = SIGN_METHODS;
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
    // No origin means no stable dapp id to derive from; offer Main instead of minting.
    const pick = chosen ?? (bound && accounts().some((a) => a.index === bound.index) ? bound.index : id.key ? 'new' : 0);
    if (pick === 'new' && id.key) {
      const next = previewAccount(id.key);
      account = { index: next.index, address: next.address, label: id.name.slice(0, 32), isNew: true };
    } else {
      const rec = accounts().find((a) => a.index === pick);
      if (rec) account = { index: rec.index, address: signerFor(rec.index).address, label: rec.label, isNew: false };
    }
  }
  return {
    id: proposal.id,
    source: 'wc',
    name: id.name,
    origin: id.key,
    attested: id.attested,
    verification: id.verification,
    icon: iconFor(id.icon, () => refreshWc()),
    canApprove: !problem,
    problem,
    account,
  };
};

const requestView = (): WcRequestView | null => {
  const r = requests[0];
  if (!r) return null;
  const { method, params } = r.params.request as { method: string; params: unknown[] };
  const address = sessionAddress(r.topic);
  const index = address && isUnlocked() ? indexOfAddress(address) : null;
  const label = index != null ? accounts().find((a) => a.index === index)?.label ?? '' : '';
  const dapp = kit?.getActiveSessions()[r.topic]?.peer.metadata.name ?? 'App';
  const { title, detail, isTransaction } = summarize(method, params);
  return {
    id: r.id,
    source: 'wc',
    icon: iconFor(kit?.getActiveSessions()[r.topic]?.peer.metadata.icons?.[0], () => refreshWc()),
    origin: null,
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
  if (!kit) {
    state.wc.proposal = browser.proposalView();
    state.wc.request = browser.requestView();
    emit();
    return;
  }
  state.wc.sessions = Object.values(kit.getActiveSessions()).map((s) => ({
    topic: s.topic,
    name: s.peer.metadata.name,
    url: s.peer.metadata.url,
    icon: iconFor(s.peer.metadata.icons?.[0], () => refreshWc()),
    address: s.namespaces.eip155?.accounts?.[0]?.split(':')[2] ?? '',
  }));
  // Browser-tab prompts come first: the user is looking at that tab.
  state.wc.proposal = browser.proposalView() ?? proposalView();
  state.wc.request = browser.requestView() ?? requestView();
  emit();
};

const respondError = async (r: WalletKitTypes.SessionRequest, code: number, message: string) => {
  await kit?.respondSessionRequest({ topic: r.topic, response: { id: r.id, jsonrpc: '2.0', error: { code, message } } }).catch(() => {});
};

export const startWc = async (): Promise<void> => {
  if (!WC_PROJECT_ID || kit) return;
  try {
    const core = new Core({ projectId: WC_PROJECT_ID, telemetryEnabled: false });
    // A project id whose allowlist lacks this extension's origin never connects; say so.
    kit = await Promise.race([
      WalletKit.init({ core, metadata: { name: 'Pangolin', description: 'Private wallet', url: location.origin, icons: [] } }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Relay refused ${location.origin}. Allow it in the WalletConnect project.`)), 20_000),
      ),
    ]);
  } catch (e) {
    state.wc.error = (e as Error).message;
    emit();
    return;
  }
  if (DEV) (globalThis as Record<string, unknown>).__wc = kit;
  kit.on('session_proposal', (p) => {
    proposal = p;
    chosen = null;
    refreshWc();
    prompt();
  });
  kit.on('session_request', (r) => {
    const { method, params } = r.params.request as { method: string; params: unknown[] };
    if (isDelegation(method, params)) {
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
  if (view.account.isNew) {
    // Recomputed, not trusted from the view: the book may have changed since it rendered.
    const next = previewAccount(view.origin);
    if (next.address !== view.account.address) throw new Error('Address changed; review again');
    await createAccount(view.account.label, next);
  }
  await k.approveSession({ id: proposal.id, namespaces });
  if (view.origin) {
    await bind(view.origin, { index: view.account.index, name: view.name, icon: identify(proposal).icon, verification: view.verification }).catch(
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
  const { method, params } = r.params.request as { method: string; params: unknown[] };
  const result = await execute(view.account.index, method, params, view.dapp);
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

export const hasPending = (): boolean => Boolean(proposal || requests.length || browser.hasPending());
