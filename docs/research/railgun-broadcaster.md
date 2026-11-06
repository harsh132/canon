# RAILGUN broadcasters: the public reference code (2026-11-06)

Source: [Railgun-Community/ppoi-safe-broadcaster-example](https://github.com/Railgun-Community/ppoi-safe-broadcaster-example), cloned at `~/Work/ppoi-safe-broadcaster-example` (last commit 2025-12-10). Node.js, runs two nwaku nodes and one broadcaster in Docker; the operator configures a mnemonic, networks and fee tokens.

## What a broadcaster does with a transaction

`src/server/transactions/process-transaction.ts`, in order:

1. Receives the encrypted request over Waku (`waku-broadcaster/methods/transact-method.ts`).
2. Estimates gas with one of its own wallets and requires type-1 gas.
3. Extracts the packaged fee note (the first output, decrypted with the broadcaster's viewing key) and checks it covers gas at its advertised rate (`fees/fee-validator.ts`).
4. Checks the proof's `minGasPrice` against the network (`fees/gas-price-validator.ts`).
5. **Validates proof of innocence** (`transactions/poi-validator.ts`): `POIValidator.isValidSpendableTransaction(walletID, …, preTransactionPOIsPerTxidLeafPerList)`. This is a proof of spendability: the spent notes are in each required list's inclusion set. Failure is "Could not validate Proof of Innocence", the reply our Sepolia sends got.
6. Signs and sends from its own address.
7. **Queues the POIs** (`transactions/poi-assurance.ts`). Every 2 minutes, once `getRailgunTransactionsForTxid` returns the transaction, it calls `POINodeRequest.submitSingleCommitmentProof` with the first output's commitment and note public key and the full pre-transaction POIs. It stops once the fee note is spendable.

Step 7 clears the broadcaster's own fee note quickly. A single commitment proof clears only the commitment it names: our first sponsored test cleared the 1-wei first output and left the payment and change Missing. Pangolin therefore submits one per output it owns.

Step 7's purpose: the PPOI node gets the transaction's proofs at once, instead of the sender waiting for RAILGUN's TXID tree to index the send and then generating proofs itself.

## What Pangolin takes from it

- **Sponsored sends use the same assurance** (`apps/extension/src/core/poi-assurance.ts`). The submission is keyed on the first output's note public key, which only its receiver can decrypt, so the sponsored send carries a 1-wei "fee" note to the user's own 0zk as its first output, and the wallet performs step 7 itself.
- **The sponsor's relay** mirrors steps 2 and 4: simulate at the real gas price, enforce `minGasPrice`.
- Running our own Waku broadcaster from this code is possible but heavy for a hackathon (Docker, nwaku, a funded wallet per chain). The sponsored relay over HTTPS through Nox gives the same sender privacy for Pangolin users.

## Result on Sepolia

With one submission per owned output, a sponsored private send's payment and change were spendable 7 minutes after sending: about 4 minutes for RAILGUN's index to list the transaction, then about 2 minutes after the submissions. Without them, notes from self-paid sends stayed pending for 40+ minutes and had not cleared when last checked.

## Why Sepolia broadcasters rejected us

Not resolved. Their step 5 failed on our transaction. Candidates: their required POI list differs from ours, or their PPOI view of our input notes lags. Ask the RAILGUN team.
