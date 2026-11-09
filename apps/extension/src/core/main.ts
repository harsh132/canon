// The core. Runs in the offscreen document, which outlives the popup and the
// service worker's idle kills. Holds the only copy of the unlocked keys.
import type { Commands, CoreMessage, Method, Request, SwMessage } from '../shared/protocol';
import { AUTO_LOCK_MINS, PORT_NAME, type AutoLockMin, type UiKind } from '../shared/protocol';
import { decode, encode } from '../shared/codec';
import { accounts, activity, bindings, closeBook, createAccount, customTokens, loadBook, myName, removeToken, saveToken, signerFor } from './book';
import { DEV, PRIVATE_NET_KEY, PRIVATE_TX, getProvider, netOf, providerFor, type Token } from './config';
import { checkToken, tokensOn } from '../shared/networks';
import { bootEngine, closeRailgunWallet, openRailgunWallet, sync } from './railgun';
import { resumePOI } from './poi-assurance';
import { executeSend, planSend } from './send';
import { emit, onState, state } from './state';
import {
  createPasskeyVault,
  createVault,
  newMnemonic,
  normaliseMnemonic,
  unlockPasskeyVault,
  unlockVault,
  vaultExists,
  vaultInfo,
  wipeVault,
  type Unlocked,
} from './vault';
import * as wc from './wc';
import * as browser from './dapp';
import { installTransport, setRpcMode } from './transport';
import { startBroadcasters } from './broadcaster';
import { claimName } from './ens';
import { fundSite } from './fund';
import { executeSwap, quoteSwap } from './swap';
import { Contract, getAddress, parseEther } from 'ethers';
import { FORK } from './config';
import { store } from './store';

const LOCK_KEY = 'autoLockMin';

let session: Unlocked | null = null;
let lockTimer: ReturnType<typeof setTimeout> | null = null;
const balances = new Map<number, bigint>();
/** Tokens the user looked up, so Add saves exactly what they were shown. */
const looked = new Map<string, Token>();

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
  state.siteChains = browser.knownChains();
  state.name = myName();
  state.tokens = customTokens();
  emit();
};

const touch = (): void => {
  if (lockTimer) clearTimeout(lockTimer);
  if (session) lockTimer = setTimeout(lock, state.autoLockMin * 60_000);
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
  state.tokens = {};
  looked.clear();
  browser.broadcastAccounts();
  wc.refreshWc();
  emit();
};

