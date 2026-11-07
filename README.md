# Canon Wallet

A privacy wallet for Ethereum, built as a Chrome extension.

- Every read goes through [Anon-RPC](https://github.com/ethereum/anon-rpc) by default, so no RPC provider learns which addresses belong to you.
- Shielded balance via [RAILGUN](https://railgun.org): one Send that becomes a public send, "Make private", "Make public" or "Send privately" depending on who you pay.
- Free ENSv2 names under an app-owned parent on Sepolia, with the app's control renounced after issue, carrying a RAILGUN `org.railgun` record so the name can be paid privately.
- Private swaps on Uniswap through RAILGUN cross-contract calls.

Built at ETHGlobal Mumbai, November 2026.

> **Alpha.** Built and tested on Sepolia. Don't put real funds in it.

## Layout

| path | what |
|---|---|
| `apps/extension` | the Chrome extension (MV3, esbuild, React, Tailwind) |
| `apps/sponsor` | the sponsor: ENS names and gasless calls (Cloudflare Worker, or a local Bun server) |
| `apps/hw-mock` | reference hardware-wallet device and test vectors |
| `packages/` | shared libraries as they split out of the extension |
| `docs/` | architecture, privacy, decisions, testing, status ([index](docs/README.md)) |

## Install

**Prebuilt:** download `canon-wallet-0.1.0-alpha.zip` from [Releases](https://github.com/harsh132/canon/releases), unzip it, and load the folder as below.

**From source:** you need Chrome or Chromium 127 or newer, and [bun](https://bun.sh).

```bash
git clone https://github.com/harsh132/canon
cd canon
bun install
cd apps/extension
bun run build
```

Then in Chrome open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick `apps/extension/dist`. The onboarding tab opens: create a wallet, restore one, or use a passkey. Click the toolbar icon to open Canon Wallet in the side panel.

Settings are optional; put them in `apps/extension/.env` (see `.env.example`) and build again:

| Variable | Without it |
|---|---|
| `CANON_WC_PROJECT_ID` | WalletConnect is off. The id (free at cloud.reown.com) must allow the origin `chrome-extension://nigpkikilgbfgmgcmeiidiinikafjpjg`; the manifest's key pins this extension id for every build |
| `CANON_SEPOLIA_RPC` | Sepolia reads use PublicNode |
| `CANON_SPONSOR_URL` | Name claims and gasless calls use the hosted sponsor, `https://canon-sponsor.prakashharsh32.workers.dev` |

`bun run build` is a production build. `bun scripts/build.mjs --dev` adds development options, such as the mock hardware device used by the tests ([docs/testing.md](docs/testing.md)).

**Network.** Private balances run on Sepolia. Get test ETH from a Sepolia faucet, for example [Google Cloud's](https://cloud.google.com/application/web3/faucet/ethereum/sepolia), send it to your Main address (Receive), then **Make private**. Reads go through Anon-RPC's Nox mixnet by default; the Privacy screen switches to direct RPC if the mixnet is slow.

**Hardware wallet (optional).** Canon Wallet can keep its keys on Buddy, an ESP32-S3 running BuddyOS, over Bluetooth or USB. On Linux, turn on `chrome://flags/#enable-web-bluetooth` and `chrome://flags/#enable-web-bluetooth-new-permissions-backend`, restart the browser, and pair Buddy from an interactive `bluetoothctl` (`scan on`, `pair <address>`, confirm the code on both, `trust <address>`). Then choose **Hardware wallet** during onboarding. Details: [docs/hardware-wallet.md](docs/hardware-wallet.md).

## Develop

Package manager: [bun](https://bun.sh) workspaces.

```bash
bun install
bun run typecheck
cd apps/extension && bun scripts/build.mjs --watch
```
