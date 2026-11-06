# POC findings: Railgun private wallet + Anon-RPC reads (2026-11-04)

Target tracks: EF **Anon-RPC** ($5k) and EF **CROPS** ($3.5k). One EF prize per project.

## What was proven

| POC | File | Result |
|---|---|---|
| Railgun engine on Sepolia in Node: start engine, load provider, create 0zk wallet, full balance scan | `01-railgun-sepolia.mjs` | Works. Fresh sync 30 s, warm sync 7 s. Fees 25 bp shield / 25 bp unshield. |
| Every outbound HTTP request of the Railgun stack can be intercepted at three seams | `rpc-hook.mjs` | Works. 13 ethers RPC + 3 PPOI calls captured and rerouted through one fetch. |
| Ground truth of every host the engine talks to, any HTTP client | `net-observe.mjs` | Exactly 3 hosts (below). |
| Anon-RPC demo page, Nox worker, Sepolia | ethereum.github.io/anon-rpc/demo | `eth_getBalance` streams through the mixnet. |
| ethers `JsonRpcProvider` with every call routed through Anon-RPC (Nox) in a real browser page | `web/index.html` (serve with `.claude/launch.json` → `poc-web`) | Works. Worker ready in 3.3 s, then ~2.5–3.5 s per RPC call. Read Railgun proxy `shieldFee()` = 25 bp over the mixnet. |

Run:
```bash
cd poc
RPC_URL=https://ethereum-sepolia-rpc.publicnode.com RPC_HOOK=1 node 01-railgun-sepolia.mjs
node --import ./net-observe.mjs 01-railgun-sepolia.mjs      # ground-truth host list
```

## Who sees what today (the privacy leak the project closes)

Fresh Sepolia sync, one wallet, no funds:

| Host | Calls | Client | What it learns |
|---|---|---|---|
| RPC provider (`ethereum-sepolia-rpc.publicnode.com`) | 14 | ethers (CJS instance) | your IP, `eth_getLogs` ranges, every `eth_call` against the Railgun proxy, later your unshield target address |
| `rail-squid.squids.live` (Railgun QuickSync, Subsquid GraphQL) | 5 | `@graphql-mesh/runtime` → node:http | your IP, which commitment ranges you pulled, i.e. when your wallet was created |
| `ppoi.fdi.network` (Private Proof of Innocence aggregator) | 3 | axios | your IP, TXID-tree sync progress; later which POI proofs you submit |

Railgun hides sender/amount/recipient on-chain. It does **not** hide the above metadata from these three operators. Routing all three through Anon-RPC is the whole pitch, and it maps straight onto the Anon-RPC track's main criterion: "how much of the app's traffic goes through Anon-RPC".

## The three seams (how to route everything through `worker.fetch`)

1. **ethers**: `FetchRequest.registerGetUrl(getUrl)`.
   - GOTCHA: ethers ships `lib.esm` and `lib.commonjs`, each with its own `defaultGetUrlFunc`. Railgun packages `require('ethers')` (CJS). An ESM-side hook sees nothing. Register on both (see `rpc-hook.mjs`). In a Vite build this collapses to one instance, but verify.
   - GOTCHA: ethers passes a `FetchCancelSignal` (has `.checkSignal()`), not an `AbortSignal`. Don't forward it to `worker.fetch`.
2. **axios** (PPOI + artifact downloads from `ipfs-lb.com`): defaults to XHR in the browser, http in Node, never touches `globalThis.fetch`. Set `axios.defaults.adapter = 'fetch'` on the axios instance the wallet package resolves (axios 1.7.2), then patch `globalThis.fetch`. Or write a custom adapter that calls `worker.fetch` directly.
3. **graphql-mesh** (QuickSync): in Node it went through `node:http`. In the browser `@whatwg-node/fetch` should fall back to `globalThis.fetch`; must be patched *before* the wallet SDK module is imported. **Unverified in browser.** If it captures fetch at import time, patch earlier or ask for a `fetch` option.

