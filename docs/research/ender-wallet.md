# Ender wallet: what carries over to the extension (2026-11-06)

Source: `harsh132/ender-wallet` (private; cloned at `~/Work/ender-wallet`). Expo 57 / RN 0.86 / Bun,
TypeScript. A self-custody wallet with a RAILGUN shielded balance beside the public one, stealth-address
payment names (`<name>.ender.my`) through an `ender-backend` gateway, WalletConnect v2, a dapp browser,
EIP-7702 sweeps. Verified on Sepolia: shield/unshield (ETH, WETH), private send, unshield through a Waku
broadcaster (tx.from = broadcaster), WalletConnect pairing + personal_sign. Not audited, no licence.

## The design decisions worth copying as-is

| Ender decision | Why it matters for the extension |
|---|---|
| **One Send, four shapes.** `src/lib/transfer/operation.ts`: source (public/private) × recipient kind (0x/0zk) ⇒ send / shield / unshield / private-transfer. The user never picks "shield"; the review step names the shape and what it reveals. | Copy verbatim. Our flow mocks had "Shield / Send / Swap" buttons; Ender's model is cleaner and the review copy (`OPERATION_NOTE`) is already written. |
| **User-facing words: "Make private" / "Make public" / "Send privately".** Never "shield/unshield" in UI. | Copy. |
| **Pay a name.** `src/lib/ens/name-recipient.ts`: resolve on Continue, never per keystroke (every lookup leaks the name to the RPC); `org.railgun` text record wins when RAILGUN can pay it on this chain, else `addr`; a failed 0zk lookup is an error with retry, never a silent public payment. | Copy, and route the lookup through Anon-RPC. Note Ender uses the ENS text key **`org.railgun`**; our ENS POC used `org.railgun.0zk`. **Switch to `org.railgun`** so the two wallets interoperate. |
| **Never misrepresent balance.** Failed read ⇒ "Unavailable", never 0; pending POI stays "Pending". | Copy. Our mocks already show "proof pending". |
| **No background polling.** Refresh on mount / network change / user action only, because polling itself signals an active address. | Copy, and it's a line for the CROPS README. |
| **Flow hooks, not screen logic.** Every flow is a `use-*-flow.ts` returning `{...state, ...actions}`; screens only render. | Copy the shape. Lets the popup, the side panel and the offscreen engine share one flow layer. |
| **Verify against the live chain, not config.** RPCs/tokens/added networks probed before trust. | Copy where cheap. |
| **Keys doc** (`docs/KEYS.md`): which RAILGUN key leaks what. Viewing key = total privacy loss, **cannot be rotated**. | Reuse its table in our README's "S" line. |
| Engine protocol: one `call` dispatch over a **whitelist** of SDK function names, not bespoke commands. | Copy for the offscreen-document bridge. |

## Architecture mapping: Expo app → MV3 extension

Ender's hardest problem was Hermes having no WebAssembly, so the whole RAILGUN engine runs in a WebView
with a JSON command protocol. An extension has the same shape of problem for a different reason: the
MV3 service worker is killed when idle and cannot hold the engine. The answer is the same shape too:

| Ender | Extension |
|---|---|
| Engine WebView (`engine-webview/`), bundled by esbuild into one HTML with WASM inlined, loaded with a fake `http://localhost` origin, CSP `connect-src https:` | **Offscreen document** hosting the engine. Same esbuild bundle approach (their `build-engine-html.mjs` shim table and WASM-inlining wrapper port almost verbatim). Real extension origin, so IndexedDB works without the origin trick. |
| RN ⇄ WebView JSON protocol (`protocol.ts`) | Popup ⇄ service worker ⇄ offscreen via `chrome.runtime` ports; same `EngineCommand` / `call` whitelist. |
| Prover WebView (snarkjs in V8) | snarkjs in a Web Worker inside the offscreen document (what our browser POC already assumed). |
| `expo-secure-store` vault (Web3 Secret Storage, scrypt N=2^17) | Same keystore JSON in `chrome.storage.local`; scrypt is native-fast in Chrome, so N=2^17 is fine (~0.6 s). Biometric path doesn't exist; auto-lock on idle does. |
| ethers `JsonRpcProvider` over RN fetch | ethers with `FetchRequest.registerGetUrl` ⇒ **Anon-RPC `worker.fetch`** (our `rpc-hook.mjs`). This is the one place we go further than Ender: their `docs/TOR.md` is a plan for Tor on mobile; Anon-RPC gives the extension the same property today. |
| QuickSync (Subsquid) + PPOI via axios/graphql-mesh | Same, but forced through the Anon-RPC fetch (axios `adapter: 'fetch'`, global fetch patched before the SDK loads). |
| Waku broadcaster (`@railgun-community/waku-broadcaster-client-web`, dynamic import) | Same package is web; libp2p/WebSocket from the offscreen document. Untested by us. |

## What NOT to carry over (hackathon scope)

- **Stealth payment names + ender-backend.** Needs their gateway, the `@ender/stealth` sibling repo, Relay
  sweeps, Calibur 7702 batches. Our **sponsored ENSv2 subname** replaces it: no server in the read path,
  judged by the ENS track, and the name's `org.railgun` record pays privately. Loses per-payer stealth
  addresses, which we should say plainly.
- WalletConnect, dapp browser, multi-chain (6 networks), NFTs, custom networks, Symbiosis swaps.
  Our swap is Uniswap v4 through the same cross-contract-call primitive Ender's `private-swap.ts` uses
  (that file's four "load-bearing" notes about quoting for the adapter and re-shielding the whole balance
  apply directly).
- The Dotrice dot-matrix display face, teal `#59e8c9` on true black, frosted dock: that is Ender's brand.
  Pick one of the ten directions on the canvas; don't re-skin Ender.

## Facts that save time

- RAILGUN SDK pins in Ender: wallet ^10.9, engine ^9.6, shared-models ^8.0, ethers ^6.17, snarkjs ^0.7.6.
  Our POC runs wallet 11.3 / engine 9.9 / shared-models 8.2.1; keep ours (7702-capable).
- Engine slow scan needs archive `eth_getLogs` over 499-block ranges. Free endpoints refuse it on mainnet
  (drpc 408, publicnode 403, 1rpc 50-block cap, Alchemy free 10 blocks). Ankr with a key worked.
  **Sepolia syncs fine on publicnode** (our POCs agree) because QuickSync covers almost everything.
- Mainnet QuickSync page is 13.4 MB against a hard-coded 20 s timeout in the SDK; it times out when
  anything else shares the thread. Stay on Sepolia for the demo.
- The engine only retries a failed scan on its own timeout error; any other transient RPC error aborts the
  sync. Wrap `refreshBalances` in our own retry (our `scan()` poll already does half of this).
- Private transfer gas paid from a public address links that address to the shielded activity; only the
  broadcaster route is fully private. Ender ships both and labels the cost. We should too.
- `sendWithPublicWallet` must be consistent between estimate, proof and populate calls.
- Ender's contrast checker found its tertiary text at 2.93:1. Our Privacy-report mock uses 11 px grey
  labels; check them.
