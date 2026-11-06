# Architecture

## Parts

| Part | Runs in | Source | Holds |
|---|---|---|---|
| Core | Offscreen document | `apps/extension/src/core` | Vault, RAILGUN engine, Anon-RPC worker, WalletConnect client, account book |
| Service worker | MV3 background | `src/background/sw.ts` | Nothing. Creates the offscreen document, sets the badge, opens prompts |
| Popup | Action popup, or a popup window for dapp prompts | `src/popup` | Nothing secret. Renders pushed state, sends commands |
| Inpage provider | Each http(s) page's own world | `src/inpage/provider.ts` | Nothing. EIP-1193 provider, EIP-6963 announcement |
| Bridge | Each page, isolated world | `src/inpage/bridge.ts` | Nothing. Relays calls to the core over a port Chrome stamps with the tab's origin |
| Anon-RPC sandbox | Null-origin iframe inside the core | `dist/anon-rpc/<ver>/sandbox.html` | The hash-pinned Nox worker bundle |

The core lives in the offscreen document because the service worker is killed when idle and has no DOM. The offscreen document stays up, so the engine, its IndexedDB store and the WalletConnect socket survive the popup closing.

## Messages

```
popup ──port "pangolin-popup"──▶ core          commands (whitelist), JSON with tagged bigints
popup ◀─────── state push ─────── core          whole CoreState after every change, coalesced per tick
core  ──runtime.sendMessage────▶ service worker "prompt" / "prompt-clear"
page  ─postMessage─▶ bridge ─port "pangolin-dapp"─▶ core   EIP-1193 calls; origin from Chrome
popup ──runtime.sendMessage────▶ service worker "ensure-core" before connecting
```

The command list is `Commands` in `src/shared/protocol.ts`. The core rejects anything else. The popup never receives a key, a mnemonic after backup, or a signer.

## Keys

- One BIP-39 phrase per wallet.
- Public addresses are `m/44'/60'/0'/0/i`. Index 0 is **Main**. Each new dapp gets the lowest unused index, labelled with the dapp's name. Indices are never reused.
- The RAILGUN wallet derives from the same phrase, so one backup restores both.
- The password is stretched with PBKDF2-SHA256, 600,000 iterations, into 96 bytes: the vault key (AES-GCM), the RAILGUN encryption key, and the account-book key (AES-GCM).

## Storage

All in the extension origin's IndexedDB. The offscreen document has no `chrome.storage`.

| Store | Contents | At rest |
|---|---|---|
| `pangolin/kv` → `vault` | Salt, IV, encrypted phrase, RAILGUN wallet id | Encrypted |
| `pangolin/kv` → `book` | Public accounts, dapp bindings, activity | Encrypted |
| `pangolin/kv` → `rpcMode` | `nox` or `direct` | Plain |
| `pangolin-railgun` | RAILGUN merkle trees (public data) and wallet data | Wallet data encrypted with the RAILGUN key |
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
