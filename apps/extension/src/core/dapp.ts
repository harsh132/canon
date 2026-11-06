// The injected provider's far end. Each browser tab's content script holds a
// port here; Chrome stamps the port with the tab's origin, which the page
// cannot forge. A site gets the same address it gets over WalletConnect: the
// binding is keyed by origin either way.
import type { WcProposalView, WcRequestView } from '../shared/protocol';
import { DAPP_PORT_NAME } from '../shared/protocol';
import { decode, encode } from '../shared/codec';
import { accounts, bind, bindingFor, bindings, createAccount, nextIndex, revokeBrowser, signerFor } from './book';
import { CHAIN_ID, getProvider } from './config';
import { dappKeyFor } from './dapp-origin';
import { RpcError, SIGN_METHODS, execute, isDelegation, summarize } from './sign';

const CHAIN_HEX = `0x${CHAIN_ID.toString(16)}`;

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
  method: string;
  params: unknown[];
  resolve: (v: unknown) => void;
  reject: (e: RpcError) => void;
};

const ports = new Map<chrome.runtime.Port, string>();
const queue: Item[] = [];
let nextItemId = 1;
let chosen: number | 'new' | null = null;

let isUnlocked = (): boolean => false;
let prompt = (): void => {};
let changed = (): void => {};

export const configureDapp = (opts: { isUnlocked: () => boolean; prompt: () => void; changed: () => void }): void => {
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
  for (const [port, origin] of ports) send(port, { event: 'accountsChanged', data: accountsFor(origin) });
};

const enqueue = (item: Omit<Item, 'id' | 'resolve' | 'reject'>): Promise<unknown> =>
  new Promise((resolve, reject) => {
    queue.push({ ...item, id: nextItemId++, resolve, reject });
    if (item.kind === 'connect') chosen = null;
    changed();
    prompt();
  });

const handle = async (port: chrome.runtime.Port, origin: string, method: string, params: unknown[]): Promise<unknown> => {
  switch (method) {
    case 'eth_chainId':
      return CHAIN_HEX;
    case 'net_version':
      return String(CHAIN_ID);
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
      const want = String((params?.[0] as { chainId?: string })?.chainId ?? '').toLowerCase();
      if (want === CHAIN_HEX) return null;
      throw new RpcError(4902, 'Pangolin runs on Sepolia only');
    }
    case 'wallet_addEthereumChain':
      throw new RpcError(4200, 'Pangolin runs on Sepolia only');
  }
  if (SIGN_METHODS.includes(method)) {
    if (!accountsFor(origin).length) throw new RpcError(4100, 'Connect first');
    if (isDelegation(method, params)) throw new RpcError(4001, 'Pangolin does not sign account delegations');
    return enqueue({ kind: 'request', port, origin, method, params });
  }
  if (READ_METHODS.has(method)) return getProvider().send(method, params ?? []);
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
      const index = nextIndex();
      account = { index, address: signerFor(index).address, label: hostOf(item.origin).slice(0, 32), isNew: true };
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
  return {
    id: item.id,
    source: 'browser',
    topic: item.origin,
    dapp: hostOf(item.origin),
    method: item.method,
    ...summarize(item.method, item.params),
    account: rec ? { index: rec.index, address: signerFor(rec.index).address, label: rec.label } : null,
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
  const item = take('connect');
  if (view.account.isNew) await createAccount(view.account.label, view.account.index);
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
    item.resolve(await execute(view.account.index, item.method, item.params, view.dapp));
  } catch (e) {
    item.reject(e instanceof RpcError ? e : new RpcError(-32603, (e as Error).message));
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
