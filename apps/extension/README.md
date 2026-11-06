# Pangolin extension

Chrome MV3 wallet. RAILGUN private balance, every RPC read through Anon-RPC (Nox), and a fresh public address for every dapp you connect over WalletConnect. Full docs: [`docs/`](../../docs/README.md).

## Run

```bash
bun install            # from the repo root
cp apps/extension/.env.example apps/extension/.env   # set PANGOLIN_WC_PROJECT_ID
bun run --filter @pangolin/extension build
```

Load `apps/extension/dist` at `chrome://extensions` with Developer mode on. The extension id is pinned by the manifest `key`:

```
nigpkikilgbfgmgcmeiidiinikafjpjg
```

Add `chrome-extension://nigpkikilgbfgmgcmeiidiinikafjpjg` to the WalletConnect project's allowed origins, or the relay refuses the wallet.

## Layout

| Path | Runs in | Holds |
|---|---|---|
| `src/core` | offscreen document | vault, RAILGUN engine, Anon-RPC worker, WalletConnect, account book |
| `src/background` | service worker | keeps the core alive, opens prompts |
| `src/popup` | popup | UI only; sends whitelisted commands, never sees keys |
| `src/shared/protocol.ts` | both | the command whitelist and pushed state |

Keys: one BIP-39 phrase. Public addresses are `m/44'/60'/0'/0/i`; index 0 is Main, each new dapp gets the next index. The RAILGUN wallet derives from the same phrase. A password stretch (PBKDF2, 600k) yields the vault key, the RAILGUN encryption key and the account-book key; the book (addresses, dapp bindings, activity) is encrypted at rest.

Send has one form. Source and recipient decide the operation: public to 0x sends, public to 0zk makes private, private to 0zk sends privately, private to 0x makes public. Private sends currently pay gas from Main; a broadcaster is next.

## Test

```bash
bun scripts/e2e-create.mjs     # new wallet, first Sepolia sync
bun scripts/e2e-wc.mjs         # two dapps get two addresses; reconnect keeps it; personal_sign
```

Full private flow on a local fork, since Sepolia faucets need a human:

```bash
anvil --fork-url https://ethereum-sepolia-rpc.publicnode.com --fork-block-number <head-12> --chain-id 11155111
PANGOLIN_FORK=1 PANGOLIN_SEPOLIA_RPC=http://127.0.0.1:8545 bun scripts/build.mjs --dev
bun scripts/e2e-fork.mjs       # make private, send privately, make public
```

`PANGOLIN_FORK=1` turns off proof-of-innocence checks, because no PPOI node watches a fork. Never ship that build. Each script takes `PANGOLIN_PROFILE=<new dir>` for a clean Chromium profile.
