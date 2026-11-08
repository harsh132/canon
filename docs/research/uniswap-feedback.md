# Uniswap developer feedback

From building Canon's private swap at ETHGlobal Mumbai (November 2026). Canon swaps a RAILGUN private balance on Uniswap v4 without a public address of the user's ever holding the tokens: RAILGUN's Relay Adapt contract unshields WETH, unwraps it, swaps ETH→USDC through the UniversalRouter, and re-shields the output, all in one transaction.

Integration code: [`apps/extension/src/core/swap.ts`](../../apps/extension/src/core/swap.ts). Quote and simulation probe: [`apps/extension/scripts/v4-probe.mjs`](../../apps/extension/scripts/v4-probe.mjs).

## What worked well

- **Liquidity on Sepolia.** Native ETH/USDC v4 pools exist at all four standard tiers with real liquidity, and v3 WETH/USDC pools are deep. A testnet where swaps behave like mainnet made the private swap testable at all.
- **`TAKE_ALL` pays `msg.sender`.** Our caller is a contract (Relay Adapt) that must end up holding the output to re-shield it. No recipient argument to get wrong.
- **Quoter `staticCall`.** Pricing for an arbitrary caller with one call, before building a zero-knowledge proof that commits to the minimum output.
- **Permissionless pools.** Knowing we could initialise our own pool if none existed removed a risk early.

## What cost us time

- **Finding which v4 pools exist.** There was no way we found to list Sepolia v4 pools for a pair. We computed `PoolId = keccak256(abi.encode(PoolKey))` for each fee tier and tick spacing and read `StateView.getSlot0` / `getLiquidity`. A "pools for this pair" read (on StateView, or a documented API that covers testnets) would have saved real time.
- **WETH vs native ETH.** On Sepolia the WETH/USDC v4 pools are empty or near-empty, while ETH/USDC pools are liquid. Callers that hold WETH, like RAILGUN, must unwrap first. A docs note on which representation testnet liquidity uses would help.
- **Hand-encoding `V4_SWAP`.** Building `execute(0x10, [abi.encode(actions, params)])` with `SWAP_EXACT_IN_SINGLE (0x06)`, `SETTLE_ALL (0x0c)`, `TAKE_ALL (0x0f)` meant reading periphery source for action codes and parameter tuples. A minimal, dependency-free encoder snippet in the docs, for callers who cannot pull in the full SDK (ours runs inside a browser-extension bundle), would help.
- **Deadline vs proof time.** Our calldata is committed inside a ZK proof that takes 20–40 s to build, then relayed. We set the deadline 30 minutes out. Worth a line in the docs for any integrator whose calldata is signed or proved well before submission.

## Requests

1. A read method or endpoint listing pools (any version) for a token pair on testnets.
2. A small reference for encoding UniversalRouter v4 commands without the SDK.
3. Guidance for contract callers that cannot react mid-transaction (smart accounts, privacy adapters): recommended `amountOutMinimum` handling and what happens to dust.
