# Overview

Canon is a Chrome extension wallet for private Ethereum use. Working name, chosen 2026-11-06; may change.

It does three things:

- **Holds a RAILGUN private balance.** Funds made private live in RAILGUN's shielded pool. Private sends prove on the device.
- **Reads the chain through Anon-RPC.** Every RPC read goes through Nox, an Anon-RPC mixnet worker, so the RPC provider cannot tie reads to the user's IP.
- **Gives each dapp its own public address.** A dapp connected over WalletConnect sees a fresh address, so two dapps cannot link the user by comparing addresses.

The model follows the author's Ender wallet (React Native): one Send whose meaning comes from the source and the recipient, plain words instead of "shield", no background polling, and never showing a failed read as zero.

## History

Started at ETHGlobal Mumbai on 2026-11-06. The hackathon is over. Its tracks and prize rules (Anon-RPC, Uniswap, ENS v2) no longer shape Canon: each part stays only on its merit, and any part can be replaced, Anon-RPC and Nox included.

## Repo

`harsh132/canon`, a bun-workspaces monorepo.

| Path | What |
|---|---|
| `apps/extension` | The MV3 extension |
| `apps/sponsor` | Issues ENS names; holds the sponsor key |
| `packages/` | Shared code, empty for now |
| `docs/` | This folder |

See [status.md](status.md) for what works today.
