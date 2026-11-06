// The core. Runs in the offscreen document, which outlives the popup and the
// service worker's idle kills. Holds the only copy of the unlocked keys.
import type { Commands, CoreMessage, Method, Request, SwMessage } from '../shared/protocol';
import { PORT_NAME, type UiKind } from '../shared/protocol';
import { decode, encode } from '../shared/codec';
import { accounts, activity, bindings, closeBook, createAccount, loadBook, myName, signerFor } from './book';
import { AUTO_LOCK_MS, DEV, WETH, getProvider } from './config';
import { bootEngine, closeRailgunWallet, openRailgunWallet, sync } from './railgun';
import { executeSend, planSend } from './send';
import { emit, onState, state } from './state';
import { createVault, newMnemonic, normaliseMnemonic, unlockVault, vaultExists, wipeVault, type Unlocked } from './vault';
import * as wc from './wc';
import * as browser from './dapp';
import { installTransport, setRpcMode } from './transport';
import { startBroadcasters } from './broadcaster';
import { claimName } from './ens';
import { USDC, executeSwap, quoteSwap } from './swap';
import { Contract, parseEther } from 'ethers';
import { FORK } from './config';

let session: Unlocked | null = null;
let lockTimer: ReturnType<typeof setTimeout> | null = null;
const balances = new Map<number, bigint>();

const sw = (msg: SwMessage) => chrome.runtime.sendMessage(msg).catch(() => {});

const rebuildAccounts = (): void => {
  const byIndex = new Map<number, string[]>();
  for (const [origin, b] of Object.entries(bindings())) byIndex.set(b.index, [...(byIndex.get(b.index) ?? []), origin]);
  state.accounts = accounts().map((a) => ({
    index: a.index,
    label: a.label,
    address: signerFor(a.index).address,
    origins: byIndex.get(a.index) ?? [],
    balance: balances.get(a.index) ?? null,
  }));
  state.activity = activity();
  state.sites = browser.connectedSites();
  state.tabs = browser.tabSites();
  state.name = myName();
  emit();
};

const touch = (): void => {
  if (lockTimer) clearTimeout(lockTimer);
  if (session) lockTimer = setTimeout(lock, AUTO_LOCK_MS);
};

const lock = (): void => {
  session = null;
  closeBook();
  closeRailgunWallet();
  balances.clear();
  state.vault = 'locked';
  state.accounts = [];
  state.activity = [];
  state.sites = [];
  state.name = null;
  browser.broadcastAccounts();
  wc.refreshWc();
  emit();
};

const afterUnlock = async (u: Unlocked, imported: boolean): Promise<void> => {
  session = u;
  await loadBook(u);
  state.vault = 'unlocked';
  rebuildAccounts();
  wc.refreshWc();
  browser.broadcastAccounts();
  touch();
  // The engine can take a while on first boot; the vault is usable before it is.
  // Broadcasters cannot see a local fork.
  if (!FORK) void startBroadcasters();
  void openRailgunWallet(u, imported)
    .then(() => sync())
    .catch((e) => {
      console.error('[core] railgun', e);
      state.engine = { status: 'error', error: (e as Error).message };
      emit();
    });
};

const need = (): Unlocked => {
  if (!session) throw new Error('Wallet is locked');
  return session;
};

const refreshPublic = async (): Promise<void> => {
  const p = getProvider();
  await Promise.all(
    accounts().map(async (a) => {
      balances.set(a.index, await p.getBalance(signerFor(a.index).address));
    }),
  );
  rebuildAccounts();
};

type Handlers = { [M in Method]: (params: Commands[M]['params']) => Promise<Commands[M]['result']> };

