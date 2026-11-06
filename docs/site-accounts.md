# Site accounts: panel, Fund, gasless calls

Each dapp gets its own public address ([walletconnect.md](walletconnect.md), [injected-provider.md](injected-provider.md)). This doc covers what the wallet does with that address: the per-tab panel, funding it from the private balance, and running its transactions without ETH.

## Per-tab panel

The toolbar icon opens the side panel for the current tab only (`panel.html?tab=<id>`). Other tabs keep their own panel, or none.

- The core maps each tab to the dapp connected in it, from the `pangolin-dapp` port Chrome stamps with the tab id.
- The panel's site card shows the dapp's icon, origin, its address and the address's ETH, WETH and USDC, read through Nox.
- A tab with no dapp shows "No dapp in this tab".
- Requests still open the toolbar popup unless the panel or popup is open ([architecture.md](architecture.md#where-prompts-appear)). In the panel, a waiting request shows as a bar at the top until reviewed.

## Fund

Fund on the site card moves private balance to the site's address in one unshield (`core/fund.ts`).

| Token | Arrives as | Path |
|---|---|---|
| WETH | ETH | The Make public path, sponsor paying gas |
| Any other | Itself | ERC-20 unshield, sponsor relaying, with the 1-wei self fee note so the wallet submits its proof-of-innocence proofs |

The chain sees that a RAILGUN user sent this amount of this token to this address. It does not see which private balance, or the user's other addresses.

## Gasless calls through EIP-7702 and Calibur

A site address never needs ETH for gas. It runs Uniswap's [Calibur](https://github.com/Uniswap/calibur) smart-account code through EIP-7702, and Pangolin's sponsor submits its transactions.

1. The dapp calls `eth_sendTransaction` or `wallet_sendCalls`. The user approves the prompt as usual.
2. The wallet signs a Calibur `SignedBatchedCall` with the site address's own key: root key (`keyHash` 0), nonce from `getSeq(0)`, a 30-minute deadline, and the sponsor as the only allowed `executor`.
3. The first time, the wallet also signs an EIP-7702 authorization delegating the address to Calibur.
4. The wallet posts both to the sponsor's `/execute` (`apps/sponsor/src/execute.ts`). The sponsor checks them, simulates, and sends `Calibur.execute` to the site address. The first one is a type-4 transaction carrying the authorization.
5. On chain, the calls come from the site address, so the dapp sees the sender it expects. The sponsor is only the transaction's `from`.

Code: `core/smart.ts` (sign and post), `core/sign.ts` (routing), `core/book.ts` (`isSiteAccount`).

### Security rules

- **Only site addresses are delegated, only to Calibur** (`0x000000009B1D0aF20D8C6d0A44e162d11F9b8f00`). Main and accounts on the standard path keep plain transactions.
- **Dapp-requested delegations are refused**, as before (4001).
- **No calls into the account itself**, `address(0)` or the EntryPoint. With the root key such calls could register new keys on the account. Both the wallet and the sponsor refuse them.
- **The signature names the sponsor as executor**, so nobody else can submit it, and it expires in 30 minutes.

### What the sponsor checks

| Check | Refuses with |
|---|---|
| Chain is Sepolia | 400 |
| `executor` is this sponsor | 400 |
| 1–10 calls, none into the account, zero or the EntryPoint | 400 |
| Deadline in the future and within an hour | 400 |
| Account already runs Calibur, or brings a 7702 authorization to Calibur signed by the account itself | 400 |
| Simulation succeeds | 400 "Would revert" |
| At most 3M gas | 400 |
| At most 60 per hour | 429 |

### What the sponsor sees

The site address, its calls and their calldata. All of it goes on chain anyway. It does not learn the user's other site addresses, Main or private balance. Today the extension reaches the local sponsor directly; a hosted sponsor would be reached through Nox.

## EIP-5792

On the injected provider, for a connected site address:

| Method | Answer |
|---|---|
| `wallet_getCapabilities` | `{"0xaa36a7": {atomic: {status: "supported"}, auxiliaryFunds: {supported: true}}}`. Empty for other addresses |
| `wallet_sendCalls` | One prompt for the batch. Runs atomically as one Calibur call. Returns `{id}`, which is the transaction hash. Other chains get 5710 |
| `wallet_getCallsStatus` | Status 100 pending, 200 confirmed, 500 reverted, with EIP-5792 receipts |
| `wallet_showCallsStatus` | `null` |

`auxiliaryFunds` (ERC-7682) tells the dapp not to block on the address's visible balance, since Fund can top it up from the private balance. Many dapp UIs still check the ETH balance before enabling a button.

## Verified

See [testing.md](testing.md#last-results).
