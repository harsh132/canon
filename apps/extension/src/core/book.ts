import type { HDNodeWallet } from 'ethers';
import { DeviceSigner } from './hw/signer';
import { deviceRequest } from './hw/device';
import type { Activity, Verification } from '../shared/protocol';
import { store } from './store';
import { ALL_CHAINS, accountPath, appPath, dappPurposeId, deriveAt, open, seal, type Unlocked } from './vault';

// The public-address book and which dapp sees which address. Encrypted at
// rest: a readable list of the sites someone uses is the disclosure that
// per-dapp addresses exist to prevent.

/** `index` is the book's own id for the account; `path` is where its key lives. */
export type AccountRecord = { index: number; label: string; createdAt: number; path: string; /** Hardware wallets: the address the device reported for `path`. */ address?: string };
/** A software key or one on the hardware wallet; both sign the same way. */
export type AccountSigner = HDNodeWallet | DeviceSigner;
export type Binding = {
  index: number;
  name: string | null;
  icon: string | null;
  verification: Verification;
  /** The site may read this address through the injected provider. */
  browser?: boolean;
  firstSeen: number;
  lastSeen: number;
};
type BookData = {
  accounts: AccountRecord[];
  bindings: Record<string, Binding>;
  activity: Activity[];
  /** This wallet's issued name, e.g. alice.canon.eth. */
  name?: string;
  /** Each site's network (chain id), as the dapp last switched it. */
  chains?: Record<string, number>;
};

const KEY = 'book';

let session: Unlocked | null = null;
let data: BookData | null = null;
const signers = new Map<number, AccountSigner>();
/** Hardware wallets: path → address, as the device reported it this session. */
const addresses = new Map<string, string>();

export const loadBook = async (unlocked: Unlocked): Promise<void> => {
  session = unlocked;
  const sealed = await store.getItem<{ iv: string; data: string }>(KEY);
  data = sealed
    ? await open<BookData>(unlocked.bookKey, sealed)
    : { accounts: [{ index: 0, label: 'Main', createdAt: Date.now(), path: accountPath(0), address: unlocked.hardware?.mainAddress }], bindings: {}, activity: [] };
  // Books written before paths were stored used the standard path by index.
  for (const a of data.accounts) a.path ??= accountPath(a.index);
  for (const a of data.accounts) if (a.address) addresses.set(a.path, a.address);
  if (!sealed) await persist();
};

export const closeBook = (): void => {
  session = null;
  data = null;
  signers.clear();
  addresses.clear();
};

const persist = async (): Promise<void> => {
  if (!session || !data) return;
  await store.setItem(KEY, await seal(session.bookKey, data));
};

const need = (): BookData => {
  if (!data) throw new Error('Wallet is locked');
  return data;
};

export const signerFor = (index: number): AccountSigner => {
  if (!session) throw new Error('Wallet is locked');
  let s = signers.get(index);
  if (!s) {
    const rec = data?.accounts.find((a) => a.index === index);
    if (!rec) throw new Error(`No account ${index}`);
    if (session.hardware) {
      const address = rec.address ?? addresses.get(rec.path);
      if (!address) throw new Error('Address not read from the device yet');
      s = new DeviceSigner(address, rec.path);
    } else {
      s = deriveAt(session.mnemonic, rec.path);
    }
    signers.set(index, s);
  }
  return s;
};

export const isHardware = (): boolean => !!session?.hardware;

/** Hardware wallets: read addresses for these paths from the device, once each. */
export const ensureAddresses = async (paths: string[]): Promise<void> => {
  if (!session?.hardware) return;
  const missing = paths.filter((p) => !addresses.has(p));
  if (!missing.length) return;
  const { addresses: got } = await deviceRequest<{ addresses: string[] }>('getAddresses', { paths: missing }, 'Share addresses with Canon');
  missing.forEach((p, i) => addresses.set(p, got[i]));
};

const fetching = new Set<string>();
/** Hardware wallets: start reading a preview's address; `then` runs when it arrives. */
export const prefetchPreview = (dappKey: string | null | undefined, then: () => void): void => {
  if (!session?.hardware) return;
  const { path, address } = previewAccount(dappKey);
  if (address || fetching.has(path)) return;
  fetching.add(path);
  void ensureAddresses([path])
    .then(then, () => {})
    .finally(() => fetching.delete(path));
};

/** previewAccount, after making sure the device has reported its address. */
export const ensurePreview = async (dappKey?: string | null) => {
  if (session?.hardware) await ensureAddresses([previewAccount(dappKey).path]);
  return previewAccount(dappKey);
};

