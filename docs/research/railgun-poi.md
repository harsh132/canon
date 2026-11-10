# RAILGUN proof of innocence and the Sepolia TXID index

Investigated 2026-11-09, when the USDC from two private swaps stayed pending on Sepolia.

## Who makes which proof

A note becomes spendable when the POI list has a valid entry for it. Three parties take part:

| Party | Does |
|---|---|
| POI list provider (RAILGUN's node; `ppoi.fdi.network` aggregates it) | Checks shields from public addresses and accepts them after a wait. It cannot make spend proofs, because those need the spender's private data |
| The wallet (RAILGUN SDK) | Makes a full transact proof for each of its own spends. The engine does this after every wallet scan: `refreshPOIsForTXIDVersion` calls `generatePOIsAllSentCommitmentsAndUnshieldEvents`, which the source marks "Auto-generate POIs" (`engine/dist/wallet/abstract-wallet.js`) |
| A RAILGUN broadcaster | Submits the wallet's pre-transaction proofs as a single commitment proof for its fee note (`ppoi-safe-broadcaster-example`, `poi-assurance.ts`) |

So in a working setup the user and the app do nothing: the SDK and the list provider do it. From 2026-11-06 to 2026-11-10, Canon also did the broadcaster's step itself (`core/poi-assurance.ts`), because its sponsor is not a broadcaster. It was removed after this investigation.

## Single commitment proof and full transact proof

| | Single commitment proof | Full transact proof |
|---|---|---|
| Call | `ppoi_submit_single_commitment_proofs` | `ppoi_submit_transact_proof` |
| Made from | The pre-transaction POIs that the wallet attached to the send | The local TXID tree (a merkle proof of the railgun txid) |
| Adds | One `Transact` event for one output | `Transact` events for all outputs, and an `Unshield` event (`railgunTxidIfHasUnshield`) |
| Needs the TXID tree | No | Yes |

A pre-transaction POI cannot go in as a transact proof: its `txidMerkleroot` is a dummy (`createDummyMerkleProof`), so the node refuses it.

## Relay Adapt shields

A private swap unshields into Relay Adapt and shields the output back. The list provider holds such a shield until the swap's unshield has a valid POI (`categorizeUnknownShield` and `handleRelayAdaptUnknownShield` in `packages/node/src/list-provider/list-provider.ts`, github.com/Railgun-Community/private-proof-of-innocence). Only a full transact proof adds the `Unshield` event. A single commitment proof never does.

The public code allows a held shield after 1 hour. The node that serves the Sepolia list does not: its status has fields that the public code lacks (`relayAdaptPendingUnshields`, `relayAdaptPendingValidation`, `queuedForPOI`), so it runs a fork that is not public. The `shieldQueueStatus` that `ppoi.fdi.network` reports is all zero on every network, so it tells nothing about the list provider's queue.

## The TXID tree

The engine sets each spend's `railgunTxid` from its local TXID tree. The tree syncs from the RAILGUN squid (`rail-squid.squids.live/squid-railgun-<network>-v2/graphql`). Each record's `verificationHash` must equal `keccak256(previous verificationHash, nullifiers[0])` (`calculateRailgunTransactionVerificationHash`). At the first record that fails, the engine stops with "Stopping queue of Railgun TXIDs - Invalid verification hash" and tries again on the next scan.

Without a `railgunTxid`, `generatePOIsAllSentCommitmentsAndUnshieldEvents` finds nothing to prove. It returns 0 and gives no error.

Engine 9.9.1 can also read TXIDs from the contract's `Action` events over RPC (`setUseActionEventTxidSourceV2`, off by default). The event exists on Ethereum, BSC, Polygon and Arbitrum, but not on Sepolia.

## What broke on Sepolia

- Every wallet's TXID tree stops at index 4177. A new wallet in a new profile stops there too.
- Walking the squid's records in id order and checking each `verificationHash` finds one break: index 4188, transaction [`0x4b78372a…`](https://sepolia.etherscan.io/tx/0x4b78372a9f06a8ab7ccb8a02373d279fc385515139c6ef157d2fe79ee147e932), block 11816741. On chain it has at least 3 nullifier events. The squid has one RailgunTransaction for it, with 1 nullifier. The 749 records after it chain correctly to each other.
- The POI node's validated index is 4936, the squid's tip.
- The same walk over Arbitrum's squid found no break in 71,995 records, and the node's validated index (71,994) matches.

Results on the Sepolia test wallet:

- Today's swap: unshield `06d447bd…` is `Missing`, the USDC shield (position 12006) is `Missing`, and the two WETH outputs are `Valid` (single commitment proofs).
- The 2026-11-06 swap: its unshield `02f95419…` and its USDC shield (position 11825) are still `Missing` after 3 days.
- `getChainTxidsStillPendingSpentPOIs` lists two older self-paid sends, which stay pending for the same reason.

Reported to a RAILGUN developer on 2026-11-09, with the GraphQL queries that show the break.

## What Canon did

- Engine errors now reach Canon in production builds. Before, the SDK connected no engine logger, because Canon passed `shouldDebug: false`.
- "Invalid verification hash" sets `txidStalled`, and Home shows "Proof sync paused". It clears when the local TXID index reaches the node's validated index.

## When the squid is fixed

The SDK should make the missing full transact proofs by itself on the next scan. If it does not, a dev build can do it by hand (the submit is a write to the public POI node):

1. Run `syncRailgunTransactionsV2(NETWORK)`. Check that `getTXOsSpentPOIStatusInfoForWallet` lists railgun txid `06d447bd…`.
2. Run `generatePOIsForWalletAndRailgunTxid(V2, NETWORK, walletId, '06d447bda2ce25690fe651cd9e89158d0f870718acbda26f200d4514941e3ca4')`.
3. Check with `ppoi_pois_per_list` that the `Unshield` becomes `Valid`, then the `Shield`.
4. Run `refreshReceivePOIsForWallet`.

## Ender

The Ender wallet has no POI code of its own. Its swaps are self-signed, and it depends on the SDK's background generation. It reads `getChainTxidsStillPendingSpentPOIs` only for a diagnostics screen. If its TXID tree stops in the same way, its swap output stays pending too.
