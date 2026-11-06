// Sponsored relay: submits a proved RAILGUN transaction from the sponsor's
// address, so no address of the user's appears as its sender. The proof was
// built in broadcaster mode and commits to a minimum gas price, which the
// RAILGUN contract enforces against this transaction's gas price.
//
// Testnet only as written: no fee is charged, so abuse is held back by caps.
// A mainnet version must take a fee in private tokens that covers gas.
import type { Wallet } from 'ethers';

// RAILGUN proxy and Relay Adapt on Sepolia (shared-models NETWORK_CONFIG).
const ALLOWED_TO = new Set(['0xecfcf3b4ec647c4ca6d49108b311b7a7c9543fea', '0x7e3d929ebd5bdc84d02bd3205c777578f33a214d']);
const CHAIN_ID = 11155111;
const MAX_GAS = 4_000_000n;
const MAX_MIN_GAS_PRICE = 100_000_000_000n; // 100 gwei
const MAX_PER_HOUR = 60;

const sent: number[] = [];

export class RelayError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const relay = async (
  sponsor: Wallet,
  body: { chainId?: number; to?: string; data?: string; minGasPrice?: string },
): Promise<{ hash: string; gasLimit: string }> => {
  if (body.chainId !== CHAIN_ID) throw new RelayError(400, 'Sepolia only');
  const to = String(body.to ?? '').toLowerCase();
  if (!ALLOWED_TO.has(to)) throw new RelayError(400, 'Only RAILGUN contracts');
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

  const provider = sponsor.provider!;
  // Simulate first: the sponsor must never pay for a transaction that reverts.
  let gas: bigint;
  try {
    gas = await provider.estimateGas({ from: sponsor.address, to, data });
  } catch (e) {
    throw new RelayError(400, `Would revert: ${((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).slice(0, 160)}`);
  }
  if (gas > MAX_GAS) throw new RelayError(400, 'Too much gas');

  const network = (await provider.getFeeData()).gasPrice ?? minGasPrice;
  // Legacy gas price: RAILGUN checks tx.gasprice >= the proof's minGasPrice.
  const gasPrice = network > minGasPrice ? network : minGasPrice;
  const gasLimit = (gas * 12n) / 10n;
  const tx = await sponsor.sendTransaction({ to, data, gasLimit, gasPrice, type: 0 });
  sent.push(now);
  return { hash: tx.hash, gasLimit: gasLimit.toString() };
};
