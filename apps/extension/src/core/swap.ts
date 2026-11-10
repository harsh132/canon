// Private swap: WETH -> USDC on Uniswap v4, without a public address of ours
// ever holding either token.
//
// One RAILGUN cross-contract call. The proof unshields WETH into the Relay
// Adapt contract, which then runs, as itself:
//   1. unwrapBase(0)        all WETH it holds -> ETH
//   2. UniversalRouter.execute(V4_SWAP)  ETH -> USDC on the ETH/USDC 0.3% pool, paid to itself
//   3. wrapBase(0)          any ETH left -> WETH (all of it if the swap failed)
// and finally re-shields its whole USDC and WETH balance to this wallet.
//
// Sent through the sponsor in broadcaster mode, where a failed inner call does
// not revert the transaction. Step 3 is what makes that safe: a failed swap
// leaves ETH, step 3 wraps it, and the WETH re-shield brings it home.
//
// Pattern and its rules from the Ender wallet's private-swap.ts.
import {
  gasEstimateForUnprovenCrossContractCalls,
  generateCrossContractCallsProof,
  populateProvedCrossContractCalls,
  getRelayAdaptTransactionError,
} from '@railgun-community/wallet';
import { EVMGasType, NETWORK_CONFIG, TXIDVersion, calculateGasPrice, type TransactionGasDetails } from '@railgun-community/shared-models';
import { AbiCoder, Contract, Interface, solidityPacked, type ContractTransaction } from 'ethers';
import { NETWORK, WETH, getProvider } from './config';
import { currentWalletId, spendable } from './railgun';
import { sponsorRelay } from './ens';
import { emit, state } from './state';
import type { Unlocked } from './vault';
import { recordActivity } from './book';

const V2 = TXIDVersion.V2_PoseidonMerkle;
export const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const ETH = '0x0000000000000000000000000000000000000000';
const ROUTER = '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b';
const QUOTER = '0x61b3f2011a92d183c7dbadbda940a7555ccf9227';
const RELAY_ADAPT = NETWORK_CONFIG[NETWORK].relayAdaptContract;
const POOL = { currency0: ETH, currency1: USDC, fee: 3000, tickSpacing: 60, hooks: ETH };
const SLIPPAGE_BPS = 300n;
/** RAILGUN's unshield fee: what reaches the adapter is 0.25% less than what leaves the pool. */
const UNSHIELD_FEE_BPS = 25n;

const abi = AbiCoder.defaultAbiCoder();
const relayAdaptIface = new Interface(['function unwrapBase(uint256)', 'function wrapBase(uint256)']);
const routerIface = new Interface(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);

const afterUnshieldFee = (amount: bigint) => amount - (amount * UNSHIELD_FEE_BPS) / 10_000n;

export type SwapQuote = { amountIn: bigint; swapped: bigint; out: bigint; minOut: bigint };

/** Quoted through the core's provider, so through Nox. */
export const quoteSwap = async (amountIn: bigint): Promise<SwapQuote> => {
  const swapped = afterUnshieldFee(amountIn);
  const quoter = new Contract(
    QUOTER,
    [
      'function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData)) returns (uint256 amountOut, uint256 gasEstimate)',
    ],
    getProvider(),
  );
  const [out] = (await quoter.quoteExactInputSingle.staticCall({ poolKey: POOL, zeroForOne: true, exactAmount: swapped, hookData: '0x' })) as [bigint];
  return { amountIn, swapped, out, minOut: (out * (10_000n - SLIPPAGE_BPS)) / 10_000n };
};

