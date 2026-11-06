# Injected provider

Pangolin injects an EIP-1193 provider into every http and https page, like MetaMask, and announces it through EIP-6963. A site connected this way gets the same per-site address it would get over WalletConnect; both key the binding by origin.

| Item | Value |
|---|---|
| Page world | `src/inpage/provider.ts` → `inpage.js`, content script with `"world": "MAIN"`, `document_start` |
| Bridge | `src/inpage/bridge.ts` → `content.js`, isolated-world content script |
| Core | `src/core/dapp.ts` |
| EIP-6963 | name `Pangolin`, rdns `io.github.harsh132.pangolin` |
| `window.ethereum` | Set only if no other wallet set it first. `window.pangolin` always |

## Path of a call

```
page ─postMessage─▶ bridge (isolated world) ─runtime port "pangolin-dapp"─▶ core (offscreen)
```

Chrome stamps the port with the tab's origin. The core keys the site on that, so a page cannot claim to be another site. The prompt shows the origin with the label "This tab".

## Methods

| Method | Behaviour |
|---|---|
| `eth_chainId`, `net_version` | Sepolia |
| `eth_accounts` | The site's address once connected and unlocked, else `[]` |
| `eth_requestAccounts`, `wallet_requestPermissions` | Prompt on first contact. A new site gets a fresh address labelled with its host |
| `wallet_getPermissions`, `wallet_revokePermissions` | Revoking keeps the address for next time |
| `personal_sign`, `eth_signTypedData*`, `eth_sendTransaction` | Prompt. Error 4100 before connecting. EIP-7702 delegations refused with 4001 |
| Reads (`eth_call`, `eth_getBalance`, `eth_blockNumber`, logs, receipts, gas) | Answered through the core's provider, so through Nox |
| `wallet_switchEthereumChain` | Accepts Sepolia only; else 4902 |
| Anything else | 4200 |

Locking sends `accountsChanged` with `[]` to every open tab; unlocking sends each tab its address again.

## Verified

`scripts/e2e-injected.mjs`, 2026-11-06, serving one page on two hosts:

- EIP-6963 announces Pangolin, and `window.ethereum.isPangolin` is true.
- `eth_chainId` is `0xaa36a7`; no accounts before connecting; `eth_blockNumber` answered through Nox.
- Connecting `127.0.0.1` prompted and returned a fresh address at `m/44'/60'/1984'/7702'/0'/1108850336'/0'` (purpose from `http://127.0.0.1:8791`); `personal_sign` recovered to it.
- `localhost` got a different address, at `…/0'/421421168'/0'`.
- Reloading `127.0.0.1` returned the same address with no prompt.

## Permissions

Content scripts on all http and https pages show Chrome's "read and change all your data on all websites" warning, as MetaMask does.

## Icons

Browser dapps show their favicon from Chrome's own favicon cache (`_favicon`, `favicon` permission). The browser serves it locally, so Pangolin makes no network request for it.