Bootstrap: Anon-RPC needs 2 clear-text RPC calls once per session to read `workerHash()`/`workerResolvers()` from the specifier contract. They reveal only "this client reads a specifier contract".

## Anon-RPC networks (from adopters.json5)

| id | specifier | chain of specifier | notes |
|---|---|---|---|
| passthrough | `0x4fd77be300f31c5fe6ab266d35d27750a3478d27` | mainnet | no anonymization, for testing the harness |
| tor-js | `0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e` | mainnet | needs a KPS gateway in `config.gateways`; demo gateway may vanish |
| nym | `0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0` | mainnet | 18 MB bundle |
| **nox** | `0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A` | **Sepolia 11155111** | used in the POC; fast bootstrap, ~3 s/call |

The specifier's chain only matters for the bootstrap read. The anonymized fetch can hit any RPC URL. `anonOptions.isolationKey` per account can unlink calls (support varies).

Harness: `@anon-rpc/browser-harness@0.4.0`, browser-only (null-origin iframe + WebRTC KPS). Loads fine from jsDelivr `+esm`. Unpublished `impl/node-harness` exists (QuickJS isolate) but is a prototype, not conforming.

## Railgun SDK facts (verified)

- Installed: `@railgun-community/wallet` 11.3.0, `shared-models` 8.2.1, `engine` 9.9.1, `ethers` 6.14.3. Docs' pinned 10.4.0/7.6.1 are stale; 7702 flow needs ≥11.2/8.2.1.
- Sepolia config: proxy `0xeCFCf3b4eC647c4Ca6D49108b311b7a7C9543fea`, relayAdapt7702 `0x05ae73c5925d843864ae6F261f3175De2ebCd963`, registry `0xb0FBBC5ba90ef3e565f162f8873F0dFF85dC9A0e`, WETH `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`, deploymentBlock 5784866, POI launch block 5944700 (so PPOI applies on Sepolia), `supports7702: true`, V3 not supported.
- `loadProvider` config: sum of provider `weight` must be ≥ 2 or it throws "Invalid fallback provider config".
- PPOI node URL is required for Sepolia (`poi` defined) → pass `['https://ppoi.fdi.network']` to `startRailgunEngine`.
- "Failed to decrypt node annotation data" during scans is expected noise (notes that are not ours).
- Proof artifacts (~50 MB, from `ipfs-lb.com`) only download when generating proofs (transfer/unshield), not for shield or balance scan.
- `wallet.json` in `.data/` holds a throwaway test mnemonic; `.data/` is gitignored.

## Working public Sepolia RPC

`https://ethereum-sepolia-rpc.publicnode.com` works from the browser and from Node. OnFinality public returns 429 under load; 1rpc.io is rate limited; drpc/ankr/tenderly timed out from this machine. Get a dedicated key (Alchemy/Infura) for the hackathon.

## Not yet done

- Shield / private transfer / unshield on Sepolia: needs a funded Sepolia EOA (ETH for gas + to shield as WETH via `populateShieldBaseToken`). Unshield/transfer also need the prover (`snarkjs` groth16) and a 7702-capable broadcaster or self-broadcast.
- Railgun wallet SDK running **in the browser** (level-js DB, Buffer/polyfills under Vite) with all three seams on `worker.fetch`. This is the main integration risk for the real build.
- graphql-mesh fetch capture in the browser (see seam 3).
- Latency budget: ~3 s per call through Nox × ~22 calls on a fresh sync ≈ 1 min. Fine for a demo; batch where possible, cache aggressively, show a progress UI.

## Pitch shape for the EF judges

"Railgun makes the transaction private; we make the *wallet* private. Every RPC read, QuickSync query and PPOI call leaves through Anon-RPC, so the RPC provider, the indexer and the POI aggregator each learn nothing about who you are." Demo: toggle anon off/on and show the network tab, plus a request counter per host.

## Hoodi testnet check (2026-11-04, chain 560048)