const calls = (q: SwapQuote): ContractTransaction[] => {
  // V4_SWAP (0x10) with SWAP_EXACT_IN_SINGLE (0x06), SETTLE_ALL (0x0c), TAKE_ALL (0x0f).
  const actions = solidityPacked(['uint8', 'uint8', 'uint8'], [0x06, 0x0c, 0x0f]);
  const swap = abi.encode(
    ['tuple(tuple(address,address,uint24,int24,address),bool,uint128,uint128,bytes)'],
    [[[POOL.currency0, POOL.currency1, POOL.fee, POOL.tickSpacing, POOL.hooks], true, q.swapped, q.minOut, '0x']],
  );
  const settle = abi.encode(['address', 'uint256'], [ETH, q.swapped]);
  const take = abi.encode(['address', 'uint256'], [USDC, q.minOut]);
  // The proof commits to these calls; leave room for proving and relaying.
  const deadline = Math.floor(Date.now() / 1000) + 30 * 60;
  return [
    { to: RELAY_ADAPT, data: relayAdaptIface.encodeFunctionData('unwrapBase', [0n]), value: 0n },
    { to: ROUTER, data: routerIface.encodeFunctionData('execute', ['0x10', [abi.encode(['bytes', 'bytes[]'], [actions, [swap, settle, take]])], deadline]), value: q.swapped },
    { to: RELAY_ADAPT, data: relayAdaptIface.encodeFunctionData('wrapBase', [0n]), value: 0n },
  ];
};

export const executeSwap = async (amountIn: bigint, u: Unlocked): Promise<{ hash: string; quote: SwapQuote }> => {
  if (amountIn <= 0n) throw new Error('Enter an amount');
  if (amountIn + 1n > spendable()) throw new Error('More than your spendable private WETH');
  const id = currentWalletId();
  const q = await quoteSwap(amountIn);
  const unshields = [{ tokenAddress: WETH, amount: amountIn }];
  const shields = [
    { tokenAddress: USDC, recipientAddress: state.railgunAddress as string },
    { tokenAddress: WETH, recipientAddress: state.railgunAddress as string },
  ];
  const cc = calls(q);
  const gasPrice = (await getProvider().getFeeData()).gasPrice ?? 1_000_000_000n;
  const t1 = (gasEstimate: bigint): TransactionGasDetails => ({ evmGasType: EVMGasType.Type1, gasEstimate, gasPrice });
  // Sponsor route: broadcaster mode (see the top of this file). Its Relay Adapt dummy proofs
  // need a fee note there, so 1 wei of WETH goes to this wallet.
  const fee = { tokenAddress: WETH, amount: 1n, recipientAddress: state.railgunAddress as string };
  const { gasEstimate } = await gasEstimateForUnprovenCrossContractCalls(
    V2, NETWORK, id, u.railgunKey, unshields, [], shields, [], cc, t1(0n), { tokenAddress: WETH, feePerUnitGas: 0n }, false, undefined,
  );
  const gd = t1(gasEstimate);
  const minGas = calculateGasPrice(gd);

  state.proof = { label: 'Proving swap', progress: 0 };
  emit();
  try {
    await generateCrossContractCallsProof(V2, NETWORK, id, u.railgunKey, unshields, [], shields, [], cc, fee, false, minGas, undefined, (p) => {
      state.proof = { label: 'Proving swap', progress: p / 100 };
      emit();
    });
  } finally {
    state.proof = null;
    emit();
  }
  const populated = await populateProvedCrossContractCalls(V2, NETWORK, id, unshields, [], shields, [], cc, fee, false, minGas, gd);
  const hash = await sponsorRelay(populated.transaction.to as string, populated.transaction.data as string, minGas);
  void recordActivity({ id: hash, kind: 'transfer', label: 'Swapped privately WETH → USDC', amount: undefined, hash, at: Date.now(), status: 'pending' });
  // A failed inner call does not revert the outer transaction; check the logs.
  void getProvider()
    .waitForTransaction(hash, 1, 10 * 60_000)
    .then((r) => {
      const err = r ? getRelayAdaptTransactionError(V2, r.logs as never) : 'no receipt';
      if (err) console.warn('[swap] inner call failed; input re-shielded as WETH:', err);
      else console.log('[swap] swap succeeded', hash);
    })
    .catch(() => {});
  return { hash, quote: q };
};
