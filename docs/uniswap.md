# Uniswap private swap

Swap private WETH for a token without it ever touching a public address of the user's: one RAILGUN cross-contract call unshields into the Relay Adapt contract, swaps there on Uniswap, and re-shields the output.

## Sepolia facts (checked 2026-11-06)

| Contract | Address |
|---|---|
| Uniswap v3 Factory | `0x0227628f3F023bb0B980b67D528571c95c6DaC1c` |
| Uniswap v3 QuoterV2 | `0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3` |
| Uniswap v3 SwapRouter02 | `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E` |
| Uniswap v4 PoolManager | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` |
| Uniswap v4 UniversalRouter | `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b` |
| RAILGUN Relay Adapt | `0x7e3d929EbD5bDC84d02Bd3205c777578f33A214D` |
| WETH (RAILGUN's base token) | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` |
| USDC (Circle) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |

WETH/USDC v3 pools all have liquidity. The 1% pool holds about 1,627 WETH and 33.7M USDC; the 0.05% pool about 128 WETH and 3.2M USDC. QuoterV2 prices 0.001 WETH at about 26.6 USDC (0.05% pool). The v4 PoolManager holds about 722 WETH and 19M USDC.

## Design (built in `apps/extension/src/core/swap.ts`)

The pool is the v4 native **ETH/USDC 0.3%** pool (the WETH/USDC v4 pools on Sepolia are empty). The adapter therefore unwraps first:

1. `RelayAdapt.unwrapBase(0)`: all unshielded WETH to ETH.
2. `UniversalRouter.execute(V4_SWAP)`: `SWAP_EXACT_IN_SINGLE`, `SETTLE_ALL`, `TAKE_ALL`; output paid to the adapter.
3. `RelayAdapt.wrapBase(0)`: wraps any ETH left. In broadcaster mode a failed inner call does not revert, so this is what returns the input if the swap fails.
4. Re-shield USDC and WETH to the wallet.

Sent through the sponsored relay with the 1-wei self fee note, so the wallet can submit the swap's proof-of-innocence proofs. Quote from the v4 Quoter through Nox, 3% slippage floor, 30-minute deadline.

## Original plan

One `generateCrossContractCallsProof` with:

1. **Unshield** the input WETH to Relay Adapt.
2. **Calls** from Relay Adapt: `WETH.approve(SwapRouter02, amount)`, then `SwapRouter02.exactInputSingle({ tokenIn: WETH, tokenOut: USDC, fee: 500, recipient: RelayAdapt, amountIn, amountOutMinimum })`.
3. **Re-shield** USDC and WETH to the user's 0zk, amount 0 meaning "everything the adapter holds". Re-shielding the input token too means a failed swap returns the funds instead of stranding them.

Rules carried over from Ender's `private-swap.ts`:

- Quote for the adapter, never the user: the router pays out to `recipient`, which must be Relay Adapt.
- Re-shield takes no amount; the engine sweeps the adapter's whole balance.
- Check `getRelayAdaptTransactionError` on the receipt: a failed inner call does not revert the outer transaction.

Gas goes through the sponsored relay like other private sends (`useRelayAdapt` is true). `amountOutMinimum` comes from QuoterV2 with slippage, read through Nox.

## Prize requirements

Public GitHub repo, a `FEEDBACK.md`, and the Uniswap Developer Feedback Form linking it. The repo is private today.
