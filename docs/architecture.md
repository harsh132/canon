# Architecture

## Parts

| Part | Runs in | Source | Holds |
|---|---|---|---|
| Core | Offscreen document | `apps/extension/src/core` | Vault, RAILGUN engine, Anon-RPC worker, WalletConnect client, account book |
| Service worker | MV3 background | `src/background/sw.ts` | Nothing. Creates the offscreen document, sets the badge, opens prompts |
| UI | The onboarding tab (`onboard.html`) on first install; Chrome side panel (`panel.html`) when the user clicks the toolbar icon; the toolbar popup (`popup.html`) when a dapp asks for something and no Canon UI is open; a small window (`popup.html?window=1`) only if Chrome refuses the popup | `src/popup` | Nothing secret. Renders pushed state, sends commands |
| Inpage provider | Each http(s) page's own world | `src/inpage/provider.ts` | Nothing. EIP-1193 provider, EIP-6963 announcement |
| Bridge | Each page, isolated world | `src/inpage/bridge.ts` | Nothing. Relays calls to the core over a port Chrome stamps with the tab's origin |
| Sponsor | Cloudflare Worker + Durable Object (`apps/sponsor`); `bun src/server.ts` locally | `apps/sponsor/src` | The gas key. Pays for private sends, swaps, Fund, name claims and site-address calls ([sponsor.md](sponsor.md)) |
| Anon-RPC sandbox | Null-origin iframe inside the core | `dist/anon-rpc/<ver>/sandbox.html` | The hash-pinned Nox worker bundle |

The core lives in the offscreen document because the service worker is killed when idle and has no DOM. The offscreen document stays up, so the engine, its IndexedDB store and the WalletConnect socket survive the popup closing.

## Messages

```
panel ──port "canon-popup"──▶ core          commands (whitelist), JSON with tagged bigints
popup ◀─────── state push ─────── core          whole CoreState after every change, coalesced per tick
core  ──runtime.sendMessage────▶ service worker "prompt" / "prompt-clear"
page  ─postMessage─▶ bridge ─port "canon-dapp"─▶ core   EIP-1193 calls; origin from Chrome
popup ──runtime.sendMessage────▶ service worker "ensure-core" before connecting
```

The command list is `Commands` in `src/shared/protocol.ts`. The core rejects anything else. The popup never receives a key or a signer. It receives the mnemonic only at backup, and from the menu's Recovery phrase after `vault.reveal` checks the password or passkey against the stored vault.

## Keys

- One BIP-39 phrase per wallet. A passkey wallet's phrase comes from the passkey ([onboarding.md](onboarding.md#passkey-wallets)).

| Account | Path | Why |
|---|---|---|
| Main | `m/44'/60'/0'/0/0` | MetaMask's standard path, so the phrase restores Main in any wallet |
| Accounts the user adds | `m/44'/60'/0'/0/n` | Same standard path, next unused `n` |
| Per-dapp addresses | `m/44'/60'/1984'/7702'/0'/<purpose(dapp)>'/i'` | RAILGUN's app-specific layout `…/chain_id'/purpose_id'/index'`. Chain `0` = every network. One purpose per dapp; `i` = 0 for its address, more if the user asks for another |
| Temporary single-chain accounts (reserved) | `m/44'/60'/1984'/7702'/<chain id>'/1'/i'` | Purpose `1`. Not used yet |
| RAILGUN spending / viewing | `m/44'/1984'/0'/0'/i'`, `m/420'/1984'/0'/0'/i'` | The RAILGUN engine's own |

- Each book record stores its path; the book's `index` is only an id. Records are never deleted, so a path is never reused.
- **purpose(dapp)** = keccak256 of the dapp key's UTF-8 bytes (the normalised origin from `dapp-origin.ts`, e.g. `app.uniswap.org` or `http://127.0.0.1:8791`), first 4 bytes read big-endian, top bit cleared. Code: `dappPurposeId` in `core/vault.ts`.
- Deterministic, so restoring the phrase and revisiting a site yields the same address with no saved list. The book still only lists sites visited since the restore.
- Dapp addresses do not appear when the phrase is restored in an ordinary wallet. Recovering them needs a wallet that follows this rule.
- A WalletConnect dapp with no usable origin cannot get a derived address; the prompt defaults to Main.
- The password is stretched with PBKDF2-SHA256, 600,000 iterations, into 96 bytes: the vault key (AES-GCM), the RAILGUN encryption key, and the account-book key (AES-GCM). Passkey wallets get the same 96 bytes from HKDF over the passkey's PRF output.

