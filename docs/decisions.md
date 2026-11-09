# Decisions

Newest last (roughly). Each entry: what, why, and what would change it.

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-11-04 | Build on RAILGUN | Mature shielded pool on Sepolia with a browser-capable SDK; POCs proved sync, shield, transfer and unshield |
| 2026-11-06 | A lean extension, not a fork of EF's Kohaku | Kohaku is a GPL-3 Ambire fork, 218 MB, needs Alchemy, Hypersync and Pimlico keys, and has no Anon-RPC. Re-evaluated when asked, same answer |
| 2026-11-06 | Lead with the EF Anon-RPC track; partner tracks Uniswap and ENS v2 | Anon-RPC is the strongest fit for a privacy wallet; one EF prize per project |
| 2026-11-06 | ENS: sponsored subnames under a parent we own | Free for users; Canon pays and renounces control after issuing. Record key `org.railgun`, matching Ender |
| 2026-11-06 | Model the product on Ender | One Send routed by recipient, plain words, no polling, flow logic outside screens |
| 2026-11-06 | UI in zo.mr's "Tape" theme; minimal copy | The author's own design language; the user asked for few words on screen |
| 2026-11-06 | Name: Canon, for now | Chosen from animal names; may be renamed |
| 2026-11-06 | Monorepo with bun workspaces, hoisted linker | Room for more apps; hoisting lets the build alias transitive packages by path |
| 2026-11-06 | ENS held back; RAILGUN first | User's call: get the private balance working before names |
| 2026-11-06 | esbuild, not Vite | RAILGUN is CommonJS-heavy, and Ender's esbuild shim table already worked against it |
| 2026-11-06 | Core in the offscreen document | The service worker dies when idle and has no DOM. One long-lived place for engine, socket and keys |
| 2026-11-06 | Per-dapp public addresses over WalletConnect | User request, following Ender's rules |
| 2026-11-06 | Test private flows on an anvil fork | No funded Sepolia key, and faucets need a human. Fork mode disables POI, build-time only |
| 2026-11-06 | Pin the extension id with a manifest key | So a WalletConnect allowlist entry stays valid |
| 2026-11-06 | Anon-RPC before WalletConnect verification | User's call while the WalletConnect project id is pending |
| 2026-11-06 | Run the harness in place inside the core | Its PageWorker mode needs no second offscreen document and no remoting hop |
| 2026-11-06 | Bulk sync data stays direct | 13 MB QuickSync pages through a mixnet are impractical, and they name no address. Counted and documented |
| 2026-11-06 | Block WalletConnect analytics | A privacy wallet should not send usage telemetry |
| 2026-11-06 | Fail closed when Nox is down | A silent fallback to direct RPC would leak exactly what the feature hides |
| 2026-11-06 | Injected provider alongside WalletConnect, same per-site binding | User request. One origin key for both, so a site sees one address however it connects |
| 2026-11-06 | Do not take `window.ethereum` from another wallet | EIP-6963 lets dapps pick; overwriting would break the user's existing wallet |
| 2026-11-06 | Per-dapp addresses on RAILGUN's `m/44'/60'/1984'/7702'/chain'/purpose'/i'`, chain `0`, purpose `0` | From the RAILGUN team. Keeps dapp addresses apart from ordinary accounts; chain `0` gives a site one address on every network. Main stays on the standard path |
| 2026-11-06 | One `purpose_id` per dapp, hashed from its origin; `index` counts accounts within the dapp | User's reading that purpose_id is for apps. Hashing makes addresses recoverable from the phrase alone |
| 2026-11-06 | Broadcaster by default for private sends; Main only by choice | Closes the gas link from Main. Waku exposes IP to its peers, which is the smaller leak |
| 2026-11-06 | Generate proof-of-innocence proofs on every sync | Self-paid private sends stayed pending; the wallet must build those proofs while open |
| 2026-11-06 | Default private-send gas back to Main | Sepolia broadcasters rejected every send on proof of innocence. Broadcaster stays one tap away |
| 2026-11-06 | Names owned by an unfunded app-path address, not Main | Main is the visible sender of shields; owning the name from it would link the two |
| 2026-11-06 | Parent registered for 1 year | The 10 test USDC covered one year (8 USDC). Anyone can renew |
| 2026-11-06 | Sponsor relays private sends by default on Sepolia | Closes the gas link from Main while Sepolia broadcasters reject; no fee on testnet |
| 2026-11-06 | Side panel on icon click | User request. Stays open across tabs and shows dapp prompts in place |
| 2026-11-06 | Dapp requests open the toolbar popup, not a window | A separate window tiled full-size on the user's desktop. Chrome only opens the side panel on a click, but `openPopup` works without one. An open panel shows requests itself |
| 2026-11-06 | Swap on the v4 native ETH/USDC pool, not WETH/USDC | Sepolia's v4 WETH/USDC pools are empty; Relay Adapt unwraps, swaps, and re-wraps any leftover so a failed swap returns funds |
| 2026-11-06 | Per-tab side panel showing that tab's dapp and its address | User's idea: Uniswap and Aave open side by side each show their own address |
| 2026-11-06 | Fund a site address from the private balance in one unshield; WETH arrives as ETH | A new site address is empty; dapps and gas expect ETH |
| 2026-11-06 | Gasless site addresses through EIP-7702 to Uniswap's Calibur, submitted by our sponsor | User asked for 7702 straight away. Calibur is audited, already on Sepolia, and lets a relayer execute signed batches, so no ETH and no ERC-4337 bundler |
| 2026-11-06 | Delegate only the wallet's own site addresses, only to Calibur; refuse calls into the account | A 7702 delegation hands the account to the code it names. Main and standard accounts stay plain |
| 2026-11-06 | EIP-5792 with `atomic` and `auxiliaryFunds` | Batches map onto one Calibur call; the batch id is the transaction hash, so status needs no storage |
| 2026-11-06 | Onboarding: new wallet, passkey, restore; hardware later | User request |
| 2026-11-06 | A passkey wallet is derived from the passkey's PRF output | User's choice (option 1): a synced passkey restores the wallet with no phrase. The phrase is still shown, optionally, at setup |
| 2026-11-06 | The extension is the passkey's relying party; no hosted page | Chrome allows WebAuthn and PRF from an extension page (checked with a virtual authenticator). A hosted page would add a server and attack surface |
| 2026-11-07 | An open side panel takes its own tab's requests | A popup over an open panel showed the same wallet twice. Only the requesting tab's panel counts, since Chrome shows a tab's panel only while that tab is active |
| 2026-11-06 | Onboarding opens in a tab on install | The toolbar popup can close while a passkey dialog has focus; the phrase screens need room |
| 2026-11-06 | New wallets check three words of the phrase | Catches a phrase that was not written down |
| 2026-11-06 | Sponsor relays RAILGUN's 7702 unshield (type 4) | User's choice. Keeps Fund one transaction and sponsored Make public working. Accepted only with one authorization to RelayAdapt7702 on Sepolia, signed by the transaction's own target |
| 2026-11-06 | Tabs under the header; status in one bottom line; secondary items in a menu | User request: information at the bottom, a lock icon, a menu for things like Get a name |
| 2026-11-06 | Show private WETH as ETH | It leaves as ETH, and users think in ETH |
| 2026-11-06 | Recovery phrase in the menu, behind the password or passkey again | Passkey wallets otherwise see their phrase only once, at setup |
| 2026-11-06 | Mainnet later; Sepolia only for the hackathon | User's call after pro.aave.com failed at the chain switch |
| 2026-11-07 | RAILGUN on Arbitrum only among mainnets; public wallets on Ethereum, Arbitrum, Base, Optimism, Polygon | User's choice. Arbitrum has the classic Relay Adapt and proof of innocence, like Sepolia; Base is 7702-only with neither |
| 2026-11-07 | A network per dapp; dapp chain switches accepted without a prompt | User's choice. Only networks in Canon's list, with Canon's own RPCs; the dapp's RPC URL is ignored |
| 2026-11-07 | Keep Sepolia | The sponsor, names and the demo run there |
| 2026-11-07 | One private network per core session, switched by restart | Every private module keeps its constants; switching locks the wallet |
| 2026-11-07 | Host the sponsor on Cloudflare Workers with one Durable Object, deployed with `cf` | User's choice. The Durable Object keeps one transaction queue for the single sponsor key; the free `workers.dev` address avoids a domain. Tighter caps in public |
| 2026-11-06 | Show dapp icons on prompts, not only in lists | User's choice over Ender's lists-only rule. The origin stays the leading line; WalletConnect icons are fetched through Nox |
| 2026-11-09 | Remove the BuddyOS hardware wallet (device link, signer, `apps/hw-mock`, onboarding and unlock screens) | User request. Real hardware wallets, such as Ledger, come later. The code is in git history before this change |
| 2026-11-09 | The hackathon is over; its track and prize rules no longer apply | User's call. Earlier rows that cite the hackathon (the Anon-RPC lead, partner tracks, Sepolia only for the hackathon, Sepolia kept for the demo) stand only on their own merit now. The submission write-up is removed; the Uniswap feedback moves to `docs/research/` |
| 2026-11-09 | Nox tunnel-open timeout 30 s, not the worker's 5 s | Proving blocks the core's renderer, so tunnel exits were skipped for 10 min and Nox calls failed. One Fund failed at 5 s and passed at 30 s. Cost: a dead exit now delays a call by up to 30 s before the next exit |
| 2026-11-09 | Retry a "beyond current head block" reply in the transport hook, not clamp `toBlock` | One hook covers every provider the engine builds. A clamp would let the engine record blocks it never scanned. Cost: a lagging node delays that read by 2 s per retry, up to 10 s |
| 2026-11-09 | Auto-lock time is a setting: 5, 15 (default) or 60 min, in the Privacy screen | User request. Stored unencrypted like `rpcMode`, since the core needs it before unlock. No "never" choice: a wallet that never locks defeats the lock |
| 2026-11-09 | Custom tokens live in the encrypted account book, per chain | Which tokens someone holds is private, like their sites. A token's own symbol is a claim: plain ASCII, at most 11 characters, and a copy of ETH, WETH or USDC is shown as "WETH?" with a warning, also for unknown tokens in the private balance |
| 2026-11-09 | ERC-20 Make private approves exactly the amount, only when the allowance is short | No standing unlimited allowance to RAILGUN's proxy from a public account |
| 2026-11-09 | Ship the Nox worker bundle in the package; the contract's `workerHash()` must still match it | The Chrome Web Store asks that all logic be in the package. The harness takes the bytes from a local `blob:` resolver (SPEC §4.1). Cost: a new Nox bundle needs a Canon release; until then Nox fails closed |
| 2026-11-09 | Check a 7702 unshield's own POIs against its target, the delegated ephemeral account | `POIValidator` compares `tx.to` with a RAILGUN contract, which a type-4 unshield never matches; the wallet method takes the contract address and has a 7702 mode. Without it, Fund and sponsored Make public change waited hours for the slow route |
| 2026-11-09 | Save each POI submission in the encrypted book before it runs; resume it after unlock | The wallet can submit only while the core runs, so a closed wallet left notes on the slow route. A job keeps its network and each accepted proof with its tree position, survives any failure, and is dropped after 7 days |
| 2026-11-09 | Ship RAILGUN's circuit witness generators (`.wasm`, 83 MB) in the package; keep downloading the proving keys | The `.wasm` is code that runs in the core; the Chrome Web Store asks for all logic in the package. The proving keys are data (894 MB for all circuits), and the SDK checks their hashes. The build checks every `.wasm` against the SDK's hashes; the transport refuses any fetch under `/prover/`. Cost: a large package, and IPFS still sees the IP at a first proof |
| 2026-11-09 | The countdown shows the newest shield's hold, not the soonest note | Notes stuck on proof of innocence count as ready now and hid a new shield's countdown |
| 2026-11-09 | A failed name lookup is reported, never read as "no record" | Ethers labels an RPC timeout `CALL_EXCEPTION`; reading it as a missing `org.railgun` record let Send fall through to the public address. Only a revert with error data counts; `ResolverNotFound` reads "is not registered" |
| 2026-11-09 | Start the RAILGUN engine with `shouldDebug` true in every build; show "Proof sync paused" | The SDK connects no engine logger otherwise, so production builds never saw an engine error. Canon's log function still prints only in dev. The warning clears when the local TXID index reaches the POI node's |
| 2026-11-09 | Only the newest request may set UI state (a counter per request kind) | Comparing the current inputs let an older reply win after A → B → A or a double click. Used in the site card and the Tokens screen |
| 2026-11-10 | A graphify knowledge graph of the repo, not committed | Agents query a scoped subgraph before they search files. The output regenerates (`/graphify .`), so `graphify-out/` is ignored, as in Ender |
| 2026-11-10 | Docs are only summary, decisions, operations and research | User request. The per-feature docs and the test log drifted from the code. The code and the graph show the structure; git history keeps the old docs |

## Why the code looks unusual

Each item is a workaround that a later reader could remove by mistake.

### RAILGUN in an MV3 page

- **Node shims** (`scripts/build.mjs`): `crypto` to `crypto-browserify`, plus `stream`, `path` and `buffer`; Node-only modules to an empty module; `process` and `Buffer` injected at the top of the bundle.
- **`@graphql-mesh/cross-helpers` is pinned to its browser build.** Otherwise QuickSync returns nothing and gives no error, and the engine falls back to a slow scan from the deployment block.
- **The Poseidon and curve25519 `.wasm` files are inlined.** Their loaders use `import.meta.url`, which fails in a bundle. The engine then falls back to a JS Poseidon about 24 times slower, and gives no error.
- **The QuickSync timeout is raised from 20 s to 300 s.** A page is about 13 MB. The build fails if the patched line moves.
- **`ethers` and `axios` are aliased to one build each.** Otherwise esbuild bundles the CommonJS and ESM builds side by side, and the transport hook on one copy misses the other's traffic.
- **`axios.defaults.adapter = 'fetch'`.** The POI client otherwise uses XHR, which the fetch patch cannot see.
- **`src/shims/inject.js` replaces `fetch` with a forwarder before any module loads.** The QuickSync client captures `fetch` when its module loads, before the transport exists.
- **Do not pass ethers' cancel signal to `worker.fetch`.** It is not an `AbortSignal`.
- **CSP:** `extension_pages` needs `'wasm-unsafe-eval'`. The core checks at start whether snarkjs can use blob workers, and proves on one thread if not.
- **The Anon-RPC harness runs in place in the core** (its `PageWorker` mode). An extension can have only one offscreen document, and the core already is one.
- **Fork builds patch the engine's POI** (`patchPoiForFork`): no POI node watches a fork.
- **Engine errors that are not problems are filtered** (`BENIGN`): note decryption failures, and the TXID queue waiting for the UTXO tree.

### RAILGUN behaviour

- **Settle before spending again.** Until the transaction is mined and scanned again, the engine sees spent notes as unspent, and a second proof over them reverts with "Note already spent". The next private send waits for the last one (at most 10 minutes, because a relayed transaction can be replaced under a new hash).
- **An `Incomplete` scan is a failure.** The engine reports it without throwing; `sync()` retries.
- **A node behind head:** PublicNode answers from backends at different heights, and Nox gives each call its own path. The transport retries "block range extends beyond current head block" up to 5 times, 2 s apart. Clamping `toBlock` would let the engine record blocks it never scanned.
- **New wallets scan from today's block.** Imported phrases scan from the deployment block.
- **A 7702 unshield's own POIs are checked against its target** (the delegated ephemeral account) with the wallet method's 7702 mode. `POIValidator` compares `tx.to` with a RAILGUN contract, which a type-4 unshield never matches.
- **Sponsored sends carry a 1-wei fee note to the wallet itself.** The POI node keys a single commitment proof on the first output's note key, which only that output's receiver can decrypt.
- **Nox TLS tunnel-open timeout is 30 s.** Proving blocks the core's renderer for seconds; with the 5 s default, every exit was skipped for 10 minutes.

### Chrome

- **The service worker attaches `popup.html` to the icon only while it opens it,** then detaches it, so the next icon click opens the side panel again.
- **The offscreen document has no `chrome.storage`,** so everything is in IndexedDB.
- **Passkey dialogs run in the visible page.** The offscreen core can show no dialog, and the toolbar popup can close while the dialog has focus.

