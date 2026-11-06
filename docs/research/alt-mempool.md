# POC findings: Railgun on the EIP-8141 alt-mempool (2026-11-04)

Target track: EF **"Best use of the Frame Transaction Alternative Mempool"** ($5k). The track text asks for
"applications that need frame transactions with verification budget higher than 100k (e.g. PQ-secure smart
wallets, or PQ-secure privacy protocols)". A Railgun transaction is exactly that. One EF prize per project,
so this competes with the Anon-RPC entry; EF judges place the project where it fits best.

## The pitch in one line

**Railgun without broadcasters.** The shielded pool becomes its own EIP-8141 account: the Groth16 proof *is*
the authorization, the fee is an unshield output to the adapter, the user needs no key, no ETH and no Waku
relayer. Only an alt-mempool can carry it, because the proof check alone costs ~300k gas of validation.

## What was proven

| # | Check | File | Result |
|---|---|---|---|
| 1 | Real Railgun transact() gas on Sepolia | `02-railgun-tx-gas.mjs` | 1.3M–2.4M gas per tx (proof + merkle insert). |
| 2 | Railgun is live on the devnet (chain 1337), fees 25 bp, tree empty | `04-railgun-devnet-verify.mjs` | Yes. Predeployed by the EF team by replaying mainnet deployment txs, all 91 verifying keys. |
| 3 | A **real Sepolia Groth16 proof verifies on the devnet's Railgun**; a tampered input fails | `04-…` | `verifyProof` = true / false. Keys are byte-identical across deployments. |
| 4 | Gas of the adapter's VERIFY-frame work | `04-…` | `verifyProof` ≈ 302k, `getVerificationKey` ≈ 106k (2 nullifiers, 3 commitments). **> 100k public budget, < 1M staked alt-mempool budget.** |
| 5 | Build/sign/encode a type-0x06 frame tx with our own code on `@forshtat/hegota-support` and dry-run it on ethrex | `03-frame-tx.mjs` | Codec OK; `ethrex_simulateFrameTransaction` recognizes `SelfVerify`, maxCost 0.0006 ETH. Default code reverted only because the sender holds 0 ETH (spec: APPROVE with payment scope reverts on insufficient balance). |
| 6 | Adapter contract sketch compiles against the HegotaSupport opcode helpers | `contracts/RailgunFrameAdapter.sol`, `05-compile-adapter.mjs` | solc 0.8.28, 9.1 KB runtime. Not deployed. |

