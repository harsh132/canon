// Runs in the page's own JavaScript world (manifest "world": "MAIN"). No
// extension APIs here: every call goes to the bridge in the isolated world by
// window.postMessage, and from there to the core.
//
// EIP-1193 provider, announced through EIP-6963. Sets window.ethereum only if
// no other wallet has, so it never hijacks one the user already relies on.

type Listener = (...args: unknown[]) => void;
type Reply = { target: string; id?: number; result?: unknown; error?: { code: number; message: string }; event?: string; data?: unknown };

const TO_BRIDGE = 'canon:bridge';
const FROM_BRIDGE = 'canon:inpage';
// Each site has its own network in Canon; this starts at Sepolia and follows chainChanged.
const START_CHAIN = '0xaa36a7';

class ProviderRpcError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

class CanonProvider {
  readonly isCanon = true;
  chainId = START_CHAIN;
  networkVersion = String(Number.parseInt(START_CHAIN, 16));
  selectedAddress: string | null = null;
  #listeners = new Map<string, Set<Listener>>();
  #pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  #nextId = 1;

  constructor() {
    window.addEventListener('message', (e: MessageEvent<Reply>) => {
      if (e.source !== window || e.data?.target !== FROM_BRIDGE) return;
      const msg = e.data;
      if (msg.event) {
        if (msg.event === 'chainChanged') {
          if (msg.data === this.chainId) return;
          this.chainId = String(msg.data);
          this.networkVersion = String(Number.parseInt(this.chainId, 16));
        }
        if (msg.event === 'accountsChanged') {
          const list = (msg.data as string[]) ?? [];
          if ((list[0] ?? null) === this.selectedAddress) return;
          this.selectedAddress = list[0] ?? null;
        }
        this.#emit(msg.event, msg.data);
        return;
      }
      const w = msg.id != null ? this.#pending.get(msg.id) : undefined;
      if (!w) return;
      this.#pending.delete(msg.id!);
      if (msg.error) w.reject(new ProviderRpcError(msg.error.code, msg.error.message));
      else w.resolve(msg.result);
    });
    queueMicrotask(() => this.#emit('connect', { chainId: this.chainId }));
  }

  request = (args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown> => {
    if (!args || typeof args.method !== 'string') return Promise.reject(new ProviderRpcError(-32600, 'Invalid request'));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      window.postMessage({ target: TO_BRIDGE, id, method: args.method, params: args.params ?? [] }, window.location.origin);
    }).then((result) => {
      if (args.method === 'eth_chainId' && typeof result === 'string' && result !== this.chainId) {
        this.chainId = result;
        this.networkVersion = String(Number.parseInt(result, 16));
      }
      if ((args.method === 'eth_requestAccounts' || args.method === 'eth_accounts') && Array.isArray(result)) {
        const next = (result[0] as string | undefined) ?? null;
        if (next !== this.selectedAddress) {
          this.selectedAddress = next;
          this.#emit('accountsChanged', result);
        }
      }
      return result;
    });
  };

  isConnected = (): boolean => true;
  enable = (): Promise<unknown> => this.request({ method: 'eth_requestAccounts' });

  // Legacy shapes some dapps still call.
  send = (methodOrPayload: unknown, paramsOrCallback?: unknown): unknown => {
    if (typeof methodOrPayload === 'string') return this.request({ method: methodOrPayload, params: paramsOrCallback as unknown[] });
    if (typeof paramsOrCallback === 'function') return this.sendAsync(methodOrPayload, paramsOrCallback as Listener);
    const p = methodOrPayload as { method: string; params?: unknown[] };
    return this.request(p);
  };

  sendAsync = (payload: unknown, cb: Listener): void => {
    const p = payload as { id?: number; method: string; params?: unknown[] };
    this.request(p).then(
      (result) => cb(null, { id: p.id, jsonrpc: '2.0', result }),
      (error) => cb(error, { id: p.id, jsonrpc: '2.0', error }),
    );
  };

  on = (event: string, fn: Listener): this => {
    let set = this.#listeners.get(event);
    if (!set) this.#listeners.set(event, (set = new Set()));
    set.add(fn);
    return this;
  };
  addListener = this.on;
  once = (event: string, fn: Listener): this => {
    const wrap: Listener = (...a) => {
      this.removeListener(event, wrap);
      fn(...a);
    };
    return this.on(event, wrap);
  };
  removeListener = (event: string, fn: Listener): this => {
    this.#listeners.get(event)?.delete(fn);
    return this;
  };
  off = this.removeListener;
  removeAllListeners = (event?: string): this => {
    if (event) this.#listeners.delete(event);
    else this.#listeners.clear();
    return this;
  };

  #emit(event: string, data: unknown): void {
    for (const fn of this.#listeners.get(event) ?? []) {
      try {
        fn(data);
      } catch (e) {
        console.error(e);
      }
    }
  }
}

const ICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#ece9e0"/><g fill="none" stroke="#0d7150" stroke-width="2" stroke-linejoin="round"><path d="M12 2.5l8 4.5v10l-8 4.5-8-4.5v-10z"/><path d="M12 7l4.5 2.5v5L12 17l-4.5-2.5v-5z"/></g></svg>',
  );

const provider = new CanonProvider();
const info = Object.freeze({
  uuid: crypto.randomUUID(),
  name: 'Canon Wallet',
  icon: ICON,
  rdns: 'io.github.harsh132.canon',
});
const announce = () =>
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
window.addEventListener('eip6963:requestProvider', announce);
announce();

const w = window as unknown as { ethereum?: unknown; canon?: unknown };
w.canon = provider;
if (!w.ethereum) {
  Object.defineProperty(window, 'ethereum', { value: provider, configurable: true, writable: true });
  window.dispatchEvent(new Event('ethereum#initialized'));
}
