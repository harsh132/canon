# Canon summary

Canon is a Chrome extension wallet for private Ethereum use. It is alpha software: it runs on Sepolia, and it must not hold real funds.

This folder has four parts:

| File | Read it for |
|---|---|
| summary.md | What Canon is, how it works, who learns what, and its state today |
| [decisions.md](decisions.md) | Each decision with its date and reason, and why some code looks unusual |
| [operations.md](operations.md) | How to build, test, deploy and operate Canon; addresses and settings |
| [research/](research/README.md) | Findings from proofs of concept and investigations |

Update these files in the same commit as a change that makes them wrong.

## What Canon does

- **Holds a RAILGUN private balance.** Funds that the user makes private live in RAILGUN's shielded pool. The device makes every proof.
- **Reads the chain through Nox.** Every RPC read goes through Nox, an Anon-RPC mixnet worker. The RPC provider cannot tie a read to the user's IP.
- **Gives each dapp its own public address.** Two dapps cannot link the user by comparing addresses.
- **Pays gas for the user on Sepolia.** Canon's sponsor sends private transactions and site-address calls, so no address of the user's appears as the sender.

The product model comes from the author's Ender wallet (React Native):

- One Send. The source and the recipient decide what it does.
- Plain words ("Make private", not "shield").
- No background polling.
- A failed read never shows as zero.

Canon started at ETHGlobal Mumbai on 2026-11-06. The hackathon is over, and its prize rules no longer apply. Each part stays only on its merit.

## Repo

`harsh132/canon` is a bun-workspaces monorepo.

