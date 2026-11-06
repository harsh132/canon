# Decisions

Newest last. Each entry: what, why, and what would change it.

| Date | Decision | Why |
|---|---|---|
| 2026-11-04 | Build on RAILGUN | Mature shielded pool on Sepolia with a browser-capable SDK; POCs proved sync, shield, transfer and unshield |
| 2026-11-06 | A lean extension, not a fork of EF's Kohaku | Kohaku is a GPL-3 Ambire fork, 218 MB, needs Alchemy, Hypersync and Pimlico keys, and has no Anon-RPC. Re-evaluated when asked, same answer |
| 2026-11-06 | Lead with the EF Anon-RPC track; partner tracks Uniswap and ENS v2 | Anon-RPC is the strongest fit for a privacy wallet; one EF prize per project |
| 2026-11-06 | ENS: sponsored subnames under a parent we own | Free for users; Pangolin pays and renounces control after issuing. Record key `org.railgun`, matching Ender |
| 2026-11-06 | Model the product on Ender | One Send routed by recipient, plain words, no polling, flow logic outside screens |
| 2026-11-06 | UI in zo.mr's "Tape" theme; minimal copy | The author's own design language; the user asked for few words on screen |
| 2026-11-06 | Name: Pangolin, for now | Chosen from animal names; may be renamed |
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