/**
 * Where the next account would live, and its address, without creating it.
 * Pass a dapp key for a dapp account: m/44'/60'/1984'/7702'/0'/<purpose(dapp)>'/i'.
 * Without one it is a user account on the standard path.
 */
export const previewAccount = (dappKey?: string | null): { index: number; path: string; address: string } => {
  if (!session) throw new Error('Wallet is locked');
  const book = need();
  const paths = new Set(book.accounts.map((a) => a.path));
  let i = 0;
  const purpose = dappKey ? dappPurposeId(dappKey) : null;
  const pathFor = (n: number) => (purpose != null ? appPath(ALL_CHAINS, purpose, n) : accountPath(n));
  while (paths.has(pathFor(i))) i += 1;
  const path = pathFor(i);
  const address = session.hardware ? (addresses.get(path) ?? '') : deriveAt(session.mnemonic, path).address;
  return { index: nextIndex(), path, address };
};

/** The derivation path of an account in the book. */
export const pathOf = (index: number): string | null => data?.accounts.find((a) => a.index === index)?.path ?? null;

/** Site addresses live on RAILGUN's app path; only these use sponsored 7702 execution. */
export const isSiteAccount = (index: number): boolean => (pathOf(index) ?? '').startsWith("m/44'/60'/1984'/7702'/");

export const accounts = (): AccountRecord[] => (data ? [...data.accounts].sort((a, b) => a.index - b.index) : []);

export const bindings = (): Record<string, Binding> => data?.bindings ?? {};

export const indexOfAddress = (address: string): number | null => {
  for (const a of accounts()) if (signerFor(a.index).address.toLowerCase() === address.toLowerCase()) return a.index;
  return null;
};

/** Lowest unused index. Records are never deleted, so an index is never reused. */
export const nextIndex = (): number => {
  const taken = new Set(need().accounts.map((a) => a.index));
  let i = 0;
  while (taken.has(i)) i += 1;
  return i;
};

/** Creates an account at a previewed spot. User-made accounts use the standard path; dapp ones the RAILGUN app path. */
export const createAccount = async (label: string, at: { index: number; path: string } = previewAccount()): Promise<AccountRecord> => {
  const book = need();
  const existing = book.accounts.find((a) => a.index === at.index || a.path === at.path);
  if (existing) return existing;
  const index = at.index;
  if (session?.hardware) await ensureAddresses([at.path]);
  const record: AccountRecord = { index, path: at.path, label: label.trim().slice(0, 32) || `Account ${index + 1}`, createdAt: Date.now(), ...(session?.hardware ? { address: addresses.get(at.path) } : {}) };
  book.accounts.push(record);
  await persist();
  return record;
};

export const bindingFor = (origin: string): Binding | null => data?.bindings[origin] ?? null;

/** The address is never changed on rebind: a dapp must see the same address next time. */
export const bind = async (origin: string, b: Omit<Binding, 'firstSeen' | 'lastSeen'>): Promise<void> => {
  const book = need();
  const now = Date.now();
  const prev = book.bindings[origin];
  book.bindings[origin] = prev
    ? { ...prev, name: b.name, icon: b.icon, verification: b.verification, browser: b.browser ?? prev.browser, lastSeen: now }
    : { ...b, firstSeen: now, lastSeen: now };
  await persist();
};

/** Withdraws a site's injected-provider access. The binding, and so its address, stays. */
export const revokeBrowser = async (origin: string): Promise<void> => {
  const b = need().bindings[origin];
  if (!b) return;
  b.browser = false;
  await persist();
};

export const myName = (): string | null => data?.name ?? null;
export const setName = async (name: string): Promise<void> => {
  need().name = name;
  await persist();
};

/** Every site's saved network. Empty while locked. */
export const siteChains = (): Record<string, number> => ({ ...(data?.chains ?? {}) });

export const saveSiteChain = async (origin: string, chainId: number): Promise<void> => {
  if (!data) return;
  data.chains = { ...(data.chains ?? {}), [origin]: chainId };
  await persist();
};

export const activity = (): Activity[] => data?.activity ?? [];

export const recordActivity = async (entry: Activity): Promise<void> => {
  const book = need();
  const i = book.activity.findIndex((a) => a.id === entry.id);
  if (i >= 0) book.activity[i] = entry;
  else book.activity.unshift(entry);
  book.activity = book.activity.slice(0, 50);
  await persist();
};
