# Overview

Pangolin is a Chrome extension wallet for private Ethereum use. Working name, chosen 2026-11-06; may change.

It does three things:

- **Holds a RAILGUN private balance.** Funds made private live in RAILGUN's shielded pool. Private sends prove on the device.
- **Reads the chain through Anon-RPC.** Every RPC read goes through Nox, an Anon-RPC mixnet worker, so the RPC provider cannot tie reads to the user's IP.
- **Gives each dapp its own public address.** A dapp connected over WalletConnect sees a fresh address, so two dapps cannot link the user by comparing addresses.

The model follows the author's Ender wallet (React Native): one Send whose meaning comes from the source and the recipient, plain words instead of "shield", no background polling, and never showing a failed read as zero.

## Hackathon

ETHGlobal Mumbai, started 2026-11-06.

| Track | Fit | State |
|---|---|---|
| Ethereum Foundation: Anon-RPC | Lead. Every RPC read through Nox in an MV3 extension, counted on a Privacy screen | Working on Sepolia |
| Ethereum Foundation: CROPS | Alternative EF entry; one EF prize per project | Not targeted separately |
| Uniswap | Private swap through RAILGUN cross-contract calls | Not started |
| ENS v2 | Sponsored `<label>.pangolin.eth` subnames whose `org.railgun` record pays privately | On hold by decision; POC proven |

## Repo

`harsh132/pangolin`, a bun-workspaces monorepo.

| Path | What |
|---|---|
| `apps/extension` | The MV3 extension |
| `packages/` | Shared code, empty for now |
| `docs/` | This folder |

See [status.md](status.md) for what works today.
