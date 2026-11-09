# Decisions

Newest last. Each entry: what, why, and what would change it.

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
