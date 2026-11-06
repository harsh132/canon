// Sponsored relay: submits a proved RAILGUN transaction from the sponsor's
// address, so no address of the user's appears as its sender. The proof was
// built in broadcaster mode and commits to a minimum gas price, which the
// RAILGUN contract enforces against this transaction's gas price.
//
// Testnet only as written: no fee is charged, so abuse is held back by caps.
// A mainnet version must take a fee in private tokens that covers gas.
import { Signature, getAddress, verifyAuthorization, type Wallet } from 'ethers';

// RAILGUN proxy and Relay Adapt on Sepolia (shared-models NETWORK_CONFIG).
const ALLOWED_TO = new Set(['0xecfcf3b4ec647c4ca6d49108b311b7a7c9543fea', '0x7e3d929ebd5bdc84d02bd3205c777578f33a214d']);
// RAILGUN's EIP-7702 Relay Adapt on Sepolia. The SDK sends base-token unshields
// to a one-off ephemeral address that delegates to it in the same transaction.
const RELAY_ADAPT_7702 = '0x05ae73c5925d843864ae6F261f3175De2ebCd963';
const CHAIN_ID = 11155111;
const MAX_GAS = 4_000_000n;
const MAX_MIN_GAS_PRICE = 100_000_000_000n; // 100 gwei
const MAX_PER_HOUR = 60;

const sent: number[] = [];

/**
 * Legacy gas price that RAILGUN accepts (>= the proof's minGasPrice) and the
 * chain accepts (>= base fee). A node's eth_gasPrice can lag the base fee (seen
 * on Sepolia: 17 wei offered against an 18 wei base fee), so price from the
 * latest block with 2x headroom plus a priority fee.
 */
export const priceFor = async (provider: NonNullable<Wallet['provider']>, minGasPrice: bigint): Promise<bigint> => {
  const block = await provider.getBlock('latest');
  const base = block?.baseFeePerGas ?? 0n;
  const tip = BigInt(await (provider as unknown as { send: (m: string, p: unknown[]) => Promise<string> }).send('eth_maxPriorityFeePerGas', []).catch(() => '0x0'));
  const price = base * 2n + tip;
  return price > minGasPrice ? price : minGasPrice;
};

export class RelayError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const relay = async (
  sponsor: Wallet,
  body: {
    chainId?: number;
    to?: string;
    data?: string;
    minGasPrice?: string;
    authorizationList?: { address: string; chainId: string; nonce: string; r: string; s: string; yParity: string }[];
  },
): Promise<{ hash: string; gasLimit: string }> => {
  if (body.chainId !== CHAIN_ID) throw new RelayError(400, 'Sepolia only');
  const to = String(body.to ?? '').toLowerCase();
  const provider = sponsor.provider!;
  // Either a RAILGUN contract, or an ephemeral that brings its own authorization
  // to RelayAdapt7702, signed by itself, so the code that runs is RAILGUN's.
  let authorizationList: { address: string; nonce: bigint; chainId: bigint; signature: Signature }[] | undefined;
  if (!ALLOWED_TO.has(to)) {
    const list = body.authorizationList ?? [];
    if (list.length !== 1) throw new RelayError(400, 'Only RAILGUN contracts');
    const a = list[0];
    const auth = { address: getAddress(a.address), nonce: BigInt(a.nonce), chainId: BigInt(a.chainId) };
    if (auth.address !== getAddress(RELAY_ADAPT_7702) || auth.chainId !== BigInt(CHAIN_ID)) throw new RelayError(400, 'Only RelayAdapt7702 authorizations');
    const signature = Signature.from({ r: a.r, s: a.s, yParity: Number(a.yParity) as 0 | 1 });
    if (getAddress(verifyAuthorization(auth, signature)) !== getAddress(to)) throw new RelayError(400, 'Authorization not signed by the target');
    const code = (await provider.getCode(to)).toLowerCase();
    if (code !== '0x' && code !== `0xef0100${RELAY_ADAPT_7702.slice(2).toLowerCase()}`) throw new RelayError(400, 'Target has other code');
    authorizationList = [{ ...auth, signature }];
  }
  const data = String(body.data ?? '');
  if (!/^0x[0-9a-f]+$/i.test(data) || data.length < 10) throw new RelayError(400, 'Bad calldata');
  let minGasPrice: bigint;
  try {
    minGasPrice = BigInt(body.minGasPrice ?? '');
  } catch {
    throw new RelayError(400, 'Bad minGasPrice');
  }
  if (minGasPrice < 0n || minGasPrice > MAX_MIN_GAS_PRICE) throw new RelayError(400, 'minGasPrice out of range');

  const now = Date.now();
  while (sent.length && sent[0] < now - 3_600_000) sent.shift();
  if (sent.length >= MAX_PER_HOUR) throw new RelayError(429, 'Relay busy; try later');

  // Simulate first, at the real gas price (the contract checks it): never pay for a revert.
  let gas: bigint;
  const gasPrice = await priceFor(provider, minGasPrice);
  // Type 4 is EIP-1559 priced. Tip = cap, so the effective price is exactly gasPrice,
  // which RAILGUN checks against the proof's minimum.
  const priced = authorizationList
    ? { type: 4, authorizationList, maxFeePerGas: gasPrice, maxPriorityFeePerGas: gasPrice }
    : { type: 0, gasPrice };
  try {
    gas = await provider.estimateGas({ from: sponsor.address, to, data, ...priced });
  } catch (e) {
    throw new RelayError(400, `Would revert: ${((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).slice(0, 160)}`);
  }
  if (gas > MAX_GAS) throw new RelayError(400, 'Too much gas');

  const gasLimit = (gas * 12n) / 10n;
  const tx = await sponsor.sendTransaction({ to, data, gasLimit, ...priced });
  sent.push(now);
  return { hash: tx.hash, gasLimit: gasLimit.toString() };
};
