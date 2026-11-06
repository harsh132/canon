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
| Per-dapp WalletConnect addresses: two dapps get two fresh addresses, personal_sign recovers to the right one, a reconnect keeps its address | `e2e-wc.mjs`, Pangolin project id |

## Built, not yet verified

- **Typed-data signing over WalletConnect.** Added to `e2e-wc.mjs`; a re-run stalled once at the personal_sign step after passing it the run before, so treat the script as flaky until it passes twice.
- **eth_sendTransaction from a dapp.** Needs a funded address.
- **Make private on real Sepolia.** Needs a funded address.

## Next

1. RAILGUN broadcaster, so private sends stop paying gas from Main.
2. Private swap on Uniswap through RAILGUN cross-contract calls.
3. ENS v2 subnames: register `pangolin.eth` on Sepolia, switch the record key to `org.railgun`.
4. Submission write-up for the Anon-RPC track, and FEEDBACK.md for Uniswap.
