# Status

Updated 2026-11-06.

## Works

| Feature | Proven by |
|---|---|
| Create, back up, import, unlock, lock, reset | `e2e-create.mjs`, manual |
| RAILGUN sync on real Sepolia, every RPC read through Nox | `e2e-create.mjs`: 50 s, 18 mixed, 0 clear |
| Proof-of-innocence lookups through Nox | 3 PPOI requests per first sync, each 200 |
| Make private, Send privately, Make public | `e2e-fork.mjs` on an anvil fork |
| Make private on real Sepolia, through Nox | `e2e-sepolia.mjs shield`: spendable after about 12 min |
| Send privately on real Sepolia, Main paying gas | Landed; its new notes still await proof of innocence |
| Broadcaster discovery over Waku in the extension | `e2e-sepolia.mjs broadcasters`: connected, 1 Sepolia broadcaster |
| Public accounts, balances on demand | Manual |
| Privacy screen with read counts and a Nox/direct switch | `e2e-create.mjs` output |
| Injected provider (`window.ethereum`, EIP-6963) with per-site addresses | `e2e-injected.mjs` |
| Per-dapp WalletConnect addresses: two dapps get two fresh addresses, personal_sign recovers to the right one, a reconnect keeps its address | `e2e-wc.mjs`, Pangolin project id |

## Built, not yet verified

- **Typed-data signing over WalletConnect.** Added to `e2e-wc.mjs`; a re-run stalled once at the personal_sign step after passing it the run before, so treat the script as flaky until it passes twice.
- **eth_sendTransaction from a dapp.** Needs a funded address.
- **A private send through a broadcaster on real Sepolia.** Waiting on a fresh shield to clear.
- **Make public on real Sepolia.** Blocked on the same.

## Open questions

- **What purpose_id means.** We read it as one id per app and hash the dapp's origin into it. If RAILGUN meant one id per wallet app (Pangolin vs others), the layout changes. Confirm with the RAILGUN team, and whether they have a hashing rule other wallets follow.
- **Two 7702 layouts.** The engine (9.9.1) derives its own temporary keys at `m/44'/60'/0'/7702'/railgunIndex'/chainId'/index'`, unlike the `1984'` layout the team sent. Ask which is canonical.
- **Restore listing.** Dapp addresses rederive on revisit, but an imported wallet does not list sites it has not seen yet.

## Next

1. Finish the broadcaster test on real Sepolia (built; discovery works).
2. Private swap on Uniswap through RAILGUN cross-contract calls.
3. ENS v2 subnames: register `pangolin.eth` on Sepolia, switch the record key to `org.railgun`.
4. Submission write-up for the Anon-RPC track, and FEEDBACK.md for Uniswap.
