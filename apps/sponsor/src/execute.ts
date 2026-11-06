// Sponsored execution for site addresses that run Uniswap's Calibur through
// EIP-7702. The wallet signs a Calibur SignedBatchedCall with the account's own
// key and names this sponsor as the only allowed executor; the sponsor submits
// it and pays gas. The first call can carry the account's EIP-7702
// authorization (delegating to Calibur), sent as a type-4 transaction.
//
// Testnet only as written: no fee is charged, so caps keep abuse down.
import { Interface, Signature, ZeroHash, getAddress, verifyAuthorization, type Wallet } from 'ethers';
import { RelayError, priceFor } from './relay';

export const CALIBUR = '0x000000009B1D0aF20D8C6d0A44e162d11F9b8f00';
const ENTRY_POINT_V08 = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108';
const CHAIN_ID = 11155111;
const MAX_GAS = 3_000_000n;
const MAX_PER_HOUR = 60;

const calibur = new Interface([
  'function execute((((address to,uint256 value,bytes data)[] calls,bool revertOnFailure) batchedCall,uint256 nonce,bytes32 keyHash,address executor,uint256 deadline) signedBatchedCall, bytes wrappedSignature) payable',
]);

const sent: number[] = [];

type Body = {
  chainId?: number;
  account?: string;
  calls?: { to: string; value: string; data: string }[];
  nonce?: string;
  executor?: string;
  deadline?: string;
  signature?: string;
  authorization?: { address: string; chainId: string; nonce: string; r: string; s: string; yParity: string };
};

export const execute = async (sponsor: Wallet, body: Body): Promise<{ hash: string; delegated: boolean }> => {
  const provider = sponsor.provider!;
  if (body.chainId !== CHAIN_ID) throw new RelayError(400, 'Sepolia only');
  const account = getAddress(String(body.account ?? ''));
  if (getAddress(String(body.executor ?? '')) !== sponsor.address) throw new RelayError(400, 'Executor must be this sponsor');
  const calls = body.calls ?? [];
  if (calls.length === 0 || calls.length > 10) throw new RelayError(400, '1–10 calls');
  for (const c of calls) {
    const to = getAddress(c.to);
    if (to === account || to === '0x0000000000000000000000000000000000000000' || to === getAddress(ENTRY_POINT_V08)) {
      throw new RelayError(400, 'No calls into the account itself');
    }
  }
  const deadline = BigInt(body.deadline ?? '0');
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (deadline <= now || deadline > now + 3600n) throw new RelayError(400, 'Deadline out of range');

  // Either already Calibur, or bringing a valid authorization to become Calibur.
  const code = (await provider.getCode(account)).toLowerCase();
  const delegated = code === `0xef0100${CALIBUR.slice(2).toLowerCase()}`;
  let authorizationList: { address: string; nonce: bigint; chainId: bigint; signature: Signature }[] | undefined;
  if (!delegated) {
    if (code !== '0x') throw new RelayError(400, 'Account has other code');
    const a = body.authorization;
    if (!a || getAddress(a.address) !== getAddress(CALIBUR) || BigInt(a.chainId) !== BigInt(CHAIN_ID)) {
      throw new RelayError(400, 'Needs an authorization to Calibur on Sepolia');
    }
    const signature = Signature.from({ r: a.r, s: a.s, yParity: Number(a.yParity) as 0 | 1 });
    const auth = { address: getAddress(a.address), nonce: BigInt(a.nonce), chainId: BigInt(a.chainId) };
    if (getAddress(verifyAuthorization(auth, signature)) !== account) throw new RelayError(400, 'Authorization not signed by the account');
    authorizationList = [{ ...auth, signature }];
  }

  const now2 = Date.now();
  while (sent.length && sent[0] < now2 - 3_600_000) sent.shift();
  if (sent.length >= MAX_PER_HOUR) throw new RelayError(429, 'Busy; try later');

  const data = calibur.encodeFunctionData('execute', [
    [[calls.map((c) => [getAddress(c.to), BigInt(c.value), c.data]), true], BigInt(body.nonce ?? '0'), ZeroHash, sponsor.address, deadline],
    String(body.signature ?? '0x'),
  ]);
  const maxFeePerGas = await priceFor(provider, 0n);
  const tip = BigInt(await (provider as unknown as { send: (m: string, p: unknown[]) => Promise<string> }).send('eth_maxPriorityFeePerGas', []).catch(() => '0x1'));
  const base = { to: account, data, maxFeePerGas, maxPriorityFeePerGas: tip > maxFeePerGas ? maxFeePerGas : tip };
  const tx = authorizationList ? { ...base, type: 4, authorizationList } : { ...base, type: 2 };

  // Simulate first, so the sponsor never pays for a revert (bad signature, failing call).
  let gas: bigint;
  try {
    gas = await provider.estimateGas({ ...tx, from: sponsor.address });
  } catch (e) {
    throw new RelayError(400, `Would revert: ${((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).slice(0, 200)}`);
  }
  if (gas > MAX_GAS) throw new RelayError(400, 'Too much gas');
  const res = await sponsor.sendTransaction({ ...tx, gasLimit: (gas * 13n) / 10n });
  sent.push(now2);
  return { hash: res.hash, delegated };
};
