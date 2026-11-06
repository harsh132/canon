// Names: <label>.pangolin.eth, issued free by the sponsor, owned by an
// unfunded identity address, with an org.railgun record holding the 0zk.
// Every lookup goes through the core's provider, so through Nox.
import { AbiCoder, Contract, Interface, dnsEncode, getAddress, namehash } from 'ethers';
import { createAccount, previewAccount, setName, signerFor, accounts } from './book';
import { getProvider } from './config';
import { privateFetch } from './transport';
import { emit, state } from './state';

export const PARENT = 'pangolin.eth';
export const TEXT_KEY = 'org.railgun';
const SPONSOR_URL = process.env.PANGOLIN_SPONSOR_URL || 'http://127.0.0.1:8792';
const UNIVERSAL_RESOLVER = '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe';
const LABEL = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

const textIface = new Interface(['function text(bytes32 node, string key) view returns (string)']);
const addrIface = new Interface(['function addr(bytes32 node) view returns (address)']);
const ur = () => new Contract(UNIVERSAL_RESOLVER, ['function resolve(bytes name, bytes data) view returns (bytes, address)'], getProvider());

export const isName = (s: string): boolean => /^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/i.test(s.trim());

/** The address that owns this wallet's names. Never funded, never used to sign anything else. */
const identity = async () => {
  const existing = accounts().find((a) => a.label === 'Name owner');
  if (existing) return signerFor(existing.index).address;
  const spot = previewAccount(PARENT);
  await createAccount('Name owner', spot);
  return spot.address;
};

const call = async (path: string, init?: RequestInit) => {
  const res = await privateFetch(`${SPONSOR_URL}${path}`, init);
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(body.error ?? `Sponsor error ${res.status}`));
  return body;
};

export const claimName = async (label: string): Promise<string> => {
  const l = label.trim().toLowerCase();
  if (!LABEL.test(l)) throw new Error('3–32 of a-z, 0-9, -');
  if (!state.railgunAddress) throw new Error('Wallet is still starting');
  const owner = await identity();
  let name = `${l}.${PARENT}`;
  try {
    const out = await call('/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: l, owner, zk: state.railgunAddress }),
    });
    name = String(out.name);
  } catch (e) {
    // A claim whose reply was lost (popup closed mid-request) still landed.
    // If the name already pays this wallet, it is ours.
    if (!/taken/i.test((e as Error).message)) throw e;
    const r = await resolveName(name).catch(() => null);
    if (r?.address !== state.railgunAddress) throw e;
  }
  await setName(name);
  state.name = name;
  emit();
  return name;
};

/** Submits a proved RAILGUN transaction through the sponsor, which pays the gas. */
export const sponsorRelay = async (to: string, data: string, minGasPrice: bigint): Promise<string> => {
  const out = await call('/relay', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chainId: 11155111, to, data, minGasPrice: minGasPrice.toString() }),
  });
  return String(out.hash);
};

export type Resolved = { address: string; via: 'org.railgun' | 'addr' };

/**
 * org.railgun wins: if a name publishes a 0zk, it is paid privately. Otherwise
 * its ETH address. Called only when the user asks to review a send, never per
 * keystroke: each lookup tells the RPC which name is being paid.
 */
export const resolveName = async (name: string): Promise<Resolved> => {
  const n = name.trim().toLowerCase();
  const node = namehash(n);
  const resolve = async (data: string) => {
    try {
      const [out] = (await ur().resolve(dnsEncode(n), data)) as [string, string];
      return out;
    } catch {
      return null;
    }
  };
  const text = await resolve(textIface.encodeFunctionData('text', [node, TEXT_KEY]));
  if (text) {
    const zk = AbiCoder.defaultAbiCoder().decode(['string'], text)[0] as string;
    if (zk) return { address: zk, via: 'org.railgun' };
  }
  const addr = await resolve(addrIface.encodeFunctionData('addr', [node]));
  if (addr) {
    const a = AbiCoder.defaultAbiCoder().decode(['address'], addr)[0] as string;
    if (a && a !== '0x0000000000000000000000000000000000000000') return { address: getAddress(a), via: 'addr' };
  }
  throw new Error(`${n} has no address`);
};
