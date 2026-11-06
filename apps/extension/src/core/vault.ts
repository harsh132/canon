import { HDNodeWallet, Mnemonic, keccak256, randomBytes, toUtf8Bytes } from 'ethers';
import { store } from './store';

// One mnemonic, encrypted with a key stretched from the password.
// The same stretch yields the RAILGUN encryption key and the key for the
// account book, so nothing but ciphertext is ever at rest.
//
// Passkey wallets: the passkey's WebAuthn PRF output (32 bytes, the same on
// every device the passkey syncs to) is the wallet. HKDF turns it into the
// mnemonic's entropy and, separately, the same three keys. No password.

export type VaultKind = 'phrase' | 'passkey' | 'hardware';

type VaultRecord = {
  v: 1;
  /** Absent on vaults made before passkeys: a phrase vault. */
  kind?: VaultKind;
  /** Passkey vaults: the credential to ask for on unlock (base64url). */
  credentialId?: string;
  salt: string;
  iv: string;
  data: string;
  iterations: number;
  railgunWalletId: string | null;
};

export type Unlocked = {
  /** Empty for a hardware wallet: the seed never leaves the device. */
  mnemonic: string;
  /** Hardware wallets: what the browser keeps instead of a seed. */
  hardware?: { shareableViewingKey: string; mainAddress: string };
  railgunKey: string;
  bookKey: CryptoKey;
  record: VaultRecord;
};

const KEY = 'vault';
const ITERATIONS = 600_000;

const b64 = (u: Uint8Array): string => btoa(String.fromCharCode(...u));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (u: Uint8Array): string => [...u].map((b) => b.toString(16).padStart(2, '0')).join('');

const stretch = async (password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) => {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 96 * 8),
  );
  return keysFrom(bits);
};

const keysFrom = async (bits: Uint8Array<ArrayBuffer>) => {
  const aes = (slice: Uint8Array<ArrayBuffer>) =>
    crypto.subtle.importKey('raw', slice, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { vaultKey: await aes(bits.slice(0, 32)), railgunKey: hex(bits.slice(32, 64)), bookKey: await aes(bits.slice(64, 96)) };
};

const hkdf = async (secret: Uint8Array<ArrayBuffer>, info: string, bytes: number): Promise<Uint8Array<ArrayBuffer>> => {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  const salt = new TextEncoder().encode('pangolin');
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(info) }, base, bytes * 8));
};

const prfBytes = (prfHex: string): Uint8Array<ArrayBuffer> => {
  if (!/^[0-9a-f]{64}$/i.test(prfHex)) throw new Error('Passkey gave no wallet secret');
  return Uint8Array.from(prfHex.match(/../g)!.map((b) => parseInt(b, 16)));
};

/** The wallet a passkey's PRF output stands for: a 12-word phrase. */
export const passkeyMnemonic = async (prfHex: string): Promise<string> =>
  Mnemonic.fromEntropy(await hkdf(prfBytes(prfHex), 'pangolin/wallet/v1', 16)).phrase;

export const seal = async (key: CryptoKey, value: unknown): Promise<{ iv: string; data: string }> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value))),
  );
  return { iv: b64(iv), data: b64(data) };
};

export const open = async <T>(key: CryptoKey, sealed: { iv: string; data: string }): Promise<T> => {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) }, key, unb64(sealed.data));
  return JSON.parse(new TextDecoder().decode(plain)) as T;
};

export const vaultExists = async (): Promise<boolean> => (await store.getItem(KEY)) != null;

export const newMnemonic = (): string => Mnemonic.fromEntropy(randomBytes(16)).phrase;

export const normaliseMnemonic = (phrase: string): string => {
  const words = phrase.trim().toLowerCase().split(/\s+/).join(' ');
  if (!Mnemonic.isValidMnemonic(words)) throw new Error('Not a valid recovery phrase');
  return words;
};

export const createVault = async (password: string, mnemonic: string): Promise<Unlocked> => {
  if (password.length < 8) throw new Error('Password needs 8+ characters');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keys = await stretch(password, salt, ITERATIONS);
  const sealed = await seal(keys.vaultKey, { mnemonic });
  const record: VaultRecord = { v: 1, salt: b64(salt), ...sealed, iterations: ITERATIONS, railgunWalletId: null };
  await store.setItem(KEY, record);
  return { mnemonic, railgunKey: keys.railgunKey, bookKey: keys.bookKey, record };
};

export const createPasskeyVault = async (prfHex: string, credentialId: string): Promise<Unlocked> => {
  const mnemonic = await passkeyMnemonic(prfHex);
  const keys = await keysFrom(await hkdf(prfBytes(prfHex), 'pangolin/vault/v1', 96));
  const sealed = await seal(keys.vaultKey, { mnemonic });
  const record: VaultRecord = { v: 1, kind: 'passkey', credentialId, salt: '', ...sealed, iterations: 0, railgunWalletId: null };
  await store.setItem(KEY, record);
  return { mnemonic, railgunKey: keys.railgunKey, bookKey: keys.bookKey, record };
};

