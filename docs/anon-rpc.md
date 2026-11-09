# Anon-RPC

Every RPC read in the extension, including the RAILGUN engine's, goes through Nox, the Anon-RPC worker the Ethereum Foundation lists for Sepolia.

| Item | Value |
|---|---|
| Package | `@anon-rpc/browser-extension-harness` 0.4.0, spec 0.4.0 |
| Worker | Nox, specifier `0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A` on Sepolia; bundle from `@hisoka-io/anon-rpc-worker` 0.4.1, packaged |
| Bootstrap | PublicNode Sepolia, one clear read per boot (`workerHash()`). No bundle download |
| Code | `apps/extension/src/core/transport.ts` |

## How it is wired

The harness expects to be called from the service worker, which then remotes to an offscreen document it creates. Canon's core already is the offscreen document, and an extension may have only one.

The harness covers this case without `mountOffscreenHost()`. `AnonRpcWorker` checks for `chrome.offscreen`; an offscreen document has no such API but has a DOM, so the harness runs in place (its `PageWorker` mode) and frames the packaged sandbox page directly. No remoting hop.

The manifest needs:

- `sandbox.pages: ["anon-rpc/*/sandbox.html"]`.
- A `sandbox` CSP with `blob:` in `script-src`, because the worker `importScripts` its bundle from a blob URL.
- No `host_permissions`. The bundle is a package file, read same-origin.

The build copies `dist/static/anon-rpc/<version>-<hash>/` from the installed package on every build. A stale copy would leave `worker.ready` hanging forever.

## The packaged bundle

The Nox worker bundle ships inside the extension. The build copies `dist/anon-rpc-worker.js` from `@hisoka-io/anon-rpc-worker` to `dist/nox/anon-rpc-worker.js`. Nothing is downloaded at run time.

The contract still decides which bundle is valid. `transport.ts` gives the harness a provider that:

1. Reads `workerHash()` from the contract through PublicNode, in the clear.
2. Compares it with keccak256 of the packaged bytes. On a mismatch the boot fails with "Nox bundle out of date; update Canon". Reads fail closed, as for any boot error.
3. Answers `workerResolvers()` locally with one `blob:` URL of the packaged bytes, and sends no request for it. SPEC §4.1 lists `blob:` entries for bytes the host already holds.

The harness then fetches the `blob:` URL in the core and checks the hash again before the bytes run (§4).

When Nox publishes a new bundle, update `@hisoka-io/anon-rpc-worker` to the version whose bundle has the new hash. The file `dist/anon-rpc-worker.js.keccak256` in that package names the hash. Until then, Canon stays in the error state, and the user can switch to direct RPC.

## The three seams

| Seam | Catches | Route in Nox mode |
|---|---|---|
| `FetchRequest.registerGetUrl` on ethers | Every JSON-RPC call: our provider and every provider the RAILGUN engine builds | Nox |
| Patched `globalThis.fetch`, PPOI host | Proof-of-innocence lookups | Nox |
| Patched `globalThis.fetch`, everything else | QuickSync, artifacts, Waku DNS discovery | Direct, counted |

`axios.defaults.adapter = 'fetch'` makes the PPOI client use `fetch` instead of XHR, which the patch could not see.

The QuickSync GraphQL client captures `fetch` when its module loads, before the core runs. So `src/shims/inject.js`, which esbuild places at the top of the bundle, replaces `fetch` with a forwarder first; the transport later sets what it forwards to. Without it QuickSync bypassed the counter entirely.

ethers must be a single module instance in the bundle. RAILGUN `require`s it and our code `import`s it; esbuild would otherwise include both builds, each with its own `registerGetUrl`. The build aliases `ethers` to `lib.esm`.

Do not forward ethers' cancel signal to `worker.fetch`. It is not an `AbortSignal`.

## TLS tunnels and the open timeout

The Nox worker (`tls: "required"`, its default) sends every https call through an end-to-end TLS tunnel: RPC reads, the sponsor and proof-of-innocence lookups. The pinned snapshot lists five exits with `tunnel_v1`. An exit that does not answer a tunnel open within `tlsOpenTimeoutMs` is skipped for 10 minutes. When all five are skipped, every Nox call fails with "No exit offers TLS tunnels".