| Path | Contents |
|---|---|
| `apps/extension` | The MV3 extension |
| `apps/sponsor` | The gas sponsor and name issuer: a Cloudflare Worker, or a local Bun server |
| `docs/` | This folder |
| `graphify-out/` | The knowledge graph (not committed; see [operations.md](operations.md#knowledge-graph)) |

## How it works

### Parts

| Part | Runs in | Source | Holds |
|---|---|---|---|
| Core | Offscreen document | `apps/extension/src/core` | The vault, the RAILGUN engine, the Nox worker, the WalletConnect client, the account book |
| Service worker | MV3 background | `src/background/sw.ts` | Nothing. It creates the offscreen document, sets the badge and opens prompts |
| UI | Side panel (toolbar icon), toolbar popup (dapp requests), onboarding tab (first install) | `src/popup` | Nothing secret. It shows pushed state and sends commands |
| Inpage provider | Each http(s) page | `src/inpage/provider.ts` | Nothing. EIP-1193 and EIP-6963 |
| Bridge | Each page, isolated world | `src/inpage/bridge.ts` | Nothing. It relays calls to the core on a port that Chrome stamps with the tab's origin |
| Nox sandbox | Null-origin iframe in the core | `dist/anon-rpc/<ver>/sandbox.html` | The packaged, hash-checked Nox worker bundle |
| Sponsor | Cloudflare Worker and one Durable Object | `apps/sponsor/src` | The gas key |

The core is in the offscreen document because the service worker stops when idle and has no DOM. The offscreen document stays open, so the engine, its IndexedDB store and the WalletConnect socket stay alive when the UI closes.

The UI talks to the core on a port (`canon-popup`). The core accepts only the commands in `Commands` (`src/shared/protocol.ts`), and after each change it pushes the whole `CoreState`. The UI never gets a key or a signer. It gets the phrase only at backup, and from the menu's Recovery phrase after the password or passkey is checked again.

### Keys

One BIP-39 phrase per wallet.

| Account | Path |
|---|---|
| Main | `m/44'/60'/0'/0/0` (the standard path, so any wallet restores Main) |
| Accounts the user adds | `m/44'/60'/0'/0/n` |
| Site addresses (one per dapp) | `m/44'/60'/1984'/7702'/0'/<purpose(dapp)>'/i'` |
| Name owner | The same path with `canon.eth` as the dapp. It never holds funds |
| RAILGUN spending and viewing | `m/44'/1984'/0'/0'/i'`, `m/420'/1984'/0'/0'/i'` |

- **purpose(dapp)** is keccak256 of the dapp key (the normalised origin from `dapp-origin.ts`): the first 4 bytes, big-endian, top bit cleared (`dappPurposeId`, `core/vault.ts`). Chain `0` means one address on every network. A restored phrase gives the same site address when the user visits the site again.
- **Password wallets:** PBKDF2-SHA256 with 600,000 iterations gives 96 bytes: the vault key (AES-GCM), the RAILGUN encryption key and the account-book key.
- **Passkey wallets:** the passkey is the wallet. The extension is the relying party. The WebAuthn PRF output (salt `canon wallet v1`) goes through HKDF-SHA256: `canon/wallet/v1` gives the entropy of a 12-word phrase, and `canon/vault/v1` gives the same 96 bytes. A synced passkey restores the wallet on another device. Deleting the passkey loses the wallet, unless the user wrote down the phrase.

### Storage

All storage is in the extension origin's IndexedDB. The offscreen document has no `chrome.storage`.

| Store | Contents | At rest |
|---|---|---|
| `canon/kv` → `vault` | Kind, salt or passkey credential id, encrypted phrase, RAILGUN wallet id | Encrypted |
| `canon/kv` → `book` | Public accounts, dapp bindings, activity (last 50), site networks, custom tokens, pending POI jobs | Encrypted |
| `canon/kv` → `rpcMode`, `autoLockMin` | Nox or direct; 5, 15 or 60 minutes | Plain, because the core needs them before unlock |
| `canon-railgun` | RAILGUN merkle trees and wallet data | Wallet data encrypted |
| `railgun-artifacts` | Circuit proving keys and vkeys | Public data |

The book is encrypted because a list of the sites that someone uses is the disclosure that site addresses exist to prevent. The wallet locks after 5, 15 (default) or 60 minutes without a command, or on the Lock button.

### One Send

| From | To | Operation | Button |
|---|---|---|---|
| Public account | 0x | Plain send | Send publicly |
| Public account | 0zk | Shield (ETH in, private WETH) | Make private |
| Private | 0zk | Transfer proof | Send privately |
| Private | 0x | Unshield (WETH out as ETH) | Make public |

- An ERC-20 moves on the same four paths. Make private approves exactly the amount, and only when the allowance is too small.
- Send accepts a name. Canon resolves it only at Review. An `org.railgun` record sends to that 0zk; otherwise the ETH address record is used.
- Private sends go through Canon's sponsor by default. The user can choose a RAILGUN broadcaster or Main instead. Main pays gas publicly and links itself to the send.
- Private WETH shows as ETH. The shield fee is 0.25%.

### Networks and tokens

- **Private network:** Sepolia (all transactions) or Arbitrum (view-only for now). Only one per core session. Switching restarts the core and locks the wallet.
- **Site networks:** Sepolia, Ethereum, Arbitrum, Base, Optimism, Polygon. Each site has its own network. A dapp's chain switch to a listed network is accepted without a prompt, and Canon uses its own RPCs, not the dapp's.
- **Tokens:** WETH and USDC are listed on each network. The user can add an ERC-20 by address. A symbol must be 1 to 11 printable ASCII characters, and a copy of a listed symbol shows as, for example, "WETH?" with a warning.

### Dapps

- **Connections:** the injected provider (`window.ethereum` only if no other wallet set it; EIP-6963 always) and WalletConnect. Both key the binding by origin, so a site gets one address however it connects.
- **Rules:** the full host is the dapp's identity. First contact gets a fresh site address, written to the book before the session exists. Reconnects get the same address. Nothing is approved without a prompt. Dapp requests for an EIP-7702 delegation are refused.
- **Per-tab side panel:** each tab's panel shows that tab's dapp, its address and its balances. Fund moves private balance to the site address in one unshield (WETH arrives as ETH).
- **Gasless site addresses:** a site address delegates to Uniswap's Calibur through EIP-7702. The wallet signs a Calibur batch with the site key, and the sponsor sends it. The sponsor is the only allowed executor. Only site addresses are delegated, and only to Calibur.
- **EIP-5792:** `wallet_sendCalls` runs a batch atomically as one Calibur call. The batch id is the transaction hash.
- **Transaction preview:** prompts show balance changes from `eth_simulateV1`, decoded calls, and warnings for reverts and unlimited approvals.

### Names

Each wallet can claim `<label>.canon.eth` free on the ENSv2 Sepolia deployment. The sponsor pays three transactions: a resolver for the user, the `org.railgun` record with all roles given to the owner, and the registration with no expiry. After that, the sponsor cannot change the name. It can still refuse new labels, and the parent `canon.eth` expires on 2027-11-07 unless someone renews it.

### Private swap

A swap is one RAILGUN cross-contract call. It unshields WETH into Relay Adapt, unwraps it, swaps on the Uniswap v4 ETH/USDC 0.3% pool, wraps any ETH that is left, and shields USDC and WETH back to the wallet. A failed swap returns the input.

### Proof of innocence

A note becomes spendable only when the POI list has it.

| Note | How it clears |
|---|---|
| Shield from a public address | The list provider checks it. On Sepolia this took 4.5 to 12 minutes |
| Output of a sponsored send, Fund or swap | The wallet submits one single commitment proof per output it owns (`core/poi-assurance.ts`). Each job is saved in the book first and resumes after the next unlock. About 4 to 7 minutes |
| Output of any other spend, and a Relay Adapt shield (swap output) | The SDK makes a full transact proof after each scan. This needs the transaction in the local TXID tree. A Relay Adapt shield waits until the swap's unshield has a valid POI |

Home shows "Spendable in about N min" (the newest shield's 12-minute hold), "Clearing proof of innocence", or "Proof sync paused" when the TXID tree has stopped.

### Transport

- Every JSON-RPC call (Canon's and the RAILGUN engine's) goes through one ethers hook to Nox. POI lookups go through Nox too. Bulk public data (QuickSync pages, proving keys) goes direct and is counted.
- **Fail closed.** If Nox cannot start, reads fail. Only the user can switch to direct RPC (Privacy screen).
- The Nox worker bundle ships in the package. The core checks it against the contract's `workerHash()`. A new Nox bundle needs a Canon release.
- The RAILGUN circuit code (93 snarkjs `.wasm` files, 83 MB) ships in the package and is checked against the SDK's hashes at build time. Canon refuses to download circuit code. The proving keys (894 MB for all circuits) download when a proof first needs them, and the SDK checks their hashes.

## Privacy

| Party | Learns |
|---|---|
| RPC provider | That someone read, not who |
| Chain, Make private | The public address that funded it |
| Chain, Send privately | A proof only: no amount, no parties |
| Chain, Make public or Fund | The recipient and the amount; not which private balance |
| Chain, sponsored gas | Only that Canon's sponsor sent it |
| Canon's sponsor | Calldata that goes on chain anyway; the IP only when not reached through Nox |
| Waku peers | The IP of a browser that uses a RAILGUN broadcaster |
| RAILGUN QuickSync (squid) | The IP of someone who syncs, and from which block |
| POI aggregator | Blinded commitments of the wallet's notes, through Nox; not the IP |
| IPFS (proving keys) | The IP of someone about to prove, and the circuit size |
| WalletConnect relay | The IP of the wallet and of the dapps it pairs with |
| Passkey provider | It holds the passkey, so it can open a passkey wallet |
| Each dapp | Only the address it was given |

Rules that the code keeps:

- No background polling. Balances refresh on unlock, on Sync and after a send.
- Fail closed when Nox is down.
- A failed read never shows as zero.
- The viewing key never leaves the device.
- WalletConnect analytics (`pulse.walletconnect.org`) are blocked.

Open leaks, in order of cost:

1. Waku sees the browser's IP when the user picks a broadcaster.
2. QuickSync and proving-key downloads show the IP and the time.
3. The WalletConnect relay sees IPs.

## State (2026-11-10)

### Works

- Create, back up, restore, passkey wallets, lock, auto-lock, reset.
- RAILGUN sync on Sepolia with every read through Nox (0 reads in the clear).
- On Sepolia: Make private, Send privately and Make public, through the sponsor or Main; a private swap WETH to USDC; Fund; names under `canon.eth`; gasless site-address calls and EIP-5792 batches; POI submissions that resume after unlock.
- The packaged Nox bundle and circuit code; the "no exits" warning; the head-lag retry.
- Site addresses over the injected provider and WalletConnect; per-tab panel; per-site networks; custom tokens; the transaction preview; the Activity screen.

[operations.md](operations.md#tests) lists the script that proves each one.

### Built, not yet verified live

- The countdown after its fix (#13).
- Custom-token sends through the sponsor or a broadcaster on Sepolia.
- Passkeys on real authenticators (only a virtual one is tested).
- Typed-data signing over WalletConnect (the script stalled once).
- Transactions on Arbitrum (view-only today).

### Known issues

- **Sepolia's TXID index is broken.** The RAILGUN squid lost part of transaction `0x4b78372a…` (block 11816741). Every wallet's TXID tree stops at index 4177, so the SDK makes no full transact proofs on Sepolia. Swap output and the change of older self-paid sends stay pending. Reported to a RAILGUN developer on 2026-11-09. Details: [research/railgun-poi.md](research/railgun-poi.md).
- **Sepolia broadcasters reject sends** with "Could not validate Proof of Innocence". Unresolved.

### Open questions

- **purpose_id.** Canon uses one id per dapp, hashed from its origin. Ask the RAILGUN team whether they meant one id per wallet app.
- **Two 7702 layouts.** Engine 9.9.1 derives its temporary keys at `m/44'/60'/0'/7702'/railgunIndex'/chainId'/index'`, not at the `1984'` layout that the team sent. Ask which is canonical.
- **Restore listing.** A restored wallet lists a site only after the user visits it again.

### Next

1. After RAILGUN fixes the squid: check that the stuck USDC and WETH clear, then run the USDC send tests.
2. Transactions on Arbitrum through RAILGUN broadcasters (fee in WETH), then private swaps there. This needs real ETH.
3. Mainnet: a sponsor that charges a private-token fee, Calibur and the ENS parent on mainnet.
