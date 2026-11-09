# Anon-RPC

Every RPC read in the extension, including the RAILGUN engine's, goes through Nox, the Anon-RPC worker the Ethereum Foundation lists for Sepolia.

| Item | Value |
|---|---|
| Package | `@anon-rpc/browser-extension-harness` 0.4.0, spec 0.4.0 |
| Worker | Nox, specifier `0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A` on Sepolia |
| Bootstrap | PublicNode Sepolia, two clear reads per boot, plus the hash-pinned bundle download |
| Code | `apps/extension/src/core/transport.ts` |

## How it is wired

The harness expects to be called from the service worker, which then remotes to an offscreen document it creates. Canon's core already is the offscreen document, and an extension may have only one.

The harness covers this case without `mountOffscreenHost()`. `AnonRpcWorker` checks for `chrome.offscreen`; an offscreen document has no such API but has a DOM, so the harness runs in place (its `PageWorker` mode) and frames the packaged sandbox page directly. No remoting hop.

The manifest needs:

- `sandbox.pages: ["anon-rpc/*/sandbox.html"]`.
- A `sandbox` CSP with `blob:` in `script-src`, because the worker `importScripts` its bundle from a blob URL.
- No `host_permissions`. The bundle host serves CORS.

The build copies `dist/static/anon-rpc/<version>-<hash>/` from the installed package on every build. A stale copy would leave `worker.ready` hanging forever.

## The three seams

| Seam | Catches | Route in Nox mode |
|---|---|---|
| `FetchRequest.registerGetUrl` on ethers | Every JSON-RPC call: our provider and every provider the RAILGUN engine builds | Nox |
| Patched `globalThis.fetch`, PPOI host | Proof-of-innocence lookups | Nox |
| Patched `globalThis.fetch`, everything else | QuickSync, artifacts, the worker bundle | Direct, counted |

`axios.defaults.adapter = 'fetch'` makes the PPOI client use `fetch` instead of XHR, which the patch could not see.

The QuickSync GraphQL client captures `fetch` when its module loads, before the core runs. So `src/shims/inject.js`, which esbuild places at the top of the bundle, replaces `fetch` with a forwarder first; the transport later sets what it forwards to. Without it QuickSync bypassed the counter entirely.

ethers must be a single module instance in the bundle. RAILGUN `require`s it and our code `import`s it; esbuild would otherwise include both builds, each with its own `registerGetUrl`. The build aliases `ethers` to `lib.esm`.

Do not forward ethers' cancel signal to `worker.fetch`. It is not an `AbortSignal`.

## TLS tunnels and the open timeout

The Nox worker (`tls: "required"`, its default) sends every https call through an end-to-end TLS tunnel: RPC reads, the sponsor and proof-of-innocence lookups. The pinned snapshot lists five exits with `tunnel_v1`. An exit that does not answer a tunnel open within `tlsOpenTimeoutMs` is skipped for 10 minutes. When all five are skipped, every Nox call fails with "No exit offers TLS tunnels".

Proving and RAILGUN's transaction building block the core's renderer for seconds. With the 5 s default, one Fund skipped all five exits and failed. `transport.ts` passes `config: { tlsOpenTimeoutMs: 30_000 }`; with it, the same Fund passed with no skipped exit (2026-11-09).

When a Nox call still fails that way, the transport sets `rpc.noTunnelsAt`. The status line shows "Nox · no exits", and the Privacy screen says why calls fail and that direct RPC works but shows the user's IP to the provider. The next Nox call that works, or a switch of mode, clears it. Canon does not switch to direct by itself: it fails closed.
## Nodes behind head

PublicNode spreads calls over backends at different heights, and Nox gives each call its own path. So the engine can read the head from one backend, then ask a backend one block behind for logs up to that head. That backend answers `-32602` "block range extends beyond current head block". The engine retries only its own timeouts, so the scan stopped until the next sync (seen once, 2026-11-09).

`getUrl` in `transport.ts` checks each short JSON-RPC reply for that error. It waits 2 s and sends the same request again, up to 5 times, then passes the error on. The check is in the hook, so it covers every provider: ours and each one the engine builds, in Nox and in direct mode. Clamping `toBlock` would not do: the engine would record blocks it never scanned. `scripts/check-head-lag.ts` checks the retry with a fake reply.

## Measured (Chromium 155, real Sepolia, 2026-11-06)

| What | Result |
|---|---|
| Worker ready | About 6 s after core start |
| New wallet, first full sync | 50 s |
| Requests during that | 18 via Nox (15 RPC, 3 PPOI lookups, all 200), 0 clear |
| Bootstrap | 2 specifier reads, 1 bundle download |
| Bulk sync, direct | 5 QuickSync requests |

The same sync with direct RPC took about 36 s.

## Modes

The Privacy screen switches between Nox and direct. The choice is stored. Builds pointed at a local RPC (`127.0.0.1`) or built with `CANON_FORK=1` start in direct mode, since a mixnet exit cannot reach localhost.
