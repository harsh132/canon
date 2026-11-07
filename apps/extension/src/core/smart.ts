// Gasless dapp transactions for site addresses, through EIP-7702 and Uniswap's
// Calibur smart-account implementation.
//
// A site's address delegates to Calibur once (an EIP-7702 authorization the
// sponsor submits with the first call). After that, every dapp transaction is a
// Calibur SignedBatchedCall: this wallet signs it with the address's own key
// (keyHash 0 = the root key), restricted to our sponsor as executor, and the
// sponsor submits it and pays gas. On-chain the calls come from the site's own
// address, so the dapp sees the sender it expects.
//
// Security rule: the wallet delegates only its own site addresses, only to
// CALIBUR. Dapp-requested delegations are still refused (sign.ts). Calls back
// into the account itself or to address(0) are refused: as the root key they
// could register new keys on the account.
import { AbiCoder, Contract, ZeroHash, getAddress, zeroPadValue } from 'ethers';
import type { AccountSigner } from './book';
import { SEPOLIA_ID, sepolia } from './config';
import { privateFetch, replyJson } from './transport';

export const CALIBUR = '0x000000009B1D0aF20D8C6d0A44e162d11F9b8f00';
const SPONSOR_URL = process.env.CANON_SPONSOR_URL || 'http://127.0.0.1:8792';
const ENTRY_POINT_V08 = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108';

export type Call = { to: string; value: bigint; data: string };

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

export const isDelegated = async (address: string): Promise<boolean> => {
  const code = (await sepolia().getCode(address)).toLowerCase();
  return code === `0xef0100${CALIBUR.slice(2).toLowerCase()}`;
};

let sponsorAddress: string | null = null;
const sponsor = async (): Promise<string> => {
  if (sponsorAddress) return sponsorAddress;
  const res = await privateFetch(`${SPONSOR_URL}/health`);
  if (!res.ok) throw new Error('Sponsor unreachable');
  sponsorAddress = getAddress((await replyJson<{ sponsor: string }>(res, 'Sponsor')).sponsor);
  return sponsorAddress;
};

const checkCalls = (account: string, calls: Call[]): void => {
  if (calls.length === 0 || calls.length > 10) throw new Error('1–10 calls per request');
  for (const c of calls) {
    const to = getAddress(c.to);
    if (to === getAddress(account) || to === '0x0000000000000000000000000000000000000000' || to === getAddress(ENTRY_POINT_V08)) {
      throw new Error('Refusing a call into the account itself');
    }
  }
};

/**
 * Executes `calls` from the signer's address, gas paid by the sponsor.
 * Returns the transaction hash. Delegates the address to Calibur first if needed,
 * in the same transaction.
 */
export const sponsoredExecute = async (signer: AccountSigner, calls: Call[]): Promise<string> => {
  const account = signer.address;
  checkCalls(account, calls);
  const provider = sepolia();
  const delegated = await isDelegated(account);
  const executor = await sponsor();

  // Nonce key 0; sequence from the account once it runs Calibur.
  const nonce = delegated
    ? ((await new Contract(account, ['function getSeq(uint256) view returns (uint256)'], provider).getSeq(0n)) as bigint)
    : 0n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
  // Calibur's EIP-712 domain: the account itself is the verifying contract, and
  // the salt packs a prefix (0 until updateSalt) with the implementation address.
  const domain = { name: 'Calibur', version: '1.0.0', chainId: SEPOLIA_ID, verifyingContract: account, salt: zeroPadValue(CALIBUR, 32) };
  const value = {
    batchedCall: { calls: calls.map((c) => ({ to: getAddress(c.to), value: c.value, data: c.data || '0x' })), revertOnFailure: true },
    nonce,
    keyHash: ZeroHash,
    executor,
    deadline,
  };
  const signature = await signer.signTypedData(domain, TYPES, value);
  const wrappedSignature = AbiCoder.defaultAbiCoder().encode(['bytes', 'bytes'], [signature, '0x']);

  let authorization: Record<string, string> | undefined;
  if (!delegated) {
    const auth = await signer.authorize({ address: CALIBUR, chainId: SEPOLIA_ID, nonce: await provider.getTransactionCount(account) });
    authorization = {
      address: auth.address,
      chainId: auth.chainId.toString(),
      nonce: auth.nonce.toString(),
      r: auth.signature.r,
      s: auth.signature.s,
      yParity: String(auth.signature.yParity),
    };
  }

  const res = await privateFetch(`${SPONSOR_URL}/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chainId: SEPOLIA_ID,
      account,
      calls: value.batchedCall.calls.map((c) => ({ to: c.to, value: c.value.toString(), data: c.data })),
      nonce: nonce.toString(),
      executor,
      deadline: deadline.toString(),
      signature: wrappedSignature,
      authorization,
    }),
  });
  const body = await replyJson<{ hash?: string; error?: string }>(res, 'Sponsor');
  if (!res.ok || !body.hash) throw new Error(body.error ?? `Sponsor error ${res.status}`);
  return body.hash;
};
