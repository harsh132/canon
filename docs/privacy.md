# Privacy

## Who learns what

| Party | Learns | Why |
|---|---|---|
| RPC provider | That someone read, not who | Reads arrive through Nox ([anon-rpc.md](anon-rpc.md)) |
| Nox mixnet | Nothing linkable to the user | That is the mixnet's job; the worker runs in a null-origin sandbox |
| Chain, on Make private | The public address that funded it, once | A shield is a public transaction from that address |
| Chain, on Send privately | A proof, no amounts, no parties | RAILGUN |
| Chain, on Make public | Recipient and amount | An unshield pays a public address |
| Chain, on a private send's gas | Only that Canon's sponsor sent it | The sponsor relays by default. Choosing "Main" makes Main the sender, which links it |
| Canon's sponsor, on a relayed send | Calldata that goes on-chain anyway; the IP unless reached through Nox | Local development sponsor is called directly |
| Waku peers | The IP of a browser using RAILGUN broadcasters | Broadcaster discovery and requests travel over Waku, not Nox. Requests are encrypted to the broadcaster |
| RAILGUN QuickSync (Subsquid) | The IP of someone syncing, and from which block | Bulk public data fetched directly, about 13 MB pages. Names no address |
| PPOI aggregator | Blinded commitments of this wallet's notes, not the IP | Sent through Nox in Nox mode; verified |
| Circuit artifact host (IPFS) | The IP of someone about to prove, and which circuit size (inputs and outputs) | Proving keys only, fetched directly once per circuit. The circuit code is in the package |
| WalletConnect relay | The IP of the wallet and the dapps it pairs with | WebSocket, not RPC; not routable through Nox |
| Passkey provider (Google, Apple, a security key) | Holds the passkey, so it can open a passkey wallet | The PRF output never leaves the authenticator unencrypted; the provider's account security is the wallet's ([onboarding.md](onboarding.md#risks)) |
| Each dapp | Only the address it was given | A fresh address per dapp ([walletconnect.md](walletconnect.md)) |
| Chain, on Fund | That a RAILGUN user sent this amount to this site address | One unshield; not which balance or which other addresses |
| Chain, on a site address's dapp call | The site address made it; Canon's sponsor paid gas | EIP-7702 + Calibur ([site-accounts.md](site-accounts.md)). The address never holds gas money, so no funding link from Main |
| Canon's sponsor, on a site address's call | The site address and its calls, which go on chain anyway | Not the user's other addresses |
| A WalletConnect dapp's icon host | That someone fetched the icon, not who | Fetched by the core through Nox. Browser-dapp favicons come from Chrome's cache, with no request |
| WalletConnect analytics | Nothing | Requests to `pulse.walletconnect.org` are blocked in the core |

## What the Privacy screen counts

Since the core started:

| Row | Counts |
|---|---|
| via Nox | RPC requests and PPOI lookups sent through the worker |
| Clear RPC | RPC requests sent directly. Zero in Nox mode; anything else is a bug |
| Bootstrap | The worker's one specifier read (`workerHash()`). It names Nox, not the user. The bundle is packaged, not downloaded |
| Bulk sync | QuickSync pages and circuit proving keys |
| Other | Any other direct request, logged to the core console |

The "Nothing leaked" stamp shows only when the mode is Nox, the worker is ready and Clear RPC is zero.

## Rules the code keeps

- **No background polling.** Balances refresh on unlock, on the Sync button and after a send settles. Polling would itself mark the user as active.
- **Fail closed.** If Nox cannot boot, reads fail. They never fall back to direct on their own; only the user switches.
- **Never show a failed read as zero.** A public balance not yet read shows "Check".
- **The viewing key never leaves the device.** Whoever holds it sees every private transaction, and it cannot be rotated.

## Open leaks, in order of cost

1. Waku sees the browser's IP when using a broadcaster. Fix: route Waku through a mixnet if one carries it.
2. QuickSync and proving-key downloads reveal IP and timing. Fix: fetch through a mixnet if Nox ever carries bulk data, or self-host.
3. The WalletConnect relay sees IPs. Inherent to WalletConnect.
