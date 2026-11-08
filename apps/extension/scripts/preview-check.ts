// Checks the transaction preview (src/core/preview.ts) against live Sepolia,
// read directly (not through Nox): this is a test of the parsing, not of privacy.
//   bun scripts/preview-check.ts
import { Interface, JsonRpcProvider, MaxUint256, parseEther } from 'ethers';
import { simulate } from '../src/core/preview';

const SEPOLIA = 11155111;
const WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const RICH = '0x000000000000000000000000000000000000dEaD';
const EMPTY = '0x00000000000000000000000000000000c0ffee01';
const SPENDER = '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD';
const p = new JsonRpcProvider(process.env.CANON_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com', SEPOLIA, { staticNetwork: true });
const erc20 = new Interface(['function approve(address,uint256)', 'function transfer(address,uint256)', 'function deposit()']);
const hex = (v: bigint) => `0x${v.toString(16)}`;

let fails = 0;
const check = (name: string, ok: boolean, got: unknown) => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok ? '' : `\n      ${JSON.stringify(got)}`}`);
  if (!ok) fails += 1;
};

const wrap = await simulate(p, SEPOLIA, RICH, [{ to: WETH, value: hex(parseEther('0.01')), data: erc20.encodeFunctionData('deposit') }]);
check('wrap: −0.01 ETH, +0.01 WETH', wrap.ok === true && wrap.changes.some((c) => c.text === '−0.01 ETH' && !c.in) && wrap.changes.some((c) => c.text === '+0.01 WETH' && c.in), wrap);
check('wrap: decoded', wrap.calls[0] === 'Wrap 0.01 ETH into WETH', wrap.calls);

const approve = await simulate(p, SEPOLIA, EMPTY, [{ to: USDC, data: erc20.encodeFunctionData('approve', [SPENDER, MaxUint256]) }]);
check('unlimited approval: danger warning', approve.ok === true && approve.warnings.some((w) => w.danger && w.text.startsWith('Unlimited USDC')), approve);
check('unlimited approval: decoded', approve.calls[0].startsWith('Allow 0x3fC9') && approve.calls[0].endsWith('unlimited USDC'), approve.calls);

const broke = await simulate(p, SEPOLIA, EMPTY, [{ to: USDC, data: erc20.encodeFunctionData('transfer', [SPENDER, 10n ** 12n]) }]);
check('transfer without funds: would fail', broke.ok === false && broke.warnings[0]?.danger && broke.warnings[0].text.startsWith('Would fail'), broke);

const send = await simulate(p, SEPOLIA, RICH, [{ to: EMPTY, value: hex(parseEther('0.002')) }]);
check('plain send: −0.002 ETH', send.ok === true && send.changes.length === 1 && send.changes[0].text === '−0.002 ETH', send);

const batch = await simulate(p, SEPOLIA, RICH, [
  { to: WETH, value: hex(parseEther('0.003')), data: erc20.encodeFunctionData('deposit') },
  { to: WETH, data: erc20.encodeFunctionData('transfer', [EMPTY, parseEther('0.001')]) },
]);
check('batch: net −0.003 ETH, +0.002 WETH', batch.ok === true && batch.changes.some((c) => c.text === '−0.003 ETH') && batch.changes.some((c) => c.text === '+0.002 WETH'), batch);

console.log(fails ? `${fails} failed` : 'all pass');
process.exit(fails ? 1 : 0);
