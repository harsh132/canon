// The injected provider's far end. Each browser tab's content script holds a
// port here; Chrome stamps the port with the tab's origin, which the page
// cannot forge. A site gets the same address it gets over WalletConnect: the
// binding is keyed by origin either way.
import type { WcProposalView, WcRequestView } from '../shared/protocol';
import { DAPP_PORT_NAME } from '../shared/protocol';
import { decode, encode } from '../shared/codec';
import { accounts, bind, bindingFor, bindings, createAccount, isSiteAccount, previewAccount, revokeBrowser, saveSiteChain, signerFor, siteChains } from './book';
import { SEPOLIA_ID, hexChain, netOf, providerFor, sepolia } from './config';
import { dappKeyFor } from './dapp-origin';
import { RpcError, SIGN_METHODS, execute, isDelegation, summarize } from './sign';
import { callsOf, previewFor } from './preview';

const SEPOLIA_HEX = hexChain(SEPOLIA_ID);

// --- Per-site network ---------------------------------------------------------
// Each site has its own network. A dapp's switch (or add) request for a network
// Canon supports is accepted without a prompt. Saved in the encrypted book;
// while locked, the session's memory only. New sites start on Sepolia.
const chains = new Map<string, number>();
export const chainOf = (origin: string): number => chains.get(origin) ?? siteChains()[origin] ?? SEPOLIA_ID;
/** Every site the core knows a network for, for the UI. */
export const knownChains = (): Record<string, number> => {
  const out: Record<string, number> = { ...siteChains() };
  for (const [o, c] of chains) out[o] = c;
  return out;
};
const sentChain = new Map<chrome.runtime.Port, number>();
const syncChain = (port: chrome.runtime.Port, origin: string): void => {
  const c = chainOf(origin);
  if (sentChain.get(port) === c) return;
  const first = !sentChain.has(port);
  sentChain.set(port, c);
  if (!first || c !== SEPOLIA_ID) send(port, { event: 'chainChanged', data: hexChain(c) });
};
export const setSiteChain = async (origin: string, chainId: number): Promise<void> => {
  if (!netOf(chainId)) throw new RpcError(4902, 'Canon does not support this network');
  chains.set(origin, chainId);
  await saveSiteChain(origin, chainId).catch(() => {});
  for (const [port, o] of ports) if (o === origin) syncChain(port, o);
  changed();
};
const chainParam = (params: unknown[]): number => {
  const raw = String((params?.[0] as { chainId?: string })?.chainId ?? '');
  const n = Number.parseInt(raw, raw.startsWith('0x') ? 16 : 10);
  if (!Number.isFinite(n)) throw new RpcError(-32602, 'Bad chainId');
  return n;
};

// Answered from the chain, through the transport (so through Nox).
const READ_METHODS = new Set([
  'eth_blockNumber', 'eth_call', 'eth_estimateGas', 'eth_feeHistory', 'eth_gasPrice', 'eth_getBalance',
  'eth_getBlockByHash', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getLogs', 'eth_getStorageAt',
  'eth_getTransactionByHash', 'eth_getTransactionCount', 'eth_getTransactionReceipt', 'eth_maxPriorityFeePerGas',
]);

type Item = {
  id: number;
  kind: 'connect' | 'request';
  port: chrome.runtime.Port;
  origin: string;
  /** The site's network when it asked; a later switch does not move the request. */
  chainId: number;
  method: string;
  params: unknown[];
  resolve: (v: unknown) => void;
  reject: (e: RpcError) => void;
};

const ports = new Map<chrome.runtime.Port, string>();

/** Which site each tab holds, for the per-tab panel. */
export const tabSites = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [port, origin] of ports) if (port.sender?.tab?.id != null) out[String(port.sender.tab.id)] = origin;
  return out;
};
const queue: Item[] = [];
let nextItemId = 1;
let chosen: number | 'new' | null = null;

let isUnlocked = (): boolean => false;
let prompt = (_windowId?: number, _tabId?: number): void => {};
let changed = (): void => {};

export const configureDapp = (opts: { isUnlocked: () => boolean; prompt: (windowId?: number, tabId?: number) => void; changed: () => void }): void => {
  ({ isUnlocked, prompt, changed } = opts);
};

const accountsFor = (origin: string): string[] => {
  if (!isUnlocked()) return [];
  const b = bindingFor(origin);
  if (!b?.browser || !accounts().some((a) => a.index === b.index)) return [];
  return [signerFor(b.index).address.toLowerCase()];
};

const send = (port: chrome.runtime.Port, msg: unknown): void => {
  try {
    port.postMessage(encode(msg));
  } catch {
    // Tab went away.
  }
};

/** Tells every open tab which account it now sees. On lock that is none. */
export const broadcastAccounts = (): void => {
  for (const [port, origin] of ports) syncChain(port, origin);
  for (const [port, origin] of ports) send(port, { event: 'accountsChanged', data: accountsFor(origin) });
};

