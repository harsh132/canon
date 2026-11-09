# Canon extension

Chrome MV3 wallet: a RAILGUN private balance, every RPC read through Anon-RPC (Nox), and a fresh public address for every dapp.

- What it is and how it works: [docs/summary.md](../../docs/summary.md)
- Build, load, test and deploy: [docs/operations.md](../../docs/operations.md)

## Quick start

```bash
bun install                      # from the repo root
cd apps/extension
bun run build
```

Load `apps/extension/dist` at `chrome://extensions` with Developer mode on. The toolbar icon opens Canon in the side panel.

## Layout

| Path | Runs in | Holds |
|---|---|---|
| `src/core` | Offscreen document | Vault, RAILGUN engine, Nox worker, WalletConnect, account book |
| `src/background` | Service worker | Keeps the core alive, opens prompts |
| `src/popup` | Side panel, toolbar popup, onboarding tab | UI only; sends whitelisted commands, never sees keys |
| `src/inpage` | Each web page | EIP-1193 provider and the bridge to the core |
| `src/shared/protocol.ts` | All | The command whitelist and the pushed state |
| `scripts/` | Bun, Chromium | The build and the test scripts |
