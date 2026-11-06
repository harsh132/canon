# RAILGUN in the extension

| Item | Value |
|---|---|
| Packages | `@railgun-community/wallet` 11.3.0, `engine` 9.9.1, `shared-models` 8.2.1, `ethers` 6.14.3, `snarkjs` 0.7.6 |
| Network | Ethereum Sepolia |
| Store | IndexedDB via `level-js` (`pangolin-railgun`); artifacts via `localforage` (`railgun-artifacts`) |
| PPOI node | `https://ppoi.fdi.network` |
| Code | `apps/extension/src/core/railgun.ts`, `send.ts` |

## One Send

The user never picks "shield" or "unshield". Source and recipient decide:

| From | To | Operation | Button |
|---|---|---|---|
| Public account | 0x | Plain ETH send | Send publicly |
| Public account | 0zk | `shieldBaseToken` (ETH in, WETH private) | Make private |
| Private | 0zk | `generateTransferProof` + `populateProvedTransfer` | Send privately |
| Private | 0x | `generateUnshieldBaseTokenProof` (WETH out as ETH) | Make public |

Review shows what becomes visible, the gas fee, which public account pays gas, and whether a proof is needed. Private sends use `sendWithPublicWallet = true` with Main paying gas, for now.

The shield key is `keccak256(sign(getShieldPrivateKeySignatureMessage()))` from the funding account, as RAILGUN specifies.

## Making it run in an MV3 page

Ported from Ender's engine WebView build:

- **Node shims.** `crypto` to `crypto-browserify`, `stream`, `path`, `buffer`; Node-only modules to an empty module; `process` and `Buffer` injected at the top of the bundle.
- **`@graphql-mesh/cross-helpers` pinned to its browser build.** Otherwise QuickSync silently returns nothing and the engine falls back to a slow scan from the deployment block.
- **Poseidon and curve25519 WASM inlined.** Their loaders use `import.meta.url`, which fails in a bundle; the engine then silently falls back to a JS Poseidon about 24x slower.
- **QuickSync timeout raised from 20 s to 300 s.** Pages run about 13 MB. The build fails loudly if the patched line moves.
- **CSP.** `extension_pages` needs `'wasm-unsafe-eval'`. snarkjs's blob workers are allowed; the core probes at boot and falls back to single-threaded proving if not.

## Quirks found by testing

- **Settle before spending again.** After a private send, the engine still sees the spent notes as unspent until the transaction is mined and re-scanned. A second proof over them reverts with "Note already spent". `send.ts` makes the next private send wait for the last one to settle.
- **Incomplete scans.** A load-balanced RPC node behind head makes the slow scan stop early ("block range extends beyond current head"). The engine reports `Incomplete` without throwing; `sync()` treats that as a failure and retries.
- **New wallets scan from today's block.** A fresh phrase has no history; imported phrases scan from the deployment block.
- **Engine boot can be slow.** Unlock does not wait on it; the vault is usable first and the wallet opens in the background.
- **Shield fee.** 25 basis points: 1 ETH made private shows 0.9975 WETH.

## Fork mode

`PANGOLIN_FORK=1` builds for a local anvil fork of Sepolia. No PPOI aggregator watches a fork, so every shield would stay pending forever. Fork mode removes the network's POI config and patches the engine to treat unspent notes as spendable. Never ship a fork build. See [testing.md](testing.md).