## Storage

All in the extension origin's IndexedDB. The offscreen document has no `chrome.storage`.

| Store | Contents | At rest |
|---|---|---|
| `canon/kv` → `vault` | Kind, salt or passkey credential id, IV, encrypted phrase, RAILGUN wallet id | Encrypted |
| `canon/kv` → `book` | Public accounts, dapp bindings, activity | Encrypted |
| `canon/kv` → `rpcMode` | `nox` or `direct` | Plain |
| `canon-railgun` | RAILGUN merkle trees (public data) and wallet data | Wallet data encrypted with the RAILGUN key |
| `railgun-artifacts` | Circuit artifacts | Public data |
| WalletConnect's own stores | Pairings and sessions | Plain, as the SDK keeps them |

The book is encrypted because a readable list of the sites someone uses is the very disclosure per-dapp addresses exist to prevent.

## Locking

The wallet locks after 15 minutes without a command, and on the Lock button. Locking drops the phrase, the derived signers and the RAILGUN wallet from memory. WalletConnect requests that arrive while locked open the popup at an unlock prompt.

## Build

esbuild bundles three entries; the Tailwind 4 CLI builds the CSS. See `apps/extension/scripts/build.mjs`.

| Entry | Output | Notes |
|---|---|---|
| `src/core/main.ts` | `core.js`, IIFE, about 15 MB | Node shims, inlined RAILGUN WASM, QuickSync timeout raised |
| `src/background/sw.ts` | `background.js`, ESM | Tiny |
| `src/popup/main.tsx` | `popup.js` + `popup.css` | React 19, Tailwind 4 |

`ethers` and `axios` are aliased to a single build each. Without that, esbuild bundles the CommonJS and ESM builds side by side, and a transport hook on one copy misses the other's traffic.

The extension id is pinned by the manifest `key` to `nigpkikilgbfgmgcmeiidiinikafjpjg`. The matching private key is `apps/extension/key.pem`, gitignored.

## Screen frame

Every unlocked screen sits in one frame (`src/popup/frame.tsx`):

- **Header:** mark, a Sepolia badge, a lock icon and a menu (Get a name, Addresses, Privacy, Recovery phrase, Reset).
- **Tabs under the header:** Home, Send, Swap, Apps.
- **One status line at the bottom:** where reads go (Nox or direct, with clear and mixed counts; taps open Privacy) and how fresh the private balance is (taps sync).

Home shows the site card (side panel, only when the tab has a dapp), the private balance in ETH, Main's public balance on demand, Receive, and recent activity. Locking returns the frame to Home.

## Where prompts appear

The panel is per tab; see [site-accounts.md](site-accounts.md#per-tab-panel).

| Situation | Shows |
|---|---|
| User clicks the toolbar icon | The side panel |
| A dapp or WalletConnect request needs approval, no Canon UI open | The toolbar popup, on the requesting tab's window (`chrome.action.openPopup`, Chrome 127+) |
| Same, with a popup already open | The popup shows it; nothing new opens |
| A site's request, with that tab's side panel open | The panel shows it in full; no popup, no badge |
| A WalletConnect request, with any side panel open | The panel shows it in full; no popup |
| A site's request, with only another tab's panel open | The toolbar popup; that panel shows a bar to review it too |
| Chrome refuses to open the popup | A small separate window, as a last resort |

The service worker attaches `popup.html` to the icon only while opening it, then detaches it, so the next icon click opens the panel again. The core tracks open UI ports, and each panel's tab (from `panel.html?tab=N`), to decide whether to ask at all.
