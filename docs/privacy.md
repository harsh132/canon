# Privacy

## Who learns what

| Party | Learns | Why |
|---|---|---|
| RPC provider | That someone read, not who | Reads arrive through Nox ([anon-rpc.md](anon-rpc.md)) |
| Nox mixnet | Nothing linkable to the user | That is the mixnet's job; the worker runs in a null-origin sandbox |
| Chain, on Make private | The public address that funded it, once | A shield is a public transaction from that address |
| Chain, on Send privately | A proof, no amounts, no parties | RAILGUN |
| Chain, on Make public | Recipient and amount | An unshield pays a public address |
| Chain, on a private send's gas | Main paid gas for some RAILGUN transaction | Gas is paid from Main until a broadcaster is wired. **Open leak** |
| RAILGUN QuickSync (Subsquid) | The IP of someone syncing, and from which block | Bulk public data fetched directly, about 13 MB pages. Names no address |
| PPOI aggregator | Blinded commitments of this wallet's notes, not the IP | Sent through Nox in Nox mode; verified |
| Circuit artifact host (IPFS) | The IP of someone about to prove | Public data, fetched directly |
| WalletConnect relay | The IP of the wallet and the dapps it pairs with | WebSocket, not RPC; not routable through Nox |
| Each dapp | Only the address it was given | A fresh address per dapp ([walletconnect.md](walletconnect.md)) |
| WalletConnect analytics | Nothing | Requests to `pulse.walletconnect.org` are blocked in the core |

## What the Privacy screen counts

Since the core started:

| Row | Counts |
|---|---|
| via Nox | RPC requests and PPOI lookups sent through the worker |
| Clear RPC | RPC requests sent directly. Zero in Nox mode; anything else is a bug |
| Bootstrap | The worker's own specifier reads and bundle download. They name Nox, not the user |
| Bulk sync | QuickSync pages and circuit artifacts |
| Other | Any other direct request, logged to the core console |

The "Nothing leaked" stamp shows only when the mode is Nox, the worker is ready and Clear RPC is zero.

## Rules the code keeps

- **No background polling.** Balances refresh on unlock, on the Sync button and after a send settles. Polling would itself mark the user as active.
- **Fail closed.** If Nox cannot boot, reads fail. They never fall back to direct on their own; only the user switches.
- **Never show a failed read as zero.** A public balance not yet read shows "Check".
- **The viewing key never leaves the device.** Whoever holds it sees every private transaction, and it cannot be rotated.

## Open leaks, in order of cost

1. Gas for private sends comes from Main. Fix: a RAILGUN broadcaster pays gas from the private balance.
2. QuickSync and artifacts reveal IP and timing. Fix: fetch through a mixnet if Nox ever carries bulk data, or self-host.
3. The WalletConnect relay sees IPs. Inherent to WalletConnect.
