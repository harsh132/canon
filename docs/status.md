# Status

Updated 2026-11-06.

## Works

| Feature | Proven by |
|---|---|
| Create, back up, import, unlock, lock, reset | `e2e-create.mjs`, manual |
| RAILGUN sync on real Sepolia, every RPC read through Nox | `e2e-create.mjs`: 50 s, 18 mixed, 0 clear |
| Proof-of-innocence lookups through Nox | 3 PPOI requests per first sync, each 200 |
| Make private, Send privately, Make public | `e2e-fork.mjs` on an anvil fork |
| Public accounts, balances on demand | Manual |
| Privacy screen with read counts and a Nox/direct switch | `e2e-create.mjs` output |

## Built, not yet verified

- **Per-dapp WalletConnect addresses.** Blocked on a WalletConnect project that allows the extension origin. `e2e-wc.mjs` is ready.
- **Make private on real Sepolia.** Needs a funded address.

## Next

1. WalletConnect project id, then run `e2e-wc.mjs`.
2. RAILGUN broadcaster, so private sends stop paying gas from Main.
3. Private swap on Uniswap through RAILGUN cross-contract calls.
4. ENS v2 subnames: register `pangolin.eth` on Sepolia, switch the record key to `org.railgun`.
5. Submission write-up for the Anon-RPC track, and FEEDBACK.md for Uniswap.
