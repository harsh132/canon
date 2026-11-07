// Injected at the top of the core bundle: the engine's deps read these at module scope.
import { Buffer } from 'buffer';
const proc = (globalThis.process ??= {});
proc.env ??= {};
proc.version ??= 'v22.0.0';
proc.versions ??= { node: '22.0.0' };
proc.browser ??= true;
proc.nextTick ??= (cb, ...args) => queueMicrotask(() => cb(...args));
globalThis.Buffer ??= Buffer;
export { Buffer };

// Some clients (the QuickSync GraphQL stack) capture `fetch` when their module
// loads, before the core can patch it. Install a forwarder first, so the
// transport can route them later. Only in pages that have fetch.
if (typeof globalThis.fetch === 'function' && !globalThis.__canonRealFetch) {
  const real = globalThis.fetch.bind(globalThis);
  globalThis.__canonRealFetch = real;
  globalThis.fetch = (input, init) => (globalThis.__canonFetch ?? real)(input, init);
}
