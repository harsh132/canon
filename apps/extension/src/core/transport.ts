// Where network reads go. Every ethers request in the bundle (ours and
// RAILGUN's engine) passes through one hook, and in "nox" mode it is sent
// through an Anon-RPC worker: the RPC provider sees that someone asked, not who.
//
// Fails closed. If the worker cannot boot, reads error out; they never fall
// back to a direct connection on their own. Only the user switches modes.
import { AnonRpcWorker } from '@anon-rpc/browser-extension-harness';
import { FetchRequest } from 'ethers';
import axios from 'axios';
import { FORK, RPC_URL } from './config';
import { emit, state } from './state';
import { store } from './store';

// Nox, the Anon-RPC worker the EF lists for Sepolia (adopters.json5).
const NOX_SPECIFIER = '0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A';
const BOOTSTRAP_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const MODE_KEY = 'rpcMode';

export type RpcMode = 'nox' | 'direct';

const realFetch = globalThis.fetch.bind(globalThis);
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
const classify = (url: string): 'poi' | 'sync' | 'artifacts' | 'other' => {
  const host = new URL(url, location.href).host;
  if (POI_HOSTS.includes(host)) return 'poi';
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
    return via()(input, init);
  }
  bump(kind === 'sync' ? 'sync' : kind === 'artifacts' ? 'artifacts' : 'clear');
  return realFetch(input, init);
};

export const installTransport = async (): Promise<void> => {
  const saved = await store.getItem<RpcMode>(MODE_KEY);
  // A local fork is unreachable from a mixnet exit.
  state.rpc.mode = FORK || RPC_URL.includes('127.0.0.1') ? 'direct' : (saved ?? 'nox');
  FetchRequest.registerGetUrl(getUrl as never);
  globalThis.fetch = patchedFetch;
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
