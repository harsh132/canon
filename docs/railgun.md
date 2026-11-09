# RAILGUN in the extension

| Item | Value |
|---|---|
| Packages | `@railgun-community/wallet` 11.3.0, `engine` 9.9.1, `shared-models` 8.2.1, `ethers` 6.14.3, `snarkjs` 0.7.6 |
| Network | Ethereum Sepolia |
| Store | IndexedDB via `level-js` (`canon-railgun`); artifacts via `localforage` (`railgun-artifacts`) |
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

With a token picked in Send (an ERC-20 on the private network, listed or added), the same four paths move that token: `transfer`, `approve` + `populateShield`, the transfer proof, and `generateUnshieldProof` ([networks.md](networks.md#tokens)).

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
- **Incomplete scans.** A load-balanced RPC node behind head makes the slow scan stop early ("block range extends beyond current head"). The transport hook now retries that one reply (see [anon-rpc.md](anon-rpc.md#nodes-behind-head)). If the scan still stops, the engine reports `Incomplete` without throwing; `sync()` treats that as a failure and retries.
- **New wallets scan from today's block.** A fresh phrase has no history; imported phrases scan from the deployment block.
- **Engine boot can be slow.** Unlock does not wait on it; the vault is usable first and the wallet opens in the background.
- **Shield fee.** 25 basis points: 1 ETH made private shows 0.9975 WETH.

## Fork mode

`CANON_FORK=1` builds for a local anvil fork of Sepolia. No PPOI aggregator watches a fork, so every shield would stay pending forever. Fork mode removes the network's POI config and patches the engine to treat unspent notes as spendable. Never ship a fork build. See [testing.md](testing.md).

## Broadcasters

Private sends can go through a RAILGUN broadcaster (`core/broadcaster.ts`, `@railgun-community/waku-broadcaster-client-web` 10.0.1). The broadcaster submits from its own address and takes its fee in private WETH, so no public address of the user's appears.

- Discovery starts on unlock over Waku. On Sepolia it connected and found one broadcaster (fees in two tokens) within about 30 s.
- Gas is type 1 with one gas price, because a broadcaster commits to an `overallBatchMinGasPrice`.
- Make public unshields to ETH through the Relay Adapt contract, so it needs a broadcaster that supports Relay Adapt.
- On Sepolia (2026-11-06) the broadcaster rejected both attempts with "Could not validate Proof of Innocence", though our input note had cleared. Unresolved; Sepolia broadcasters may not validate POI. Main is the default route until that is resolved.
- The Send screen offers "Main" instead, which pays gas publicly and links Main. The fork build defaults to Main.

## Proof of innocence on real Sepolia

Measured 2026-11-06 with `e2e-sepolia.mjs`:

| Event | Time to spendable |
|---|---|
| Make private (shield) | About 12 minutes |
| Send privately with Main paying gas | Not cleared after 40+ minutes |

After the self-paid private send, both new notes sat in `MissingExternalPOI`, and the engine listed the send in `getChainTxidsStillPendingSpentPOIs`. The wallet has to generate the proof itself, which needs the send in RAILGUN's TXID tree first. `sync()` now calls `generatePOIsForWallet` after every scan so the proof is built while the wallet is open. A broadcaster send attaches its proofs up front instead. `scripts/poi-probe.mjs` prints this state from a dev build.

## Spendable countdown

Home shows "Spendable in about N min" under pending private funds, or "Clearing proof of innocence" when the hold is over and the proof is not.

- **Data.** RAILGUN's network config has no shield hold time (`NETWORK_CONFIG[...].poi` holds only `launchBlock` and `launchTimestamp`), and the POI status info has no time. Two sources work: each note's block time (`TXO.timestamp`, seconds, from `walletForID(id).TXOs()`) and its bucket (`POI.getBalanceBucket`).
- **Hold.** `SHIELD_HOLD_MS` in `shared/eta.ts` holds the measured 12 minutes for Sepolia. A network with no entry (Arbitrum) gets no estimate for shields until someone measures it.
- **Core.** `rebuildBalances` calls `readPendingEta` only while some balance is pending, so it adds no RPC call and no polling. The soonest pending note decides. `CoreState.pendingEta` is `{ readyAt }` (ms epoch) or null. A pending note from a private send has no hold, so `readyAt` is 0 and the text is "Clearing proof of innocence".
- **UI.** `etaText` rounds up to whole minutes. Home re-renders every 30 s from the stored time. It asks the core for nothing.
- **Not done.** The Recent list shows a transaction's own status, which is done once mined, so it has no countdown. A full activity screen can read `pendingEta` too.
- **Check.** `bun scripts/check-eta.ts` covers no data, a running hold, hold over, and the oldest note winning.

## Sponsored relay (default on Sepolia)

Private sends default to Canon's sponsor paying gas (`apps/sponsor/src/relay.ts`, `POST /relay`). The wallet proves in broadcaster mode with no fee output and posts `{ to, data, minGasPrice }`; the sponsor sends it from its own address.

- The sponsor accepts only the RAILGUN proxy and Relay Adapt as `to`, simulates at the real gas price first (RAILGUN checks `tx.gasprice >= minGasPrice`), caps gas at 4M and sends at most 60 an hour.
- It prices legacy gas from the latest base fee ×2 plus a tip. A node's `eth_gasPrice` lagged the base fee on Sepolia (17 wei against 18) and left the first relayed transaction unmineable; `scripts/replace-stuck.ts` rebroadcast it.
- No fee is charged, so this is testnet-only as written. On mainnet it must charge a private-token fee covering gas, and running a relayer there has legal exposure.
- The wallet submits the send's pre-attached proofs itself (`core/poi-assurance.ts`), one single commitment proof per output it owns. Measured: spendable again 7 minutes after sending, against 40+ minutes without. It can only do that while the core runs, so each submission is saved in the encrypted book (`pendingPOI`, codec-encoded because the transaction carries bigints) before it starts, with its network and the proofs the node has accepted so far, each with its tree and position: after a re-org that moves the transaction, its outputs are submitted again at the new position. A job saved before the network field existed is read as Sepolia's, the only network that ran relayed private sends then. It is removed only when every output the wallet owns is accepted, or when the first output is not the wallet's (nothing to submit). Any other failure keeps it: a lock, a network or node error, a rejected change proof, and a validation result of "invalid", which the SDK also gives for a node timeout. After an unlock, once the wallet has synced, `resumePOI` runs the saved jobs of the current private network and skips accepted proofs; jobs of the other network wait. A job still running from before the lock is marked and starts again when that run ends. A job older than 7 days is dropped, so one that can never pass retries on each unlock until then.
- The wallet caps its wait for a send to settle at 10 minutes, because a relayed transaction can be replaced under a new hash.

Verified 2026-11-06: Send privately 0.001 WETH to `alice.pangolin.eth`, name resolved through Nox, sponsor as sender ([tx](https://sepolia.etherscan.io/tx/0xc4864297530c07547a3b5448bee9f987cceb8a2bd6daee27312699e6b1df74d2)). Main does not appear.
