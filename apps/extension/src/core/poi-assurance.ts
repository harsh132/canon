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
//
// It can only do that while the core runs. Each job is saved in the encrypted book
// first and removed when done, so a wallet closed or locked mid-way resumes it
// after the next unlock (resumePOI) instead of leaving the notes on the slow route.
import {
  POINodeRequest,
  POIValidator,
  getRailgunTransactionsForTxid,
  walletForID,
  ByteLength,
  ByteUtils,
} from '@railgun-community/wallet';
import { TXIDVersion, type PreTransactionPOIsPerTxidLeafPerList } from '@railgun-community/shared-models';
import type { ContractTransaction } from 'ethers';
import { CHAIN, POI_NODES } from './config';
import { currentWalletId, sync } from './railgun';
import { dropPendingPOI, pendingPOIs, savePendingPOI } from './book';
import { decode, encode } from '../shared/codec';

const V2 = TXIDVersion.V2_PoseidonMerkle;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Job = {
  txHash: string;
  transaction: ContractTransaction;
  useRelayAdapt: boolean;
  pois: PreTransactionPOIsPerTxidLeafPerList;
  /** When the send went out; a job older than MAX_AGE_MS is dropped on resume. */
  at: number;
};

// ponytail: a node error on submit counts as "try again"; a job the node keeps
// refusing retries on each unlock until MAX_AGE_MS. Parse node errors if that matters.
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const running = new Set<string>();
const log = (...a: unknown[]) => console.log('[poi-assurance]', ...a);

export const assurePOI = async (p: Omit<Job, 'at'> & { at?: number }): Promise<void> => {
  const job: Job = { ...p, at: p.at ?? Date.now() };
  if (running.has(job.txHash)) return;
  running.add(job.txHash);
  try {
    await savePendingPOI(job.txHash, encode(job));
    if (await run(job)) await dropPendingPOI(job.txHash);
  } catch (e) {
    console.warn('[poi-assurance]', (e as Error).message);
  } finally {
    running.delete(job.txHash);
  }
};

/** After unlock, once the RAILGUN wallet is open and synced: finish the jobs a closed wallet left. */
export const resumePOI = async (): Promise<void> => {
  for (const saved of pendingPOIs()) {
    const job = decode<Job>(saved);
    if (Date.now() - job.at > MAX_AGE_MS) {
      log('dropped a job older than 7 days', job.txHash);
      await dropPendingPOI(job.txHash);
      continue;
    }
    log('resuming', job.txHash);
    void assurePOI(job);
  }
};

/** True when the job is finished: submitted, or it can never succeed. False: try again later. */
const run = async (p: Job): Promise<boolean> => {
  try {
    // Same check a broadcaster runs; it also extracts the first output's data.
    // A 7702 unshield (type 4) goes to the delegated ephemeral account, not to a RAILGUN
    // contract, so POIValidator's address check fails; check it against its own target.
    const is7702 = !!(p.transaction as { authorizationList?: unknown[] }).authorizationList?.length;
    const { isValid, error, extractedRailgunTransactionData } = is7702
      ? await walletForID(currentWalletId()).isValidSpendableTransaction(V2, CHAIN, p.transaction.to as string, p.transaction, true, p.pois, true)
      : await POIValidator.isValidSpendableTransaction(currentWalletId(), V2, CHAIN, p.transaction, p.useRelayAdapt, p.pois);
    if (!isValid) {
      log('own POIs invalid:', error);
      return true;
    }
    const first = extractedRailgunTransactionData?.find((d) => d.firstCommitment && d.firstCommitmentNotePublicKey != null);
    if (!first) {
      log('first output is not ours; nothing to submit');
      return true;
    }

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

      // A single commitment proof clears only the output it names. A broadcaster
      // needs only its fee note; we need the payment and the change too. Every
      // output this wallet received from the send gets its own submission, with
      // its note key and position from the wallet's synced notes.
      await sync();
      const sameTx = (a: string) => a.replace(/^0x/, '').toLowerCase() === p.txHash.replace(/^0x/, '').toLowerCase();
      const txos = await walletForID(currentWalletId()).TXOs(V2, CHAIN);
      for (const txo of txos) {
        if (!sameTx(txo.txid) || txo.tree !== tx.utxoTreeOut) continue;
        const index = txo.position - tx.utxoBatchStartPositionOut;
        if (index <= 0 || index >= tx.commitments.length) continue; // 0 is the one already sent
        await node
          .submitSingleCommitmentProof(V2, CHAIN, {
            commitment: tx.commitments[index],
            npk: ByteUtils.nToHex(txo.note.notePublicKey, ByteLength.UINT_256, true),
            utxoTreeIn: Number(first.utxoTreeIn),
            utxoTreeOut: tx.utxoTreeOut,
            utxoPositionOut: txo.position,
            railgunTxid: first.railgunTxid,
            pois: p.pois,
          })
          .then(
            () => log('submitted output', index),
            (e: unknown) => log('output', index, 'rejected:', (e as Error).message),
          );
      }
      await sleep(15_000);
      await sync();
      return true;
    }
    log('gave up waiting for the index; trying again after the next unlock');
    return false;
  } catch (e) {
    // Locked mid-way, or a network or node error: keep the job for the next unlock.
    console.warn('[poi-assurance]', (e as Error).message);
    return false;
  }
};
