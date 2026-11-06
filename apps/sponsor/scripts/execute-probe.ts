// Probe /execute on Sepolia from a fresh, empty address: first call delegates to
// Calibur (type-4), second is a two-call batch on the delegated account.
// Mirrors apps/extension/src/core/smart.ts. Sponsor must be running.
//   bun scripts/execute-probe.ts
import { AbiCoder, Contract, Interface, JsonRpcProvider, Wallet, ZeroHash, zeroPadValue } from 'ethers';

const URL = process.env.SPONSOR_URL ?? 'http://127.0.0.1:8792';
const RPC = process.env.SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const CALIBUR = '0x000000009B1D0aF20D8C6d0A44e162d11F9b8f00';
const WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';
const CHAIN_ID = 11155111;
const provider = new JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
const signer = Wallet.createRandom().connect(provider);
const erc20 = new Interface(['function approve(address,uint256)', 'function allowance(address,address) view returns (uint256)']);
const TYPES = {
  SignedBatchedCall: [
    { name: 'batchedCall', type: 'BatchedCall' },
    { name: 'nonce', type: 'uint256' },
    { name: 'keyHash', type: 'bytes32' },
    { name: 'executor', type: 'address' },
    { name: 'deadline', type: 'uint256' },
  ],
  BatchedCall: [
    { name: 'calls', type: 'Call[]' },
    { name: 'revertOnFailure', type: 'bool' },
  ],
  Call: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
};
const executor = ((await (await fetch(`${URL}/health`)).json()) as { sponsor: string }).sponsor;

const run = async (calls: { to: string; value: bigint; data: string }[]) => {
  const account = signer.address;
  const delegated = (await provider.getCode(account)).toLowerCase() === `0xef0100${CALIBUR.slice(2).toLowerCase()}`;
  const nonce = delegated ? ((await new Contract(account, ['function getSeq(uint256) view returns (uint256)'], provider).getSeq(0n)) as bigint) : 0n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const domain = { name: 'Calibur', version: '1.0.0', chainId: CHAIN_ID, verifyingContract: account, salt: zeroPadValue(CALIBUR, 32) };
  const sig = await signer.signTypedData(domain, TYPES, { batchedCall: { calls, revertOnFailure: true }, nonce, keyHash: ZeroHash, executor, deadline });
  let authorization;
  if (!delegated) {
    const a = await signer.authorize({ address: CALIBUR, chainId: CHAIN_ID, nonce: await provider.getTransactionCount(account) });
    authorization = { address: a.address, chainId: a.chainId.toString(), nonce: a.nonce.toString(), r: a.signature.r, s: a.signature.s, yParity: String(a.signature.yParity) };
  }
  const res = await fetch(`${URL}/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chainId: CHAIN_ID, account, executor, nonce: nonce.toString(), deadline: deadline.toString(),
      calls: calls.map((c) => ({ to: c.to, value: c.value.toString(), data: c.data })),
      signature: AbiCoder.defaultAbiCoder().encode(['bytes', 'bytes'], [sig, '0x']),
      authorization,
    }),
  });
  const body = (await res.json()) as { hash?: string; error?: string };
  if (!body.hash) throw new Error(`execute failed: ${body.error}`);
  const r = await provider.waitForTransaction(body.hash, 1, 180_000);
  console.log(delegated ? 'batch' : 'first (with 7702 authorization)', body.hash, 'status', r?.status, 'from', r?.from);
};

console.log('account', signer.address, 'balance', await provider.getBalance(signer.address));
await run([{ to: WETH, value: 0n, data: erc20.encodeFunctionData('approve', [executor, 1n]) }]);
// The public RPC is load-balanced; wait until the node we hit has the delegation.
for (let i = 0; i < 20 && (await provider.getCode(signer.address)) === '0x'; i += 1) await new Promise((r) => setTimeout(r, 1500));
console.log('code', await provider.getCode(signer.address));
await run([
  { to: WETH, value: 0n, data: erc20.encodeFunctionData('approve', [executor, 2n]) },
  { to: WETH, value: 0n, data: erc20.encodeFunctionData('approve', [CALIBUR, 3n]) },
]);
const weth = new Contract(WETH, erc20, provider);
console.log('allowance to sponsor', await weth.allowance(signer.address, executor), 'to calibur', await weth.allowance(signer.address, CALIBUR));
console.log('balance after', await provider.getBalance(signer.address));
