# Testing

End-to-end scripts in `apps/extension/scripts`. Each launches Chromium with `dist/` loaded, drives the popup with puppeteer, and prints the core's console. Pass `PANGOLIN_PROFILE=<new dir>` for a clean profile; reusing a profile reuses its wallet.

| Script | Proves | Needs |
|---|---|---|
| `smoke.mjs` | The extension loads, the core boots, the popup renders | A build |
| `e2e-create.mjs` | New wallet, backup screen, first RAILGUN sync | A build; network |
| `e2e-fork.mjs` | Make private 1 ETH, Send privately 0.2, Make public 0.3 to a fresh address | Anvil fork and a fork build |
| `e2e-injected.mjs` | EIP-6963, chain id, a read through Nox, connect, personal_sign, a second origin, reload keeps the address | A build; serves its own page on port 8791 |
| `e2e-sepolia.mjs` | Real Sepolia through Nox in a persistent profile: `setup`, `shield`, `status`, `spend`, `public`, `private`, `swap`, `name`, `broadcasters`, `dapp` | Sepolia ETH in the test wallet's Main |
| `e2e-sepolia.mjs dapp` | A local dapp on an empty site address: EIP-5792 capabilities, a sponsored `eth_sendTransaction` that delegates to Calibur, a `wallet_sendCalls` batch and its status, Fund from the panel, a batch carrying value | A `--dev` build; the sponsor running; spendable private WETH |
| `e2e-hardware.mjs` | Hardware wallet against the mock device over a WebSocket: onboarding with three device approvals and the confirm banner, Main and site addresses from the device, 0zk from the device's viewing key, personal_sign and typed data on the device, a device reject reaching the dapp as 4001, unlock with the device, no recovery phrase. `SPONSORED=1` adds a gasless 7702 call through the hosted sponsor | A `--dev` build; ports 8799 and 8800 |
| `e2e-networks.mjs` | Per-site networks, dapp chain switches, reads per chain, persistence, the panel's network chip, RAILGUN on Arbitrum and back | A `--dev` build; port 8798; up to 10 min for the Arbitrum sync |
| `e2e-onboard.mjs` | Onboarding tab on install; new wallet with the word check; restore from a pasted phrase with a bad word flagged; passkey create, lock, unlock and restore after erase, on a virtual authenticator with PRF | A build |
| `shot-onboard.mjs` | Screenshots of the onboarding screens into `.cache/onboard-shots/` | A build |
| `check-site-panel.mjs` | Two dapps in two tabs; each tab's panel shows its own site and address; a tab with no dapp shows none | A `--dev` build; port 8795 |
| `apps/sponsor/scripts/execute-probe.ts` | The sponsor's `/execute` from a fresh address: first call with a 7702 authorization, then a two-call batch | The sponsor running |
| `check-focus.mjs` | Every field on every screen shows one focus border and no outline (dark mode) | A build |
| `check-panel.mjs` | Side panel behaviour and layout at several widths: tabs at the top, status line pinned to the bottom | A build |
| `shot-frame.mjs` | Screenshots of Home, the menu, Send, Recovery phrase and a panel with a dapp, dark, into `.cache/frame-shots/` | A build; port 8797 |
| `check-icons.mjs` | Favicon on browser connect/sign prompts and lists; WalletConnect metadata icon fetched and shown inline | A build; port 8794; WalletConnect project id |
| `check-prompt.mjs` | With no UI open, a dapp connect opens the toolbar popup, not a window; the icon still opens the panel | A build; serves its own page on port 8793 |
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
| 2026-11-07 | `e2e-hardware.mjs` | Chromium, mock device | 11 of 11 with the public test seed. Later runs with a fresh seed stalled at the first signature: the popup stopped answering Puppeteer while RAILGUN synced; under investigation. `apps/hw-mock` self-test: all pass |
| 2026-11-07 | `e2e-networks.mjs` | Chromium; Sepolia, Arbitrum, Base, Optimism reads through Nox | 19 of 20 pass: per-site networks, prompt-free switches (10 ms), 4902/4200 for unknown chains, Arbitrum reads, persistence across reload and lock, the panel's chip and picker, the private network switch. RAILGUN on Arbitrum reached 90%: the wallet scan finished, transaction-id validation waits on a Nox TLS exit. First run failed earlier: publicnode refused `eth_getLogs` on Arbitrum |
| 2026-11-07 | `execute-probe.ts`, hosted sponsor | Sepolia, Cloudflare | Fresh address delegated and called ([tx](https://sepolia.etherscan.io/tx/0xab5735d62ec023f837049cb6bca15c052a22f400411cc443c2a35533a73a44b2)), then a two-call batch ([tx](https://sepolia.etherscan.io/tx/0x0c8a5ac71025b93bfab69533a938d9ae24e459664076a586546df06a43662a21)). A first run failed only because the public RPC answered from a node a block behind; the probe now waits for the delegation |
| 2026-11-06 | New frame: `e2e-onboard`, `check-focus`, `check-panel`, `check-site-panel`, `check-prompt`, `e2e-injected`, `shot-name-focus` | Chromium | All pass. `e2e-onboard` now also reveals a passkey wallet's phrase from the menu (14 checks). It caught the app reopening on the last screen after lock |
| 2026-11-06 | `e2e-onboard.mjs` | Chromium, virtual authenticator | All 13 checks pass. `check-focus`, `e2e-injected`, `check-prompt`, `check-site-panel` and `check-panel` pass on the new onboarding |
| 2026-11-06 | `RPC_DIRECT=1 FUND_ONLY=1 e2e-sepolia.mjs dapp` | Sepolia, direct reads, sponsor | Funded the site address with 0.0005 ETH from private WETH in 40 s; 0.00049875 arrived ([tx](https://sepolia.etherscan.io/tx/0x7b724b9287d6e875e5a870a82e41386e38c03644681f0e44761e2ede911a0c8e)). Then a gasless batch wrapped 0.0001 ETH from it ([tx](https://sepolia.etherscan.io/tx/0x978c42646b1aacf773ea48cc58c7124d7a4c5f07ddd308e062fd7e340d64752f)) |
| 2026-11-06 | `e2e-sepolia.mjs dapp`, Fund step, Nox | Sepolia | Failed twice: "No exit offers TLS tunnels" while the SDK built the 7702 unshield. Before the sponsor fix: "Only RAILGUN contracts". Before the test fix: it clicked the Fund screen's back button, also labelled Fund |
| 2026-11-06 | `e2e-sepolia.mjs dapp` | Sepolia, Nox, sponsor | Empty site address: capabilities returned atomic + auxiliaryFunds; `eth_sendTransaction` delegated it to Calibur in a type-4 transaction from the sponsor ([tx](https://sepolia.etherscan.io/tx/0x09607fddca656b2b339db82df7fd1d9edf2de4c7b20cfe52aa3447bbb0a212b5)), 12 s; a two-call `wallet_sendCalls` landed with both events, status 200 ([tx](https://sepolia.etherscan.io/tx/0x4a67b7d4abb0fd2bba2b5c21749bae2794f5f0307f3d235170ac0425cdaa9cc7)). Re-run on the delegated address: type 2, 8 s |
| 2026-11-06 | `execute-probe.ts` | Sepolia | Fresh address with 0 ETH: delegate and call, then a two-call batch; both status 1, sponsor as sender, allowances set |
| 2026-11-06 | `e2e-create.mjs` | Sepolia, Nox | Synced in 50 s; 18 RPC via Nox, 0 clear |
| 2026-11-06 | `e2e-create.mjs` | Sepolia, direct | Synced in 36 s |
| 2026-11-06 | `e2e-fork.mjs` | Anvil fork | Make private 1 s; private send proof 12 s; make public 31 s; recipient got 0.29925 ETH |
| 2026-11-06 | `e2e-sepolia.mjs spend` | Sepolia, Nox, Main pays gas | Send privately landed ([tx](https://sepolia.etherscan.io/tx/0xef03cb2196c67abdcf8fc5980c4d09c599ab606d9e130d2405caeced79640c98)), proof 20 s. New notes then waited on proof of innocence |
| 2026-11-06 | `e2e-sepolia.mjs broadcasters` | Sepolia, Waku | Connected; 1 broadcaster |
| 2026-11-06 | `e2e-sepolia.mjs public` | Sepolia, Nox, Main pays gas | Made 0.002 public to Main ([tx](https://sepolia.etherscan.io/tx/0xe41b989c800e8124bb32155a8c0fb102d65797a19ba6e73b57459fff6a7faad9)), 1,763,370 gas, 38 s. 89 reads via Nox, 0 clear |
| 2026-11-06 | `e2e-sepolia.mjs name` | Sepolia, Nox, sponsor | Claimed alice.pangolin.eth; paid it by name, resolved via org.railgun |
| 2026-11-06 | `e2e-sepolia.mjs swap` | Sepolia, Nox, sponsor relay, Uniswap v4 | 0.001 WETH → 24.95 USDC, no inner-call error ([tx](https://sepolia.etherscan.io/tx/0x270b85b24a68c6e2986bc670d20f69e3a7f085edb9ef23da1a1d629436ee3fe3)). WETH change spendable within minutes; USDC returns as a shield and waits RAILGUN's shield hold. 137 reads via Nox, 0 clear |
| 2026-11-06 | `check-panel.mjs` | Chromium | Panel opens on icon click (`openPanelOnActionClick`); layout fits 320, 420, 560 px wide and a 520 px tall panel |
| 2026-11-06 | `e2e-sepolia.mjs private`, per-output POI | Sepolia, Nox, sponsor relay | Indexed at +4 min, proofs submitted for all three outputs at +5 min, payment and change spendable at +7 min ([tx](https://sepolia.etherscan.io/tx/0xee18095652ffd2d62765804cec0c60420cd8bd3b489e531741d9880b7ec51991)) |
| 2026-11-06 | `e2e-sepolia.mjs private`, first output only | Sepolia, Nox, sponsor relay | Only the 1-wei first output cleared; payment and change stayed Missing |
| 2026-11-06 | `e2e-sepolia.mjs private` | Sepolia, Nox, sponsor relay | Sent privately to alice.pangolin.eth; sponsor was the sender. First attempt priced below the base fee and stuck; replaced |
| 2026-11-06 | `e2e-sepolia.mjs spend`, via broadcaster | Sepolia, Waku | Proof built and sent; broadcaster replied "Could not validate Proof of Innocence". Retried 4 min later, same |
| 2026-11-06 | `e2e-sepolia.mjs shield` | Sepolia, Nox | Made 0.01 ETH private ([tx](https://sepolia.etherscan.io/tx/0xeaca504c98a6bbb1eeaf0cb5cf4c33185df4d03e7f47de83fab6583d509417d1)), 935,150 gas. Shows 0.0099 WETH pending proof of innocence. 66 reads via Nox, 0 clear |
| 2026-11-06 | `e2e-injected.mjs` | Sepolia, Nox | All checks pass in 7 s |
| 2026-11-06 | `e2e-wc.mjs` | Sepolia, Pangolin project id | Distinct addresses, personal_sign, reconnect all pass. A later run with typed data stalled once; under watch |

## Bugs these caught

- The recovery-phrase screen unmounted as soon as the vault reported unlocked.
- A second private send reused notes the first had spent.
- An incomplete engine scan was shown as Synced.
- WalletKit init never resolves when the relay refuses the origin.
- QuickSync captured `fetch` before the transport patch and went uncounted.
- The popup flashed onboarding at an existing user while the core started.
- A near-zero Sepolia gas fee displayed as 0.000000 ETH.
- The relay simulated without a gas price and hit RAILGUN's minimum-gas-price check.
- The relay priced from a stale `eth_gasPrice`, below the base fee.