const enqueue = (item: Omit<Item, 'id' | 'resolve' | 'reject' | 'chainId'>): Promise<unknown> =>
  new Promise((resolve, reject) => {
    queue.push({ ...item, chainId: chainOf(item.origin), id: nextItemId++, resolve, reject });
    if (item.kind === 'connect') chosen = null;
    changed();
    prompt(item.port.sender?.tab?.windowId, item.port.sender?.tab?.id);
  });

const handle = async (port: chrome.runtime.Port, origin: string, method: string, params: unknown[]): Promise<unknown> => {
  switch (method) {
    case 'eth_chainId':
      return hexChain(chainOf(origin));
    case 'net_version':
      return String(chainOf(origin));
    case 'eth_accounts':
      return accountsFor(origin);
    case 'eth_requestAccounts':
    case 'wallet_requestPermissions': {
      const now = accountsFor(origin);
      const got = now.length ? now : ((await enqueue({ kind: 'connect', port, origin, method, params })) as string[]);
      return method === 'eth_requestAccounts' ? got : [{ parentCapability: 'eth_accounts' }];
    }
    case 'wallet_getPermissions':
      return accountsFor(origin).length ? [{ parentCapability: 'eth_accounts' }] : [];
    case 'wallet_revokePermissions':
      await revokeBrowser(origin).catch(() => {});
      changed();
      broadcastAccounts();
      return null;
    case 'wallet_switchEthereumChain': {
      const want = chainParam(params);
      if (!netOf(want)) throw new RpcError(4902, 'Canon does not support this network');
      await setSiteChain(origin, want);
      return null;
    }
    case 'wallet_addEthereumChain': {
      // Only networks Canon already knows; the dapp's RPC URL is never used.
      const want = chainParam(params);
      if (!netOf(want)) throw new RpcError(4200, 'Canon does not support this network');
      await setSiteChain(origin, want);
      return null;
    }
    // EIP-5792. Site addresses run Calibur through EIP-7702: batches are atomic and
    // gas is sponsored. auxiliaryFunds (ERC-7682): the private balance can fund them.
    case 'wallet_getCapabilities': {
      // Batches and gas sponsorship (Calibur via our sponsor) are on Sepolia only.
      const [address] = (params ?? []) as [string?];
      const b = bindingFor(origin);
      const mine = accountsFor(origin)[0];
      if (!mine || (address && address.toLowerCase() !== mine) || !b || !isSiteAccount(b.index)) return {};
      return { [SEPOLIA_HEX]: { atomic: { status: 'supported' }, auxiliaryFunds: { supported: true } } };
    }
    case 'wallet_getCallsStatus': {
      const id = String((params ?? [])[0] ?? '');
      const r = await sepolia().getTransactionReceipt(id);
      const hex = (n: bigint | number) => `0x${BigInt(n).toString(16)}`;
      return {
        version: '2.0.0',
        id,
        chainId: SEPOLIA_HEX,
        atomic: true,
        status: !r ? 100 : r.status === 1 ? 200 : 500,
        receipts: r
          ? [{
              logs: r.logs.map((l) => ({ address: l.address, data: l.data, topics: l.topics })),
              status: hex(r.status ?? 0),
              blockHash: r.blockHash,
              blockNumber: hex(r.blockNumber),
              gasUsed: hex(r.gasUsed),
              transactionHash: r.hash,
            }]
          : [],
      };
    }
    case 'wallet_showCallsStatus':
      return null;
  }
  if (SIGN_METHODS.includes(method)) {
    if (!accountsFor(origin).length) throw new RpcError(4100, 'Connect first');
    if (isDelegation(method, params)) throw new RpcError(4001, 'Canon does not sign account delegations');
    return enqueue({ kind: 'request', port, origin, method, params });
  }
  if (READ_METHODS.has(method)) return providerFor(chainOf(origin)).send(method, params ?? []);
  throw new RpcError(4200, `${method} is not supported`);
};

export const attachDappPort = (port: chrome.runtime.Port): void => {
  if (port.name !== DAPP_PORT_NAME) return;
  const origin = dappKeyFor(port.sender?.origin ?? port.sender?.url);
  if (!origin) {
    port.disconnect();
    return;
  }
  ports.set(port, origin);
  syncChain(port, origin);
  changed();
  port.onMessage.addListener(async (raw: string) => {
    let req: { id: number; method: string; params?: unknown[] };
    try {
      req = decode(raw);
    } catch {
      return;
    }
    try {
      send(port, { id: req.id, result: await handle(port, origin, req.method, Array.isArray(req.params) ? req.params : []) });
    } catch (e) {
      const code = e instanceof RpcError ? e.code : -32603;
      send(port, { id: req.id, error: { code, message: (e as Error)?.message ?? String(e) } });
    }
  });
  port.onDisconnect.addListener(() => {
    ports.delete(port);
    sentChain.delete(port);
    for (let i = queue.length - 1; i >= 0; i -= 1) if (queue[i].port === port) queue.splice(i, 1);
    changed();
  });
};

