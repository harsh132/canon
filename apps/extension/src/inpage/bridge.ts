// Isolated-world content script: relays the page's provider calls to the core
// over a runtime port. Chrome stamps that port with this tab's origin, which
// is what the core keys the site's address on; the page cannot change it.
import { decode, encode } from '../shared/codec';
import { DAPP_PORT_NAME, type SwMessage } from '../shared/protocol';

const TO_BRIDGE = 'canon:bridge';
const FROM_BRIDGE = 'canon:inpage';

let port: chrome.runtime.Port | null = null;
let connecting: Promise<chrome.runtime.Port> | null = null;

const toPage = (msg: Record<string, unknown>) => window.postMessage({ target: FROM_BRIDGE, ...msg }, window.location.origin);

const connect = (): Promise<chrome.runtime.Port> => {
  if (port) return Promise.resolve(port);
  connecting ??= (async () => {
    await chrome.runtime.sendMessage({ type: 'ensure-core' } satisfies SwMessage);
    const p = chrome.runtime.connect({ name: DAPP_PORT_NAME });
    p.onMessage.addListener((raw: string) => toPage(decode(raw)));
    p.onDisconnect.addListener(() => {
      port = null;
    });
    port = p;
    return p;
  })().finally(() => {
    connecting = null;
  });
  return connecting;
};

window.addEventListener('message', (e: MessageEvent) => {
  if (e.source !== window || e.data?.target !== TO_BRIDGE) return;
  const { id, method, params } = e.data as { id: number; method: string; params: unknown };
  connect().then(
    (p) => p.postMessage(encode({ id, method, params })),
    (err: unknown) => toPage({ id, error: { code: 4900, message: `Canon Wallet unavailable: ${String((err as Error)?.message ?? err)}` } }),
  );
});
