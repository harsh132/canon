# Submission: Best Use of Anon-RPC

**Pangolin** is a Chrome extension wallet for private Ethereum use: a RAILGUN private balance, a fresh public address for every site, free private-payable ENS names, and every chain read through Anon-RPC (Nox) by default.

## What the judges asked for, and where it is

| Criterion | Pangolin |
|---|---|
| Works end to end in the demo | Real Sepolia: new wallet, first sync, make private, send privately to `alice.pangolin.eth`, make public, all with reads through Nox. Transactions are linked in [testing.md](testing.md) |
| Quality of UX | One Send screen decides the operation from source and recipient. A Privacy screen shows reads via Nox, clear reads (0), and a "Nothing leaked" stamp |
| Share of traffic through Anon-RPC | Every JSON-RPC call in the bundle, including the RAILGUN engine's own providers, plus proof-of-innocence lookups. First sync: 18 via Nox, 0 clear |
| Intentional exclusions | Listed below with reasons |
| Shippable after the hackathon | MV3, no new host permissions, fails closed, harness assets versioned in the build |
| Technical depth | Below |

## Traffic: what goes through Nox and what does not

| Traffic | Route | Why |
|---|---|---|
| Every ethers JSON-RPC call (wallet, RAILGUN engine, dapp reads, ENS resolution, Uniswap quotes) | **Nox** | One `FetchRequest.registerGetUrl` hook on the single ethers copy in the bundle |
| RAILGUN proof-of-innocence lookups (they carry this wallet's blinded commitments) | **Nox** | Patched `fetch`, axios switched to its fetch adapter |
| Calls to Pangolin's sponsor (name claims, relayed sends) over https | **Nox** | `privateFetch` |
| RAILGUN QuickSync (~13 MB GraphQL pages) and circuit artifacts | Direct, counted | **Intentional**: public bulk data that names no address; mixnet latency would make first sync impractical |
| Nox bootstrap (2 specifier reads, bundle download) | Direct, counted | Names Nox, not the user |
| WalletConnect relay, RAILGUN broadcaster discovery (Waku) | Direct | WebSocket / p2p, not HTTP RPC |
| WalletConnect analytics | **Blocked** | Sent even with telemetry off |

If Nox cannot boot, reads fail: the wallet never falls back to direct RPC on its own. The user can switch deliberately on the Privacy screen.

## Technical depth

- **Harness inside an existing offscreen document.** Pangolin's whole core (vault, RAILGUN engine, WalletConnect) lives in the extension's single offscreen document. The harness's `PageWorker` mode runs in place there, framing the packaged null-origin sandbox page, with no second offscreen document and no remoting hop. See [anon-rpc.md](anon-rpc.md).
- **One ethers instance.** RAILGUN `require`s ethers while app code imports it, so a bundler includes both builds, and a hook registered on one misses the other's traffic. The build aliases ethers (and axios) to a single copy.
- **Early-bound `fetch`.** RAILGUN's GraphQL client captures `fetch` at module load. A forwarder installed at the very top of the bundle lets the transport route and count it.
- **Measured.** Sepolia first sync: 50 s through Nox vs 36 s direct; Nox worker ready in about 3–6 s.

## Beyond reads

The same privacy goal runs through the rest of the wallet: one public address per dapp (RAILGUN's app-path derivation, keyed by origin, over both WalletConnect and an injected EIP-6963 provider), private sends relayed by a sponsor so no user address pays gas, and proof-of-innocence proofs submitted by the wallet itself, as a RAILGUN broadcaster does.

## Run it

See [apps/extension/README.md](../apps/extension/README.md). Reads go through Nox by default; the Privacy screen shows the counts live.
