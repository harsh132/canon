// Where network reads go. Every ethers request in the bundle (ours and
// RAILGUN's engine) passes through one hook, and in "nox" mode it is sent
// through an Anon-RPC worker: the RPC provider sees that someone asked, not who.
//
// Fails closed. If the worker cannot boot, reads error out; they never fall
// back to a direct connection on their own. Only the user switches modes.
import { AnonRpcWorker } from '@anon-rpc/browser-extension-harness';
import { FetchRequest } from 'ethers';
import axios from 'axios';
import { DEV, FORK, RPC_URL } from './config';
import { emit, state } from './state';
import { store } from './store';

// Nox, the Anon-RPC worker the EF lists for Sepolia (adopters.json5).
const NOX_SPECIFIER = '0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A';
const BOOTSTRAP_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const MODE_KEY = 'rpcMode';

export type RpcMode = 'nox' | 'direct';

// The untouched fetch, saved by src/shims/inject.js before any module loaded.
const g = globalThis as unknown as { __canonRealFetch?: typeof fetch; __canonFetch?: typeof fetch };
const realFetch: typeof fetch = g.__canonRealFetch ?? globalThis.fetch.bind(globalThis);
let worker: AnonRpcWorker | null = null;

const bump = (key: keyof typeof state.rpc.counts): void => {
  state.rpc.counts[key] += 1;
  emit();
};

// The worker reads its specifier contract once per boot. That read is in the
// clear by necessity; it names the worker, not the user.
const bootstrapProvider = {
  request: async ({ method, params }: { method: string; params?: unknown[] }) => {
    bump('bootstrap');
    const r = await realFetch(BOOTSTRAP_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }),
    });
    const j = (await r.json()) as { result?: unknown; error?: { message: string } };
    if (j.error) throw new Error(j.error.message);
    return j.result;
  },
};

const ensureWorker = (): AnonRpcWorker => {
  if (worker) return worker;
  state.rpc.status = 'booting';
  emit();
  const w = new AnonRpcWorker({ address: NOX_SPECIFIER, preExisting: { rpcProvider: bootstrapProvider } });
  worker = w;
  const started = Date.now();
  w.ready.then(
    () => {
      state.rpc.status = 'ready';
      state.rpc.bootMs = Date.now() - started;
      emit();
    },
    (e: unknown) => {
      if (worker === w) worker = null;
      state.rpc.status = 'error';
      state.rpc.error = (e as Error)?.message ?? String(e);
      emit();
    },
  );
  return w;
};

const via = (): typeof fetch => {
  if (state.rpc.mode !== 'nox') return realFetch;
  return ensureWorker().fetch as typeof fetch;
};

type GetUrlResponse = { statusCode: number; statusMessage: string; headers: Record<string, string>; body: Uint8Array };

const getUrl = async (req: FetchRequest): Promise<GetUrlResponse> => {
  const mixed = state.rpc.mode === 'nox';
  bump(mixed ? 'mixed' : 'clear');
  // ethers' cancel signal is not an AbortSignal; do not forward it.
  const res = await via()(req.url, {
    method: req.method,
    headers: Object.fromEntries(Object.entries(req.headers)),
    body: req.body ? new Uint8Array(req.body) : undefined,
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => (headers[k] = v));
  return { statusCode: res.status, statusMessage: res.statusText, headers, body: new Uint8Array(await res.arrayBuffer()) };
};

// RAILGUN's non-RPC traffic. QuickSync pages (~13 MB) and circuit artifacts
// are bulk downloads of public data that name nobody; they stay direct and are
// counted. Proof-of-innocence lookups carry this wallet's blinded commitments,
// so they go through the worker with the RPC reads.
const POI_HOSTS = ['ppoi.fdi.network'];
// WalletConnect's analytics. Sent even with telemetry off; never needed.
const BLOCKED_HOSTS = ['pulse.walletconnect.org', 'pulse.walletconnect.com'];
const classify = (url: string): 'poi' | 'sync' | 'artifacts' | 'bootstrap' | 'blocked' | 'other' => {
  const host = new URL(url, location.href).host;
  if (BLOCKED_HOSTS.includes(host)) return 'blocked';
  if (POI_HOSTS.includes(host)) return 'poi';
  // The worker's hash-pinned bundle. Names Nox, not the user.
  if (url.includes('/anon-rpc/')) return 'bootstrap';
  if (/subsquid|squid|graph/i.test(host)) return 'sync';
  if (/ipfs|artifact/i.test(host + url)) return 'artifacts';
  return 'other';
};

const patchedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('chrome-extension:') || url.startsWith('blob:') || url.startsWith('data:')) return realFetch(input, init);
  const kind = classify(url);
  if (kind === 'poi' && state.rpc.mode === 'nox') {
    bump('mixed');
    const res = await via()(input, init);
    if (DEV) console.log('[transport] poi via nox', res.status);
    return res;
  }
  if (kind === 'blocked') return new Response(null, { status: 204 });
  if (kind === 'other') console.log('[transport] direct', url.slice(0, 120));
  bump(kind === 'poi' ? 'clear' : kind);
  return realFetch(input, init);
};

/** For our own HTTPS calls (the name sponsor): through Nox when on. Local URLs go direct. */
export const privateFetch = (url: string, init?: RequestInit): Promise<Response> => {
  if (state.rpc.mode === 'nox' && url.startsWith('https:')) {
    bump('mixed');
    return via()(url, init);
  }
  bump('other');
  return realFetch(url, init);
};

/** A JSON reply, or a short error when a service answers with anything else (an outage or proxy page). */
export const replyJson = async <T>(res: Response, who: string): Promise<T> => {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${who} unavailable (HTTP ${res.status})`);
  }
};

export const installTransport = async (): Promise<void> => {
  const saved = await store.getItem<RpcMode>(MODE_KEY);
  // A local fork is unreachable from a mixnet exit.
  state.rpc.mode = FORK || RPC_URL.includes('127.0.0.1') ? 'direct' : (saved ?? 'nox');
  FetchRequest.registerGetUrl(getUrl as never);
  g.__canonFetch = patchedFetch;
  // axios defaults to XHR in a browser, which the fetch patch cannot see.
  axios.defaults.adapter = 'fetch';
  if (state.rpc.mode === 'nox') ensureWorker();
  emit();
};

export const setRpcMode = async (mode: RpcMode): Promise<void> => {
  state.rpc.mode = mode;
  state.rpc.error = undefined;
  await store.setItem(MODE_KEY, mode);
  if (mode === 'nox') ensureWorker();
  emit();
};