**Blocked:** sending for real. The sidecar's faucet is disabled and the gateway that had one returns 502.
Fund `0x3520775d7e862a341D808c722b555A4E5ef045E5` on chain 1337 (0.05 ETH is plenty; devnet docs say to
send from the published genesis account in the sidecar repo's `deploy/devnet/genesis.values.env`, or use
the explorer's Faucet button if it comes back). Then `node 03-frame-tx.mjs`. Don't send from the
*deployer* key: bumping its nonce shifts every predeploy address after a devnet restart.

## Devnet facts

| | |
|---|---|
| Execution RPC (ethrex `eip8141-tracer`) | `https://altmempool.forshtat.com` (chain 1337, 6 s blocks) |
| Sidecar (alt-mempool) RPC | `https://altmempool.forshtat.com/rpc` — `eth_sendFrameTransaction`, `skandha_frameTransactionStatus`, `eth_getFrameTransactionReceipt` |
| Gateway (workshop default) | `https://altmempoolgateway.forshtat.com/rpc` — **502 today** |
| Explorer | https://explorer.altmempool.wtf/ |
| Railgun (RailgunSmartWallet proxy) | `0x06a7dfbc3b95dcdfeca1c2cf8dbb0c8fdb194213` |
| WETH9 / USDC | `0x1b7d32025F7cA633943BbCC9Ec61a98ef66187b6` / `0xEFe0D421fD473564c9C9b0cDCeB194cF476D6AF5` |
| NaiveStakingRegistry | `0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f`, minStake 0.01 ETH (stake strictly more), minUnstakeDelay 0 |
| Predeploys | NONCE_MANAGER `0x…8250`, RECENT_ROOT `0x…8272`, entry point sentinel `0x…aa` |
| Codec | `@forshtat/hegota-support@0.0.1` (`/tx`, `/rpc`, `/profiles/ethrex-eip8141-tracer`), Solidity helpers `contracts/HegotaSupport.sol`, pins solc **0.8.28** |
| Rules revision | sidecar follows forshtat/ERCs PR #6 (`74a868c`), not ERC-8421 exactly; the EF team (Pierre, Alex) is on site |

The workshop repo `forshtat/mempool-workshop` (yarn steps 1–13) is the reference; its `AGENTS.md` and
`docs/findings.md` are worth reading. Its install was blocked here by the sandbox's external-code rule, so
all POC code is our own on top of the published package.

## Design: `RailgunFrameAdapter`

```
tx.sender   = adapter (staked)        signatures = [ARBITRARY]       nonceKeys = [nullifiers[0]]
frame 0     VERIFY  target=adapter  data=∅            -> fallback(): validate frame 1, approve(EXEC+PAY)
frame 1     SENDER  target=adapter  data=execute(txs) -> railgun.transact(txs) as msg.sender=adapter
```

VERIFY frame, per Railgun `Transaction` in the batch (all `view`, no banned opcodes):

1. `FRAME_COUNT == 2`, frame 1 is `SENDER` → adapter, value 0, data starts with `execute.selector`.
   *Approval covers every later SENDER frame*, so extra frames must be rejected or an attacker runs code
   as the adapter.
2. `boundParams.chainID == chainid`, `adaptContract == adapter` (binds the proof to this adapter).
3. `railgun.rootHistory[tree][root]`, every `railgun.nullifiers[tree][n] == false` (STORAGE-032: a staked
   entity may read any contract's storage). Double-spend races between two pending txs are caught by the
   sidecar's revalidation; the adapter's reputation absorbs a bounded number of those.
4. Unshield preimage: `validateCommitmentPreimage` and `hashCommitment == commitments[last]`.
5. `verifyProof(getVerificationKey(n,c), proof, [root, hashBoundParams(bp), ...nullifiers, ...commitments])`.
   This is `Verifier.verify` minus its `tx.origin` bypass; `validateTransaction` is unusable in validation
   because it reads `tx.gasprice` (GASPRICE is banned, so `minGasPrice` must be 0 anyway).
6. Fee: sum of unshield outputs whose `npk == bytes32(adapter)` and token == `feeToken`; must cover
   `TXPARAM(0x06) MAX_COST` (ethrex-specific param) converted at a fixed rate. The amount is public, as a
   broadcaster fee is today. Then `approve(EXECUTION_AND_PAYMENT)`.

Why it needs the alt-mempool, not EIP-8141's public one: step 5 alone is ~300k; steps 3–5 read Railgun's
storage from a non-sender contract (STORAGE-032 needs stake); the public mempool allows neither.

Staking: the registry keys stake on `msg.sender`, so `adapter.stake(registry, delay){value}` forwards
`addStake` from the adapter itself. Fund the adapter with ETH through its constructor value or `receive()`.

Keyed nonces: sender nonce key = first nullifier, seq 0. `SAME_NONCE_KEY_MEMPOOL_COUNT` = 4,
`SAME_SENDER_MEMPOOL_COUNT` = 64 applies to **unstaked** senders only.

## Open risks (ordered)

1. **`FRAMEDATACOPY`/`FRAMEPARAM`/`TXPARAM` helpers are "from the EIP text", not yet exercised on this
   devnet** (only APPROVE and SIGPARAM are). First thing to test after funding: a probe VERIFY frame via
   `ethrex_simulateFrameTransaction` with `trace: true`.
2. Does the ERC-7562-style tracer accept the Poseidon library calls (`hashCommitment` → PoseidonT4) and
   the pairing precompile inside VERIFY? Precompiles 0x01–0x11 are allowed (CALLING-040); PoseidonT4 is an
   ordinary contract with code (CALLING-010 OK).
3. Budget headroom: ~300k verify + ~106k key read + nullifier/root SLOADs + ABI decoding of a 2–5 KB
   calldata ≈ 500–600k per Railgun tx. One tx per frame tx is safe under 1M; batches of 2 are borderline.
   The landing page mentions 2.5M for staked entities; confirm the devnet's effective cap in the admission
   report.
4. `execute(txs)` is re-decoded from `framedatacopy` in VERIFY and from calldata in SENDER; they are the same
   bytes by construction (frame 1 data), so no TOCTOU, but the double ABI decode costs gas.
5. Gas price volatility between admission and inclusion: the fee is sized to `MAX_COST`, refunds go to the
   adapter, so the adapter profits slightly; fine for a hackathon.
6. The Railgun SDK must build a transaction with `adaptContract = adapter` and an extra unshield-to-adapter
   output in WETH. The SDK's cross-contract-call path (`generateCrossContractCallsProof7702`) already sets
   adaptContract for the 7702 relay adapt; we need the pre-7702 "relay adapt" style proof with our address.
   The sidecar team used `@railgun-community/engine` directly on this devnet (see `deployments/devnet.md`
   liveness section) with a custom chain config: copy that approach.

## Next steps (in order)

1. Fund the devnet key → `node 03-frame-tx.mjs` → first frame tx on chain.
2. Deploy `RailgunFrameAdapter` (constructor needs ~6M gas on this devnet; helpers are CREATEd), stake it.
3. Probe the three untested opcode helpers with a trivial VERIFY frame through `ethrex_simulateFrameTransaction`.
4. Shield WETH9 on devnet Railgun with the engine SDK (custom chain config for 1337), build a transact with
   `adaptContract = adapter` + fee unshield, generate the proof, wrap it in the two-frame tx, submit to the
   sidecar, watch it mine. That is the demo.
5. Demo UI: show the explorer admission report (staked budget applied), the on-chain Railgun `Transact`
   event, and that no EOA, key or broadcaster was involved.

## Devnet session 2 (2026-11-04): funded, probed, adapter live

Funding: per https://docs.altmempool.wtf/guides/devnet/ , plain transfers from the published genesis account
(`deploy/devnet/genesis.values.env` in the sidecar repo; it is also the sidecar relayer `0x5544…16f9`). Our key
`0x3520775d7e862a341D808c722b555A4E5ef045E5`. State of what we deployed: `.data/devnet-state.json`.

| # | Check | Script | Result |
|---|---|---|---|
| 7 | First frame tx (EOA self-relay) through the sidecar | `03-frame-tx.mjs` | OnChain, 2 frames ok, 26k gas total. |
| 8 | **ProbeWallet** as `tx.sender`, ARBITRARY signature (nobody signs), contract nonce 8 (1 + 7 CREATEd helpers). VERIFY frame checks `TXPARAM` FRAME_COUNT / MAX_COST / CURRENT_FRAME_INDEX / SENDER, `FRAMEPARAM` MODE / RESOLVED_TARGET / VALUE / DATA_LENGTH, `FRAMEDATACOPY` content hash | `07-devnet-probe-opcodes.mjs` step A | **All correct on this devnet**; simulate success, sidecar OnChain. Deploy 4.7M gas (state-gas model). |
| 9 | Same tx with VERIFY limit 300k, unstaked | step C1 | Rejected: `… = 300100 exceeds MAX_VERIFY_GAS 100000`. |
| 10 | Wallet stakes itself: SENDER frame → `registry.addStake(86400)` with 0.012 ETH | step B | OnChain. |
| 11 | VERIFY limit 300k, **staked** | step C2 | **Still rejected with the same flat 100k message.** |
| 12 | `RailgunFrameAdapter` deployed (15.9M gas!) and staked via `adapter.stake()` | `08-devnet-deploy-adapter.mjs` | Live at the address in `.data/devnet-state.json`. |

### Finding for the EF mempool team: stake does not raise the verification budget on this devnet

`packages/executor/src/services/UserOpValidation/utils/validationPrefix.ts` in the sidecar hard-codes
`MAX_VERIFY_GAS = 100_000` and checks `sum(limits.execution) + sigCost <= MAX_VERIFY_GAS` over the whole prefix,
with no per-entity or staked variant. `deploy/devnet/devnet-readme.md` step 4 says a staked entity gets
`MAX_VERIFY_GAS_STAKED_ENTITY`; the docs' BUDGET-010 says 1M for staked. The code implements neither. Staking does
relax storage/BALANCE rules (the workshop's step 8), just not the budget. Consequence: a Groth16 check (~300k)
cannot be admitted by this sidecar at all, staked or not. That is exactly the "PQ-secure privacy protocol" use case
the track text names, so it is a legitimate bug report / rule proposal ("break the rules and improve them").
Demo workaround: `ethrex_submitPrivilegedFrameTransaction` (devnet-only, unauthenticated) bypasses mempool
admission; the protocol itself has no verification budget, so the frame tx mines and proves the on-chain mechanics.

Other gotchas learned:
- Contract creation on this devnet costs state gas: 3.7 KB probe 4.7M, 11 KB adapter 15.9M. Use gasLimit 20M (allowed).
- A contract entity must hold ETH *before* the sidecar admits its tx (solvency check); fund via creation value or a
  `receive()` (a `fallback()` that calls APPROVE reverts on plain transfers).
- `debug_bundler_getStakeStatus` returns "Internal error" on this devnet; `skandha_explorer_listReputation` is paginated.

## IT WORKS: Railgun private unshield as an EIP-8141 frame tx, adapter as sender/payer (2026-11-04)

`09-devnet-railgun-frametx.mjs` (plus `11-resim-frametx.mjs` / `13-submit-resim.mjs` for iterating without re-proving).
Mined on the devnet: tx `0x6e0de0464676e30daf120bd02eeaeb596ff34b5dd3b91d1a88c40c2349a7d99b`, block 389960.

| | |
|---|---|
| `tx.from` / payer | `RailgunFrameAdapter` 0xcbEF…36FC (staked). Signature entry: ARBITRARY. Nobody signed anything. |
| Keyed nonce | `nonceKeys = [first nullifier]`, seq 0 (EIP-8250), so concurrent users never collide. |
| Frame 0 VERIFY | adapter re-validates 2 Railgun txs: root history, nullifiers unspent, unshield preimage hash, 2× Groth16 via `verifyProof`, fee ≥ `TXPARAM MAX_COST`; then APPROVE(exec+pay). **1,254,457 gas.** |
| Frame 1 SENDER | `adapter.execute(txs)` → `railgun.transact(txs)` (msg.sender = adapter). 704,531 gas. |
| Railgun events | Nullified ×2, Action, Unshield ×2 (+ 4 WETH9 Transfers incl. 0.25% fees to treasury). Total 2,382,170 gas. |
| Money | user (fresh address, 0 ETH, never signed): 0 → 0.0298501875 WETH. Adapter fee: 0 → 0.005985 WETH. Adapter paid 0.00238 ETH gas. |
| Sidecar | rejected: `… 1800100 exceeds MAX_VERIFY_GAS 100000` (flat cap, see finding above). Mined via `ethrex_submitPrivilegedFrameTransaction`. |

How the batch is built with the stock wallet SDK (no engine hacking):
- `NETWORK_CONFIG[Hardhat]` repurposed at runtime for chain 1337 (devnet Railgun, WETH9, `relayAdaptContract = adapter`,
  7702/V3 off, `poi` deleted) + the fork-only POI bucket patch from 06. QuickSync throws for Hardhat and the engine
  falls back to an RPC scan (first run ≈ 3.5 min; keep `.data/devnet-railgun` between runs).
- The SDK allows **one unshield per token per batch**, so payout and fee are two proven batches whose calldata is
  decoded and concatenated into one `transact(Transaction[])`. To keep their notes disjoint, both are exact-match
  spends: shield note1 (user takes all of it) and a fee note shielded at exactly `FEE/0.9975` (engine note selection is
  exact-match first, then smallest-first accumulation: `engine/dist/solutions/complex-solutions.js`).
- `adaptContract` stays 0 (SDK default); the adapter accepts 0 or itself. The fee recipient is bound in the proof
  (unshield preimage is the last commitment), so the proof cannot be redirected, only front-run.

Bugs found on the way (all ours):
1. **VERIFY frame data must be non-empty.** With `data: 0x` Solidity dispatches to `receive()`, never `fallback()`, so
   APPROVE never runs and ethrex says "frame 1 is a SENDER frame but no frame approved execution" (no trace, no reason).
   Fix: 1 byte of data, or drop `receive()` from the adapter. Cost us an hour.
2. Adapter deploy needs ~15.9M gas (state-gas model); 8M ran out.
3. ethrex returns no `frames`/trace when the prefix fails, so debug by (a) re-simulating with overrides (ARBITRARY sig
   means the envelope is free to edit) and (b) replaying each check as `eth_call` (`12-check-txs.mjs`).

What a judge sees: an on-chain Railgun unshield whose Ethereum transaction has **no EOA**: `from` is the shielded-pool
adapter, the proof authorized it, the fee came out of the shielded balance. And the alt-mempool rejection message
that shows exactly which rule the ERC-8421 draft already fixes on paper (per-entity staked budget) but the devnet
sidecar does not yet implement.
