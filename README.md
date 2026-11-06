# Pangolin

The only mammal in armour. A privacy wallet for Ethereum, built as a Chrome extension.

- Every read goes through [Anon-RPC](https://github.com/ethereum/anon-rpc) by default, so no RPC provider learns which addresses belong to you.
- Shielded balance via [RAILGUN](https://railgun.org): one Send that becomes a public send, "Make private", "Make public" or "Send privately" depending on who you pay.
- Free ENSv2 names under an app-owned parent on Sepolia, with the app's control renounced after issue, carrying a RAILGUN `org.railgun` record so the name can be paid privately.
- Private swaps on Uniswap through RAILGUN cross-contract calls.

Built at ETHGlobal Mumbai, November 2026. Working name; may be renamed.

## Layout

| path | what |
|---|---|
| `apps/extension` | the Chrome extension (MV3, Vite, React, Tailwind) |
| `apps/sponsor` | ENS name sponsor (Bun server) |
| `packages/` | shared libraries as they split out of the extension |
| `docs/` | architecture, privacy, decisions, testing, status ([index](docs/README.md)) |

Package manager: [bun](https://bun.sh) workspaces.

```bash
bun install
bun run build
```
