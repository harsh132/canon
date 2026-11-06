# Testing

End-to-end scripts in `apps/extension/scripts`. Each launches Chromium with `dist/` loaded, drives the popup with puppeteer, and prints the core's console. Pass `PANGOLIN_PROFILE=<new dir>` for a clean profile; reusing a profile reuses its wallet.

| Script | Proves | Needs |
|---|---|---|
| `smoke.mjs` | The extension loads, the core boots, the popup renders | A build |
| `e2e-create.mjs` | New wallet, backup screen, first RAILGUN sync | A build; network |
| `e2e-fork.mjs` | Make private 1 ETH, Send privately 0.2, Make public 0.3 to a fresh address | Anvil fork and a fork build |
| `e2e-wc.mjs` | Two dapps get two addresses; personal_sign recovers to the right one; a reconnect keeps its address | A WalletConnect project id that allows the extension origin |

## Fork setup

```bash
anvil --fork-url https://ethereum-sepolia-rpc.publicnode.com --fork-block-number <head-12> --chain-id 11155111 --port 8545
PANGOLIN_FORK=1 PANGOLIN_SEPOLIA_RPC=http://127.0.0.1:8545 bun scripts/build.mjs --dev
PANGOLIN_PROFILE=$PWD/.cache/<new> bun scripts/e2e-fork.mjs
```

- **Fork near head, and restart it often.** QuickSync serves real Sepolia commitments. Once the chain moves well past the fork block, the engine validates merkle roots the fork has never seen, and every write fails with "Failed to validate V2 merkleroot". An hour-old fork was enough to break it.
- **Pin the fork block.** Forking at head races publicnode's load balancer, which can answer from a node a block behind.
- Rebuild without the env vars before loading the extension for real use.

## Last results

| Date | Script | Network | Result |
|---|---|---|---|
| 2026-11-06 | `e2e-create.mjs` | Sepolia, Nox | Synced in 50 s; 18 RPC via Nox, 0 clear |
| 2026-11-06 | `e2e-create.mjs` | Sepolia, direct | Synced in 36 s |
| 2026-11-06 | `e2e-fork.mjs` | Anvil fork | Make private 1 s; private send proof 12 s; make public 31 s; recipient got 0.29925 ETH |
| 2026-11-06 | `e2e-wc.mjs` | — | Not run to completion: the borrowed project id refuses the extension origin |

## Bugs these caught

- The recovery-phrase screen unmounted as soon as the vault reported unlocked.
- A second private send reused notes the first had spent.
- An incomplete engine scan was shown as Synced.
- WalletKit init never resolves when the relay refuses the origin.
- QuickSync captured `fetch` before the transport patch and went uncounted.
