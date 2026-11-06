import type { HDNodeWallet } from 'ethers';
import type { Activity, Verification } from '../shared/protocol';
import { store } from './store';
import { deriveAccount, open, seal, type Unlocked } from './vault';

// The public-address book and which dapp sees which address. Encrypted at
// rest: a readable list of the sites someone uses is the disclosure that
// per-dapp addresses exist to prevent.

export type AccountRecord = { index: number; label: string; createdAt: number };
export type Binding = {
  index: number;
  name: string | null;
  icon: string | null;
  verification: Verification;
  firstSeen: number;
  lastSeen: number;
};
type BookData = {
  accounts: AccountRecord[];
  bindings: Record<string, Binding>;
  activity: Activity[];
};

const KEY = 'book';

let session: Unlocked | null = null;
let data: BookData | null = null;
const signers = new Map<number, HDNodeWallet>();

export const loadBook = async (unlocked: Unlocked): Promise<void> => {
  session = unlocked;
  const sealed = await store.getItem<{ iv: string; data: string }>(KEY);
  data = sealed
    ? await open<BookData>(unlocked.bookKey, sealed)
    : { accounts: [{ index: 0, label: 'Main', createdAt: Date.now() }], bindings: {}, activity: [] };
  if (!sealed) await persist();
};

export const closeBook = (): void => {
  session = null;
  data = null;
  signers.clear();
};

const persist = async (): Promise<void> => {
  if (!session || !data) return;
  await store.setItem(KEY, await seal(session.bookKey, data));
};

const need = (): BookData => {
  if (!data) throw new Error('Wallet is locked');
  return data;
};

export const signerFor = (index: number): HDNodeWallet => {
  if (!session) throw new Error('Wallet is locked');
  let s = signers.get(index);
  if (!s) {
    s = deriveAccount(session.mnemonic, index);
    signers.set(index, s);
  }
  return s;
};

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

export const createAccount = async (label: string, index = nextIndex()): Promise<AccountRecord> => {
  const book = need();
  const existing = book.accounts.find((a) => a.index === index);
  if (existing) return existing;
  const record = { index, label: label.trim().slice(0, 32) || `Account ${index + 1}`, createdAt: Date.now() };
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
    ? { ...prev, name: b.name, icon: b.icon, verification: b.verification, lastSeen: now }
    : { ...b, firstSeen: now, lastSeen: now };
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