Asked: can we test on Hoodi (hoodi.dev)? Probed `rpc.hoodi.ethpandaops.io` (ethrex v30 stable), `ethereum-hoodi-rpc.publicnode.com` (Geth 1.17), `0xrpc.io/hoodi`.

| What | Hoodi | Evidence |
|---|---|---|
| Anon-RPC reads (ethers via Nox mixnet) | **Works** | `web/index.html?rpc=https://ethereum-hoodi-rpc.publicnode.com&chain=560048`: eth_chainId/blockNumber/getCode/getBalance all anonymized, ~1.5 s per call. The Nox specifier is read on Sepolia; the anonymized fetch can target any chain. |
| Railgun | **Not deployed** | No code at the Sepolia/devnet Railgun addresses; `@railgun-community/shared-models` NETWORK_CONFIG has no Hoodi entry; Railgun-Community/deployments only has `sepolia.ts`. Hoodi is a staking/infra testnet; hoodi.dev itself points dApp testing to Sepolia. |
| EIP-8141 frame txs / alt-mempool | **Not supported** | `eth_sendRawTransaction` of a type-0x06 tx → "transaction type not supported" (Geth) / invalid params (ethrex stable); `ethrex_simulateFrameTransaction` and `eth_sendFrameTransaction` → method not found. ERC-8421 is live on no public network; only the EF devnet (chain 1337) runs the `eip8141-tracer` fork. |

Conclusion: Hoodi only helps for the Anon-RPC half (as a second chain in the demo, with a generous PoW faucet up to 33 ETH). Railgun work stays on Sepolia (or the devnet, which has Railgun predeployed); frame-tx work stays on the devnet. Deploying Railgun ourselves to Hoodi (91 verifying keys, two Poseidon libraries, hardhat scripts in Railgun-Privacy/contract) is possible but is a day of work with no track payoff.

## Anvil fork: full Railgun flow works (2026-11-04)

`06-railgun-anvil-flow.mjs` against `anvil --fork-url <sepolia> --port 8545` (chain id stays 11155111, so the
Sepolia network config, contracts and Subsquid QuickSync all keep working; only new blocks are scanned over RPC).

| Step | Result | Gas |
|---|---|---|
| wrap 1 ETH → WETH, approve proxy | ok | 133k / 128k |
| `shield(1 WETH → A)` via `populateShield` (plain ERC-20 shield, no relay adapt) | A spendable 0.9975 WETH (0.25% fee) | ~0.9M |
| private transfer A → B 0.49875 WETH, proof via snarkjs (`generateTransferProof`), self-broadcast from the anvil EOA | A 0.49875 / B 0.49875 | 1.28M–1.51M |
| unshield B → EOA via `generateUnshieldProof` + `populateProvedUnshield` | EOA got 0.497503125 WETH (0.25% fee), B 0 | 659k |

Whole run ≈ 60 s warm, ≈ 2–3 min on first run (QuickSync 15 s, circuit artifacts download from ipfs-lb.com once).

Two things needed to make a fork usable, both in the script and both **fork-only**:
1. `delete NETWORK_CONFIG[EthereumSepolia].poi` before `loadProvider`, otherwise the SDK insists on PPOI.
2. Runtime patch of the engine's `POI.getBalanceBucket` (unspent ⇒ Spendable) and empty `POI` list keys.
   Reason: `engine/dist/poi/poi.js` buckets any note without a `poisPerList` record as ShieldPending, and that
   record only ever comes from a PPOI aggregator that has indexed the shield. ppoi.fdi.network watches real
   Sepolia, never a fork. With the patch, `TransactionBatch` also skips POI proof generation.

Gotcha: the engine ingests events through an async write queue, so `refreshBalances` right after a receipt can
miss the block. Poll (3 s × up to 8) until the expected balance change shows; the script's `scan()` does this.

What this means for the build: the wallet half (shield / transfer / unshield, self-broadcast, no Waku) is fully
exercised locally; the Anon-RPC half is exercised in the browser; only the broadcaster path and real PPOI are untested,
and the EIP-8141 half still needs the devnet (anvil has no type-0x06).
