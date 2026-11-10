# Operations

How to build, test, deploy and operate Canon. For what Canon is, read [summary.md](summary.md).

## Build

You need [bun](https://bun.sh) and Chrome or Chromium 127 or newer.

```bash
bun install                      # from the repo root
bun run typecheck
cd apps/extension
bun run build                    # production build into dist/
bun scripts/build.mjs --dev      # development build (the tests need it for some state hooks)
bun scripts/build.mjs --watch    # rebuild on change
```

Load `apps/extension/dist` at `chrome://extensions` with Developer mode on (Load unpacked). The onboarding tab opens on first install. The toolbar icon opens the side panel.

- The first build downloads RAILGUN's 93 circuit `.wasm` files (83 MB) from IPFS into `.cache/artifacts` and checks each against the SDK's hashes. A wrong hash or a moved IPFS root stops the build. Later builds use the cache.
- The build copies the Nox worker bundle and the Anon-RPC sandbox page from the installed packages on every build.

Settings, in `apps/extension/.env` (see `.env.example`):

| Variable | Without it |
|---|---|
| `CANON_WC_PROJECT_ID` | WalletConnect is off |
| `CANON_SEPOLIA_RPC` | Sepolia reads use PublicNode |
| `CANON_SPONSOR_URL` | The hosted sponsor (a `CANON_FORK` build uses `http://127.0.0.1:8792`) |
| `CANON_FORK=1` | A normal build. With it: a build for a local anvil fork, with POI checks off. Never ship a fork build |

## Extension id

The manifest `key` pins the extension id to `nigpkikilgbfgmgcmeiidiinikafjpjg` in every build. The matching private key is `apps/extension/key.pem` (gitignored). The id matters for:

- the WalletConnect project's allowed origins;
- passkeys, whose relying party is the extension origin.

## WalletConnect

The relay accepts only origins on the project's allowlist. Add `chrome-extension://nigpkikilgbfgmgcmeiidiinikafjpjg` to the project at cloud.reown.com, and put its id in `CANON_WC_PROJECT_ID`. If the allowlist does not have the origin, the Apps screen shows "Relay refused" after 20 seconds.

## Sponsor

The sponsor pays gas and issues names. It charges no fee, so it is for testnet only, and hourly caps limit abuse.

Hosted at `https://canon-sponsor.prakashharsh32.workers.dev` (Cloudflare Worker with one Durable Object, so one transaction queue for the single key).

| Endpoint | Does | Code |
|---|---|---|
| `GET /health` | Parent name, subregistry, sponsor address | `src/app.ts` |
| `GET /available?label=` | Whether `<label>.canon.eth` is free | `src/app.ts` |
| `POST /claim` | Issues a name with an `org.railgun` record, then gives every role to the owner | `src/app.ts` |
| `POST /relay` | Sends a proved RAILGUN transaction, or RAILGUN's 7702 unshield (type 4) | `src/relay.ts` |
| `POST /execute` | Sends a Calibur batch for a site address, and delegates it on first use | `src/execute.ts` |

| Cap per hour | Local | Hosted |
|---|---|---|
| Name claims | 20 | 10 |
| Relays | 60 | 20 |
| Executes | 60 | 30 |

What `/relay` and `/execute` refuse:

- `/relay`: a `to` that is not the RAILGUN proxy or Relay Adapt, unless it is RAILGUN's 7702 unshield target (the one-off ephemeral address). Such a target must bring exactly one authorization to RelayAdapt7702 on Sepolia, signed by the target itself, and have no code or only that delegation. Fund with ETH and sponsored Make public depend on this path. The relay also refuses bad calldata, a simulation that fails at the real gas price, and more than 4M gas.
- `/execute`: a chain other than Sepolia; an executor other than this sponsor; 0 or more than 10 calls; a call into the account, `address(0)` or the EntryPoint; a deadline in the past or more than 1 hour ahead; an account that does not run Calibur and brings no authorization to Calibur; a failed simulation; more than 3M gas.

Gas price: the sponsor prices legacy gas from the latest base fee ×2 plus a tip. Do not use `eth_gasPrice`: on Sepolia it lagged the base fee and left a transaction that could not be mined.

### Run it locally

```bash
cd apps/sponsor
cp .env.example .env              # SPONSOR_KEY, SEPOLIA_RPC, PARENT_LABEL, PORT
bun src/server.ts                 # 127.0.0.1:8792; reads .env and .data/parent.json
```

### Deploy

`cf` (Cloudflare's CLI) must be logged in. Loading `cloudflare.config.ts` needs Node 22.18 or newer, not Bun.

1. Run a dry deploy: `bun run deploy:dry`.
2. Write `.secrets.json` (gitignored): `{"SPONSOR_KEY": "0x…"}`.
3. Deploy: `bun run deploy`. This uploads `SPONSOR_KEY` as a secret.
4. Delete `.secrets.json`.
5. Check the deploy (it spends a little Sepolia ETH): `SPONSOR_URL=https://canon-sponsor.prakashharsh32.workers.dev bun scripts/execute-probe.ts`.

### Sponsor scripts

| Script | Does |
|---|---|
| `scripts/setup-parent.ts` | One time: registers `<PARENT_LABEL>.eth` with a UserRegistry where the sponsor has only REGISTRAR and RENEW, then renounces `SET_SUBREGISTRY`. Resumable; state in `.data/parent.json` |
| `scripts/fund-from-test-wallet.ts [eth]` | Development: creates a sponsor key if there is none, and funds it from the test wallet's Main |
| `scripts/replace-stuck.ts <txHash>` | Sends a stuck sponsor transaction again with the same nonce and a higher gas price |
| `scripts/execute-probe.ts` | `/execute` from a new address: a 7702 delegation, then a two-call batch |

## Names

| Item | Value |
|---|---|
| Parent | `canon.eth` on ENSv2 Sepolia, registered 2026-11-07 for 1 year. **Renew it before 2027-11-07**, or someone can take the parent and every name under it after the grace period. Anyone can renew it through the registrar |
| Subregistry | `0x8cA3Dc27639766aeC78e11cb9fB27443148FC639` (UserRegistry proxy) |
| Sponsor | `0x254d9B9c09F113271fBC2f7DD84f17060A7d3141`: REGISTRAR and RENEW on the subregistry only |
| Older names | Under `pangolin.eth` (subregistry `0x371c18e4B47B1183Ae4c4bE2018440871424bF61`), from before the rename. `alice.pangolin.eth` still resolves |
| Universal Resolver | `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` |
| Test name | `alice.canon.eth` pays the test wallet |

## Nox

| Item | Value |
|---|---|
| Specifier (Sepolia) | `0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A` |
| Bundle | `@hisoka-io/anon-rpc-worker`, copied to `dist/nox/anon-rpc-worker.js` |
| Harness | `@anon-rpc/browser-extension-harness` |
| Bootstrap read | `workerHash()` through PublicNode, once per start, in the clear |

When Nox publishes a new bundle, every installed Canon stops with "Nox bundle out of date; update Canon" until a release ships it. To update: install the `@hisoka-io/anon-rpc-worker` version whose `dist/anon-rpc-worker.js.keccak256` equals the contract's new `workerHash()`, build and release. Direct RPC still works meanwhile, if the user chooses it.

Before each Chrome Web Store submission, read the MV3 policy on remotely hosted code again. Link the Nox bundle's source, provenance file and reproducible build ([nox-sdk](https://github.com/hisoka-io/nox-sdk)) in the review notes.

## Addresses (Sepolia)

| Contract | Address |
|---|---|
| RAILGUN Relay Adapt | `0x7e3d929EbD5bDC84d02Bd3205c777578f33A214D` |
| WETH (RAILGUN's base token) | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` |
| USDC (Circle) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| Calibur | `0x000000009B1D0aF20D8C6d0A44e162d11F9b8f00` |
| Uniswap v4 PoolManager | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` |
| Uniswap v4 UniversalRouter | `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b` |
| POI node | `https://ppoi.fdi.network` |
| RAILGUN squid | `https://rail-squid.squids.live/squid-railgun-eth-sepolia-v2/graphql` |

Arbitrum reads use `arb1.arbitrum.io`, because PublicNode refuses RAILGUN's `eth_getLogs` there without a paid token.

## Tests

### Chromium

Use Playwright's Chromium. Branded Chrome does not load an unpacked extension from the command line.

```bash
export CHROME="$HOME/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe"   # Windows example
export CANON_PROFILE="$TMP/canon-$RANDOM"   # a new profile is a new wallet; a reused one keeps its wallet
```

The scripts are in `apps/extension/scripts`. Each loads `dist/`, drives the UI with puppeteer and prints the core's console.

### Checks without a browser

| Script | Checks |
|---|---|
| `check-eta.ts` | The spendable countdown |
| `check-token.ts` | Token symbol and decimals checks |
| `check-head-lag.ts` | The transport's retry of "beyond current head block" |
| `check-ens-resolve.ts` | Name lookup errors (needs network) |
| `preview-check.ts` | The transaction preview against live Sepolia (needs network) |

Run each with `bun scripts/<name>`.

### Browser scripts

| Script | Proves | Needs |
|---|---|---|
| `smoke.mjs` | The extension loads, the core starts, the UI renders | A build |
| `e2e-create.mjs` | New wallet, backup, first sync through Nox, every off-extension request; custom tokens | Network |
| `e2e-onboard.mjs` | New wallet with the word check, restore, passkey create, unlock and restore (virtual authenticator with PRF) | A build |
| `e2e-injected.mjs` | EIP-6963, reads through Nox, connect, `personal_sign`, transaction preview, two origins, reload | Port 8791 |
| `e2e-wc.mjs` | Two dapps get two addresses; reconnect keeps it; `personal_sign` | `CANON_WC_PROJECT_ID` |
| `e2e-networks.mjs` | Per-site networks, chain switches, RAILGUN on Arbitrum and back | `--dev` build; port 8798; up to 10 min |
| `e2e-panel-prompt.mjs` | A request shows in the open panel; with the panel closed, the popup opens | Port 8801 |
| `check-prompt.mjs` | A dapp connect opens the toolbar popup, not a window | Port 8793 |
| `check-site-panel.mjs` | Each tab's panel shows its own site and address | `--dev` build; port 8795 |
| `check-no-exits.mjs` | "Nox · no exits" when every tunnel exit is down | `--dev` build |
| `check-panel.mjs`, `check-focus.mjs`, `check-icons.mjs` | Panel layout, focus borders, dapp icons | A build |
| `shot-onboard.mjs`, `shot-frame.mjs`, `shot-activity.mjs` | Screenshots into `.cache/` | A build (`shot-activity` needs `--dev`) |
| `e2e-fork.mjs` | Make private, Send privately, Make public, then the same with LINK (`TOKEN_ONLY=1`: LINK only) | Anvil fork and a fork build |
| `e2e-sepolia.mjs <phase>` | Real Sepolia through Nox, with the test wallet (below) | Sepolia ETH in the test wallet |
| `poi-probe.mjs` | Prints the test wallet's POI state: buckets, spent and received POIs, pending txids | `--dev` build |

### Fork

No faucet is needed. No POI node watches a fork, so a fork build turns POI off.

```bash
anvil --fork-url https://ethereum-sepolia-rpc.publicnode.com --fork-block-number <head-12> --chain-id 11155111 --port 8545
CANON_FORK=1 CANON_SEPOLIA_RPC=http://127.0.0.1:8545 bun scripts/build.mjs --dev
CANON_PROFILE=$PWD/.cache/<new> bun scripts/e2e-fork.mjs
```

- Fork near the head, at a pinned block, and restart the fork often. After about an hour, merkle root checks fail with "Failed to validate V2 merkleroot".
- Build again without the variables before real use.

### Test wallet (Sepolia)

`e2e-sepolia.mjs` uses a persistent profile in `apps/extension/.cache/sepolia/` (gitignored). `wallet.json` there holds the test phrase, Main and the 0zk. Test funds only.

- Main: `0x8EC234E508ace216d08103D87Eb493d8E0F3a4D4`. Fund it with Sepolia ETH from a faucet.
- To run it from another profile directory, copy the whole `.cache/sepolia/` folder.

| Phase | Does |
|---|---|
| `setup` | Creates the wallet once and prints Main and the 0zk |
| `shield` | Make private `AMOUNT` (default 0.01) from Main |
| `status` | Syncs and prints the balances |
| `private` | Send privately `AMOUNT` to `TO` (default `alice.canon.eth`) |
| `public` | Make public 0.002 to Main |
| `spend` | Send privately 0.002 to the wallet's own 0zk |
| `swap` | Private swap `AMOUNT` (default 0.001) WETH to USDC |
| `name` | Claims `LABEL.canon.eth` (default `alice`), then pays it from Main |
| `broadcasters` | Waits until Waku finds a Sepolia broadcaster |
| `dapp` | A local dapp: EIP-5792, sponsored 7702 calls, then Fund. **Needs a `--dev` build** (it reads `__canonState`; a production build fails after the sponsored transactions have run) and spendable private WETH for Fund |

| Variable | Effect |
|---|---|
| `AMOUNT`, `TO`, `LABEL` | As in the table |
| `VIA` | Gas for private sends: `sponsor` (default), `broadcaster` or `self` (Main pays) |
| `TOKEN` | Send this ERC-20 (address) instead of ETH |
| `WAIT_SPENDABLE=1` | Stay open until the funds clear: after `shield` until the new notes clear (needs `AMOUNT` ≥ 0.001), before `private`, before and after `public`, during `status` |
| `STAY_MIN=N` | `status` stays open N minutes and syncs each minute |
| `FUND_ONLY=1` | `dapp` runs only Fund |
| `RPC_DIRECT=1` | `dapp` reads direct for this run, then goes back to Nox |
| `WATCHDOG_MIN` | Stops the run after N minutes (default 25) |

The SDK makes a spend's POI proofs only while the wallet is open, so keep the run open (`WAIT_SPENDABLE`, `STAY_MIN`) after a private send. On Sepolia the outputs of a private spend stay pending until RAILGUN fixes the TXID index ([summary.md](summary.md#known-issues)).

## Knowledge graph

The repo has a graphify knowledge graph in `graphify-out/` (not committed). `CLAUDE.md` and `AGENTS.md` tell agents to use it.

```bash
graphify query "<question>"      # a scoped subgraph for a question
graphify update .                # after code changes (AST only, no LLM cost)
```

`/graphify .` in Claude Code builds it again from scratch, including the docs.