const handlers: Handlers = {
  'vault.create': async ({ password }) => {
    if (await vaultExists()) throw new Error('A wallet already exists');
    const mnemonic = newMnemonic();
    await afterUnlock(await createVault(password, mnemonic), false);
    return { mnemonic };
  },
  'vault.import': async ({ password, mnemonic }) => {
    if (await vaultExists()) throw new Error('A wallet already exists');
    await afterUnlock(await createVault(password, normaliseMnemonic(mnemonic)), true);
    return null;
  },
  'vault.unlock': async ({ password }) => {
    await afterUnlock(await unlockVault(password), false);
    return null;
  },
  'vault.lock': async () => {
    lock();
    return null;
  },
  'vault.reset': async () => {
    lock();
    await wipeVault();
    state.vault = 'none';
    emit();
    return null;
  },
  'railgun.sync': async () => {
    need();
    void sync();
    return null;
  },
  'accounts.refresh': async () => {
    need();
    await refreshPublic();
    return null;
  },
  'accounts.create': async ({ label }) => {
    need();
    const rec = await createAccount(label);
    rebuildAccounts();
    return state.accounts.find((a) => a.index === rec.index)!;
  },
  'send.plan': async (intent) => planSend(intent, need()),
  'send.execute': async (intent) => {
    const r = await executeSend(intent, need());
    void refreshPublic();
    return r;
  },
  'rpc.setMode': async ({ mode }) => {
    await setRpcMode(mode);
    return null;
  },
  'swap.quote': async ({ amount }) => {
    need();
    const q = await quoteSwap(parseEther(amount || '0'));
    return { swapped: q.swapped, out: q.out, minOut: q.minOut };
  },
  'swap.execute': async ({ amount }) => {
    const { hash } = await executeSwap(parseEther(amount || '0'), need());
    return { hash };
  },
  'site.balances': async ({ address }) => {
    need();
    const p = getProvider();
    const erc20 = (t: string) => new Contract(t, ['function balanceOf(address) view returns (uint256)'], p);
    const known = [
      { symbol: 'WETH', decimals: 18, token: WETH },
      { symbol: 'USDC', decimals: 6, token: USDC },
    ];
    const [eth, ...amounts] = await Promise.all([p.getBalance(address), ...known.map((k) => erc20(k.token).balanceOf(address) as Promise<bigint>)]);
    return { eth, tokens: known.map((k, i) => ({ symbol: k.symbol, decimals: k.decimals, amount: amounts[i] })) };
  },
  'ens.claim': async ({ label }) => {
    need();
    const name = await claimName(label);
    rebuildAccounts();
    return { name };
  },
  'dapp.disconnect': async ({ origin }) => {
    need();
    await browser.disconnectSite(origin);
    rebuildAccounts();
    return null;
  },
  'wc.pair': async ({ uri }) => {
    await wc.pair(uri);
    return null;
  },
  'wc.chooseAccount': async ({ index }) => {
    if (browser.hasProposal()) browser.chooseAccount(index);
    else wc.chooseAccount(index);
    return null;
  },
  'wc.approve': async () => {
    need();
    if (browser.hasProposal()) await browser.approveConnect();
    else await wc.approveProposal();
    rebuildAccounts();
    if (!wc.hasPending()) void sw({ type: 'prompt-clear' });
    return null;
  },
  'wc.reject': async () => {
    if (browser.hasProposal()) browser.rejectConnect();
    else await wc.rejectProposal();
    if (!wc.hasPending()) void sw({ type: 'prompt-clear' });
    return null;
  },
  'wc.approveRequest': async () => {
    need();
    if (browser.hasRequest()) await browser.approveRequest();
    else await wc.approveRequest();
    rebuildAccounts();
    if (!wc.hasPending()) void sw({ type: 'prompt-clear' });
    return null;
  },
  'wc.rejectRequest': async () => {
    if (browser.hasRequest()) browser.rejectRequest();
    else await wc.rejectRequest();
    if (!wc.hasPending()) void sw({ type: 'prompt-clear' });
    return null;
  },
  'wc.disconnect': async ({ topic }) => {
    await wc.disconnect(topic);
    return null;
  },
};

chrome.runtime.onConnect.addListener(browser.attachDappPort);

// Open popups and prompt windows already show a request; side panels do not
// (they show a "request waiting" bar instead), so only these suppress the popup.
// windowId: the browser window of the requesting tab, so the popup opens there.
let openPrompts = 0;
const prompt = (windowId?: number) => {
  if (openPrompts === 0) void sw({ type: 'prompt', windowId });
};

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith(PORT_NAME)) return;
  const kind = port.name.slice(PORT_NAME.length + 1) as UiKind;
  if (kind !== 'panel') {
    openPrompts += 1;
    port.onDisconnect.addListener(() => {
      openPrompts -= 1;
    });
  }
  const push = () => port.postMessage(encode({ event: 'state', state } satisfies CoreMessage));
  const off = onState(push);
  push();
  port.onDisconnect.addListener(off);
  port.onMessage.addListener(async (raw: string) => {
    let req: Request;
    try {
      req = decode<Request>(raw);
    } catch {
      return;
    }
    const handler = Object.prototype.hasOwnProperty.call(handlers, req.method)
      ? (handlers[req.method] as (p: unknown) => Promise<unknown>)
      : null;
    let reply: CoreMessage;
    try {
      if (!handler) throw new Error(`Unknown command ${req.method}`);
      touch();
      reply = { id: req.id, ok: true, result: await handler(req.params) };
    } catch (e) {
      console.error('[core]', req.method, e);
      reply = { id: req.id, ok: false, error: (e as Error)?.message ?? String(e) };
    }
    try {
      port.postMessage(encode(reply));
    } catch {
      // Popup closed mid-call.
    }
  });
});

// Dev builds only: lets test scripts read core state (e.g. which site is in which tab).
if (DEV) (globalThis as Record<string, unknown>).__pangolinState = state;

wc.configureWc({ isUnlocked: () => session != null, prompt });
browser.configureDapp({
  isUnlocked: () => session != null,
  prompt,
  changed: () => {
    state.tabs = browser.tabSites();
    wc.refreshWc();
    if (session) rebuildAccounts();
    if (!wc.hasPending()) void sw({ type: 'prompt-clear' });
  },
});

void (async () => {
  // Before anything touches the network.
  await installTransport();
  state.vault = (await vaultExists()) ? 'locked' : 'none';
  emit();
  void bootEngine().catch((e) => console.error('[core] engine', e));
  void wc.startWc();
})();