export const unlockPasskeyVault = async (prfHex: string): Promise<Unlocked> => {
  const record = await store.getItem<VaultRecord>(KEY);
  if (!record) throw new Error('No wallet on this device');
  if (record.kind !== 'passkey') throw new Error('This wallet uses a password');
  const keys = await keysFrom(await hkdf(prfBytes(prfHex), 'pangolin/vault/v1', 96));
  let mnemonic: string;
  try {
    ({ mnemonic } = await open<{ mnemonic: string }>(keys.vaultKey, record));
  } catch {
    throw new Error('Not this wallet\'s passkey');
  }
  return { mnemonic, railgunKey: keys.railgunKey, bookKey: keys.bookKey, record };
};

// --- Hardware wallet (docs/hardware-wallet.md) --------------------------------
// The device's vaultKey signature (RFC 6979, the same every time) stands in for a
// password: HKDF over it gives the three keys. The vault holds RAILGUN's shareable
// viewing key and Main's address, never a seed.

const sigBytes = (sigHex: string): Uint8Array<ArrayBuffer> => {
  if (!/^0x[0-9a-f]{130}$/i.test(sigHex)) throw new Error('Device gave no vault key');
  return Uint8Array.from(sigHex.slice(2).match(/../g)!.map((b) => parseInt(b, 16)));
};

type HardwareSealed = { shareableViewingKey: string; mainAddress: string };

export const createHardwareVault = async (vaultSig: string, sealedData: HardwareSealed): Promise<Unlocked> => {
  const keys = await keysFrom(await hkdf(sigBytes(vaultSig), 'pangolin/vault/v1', 96));
  const sealed = await seal(keys.vaultKey, sealedData);
  const record: VaultRecord = { v: 1, kind: 'hardware', salt: '', ...sealed, iterations: 0, railgunWalletId: null };
  await store.setItem(KEY, record);
  return { mnemonic: '', hardware: sealedData, railgunKey: keys.railgunKey, bookKey: keys.bookKey, record };
};

export const unlockHardwareVault = async (vaultSig: string): Promise<Unlocked> => {
  const record = await store.getItem<VaultRecord>(KEY);
  if (!record) throw new Error('No wallet on this device');
  if (record.kind !== 'hardware') throw new Error('This wallet does not use a hardware device');
  const keys = await keysFrom(await hkdf(sigBytes(vaultSig), 'pangolin/vault/v1', 96));
  let data: HardwareSealed;
  try {
    data = await open<HardwareSealed>(keys.vaultKey, record);
  } catch {
    throw new Error('Not this wallet\'s device');
  }
  return { mnemonic: '', hardware: data, railgunKey: keys.railgunKey, bookKey: keys.bookKey, record };
};

/** How this device's wallet unlocks, for the unlock screen. */
export const vaultInfo = async (): Promise<{ kind: VaultKind; credentialId: string | null } | null> => {
  const record = await store.getItem<VaultRecord>(KEY);
  return record ? { kind: record.kind ?? 'phrase', credentialId: record.credentialId ?? null } : null;
};

export const unlockVault = async (password: string): Promise<Unlocked> => {
  const record = await store.getItem<VaultRecord>(KEY);
  if (!record) throw new Error('No wallet on this device');
  if (record.kind === 'passkey') throw new Error('This wallet unlocks with its passkey');
  if (record.kind === 'hardware') throw new Error('This wallet unlocks with its device');
  const keys = await stretch(password, unb64(record.salt), record.iterations);
  let mnemonic: string;
  try {
    ({ mnemonic } = await open<{ mnemonic: string }>(keys.vaultKey, record));
  } catch {
    throw new Error('Wrong password');
  }
  return { mnemonic, railgunKey: keys.railgunKey, bookKey: keys.bookKey, record };
};

export const saveRailgunWalletId = async (record: VaultRecord, id: string): Promise<void> => {
  record.railgunWalletId = id;
  await store.setItem(KEY, record);
};

export const wipeVault = async (): Promise<void> => {
  await store.clear();
};

/** MetaMask's standard path. Main is index 0, so the phrase restores Main anywhere. */
export const accountPath = (index: number): string => `m/44'/60'/0'/0/${index}`;

/**
 * RAILGUN's layout for app- and use-case-specific accounts:
 * m/44'/60'/1984'/7702'/chain_id'/purpose_id'/index'. Chain 0 means one
 * account for every network. Kept apart from the standard path, so these
 * never show up as ordinary accounts when the phrase is restored elsewhere.
 */
export const ALL_CHAINS = 0;
/** Purpose for temporary single-chain accounts (on a chain-specific subtree). */
export const PURPOSE_TEMP = 1;

/**
 * Each dapp is its own purpose: keccak256 of the dapp key's UTF-8 bytes
 * (e.g. "app.uniswap.org", see dapp-origin.ts), first 4 bytes big-endian,
 * top bit cleared to fit a hardened segment. Deterministic, so restoring the
 * phrase and revisiting a site gives the same address with no saved list.
 */
export const dappPurposeId = (dappKey: string): number =>
  Number.parseInt(keccak256(toUtf8Bytes(dappKey)).slice(2, 10), 16) & 0x7fffffff;
export const appPath = (chainId: number, purpose: number, index: number): string =>
  `m/44'/60'/1984'/7702'/${chainId}'/${purpose}'/${index}'`;

export const deriveAt = (mnemonic: string, path: string): HDNodeWallet => HDNodeWallet.fromPhrase(mnemonic, undefined, path);
