# Networks

Two separate choices: where the **private balance** lives, and which network each **site** uses.

## Private network (RAILGUN)

| Network | Private balance | Transactions from the wallet |
|---|---|---|
| Sepolia (test) | Yes | Yes: Make private, Send privately, Make public, Swap, Fund; gas sponsored |
| Arbitrum | Yes, view-only for now | Not yet: Send and Swap say "Sepolia only" |

- Chosen with the badge in the header. Switching restarts the core, which locks the wallet.
- One network per session: `core/config.ts` reads the choice from `localStorage` (`pangolin.privateNet`) when the core starts. It is not secret, so it is not in the encrypted vault.
- The 0zk address is the same on both.
- First sync on Arbitrum: RAILGUN's QuickSync loads about 92,000 commitments, then the last few thousand blocks are scanned through the RPC. The wallet scan finishes in a few minutes. The final step, validating transaction ids against the proof-of-innocence aggregator, needs a Nox TLS exit in Nox mode; on 2026-11-07 none was available, so the footer stayed at "Syncing 90%".
- Arbitrum reads use Offchain Labs' RPC (`arb1.arbitrum.io`), because publicnode refuses RAILGUN's `eth_getLogs` there without a paid token.

## Site networks (public)

Sepolia, Ethereum, Arbitrum, Base, Optimism, Polygon (`src/shared/networks.ts`). Main and every site address are plain EVM addresses (site paths use chain `0`), so one address works on all of them.

- **Each site has its own network.** New sites start on Sepolia.
- **A dapp's `wallet_switchEthereumChain` or `wallet_addEthereumChain` is accepted without a prompt** when the network is in the list; the site's tabs get `chainChanged`. The dapp's RPC URL is never used. Unknown networks: 4902 on switch, 4200 on add.
- The panel's site card shows the site's network as a chip; tapping it overrides the network by hand.
- Saved in the encrypted account book, because a list of sites and their networks is the kind of disclosure per-site addresses exist to prevent. While locked, the core's memory holds it.
- Reads from a dapp go to its network's RPC, through Nox. A pending request keeps the network it was made on, even if the site switches before it is approved.
- WalletConnect sessions advertise all six; each request runs on the chain it names.

## What stays on Sepolia

| Feature | Why |
|---|---|
| Gasless site-address calls (EIP-7702 + Calibur) and EIP-5792 batches | The sponsor pays gas for free, which only makes sense on a testnet |
| Fund | It unshields on the private network; only Sepolia builds transactions for now |
| Names (`pangolin.eth`) | ENSv2 is on Sepolia |

On other networks a site address sends ordinary transactions and pays its own gas.

## Next

1. Transactions on Arbitrum: Make private, then private sends, Make public and Fund through RAILGUN broadcasters (fee in WETH). Needs real ETH to test.
2. Private swaps on Arbitrum through its classic Relay Adapt and Uniswap v4.