// --- prompts ------------------------------------------------------------------

const firstOf = (kind: Item['kind']) => queue.find((i) => i.kind === kind) ?? null;
const hostOf = (origin: string) => origin.replace(/^[a-z]+:\/\//, '');

export const proposalView = (): WcProposalView | null => {
  const item = firstOf('connect');
  if (!item) return null;
  let account: WcProposalView['account'] = null;
  if (isUnlocked()) {
    const bound = bindingFor(item.origin);
    const pick = chosen ?? (bound && accounts().some((a) => a.index === bound.index) ? bound.index : 'new');
    if (pick === 'new') {
      const next = previewAccount(item.origin);
      account = { index: next.index, address: next.address, label: hostOf(item.origin).slice(0, 32), isNew: true };
    } else {
      const rec = accounts().find((a) => a.index === pick);
      if (rec) account = { index: rec.index, address: signerFor(rec.index).address, label: rec.label, isNew: false };
    }
  }
  return {
    id: item.id,
    source: 'browser',
    name: hostOf(item.origin),
    origin: item.origin,
    attested: true,
    verification: 'BROWSER',
    icon: null,
    canApprove: true,
    account,
  };
};

export const requestView = (): WcRequestView | null => {
  const item = firstOf('request');
  if (!item) return null;
  const b = isUnlocked() ? bindingFor(item.origin) : null;
  const rec = b ? accounts().find((a) => a.index === b.index) : undefined;
  const address = rec ? signerFor(rec.index).address : null;
  const calls = callsOf(item.method, item.params);
  return {
    id: item.id,
    source: 'browser',
    icon: null,
    origin: item.origin,
    topic: item.origin,
    dapp: hostOf(item.origin),
    method: item.method,
    ...summarize(item.method, item.params),
    network: netOf(item.chainId)?.name ?? String(item.chainId),
    account: rec && address ? { index: rec.index, address, label: rec.label } : null,
    preview: calls && address && netOf(item.chainId) ? previewFor(`b:${item.id}`, providerFor(item.chainId), item.chainId, address, calls, changed) : undefined,
  };
};

export const hasProposal = (): boolean => firstOf('connect') != null;
export const hasRequest = (): boolean => firstOf('request') != null;
export const hasPending = (): boolean => queue.length > 0;

const take = (kind: Item['kind']): Item => {
  const i = queue.findIndex((x) => x.kind === kind);
  if (i < 0) throw new Error('Nothing to approve');
  return queue.splice(i, 1)[0];
};

export const chooseAccount = (index: number | 'new'): void => {
  chosen = index;
  changed();
};

export const approveConnect = async (): Promise<void> => {
  const view = proposalView();
  if (!view?.account) throw new Error('Unlock first');
  if (view.account.isNew) {
    // Recomputed, not trusted from the view: the book may have changed since it rendered.
    const next = previewAccount(view.origin);
    if (next.address !== view.account.address) throw new Error('Address changed; review again');
    await createAccount(view.account.label, next);
  }
  const item = take('connect');
  await bind(item.origin, { index: view.account.index, name: view.name, icon: null, verification: 'BROWSER', browser: true });
  chosen = null;
  item.resolve(accountsFor(item.origin));
  // Anything else this site queued behind the connect can now see the account.
  broadcastAccounts();
  changed();
};

export const rejectConnect = (): void => {
  take('connect').reject(new RpcError(4001, 'User rejected'));
  chosen = null;
  changed();
};

export const approveRequest = async (): Promise<void> => {
  const view = requestView();
  if (!view?.account) throw new Error('Unlock first');
  const item = take('request');
  try {
    item.resolve(await execute(view.account.index, item.method, item.params, view.dapp, item.chainId));
  } catch (e) {
    // A 4001 from execute is the user's reject; pass it through.
    const code = e instanceof RpcError ? e.code : (e as { code?: unknown }).code === 4001 ? 4001 : -32603;
    item.reject(e instanceof RpcError ? e : new RpcError(code, (e as Error).message));
  }
  changed();
};

export const rejectRequest = (): void => {
  take('request').reject(new RpcError(4001, 'User rejected'));
  changed();
};

export const disconnectSite = async (origin: string): Promise<void> => {
  await revokeBrowser(origin);
  broadcastAccounts();
  changed();
};

export const connectedSites = () =>
  Object.entries(bindings())
    .filter(([, b]) => b.browser)
    .map(([origin, b]) => ({
      origin,
      address: signerFor(b.index).address,
      label: accounts().find((a) => a.index === b.index)?.label ?? '',
    }));
