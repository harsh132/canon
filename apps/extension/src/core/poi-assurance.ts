// Gets a relayed private send's new notes cleared for proof of innocence fast.
//
// Modelled on RAILGUN's public broadcaster (ppoi-safe-broadcaster-example,
// src/server/transactions/poi-assurance.ts). A broadcaster takes the
// pre-transaction POI proofs the wallet attached to the send and, once the
// transaction is indexed, submits them to the PPOI node as a "single commitment
// proof" for the transaction's first output. Those proofs cover every output,
// so the whole transaction clears without waiting for the slow TXID-tree route.
//
// The node keys the submission on the first output's note public key, which
// only that output's receiver can decrypt. So sponsored sends put a 1-wei fee
// note to this wallet first, and this wallet plays the broadcaster's part.
import {
  POINodeRequest,
  POIValidator,
  getRailgunTransactionsForTxid,
  ByteLength,
  ByteUtils,
} from '@railgun-community/wallet';
import { TXIDVersion, type PreTransactionPOIsPerTxidLeafPerList } from '@railgun-community/shared-models';
import type { ContractTransaction } from 'ethers';
import { CHAIN, POI_NODES } from './config';
import { currentWalletId, sync } from './railgun';

const V2 = TXIDVersion.V2_PoseidonMerkle;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const assurePOI = async (p: {
  txHash: string;
  transaction: ContractTransaction;
  useRelayAdapt: boolean;
  pois: PreTransactionPOIsPerTxidLeafPerList;
}): Promise<void> => {
  const log = (...a: unknown[]) => console.log('[poi-assurance]', ...a);
  try {
    // Same check a broadcaster runs; it also extracts the first output's data.
    const { isValid, error, extractedRailgunTransactionData } = await POIValidator.isValidSpendableTransaction(
      currentWalletId(),
      V2,
      CHAIN,
      p.transaction,
      p.useRelayAdapt,
      p.pois,
    );
    if (!isValid) throw new Error(`own POIs invalid: ${error}`);
    const first = extractedRailgunTransactionData?.find((d) => d.firstCommitment && d.firstCommitmentNotePublicKey != null);
    if (!first) throw new Error('first output is not ours; nothing to submit');

    const node = new POINodeRequest(POI_NODES);
    // Wait for the transaction to be indexed, then submit; retry like a broadcaster.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(attempt === 0 ? 20_000 : 45_000);
      const txs = await getRailgunTransactionsForTxid(CHAIN, p.txHash).catch(() => []);
      const tx = txs.find((t) => t.commitments[0] === first.firstCommitment);
      if (!tx) {
        log('not indexed yet', attempt);
        continue;
      }
      await node.submitSingleCommitmentProof(V2, CHAIN, {
        commitment: first.firstCommitment as string,
        npk: ByteUtils.nToHex(first.firstCommitmentNotePublicKey as bigint, ByteLength.UINT_256, true),
        utxoTreeIn: Number(first.utxoTreeIn),
        utxoTreeOut: tx.utxoTreeOut,
        utxoPositionOut: tx.utxoBatchStartPositionOut,
        railgunTxid: first.railgunTxid,
        pois: p.pois,
      });
      log('submitted single commitment proof for', p.txHash);
      await sleep(15_000);
      await sync();
      return;
    }
    log('gave up waiting for the index; the slow route still applies');
  } catch (e) {
    console.warn('[poi-assurance]', (e as Error).message);
  }
};
