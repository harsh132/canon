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
