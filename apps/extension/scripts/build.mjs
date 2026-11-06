// Builds the MV3 extension into dist/.
//   bun scripts/build.mjs           one-shot
//   bun scripts/build.mjs --watch   rebuild on change
//
// esbuild rather than Vite: the RAILGUN stack is CommonJS-heavy and Ender's
// esbuild shim table is already proven against it. Tailwind runs as its CLI.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { context, build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..');
const root = join(app, '..', '..');
const nm = (...p) => join(root, 'node_modules', ...p);
const dist = join(app, 'dist');
const watch = process.argv.includes('--watch');

// .env -> build-time constants. Public config only (project ids, RPC URLs).
const env = {};
for (const file of ['.env', '.env.local']) {
  const path = join(app, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const define = {
  'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production'),
  'process.env.PANGOLIN_WC_PROJECT_ID': JSON.stringify(env.PANGOLIN_WC_PROJECT_ID ?? ''),
  'process.env.PANGOLIN_SEPOLIA_RPC': JSON.stringify(env.PANGOLIN_SEPOLIA_RPC ?? ''),
  global: 'globalThis',
  'import.meta.url': '"chrome-extension://pangolin/"',
};

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NODE_ONLY = [
  'http', 'https', 'http2', 'zlib', 'net', 'tls', 'dns', 'fs', 'readline', 'child_process',
  'worker_threads', 'cluster', 'dgram', 'module', 'perf_hooks', 'v8', 'vm', 'tty', 'url',
  'querystring', 'os', 'constants', 'fs/promises', 'util/types', 'async_hooks',
];
const ALIASES = {
  crypto: join(app, 'src', 'shims', 'node-crypto.js'),
  stream: nm('stream-browserify', 'index.js'),
  path: nm('path-browserify', 'index.js'),
  buffer: nm('buffer', 'index.js'),
  // The graph client swallows a resolution miss here and quick sync silently returns nothing.
  '@graphql-mesh/cross-helpers': nm('@graphql-mesh', 'cross-helpers', 'browser.js'),
};
const emptyShim = join(app, 'src', 'shims', 'node-empty.js');

// The two wasm-bindgen packages read their .wasm via import.meta.url, and the
// engine silently falls back to a 24x slower JS Poseidon if that fails. Inline.
const WASM = {
  '@railgun-community/poseidon-hash-wasm': {
    esm: nm('@railgun-community', 'poseidon-hash-wasm', 'index.mjs'),
    wasm: nm('@railgun-community', 'poseidon-hash-wasm', 'pkg-esm', 'poseidon_hash_wasm_bg.wasm'),
    exports: ['poseidon', 'poseidonHex', 'initSync'],
  },
  '@railgun-community/curve25519-scalarmult-wasm': {
    esm: nm('@railgun-community', 'curve25519-scalarmult-wasm', 'pkg-esm', 'curve25519_scalarmult_wasm.js'),
    wasm: nm('@railgun-community', 'curve25519-scalarmult-wasm', 'pkg-esm', 'curve25519_scalarmult_wasm_bg.wasm'),
    exports: ['scalarMultiply', 'initSync'],
  },
};
const wasmWrapper = ({ esm, wasm, exports }) => `
import __init, { ${exports.join(', ')} } from ${JSON.stringify(esm)};
const __b64 = ${JSON.stringify(readFileSync(wasm).toString('base64'))};
const __bytes = () => Uint8Array.from(atob(__b64), (c) => c.charCodeAt(0));
export { ${exports.join(', ')} };
export default () => __init(__bytes());
`;

// Quick sync pages are 13 MB against a hard-coded 20 s budget. Raise it, loudly.
const quickSyncPlugin = {
  name: 'quick-sync-timeout',
  setup(b) {
    b.onLoad({ filter: /quick-sync[\\/]graph-query\.js$/ }, (args) => {
      const src = readFileSync(args.path, 'utf8');
      const needle = ", 20000, new Error('Timeout querying Graph";
      if (!src.includes(needle)) throw new Error(`quick-sync timeout moved in ${args.path}`);
      return { contents: src.replace(needle, ", 300000, new Error('Timeout querying Graph"), loader: 'js' };
    });
  },
};

const shimPlugin = {
  name: 'node-shims',
  setup(b) {
    const names = [...Object.keys(ALIASES), ...NODE_ONLY];
    b.onResolve({ filter: new RegExp(`^(${names.map(reEscape).join('|')})$`) }, (a) => ({
      path: ALIASES[a.path] ?? emptyShim,
    }));
    b.onResolve({ filter: /^node:/ }, (a) => ({ path: ALIASES[a.path.slice(5)] ?? emptyShim }));
    b.onResolve({ filter: new RegExp(`^(${Object.keys(WASM).map(reEscape).join('|')})$`) }, (a) => ({
      path: a.path,
      namespace: 'wasm-inline',
    }));
    b.onLoad({ filter: /.*/, namespace: 'wasm-inline' }, (a) => ({
      contents: wasmWrapper(WASM[a.path]),
      resolveDir: root,
      loader: 'js',
    }));
  },
};

const common = {
  bundle: true,
  platform: 'browser',
  target: 'chrome120',
  define,
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  legalComments: 'none',
  logLevel: 'warning',
  mainFields: ['browser', 'module', 'main'],
  conditions: ['browser'],
};

const targets = [
  // The core: vault, RAILGUN engine, WalletConnect. Lives in the offscreen document.
  { ...common, entryPoints: { core: join(app, 'src/core/main.ts') }, format: 'iife', outdir: dist,
    plugins: [quickSyncPlugin, shimPlugin], inject: [join(app, 'src/shims/inject.js')] },
  // The service worker only keeps the offscreen document alive and opens prompts.
  { ...common, entryPoints: { background: join(app, 'src/background/sw.ts') }, format: 'esm', outdir: dist },
  // The popup never holds a key; it renders state and sends intents.
  { ...common, entryPoints: { popup: join(app, 'src/popup/main.tsx') }, format: 'esm', outdir: dist,
    jsx: 'automatic', plugins: [shimPlugin] },
];

const copyStatic = () => {
  mkdirSync(join(dist, 'fonts'), { recursive: true });
  cpSync(join(app, 'public'), dist, { recursive: true });
  const fonts = [
    ['instrument-sans', 'instrument-sans-latin-400-normal.woff2'],
    ['instrument-sans', 'instrument-sans-latin-500-normal.woff2'],
    ['instrument-sans', 'instrument-sans-latin-600-normal.woff2'],
    ['jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff2'],
    ['jetbrains-mono', 'jetbrains-mono-latin-700-normal.woff2'],
  ];
  for (const [pkg, file] of fonts) cpSync(nm('@fontsource', pkg, 'files', file), join(dist, 'fonts', file));
};

const tailwind = (w) =>
  new Promise((resolve, reject) => {
    const args = ['-i', join(app, 'src/popup/styles.css'), '-o', join(dist, 'popup.css')];
    if (w) args.push('--watch');
    else args.push('--minify');
    const bin = nm('.bin', 'tailwindcss');
    const p = spawn(bin, args, { stdio: w ? 'inherit' : ['ignore', 'ignore', 'inherit'], cwd: app });
    if (w) return resolve();
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tailwind exited ${code}`))));
  });

if (!watch) rmSync(dist, { recursive: true, force: true });
copyStatic();
const started = Date.now();
if (watch) {
  for (const t of targets) await (await context(t)).watch();
  await tailwind(true);
  console.log('watching… load dist/ as an unpacked extension');
} else {
  await Promise.all([...targets.map((t) => build(t)), tailwind(false)]);
  console.log(`built dist/ in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
