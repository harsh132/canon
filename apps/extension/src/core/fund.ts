// Fund a site's public address from the private balance: one unshield to that
// address. Private WETH arrives as ETH (what dapps and gas expect); any other
// token arrives as itself. Gas is paid by the sponsor. The SDK makes the send's
// proof-of-innocence proof after a later scan, as for any of this wallet's spends.
//
// What it reveals, by design: that a RAILGUN user sent this amount of this
// token to this address. Not which private balance or which other address.
import {
  gasEstimateForUnprovenUnshield,
  generateUnshieldProof,
  populateProvedUnshield,
} from '@railgun-community/wallet';
import { EVMGasType, TXIDVersion, calculateGasPrice, type TransactionGasDetails } from '@railgun-community/shared-models';
import { getAddress } from 'ethers';
import { NETWORK, WETH, getProvider } from './config';
import { currentWalletId, sync } from './railgun';
import { executeSend } from './send';
import { sponsorRelay } from './ens';
import { recordActivity } from './book';
import { emit, state } from './state';
import type { Unlocked } from './vault';

const V2 = TXIDVersion.V2_PoseidonMerkle;

export const fundSite = async (p: { address: string; token: string; amount: bigint }, u: Unlocked): Promise<{ hash: string }> => {
  const to = getAddress(p.address);
  const bal = state.privateBalances.find((b) => b.token === p.token.toLowerCase());
  if (!bal) throw new Error('No private balance of that token');
  if (p.amount <= 0n) throw new Error('Enter an amount');

  // WETH: the existing "Make public" path unshields it as ETH, sponsored.
  if (p.token.toLowerCase() === WETH.toLowerCase()) {
    const whole = p.amount.toString().padStart(19, '0');
    const asEther = `${whole.slice(0, -18)}.${whole.slice(-18)}`;
    return executeSend({ from: 'private', to, amount: asEther, via: 'sponsor' }, u);
  }

  // Any other token: an ERC-20 unshield to the site's address.
  if (p.amount > bal.spendable) throw new Error(`More than your spendable private ${bal.symbol}`);
  const id = currentWalletId();
  const recipients = [{ tokenAddress: p.token, amount: p.amount, recipientAddress: to }];
  const gasPrice = (await getProvider().getFeeData()).gasPrice ?? 1_000_000_000n;
  const t1 = (gasEstimate: bigint): TransactionGasDetails => ({ evmGasType: EVMGasType.Type1, gasEstimate, gasPrice });
  // Broadcaster mode with no fee note. The estimate runs as a public-wallet one: a
  // broadcaster-mode estimate adds a WETH fee output that this unshield does not have.
  // The sponsor sets the gas itself.
  const fee = undefined;
  const { gasEstimate } = await gasEstimateForUnprovenUnshield(V2, NETWORK, id, u.railgunKey, recipients, [], t1(0n), undefined, true);
  const gd = t1(gasEstimate);
  const minGas = calculateGasPrice(gd);

  state.proof = { label: 'Proving', progress: 0 };
  emit();
  try {
    await generateUnshieldProof(V2, NETWORK, id, u.railgunKey, recipients, [], fee, false, minGas, (x) => {
      state.proof = { label: 'Proving', progress: x / 100 };
      emit();
    });
  } finally {
    state.proof = null;
    emit();
  }
  const populated = await populateProvedUnshield(V2, NETWORK, id, recipients, [], fee, false, minGas, gd);
  const hash = await sponsorRelay(populated.transaction.to as string, populated.transaction.data as string, minGas);
  void recordActivity({ id: hash, kind: 'unshield', label: `Funded ${to.slice(0, 10)}… with ${bal.symbol}`, hash, at: Date.now(), status: 'pending' });
  void getProvider()
    .waitForTransaction(hash, 1, 10 * 60_000)
    .then(() => sync())
    .catch(() => {});
  return { hash };
};
