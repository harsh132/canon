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
| Make public on real Sepolia, Main paying gas | Landed; proof and submit 38 s |
| ENS: claim `<label>.pangolin.eth`, pay a name privately | `e2e-sepolia.mjs name` on Sepolia |
| Sponsored private send (sponsor pays gas, Main not involved) | `e2e-sepolia.mjs private` on Sepolia |
| Fast proof of innocence after a sponsored send: the wallet submits a proof per output it owns | `e2e-sepolia.mjs private`: spendable again 7 min after sending |
| Private swap WETH → USDC on Uniswap v4, sponsor paying gas | `e2e-sepolia.mjs swap`: 0.001 WETH → 24.95 USDC ([tx](https://sepolia.etherscan.io/tx/0x270b85b24a68c6e2986bc670d20f69e3a7f085edb9ef23da1a1d629436ee3fe3)) |
| Side panel from the toolbar icon | `check-panel.mjs`: fits 320–560 px wide, tab bar pinned |
| Broadcaster discovery over Waku in the extension | `e2e-sepolia.mjs broadcasters`: connected, 1 Sepolia broadcaster |
| Public accounts, balances on demand | Manual |
| Privacy screen with read counts and a Nox/direct switch | `e2e-create.mjs` output |
| Injected provider (`window.ethereum`, EIP-6963) with per-site addresses | `e2e-injected.mjs` |
| Gasless dapp transactions from a site address (EIP-7702 to Calibur, sponsor pays) | `e2e-sepolia.mjs dapp`, `execute-probe.ts` |
| EIP-5792: `wallet_getCapabilities`, `wallet_sendCalls`, `wallet_getCallsStatus` | `e2e-sepolia.mjs dapp` |
| Onboarding: new wallet with word check, restore grid, passkey (PRF) wallets | `e2e-onboard.mjs` with a virtual authenticator |
| Fund a site address from private WETH, arriving as ETH (sponsor relays RAILGUN's type-4 unshield) | `e2e-sepolia.mjs dapp` with `RPC_DIRECT=1` |
| Hosted sponsor on Cloudflare (Worker + Durable Object) | `execute-probe.ts` against the live URL: delegate, then a two-call batch |
| Per-tab side panel showing each tab's dapp and address | `check-site-panel.mjs` |
| Per-dapp WalletConnect addresses: two dapps get two fresh addresses, personal_sign recovers to the right one, a reconnect keeps its address | `e2e-wc.mjs`, Pangolin project id |

## Built, not yet verified

- **The 7702 unshield through Nox.** The SDK reads the ephemeral address's nonce over a route that needs a Nox TLS exit. On 2026-11-06 no exit offered TLS tunnels, so Fund with ETH and Make public failed with "No exit offers TLS tunnels" in Nox mode. They passed with direct reads.
- **Sponsored Make public from Home.** Same relay path as Fund with ETH, not run separately.
- **Passkeys on real authenticators.** Google Password Manager, iCloud Keychain and security keys need a manual try; headless tests use a virtual one.

- **Typed-data signing over WalletConnect.** Added to `e2e-wc.mjs`; a re-run stalled once at the personal_sign step after passing it the run before, so treat the script as flaky until it passes twice.
- **A private send through a broadcaster on real Sepolia.** Discovery finds up to 4 broadcasters, the proof builds and the request reaches one, but it answers "Could not validate Proof of Innocence". Twice, minutes apart, with an input note that had cleared. Sepolia broadcasters may not be validating; unresolved.

## Open questions

- **What purpose_id means.** We read it as one id per app and hash the dapp's origin into it. If RAILGUN meant one id per wallet app (Pangolin vs others), the layout changes. Confirm with the RAILGUN team, and whether they have a hashing rule other wallets follow.
- **Two 7702 layouts.** The engine (9.9.1) derives its own temporary keys at `m/44'/60'/0'/7702'/railgunIndex'/chainId'/index'`, unlike the `1984'` layout the team sent. Ask which is canonical.
- **Restore listing.** Dapp addresses rederive on revisit, but an imported wallet does not list sites it has not seen yet.

## Next

1. Prove the extension against the hosted sponsor with one sponsored action. The sponsor is live on Cloudflare ([sponsor.md](sponsor.md)); in Nox mode it needs a Nox TLS exit.
2. Submissions: make the repo public, fill the Uniswap feedback form, record the demo.
3. Ask the RAILGUN team why Sepolia broadcasters reject on proof of innocence.
4. WalletConnect signing stall (parked).
5. **Mainnet: phase 1 done ([networks.md](networks.md)); transactions on Arbitrum next.** Earlier note: Pangolin runs on Sepolia only. Mainnet-only dapps such as pro.aave.com connect, then ask to switch to chain 1; Pangolin refuses with 4902, then 4200 on `wallet_addEthereumChain`. Wagmi reports that as "user rejected", so the dapp shows "Request cancelled". Mainnet needs: RAILGUN's mainnet network config, a mainnet sponsor with a fee in private tokens, Calibur (deployed at the same address on mainnet), the ENS parent on mainnet, and a network switch in the UI.