const afterUnlock = async (u: Unlocked, imported: boolean): Promise<void> => {
  session = u;
  state.unlockWith = await vaultInfo();
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
    .then(() => resumePOI())
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

/** Wallet-built transactions run on Sepolia only for now; Arbitrum's private balance is view-only. */
const txHere = (): void => {
  if (!PRIVATE_TX) throw new Error('Sepolia only for now');
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

const lookupToken = async (chainId: number, raw: string): Promise<Token> => {
  let address: string;
  try {
    address = getAddress(raw.trim().toLowerCase());
  } catch {
    throw new Error('Not a token address');
  }
  if (tokensOn(chainId, customTokens()).some((t) => t.address.toLowerCase() === address.toLowerCase())) throw new Error('Already in the list');
  // Through the network's provider, so through Nox like every other read.
  const c = new Contract(address, ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'], providerFor(chainId));
  const [symbol, decimals] = await Promise.all([c.symbol(), c.decimals()]).catch(() => {
    throw new Error('No ERC-20 token at this address on this network');
  });
  const t = checkToken(chainId, address, symbol, decimals);
  const token: Token = { address, symbol: t.symbol, decimals: t.decimals, ...(t.warning ? { warning: t.warning } : {}) };
  looked.set(`${chainId}:${address.toLowerCase()}`, token);
  return token;
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
  'vault.passkey': async ({ prf, credentialId, existing }) => {
    if (await vaultExists()) throw new Error('A wallet already exists');
    const u = await createPasskeyVault(prf, credentialId);
    await afterUnlock(u, existing);
    return { mnemonic: u.mnemonic };
  },
  'vault.unlockPasskey': async ({ prf }) => {
    await afterUnlock(await unlockPasskeyVault(prf), false);
    return null;
  },
  'vault.reveal': async ({ password, prf }) => {
    need();
    // Checked against the stored vault, not the open session: being unlocked is not enough.
    const u = prf ? await unlockPasskeyVault(prf) : await unlockVault(password ?? '');
    return { mnemonic: u.mnemonic };
  },
  'vault.lock': async () => {
    lock();
    return null;
  },
  'vault.reset': async () => {
    lock();
    await wipeVault();
    state.vault = 'none';
    state.unlockWith = null;
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
  'send.plan': async (intent) => (txHere(), planSend(intent, need())),
  'send.execute': async (intent) => {
    txHere();
    const r = await executeSend(intent, need());
    void refreshPublic();
    return r;
  },
  'rpc.setMode': async ({ mode }) => {
    await setRpcMode(mode);
    return null;
  },
  'settings.autoLock': async ({ min }) => {
    if (!AUTO_LOCK_MINS.includes(min)) throw new Error('Unsupported auto-lock time');
    state.autoLockMin = min;
    await store.setItem(LOCK_KEY, min);
    touch(); // restart the running timer with the new time
    emit();
    return null;
  },
  'swap.quote': async ({ amount }) => {
    txHere();
    need();
    const q = await quoteSwap(parseEther(amount || '0'));
    return { swapped: q.swapped, out: q.out, minOut: q.minOut };
  },
  'swap.execute': async ({ amount }) => {
    txHere();
    const { hash } = await executeSwap(parseEther(amount || '0'), need());
    return { hash };
  },
  'site.balances': async ({ address, chainId }) => {
    need();
    const p = providerFor(chainId);
    const erc20 = (t: string) => new Contract(t, ['function balanceOf(address) view returns (uint256)'], p);
    const known = tokensOn(chainId, customTokens());
    // Each token read stands alone: a custom token whose balanceOf reverts must not hide the others.
    // A failed read is left out, so the UI shows it as unknown, never as zero.
    const [eth, amounts] = await Promise.all([p.getBalance(address), Promise.allSettled(known.map((k) => erc20(k.address).balanceOf(address) as Promise<bigint>))]);
    return {
      eth,
      tokens: known.flatMap((k, i) => {
        const r = amounts[i];
        return r.status === 'fulfilled' ? [{ address: k.address, symbol: k.symbol, decimals: k.decimals, amount: r.value }] : [];
      }),
    };
  },
  'tokens.lookup': async ({ chainId, address }) => (need(), lookupToken(chainId, address)),
  'tokens.add': async ({ chainId, address }) => {
    need();
    const token = looked.get(`${chainId}:${address.trim().toLowerCase()}`) ?? (await lookupToken(chainId, address));
    await saveToken(chainId, token);
    rebuildAccounts();
    return token;
  },
  'tokens.remove': async ({ chainId, address }) => {
    need();
    await removeToken(chainId, address);
    rebuildAccounts();
    return null;
  },
  'site.fund': async (p) => (txHere(), fundSite(p, need())),
  'site.setChain': async ({ origin, chainId }) => {
    await browser.setSiteChain(origin, chainId);
    return null;
  },
  'net.setPrivate': async ({ net }) => {
    // The private network is fixed for the core's lifetime: switch, then restart (which locks).
    localStorage.setItem(PRIVATE_NET_KEY, net);
    setTimeout(() => location.reload(), 50);
    return null;
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

// Where a request can be answered without opening the toolbar popup:
// - an open popup or prompt window shows every request;
// - an open side panel shows its own tab's requests in full, and WalletConnect's.
// windowId: the browser window of the requesting tab, so the popup opens there.
let openPrompts = 0;
/** Tab id of every open side panel (panel.html?tab=N), one entry per panel. */
const panelTabs: number[] = [];
const prompt = (windowId?: number, tabId?: number) => {
  if (openPrompts > 0) return;
  if (tabId == null ? panelTabs.length > 0 : panelTabs.includes(tabId)) return;
  void sw({ type: 'prompt', windowId });
};

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith(PORT_NAME)) return;
  const kind = port.name.slice(PORT_NAME.length + 1) as UiKind;
  if (kind === 'popup' || kind === 'window') {
    openPrompts += 1;
    port.onDisconnect.addListener(() => {
      openPrompts -= 1;
    });
  }
  if (kind === 'panel') {
    const tab = Number(new URL(port.sender?.url ?? 'x:').searchParams.get('tab'));
    if (Number.isInteger(tab) && tab > 0) {
      panelTabs.push(tab);
      port.onDisconnect.addListener(() => panelTabs.splice(panelTabs.indexOf(tab), 1));
    }
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
if (DEV) Object.assign(globalThis, { __canonState: state, __canonEmit: emit });

wc.configureWc({ isUnlocked: () => session != null, prompt });
browser.configureDapp({
  isUnlocked: () => session != null,
  prompt,
  changed: () => {
    state.tabs = browser.tabSites();
    state.siteChains = browser.knownChains();
    wc.refreshWc();
    if (session) rebuildAccounts();
    if (!wc.hasPending()) void sw({ type: 'prompt-clear' });
  },
});

void (async () => {
  // Before anything touches the network.
  await installTransport();
  const lockMin = await store.getItem<AutoLockMin>(LOCK_KEY);
  if (lockMin && AUTO_LOCK_MINS.includes(lockMin)) state.autoLockMin = lockMin;
  state.vault = (await vaultExists()) ? 'locked' : 'none';
  state.unlockWith = await vaultInfo();
  emit();
  void bootEngine().catch((e) => console.error('[core] engine', e));
  void wc.startWc();
})();