Proving and RAILGUN's transaction building block the core's renderer for seconds. With the 5 s default, one Fund skipped all five exits and failed. `transport.ts` passes `config: { tlsOpenTimeoutMs: 30_000 }`; with it, the same Fund passed with no skipped exit (2026-11-09).

## Measured, bundle still downloaded (Chromium 155, real Sepolia, 2026-11-06)

| What | Result |
|---|---|
| Worker ready | About 6 s after core start |
| New wallet, first full sync | 50 s |
| Requests during that | 18 via Nox (15 RPC, 3 PPOI lookups, all 200), 0 clear |
| Bootstrap | 2 specifier reads, 1 bundle download |
| Bulk sync, direct | 5 QuickSync requests |

The same sync with direct RPC took about 36 s.

## Packaged bundle, measured (Chromium 155, real Sepolia, 2026-11-09)

`e2e-create.mjs` logs every request that the core page makes off the extension. A fresh wallet's boot and first sync made only these:

| Request | Count | Why |
|---|---|---|
| `POST ethereum-sepolia-rpc.publicnode.com` | 1 | `workerHash()`, the specifier read |
| `GET dns.google/resolve?…discovery.rootedinprivacy.com` | 5 | RAILGUN's Waku broadcaster discovery (DNS over HTTPS); not Nox |
| `POST rail-squid.squids.live/…/graphql` | 9 | QuickSync, public data |

No request went to `raw.githubusercontent.com`, `cdn.jsdelivr.net` or `unpkg.com`, and no `kps:` resolver was used. Nox's own traffic is WebRTC to its KPS nodes, which this log does not show. The worker was ready in 4.1 s; the sync finished in 81 s, with 25 reads via Nox and 0 in the clear.

With one line appended to the packaged bundle, the boot stopped with "Nox bundle out of date; update Canon", and 0 RPC reads went out in the clear.

## Chrome Web Store: remotely hosted code

The [MV3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements) say:

> Extensions using Manifest V3 must meet additional requirements related to the extension's code. Specifically, the full functionality of an extension must be easily discernible from its submitted code, unless otherwise exempt as noted in Section 2. This means that the logic of how each extension operates should be self contained. The extension may reference and load data and other information sources that are external to the extension, but these external resources must not contain any logic.

> Additionally, code run in contexts that are isolated from extension APIs (such as iframes and sandboxed pages) are exempt from the restriction on loading code from remote sources; however, these are treated similarly to our policy on communication with external servers. That is, it must still be possible to determine the full functionality of your extension and the interaction must still comply with our user data policies, including Limited Use and the extension's Privacy Policy.

The [MV3 migration guide](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security) says: "In Manifest V3, all of your extension's logic must be part of the extension package." It also says: "Remotely hosted code is supported in sandboxed iframes."

Before this change, Canon relied on the sandbox exemption: the bundle came from GitHub or a CDN at run time. The exemption still asks that the full functionality be determinable. A reviewer cannot do that for code that the package does not contain.

Now the Nox worker is part of the submitted package, so the first rule holds for it. It still runs in the sandboxed null-origin iframe. The Nox README says that the bundle "has no imports and never loads code or WebAssembly by URL". What crosses the network at run time is data: the specifier hash, Nox's registry and topology, and RPC replies.

What is left:

- **RAILGUN's circuit artifacts.** At the first proof, the RAILGUN wallet SDK downloads each circuit's snarkjs witness generator (`*.wasm.br`) and proving key from `ipfs-lb.com`. It checks them against hashes that it carries (`artifact-hash.js`). That WebAssembly then runs in the core, which has extension APIs, so the sandbox exemption does not cover it. To close this, ship the artifacts in the package. This change does not do that.
- **Reviewability of the bundle.** It is 1.8 MB of minified JavaScript with embedded WebAssembly. The npm package carries its source, a provenance file and a reproducible build ([nox-sdk](https://github.com/hisoka-io/nox-sdk)). Link them in the review notes.
- **Updates.** A new `workerHash()` on the contract stops Nox in every installed Canon until a store update ships the matching bundle. Direct RPC still works, by the user's choice.
- **Policy changes.** Read the policy again before each submission.

## Modes

The Privacy screen switches between Nox and direct. The choice is stored. Builds pointed at a local RPC (`127.0.0.1`) or built with `CANON_FORK=1` start in direct mode, since a mixnet exit cannot reach localhost.
