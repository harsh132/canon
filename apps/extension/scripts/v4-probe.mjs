// Checks Uniswap v4 ETH/USDC on Sepolia: quote, then simulate a swap through
// the UniversalRouter from an address with ETH. No transaction is sent.
//   bun scripts/v4-probe.mjs [from]
import { AbiCoder, Contract, JsonRpcProvider, formatUnits, parseEther, solidityPacked } from 'ethers';

const p = new JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com', 11155111, { staticNetwork: true });
const ETH = '0x0000000000000000000000000000000000000000';
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const QUOTER = '0x61b3f2011a92d183c7dbadbda940a7555ccf9227';
const ROUTER = '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b';
const FROM = process.argv[2] ?? '0xbb80dAf3108ba7e9944C9E47EA5b34C1F030B071';
const key = { currency0: ETH, currency1: USDC, fee: 3000, tickSpacing: 60, hooks: ETH };
const amountIn = parseEther('0.0001');
const abi = AbiCoder.defaultAbiCoder();

const quoter = new Contract(QUOTER, [
  'function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData)) returns (uint256 amountOut, uint256 gasEstimate)',
], p);
const [out, gas] = await quoter.quoteExactInputSingle.staticCall({ poolKey: key, zeroForOne: true, exactAmount: amountIn, hookData: '0x' });
console.log('quote 0.0001 ETH ->', formatUnits(out, 6), 'USDC, gas', gas.toString());

// V4_SWAP = 0x10; actions SWAP_EXACT_IN_SINGLE 0x06, SETTLE_ALL 0x0c, TAKE_ALL 0x0f.
const minOut = (out * 97n) / 100n;
const actions = solidityPacked(['uint8', 'uint8', 'uint8'], [0x06, 0x0c, 0x0f]);
const swapParams = abi.encode(
  ['tuple(tuple(address,address,uint24,int24,address),bool,uint128,uint128,bytes)'],
  [[[key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks], true, amountIn, minOut, '0x']],
);
const settle = abi.encode(['address', 'uint256'], [ETH, amountIn]);
const take = abi.encode(['address', 'uint256'], [USDC, minOut]);
const input = abi.encode(['bytes', 'bytes[]'], [actions, [swapParams, settle, take]]);
const router = new Contract(ROUTER, ['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable'], p);
const deadline = Math.floor(Date.now() / 1000) + 600;
const data = router.interface.encodeFunctionData('execute', ['0x10', [input], deadline]);
try {
  const g = await p.estimateGas({ from: FROM, to: ROUTER, data, value: amountIn });
  console.log('simulated swap from', FROM, 'OK, gas', g.toString());
} catch (e) {
  console.log('simulated swap FAILED:', e.shortMessage ?? e.message);
}
