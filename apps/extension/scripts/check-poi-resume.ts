// POI assurance survives a closed wallet (src/core/poi-assurance.ts): a job is saved
// before it runs, dropped only when finished, resumed after unlock, and run once at a
// time. RAILGUN, the POI node and the book are fakes. No network, no browser.
//   bun scripts/check-poi-resume.ts
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { encode } from '../src/shared/codec';

// Sleeps in the job's wait loop return at once.
(globalThis as { setTimeout: unknown }).setTimeout = (fn: () => void) => (queueMicrotask(fn), 0);

const book = new Map<string, string>();
let unlocked = true;
let valid = true;
let indexed = true;
const submitted: string[] = [];
let runs = 0;
let lastTx: { value?: unknown } = {};

mock.module('../src/core/book', () => ({
  pendingPOIs: () => [...book.values()],
  savePendingPOI: async (h: string, j: string) => void book.set(h, j),
  dropPendingPOI: async (h: string) => void book.delete(h),
}));
mock.module('../src/core/railgun', () => ({
  currentWalletId: () => {
    if (!unlocked) throw new Error('Wallet is locked');
    return 'w';
  },
  sync: async () => {},
}));
mock.module('../src/core/config', () => ({ CHAIN: { type: 0, id: 11155111 }, POI_NODES: [] }));
const first = { firstCommitment: '0xc0', firstCommitmentNotePublicKey: 1n, utxoTreeIn: 0n, railgunTxid: '0x01' };
mock.module('@railgun-community/wallet', () => ({
  POIValidator: {
    isValidSpendableTransaction: async (_w: unknown, _v: unknown, _c: unknown, tx: { value?: unknown }) => {
      runs += 1;
      lastTx = tx;
      if (!unlocked) throw new Error('Wallet is locked');
      return valid ? { isValid: true, extractedRailgunTransactionData: [first] } : { isValid: false, error: 'bad proof' };
    },
  },
  walletForID: () => ({ TXOs: async () => [] }),
  getRailgunTransactionsForTxid: async () => (indexed ? [{ commitments: ['0xc0'], utxoTreeOut: 0, utxoBatchStartPositionOut: 0 }] : []),
  POINodeRequest: class {
    submitSingleCommitmentProof = async (_v: unknown, _c: unknown, p: { commitment: string }) => void submitted.push(p.commitment);
  },
  ByteLength: { UINT_256: 32 },
  ByteUtils: { nToHex: (n: bigint) => `0x${n.toString(16)}` },
}));

const { assurePOI, resumePOI } = await import('../src/core/poi-assurance');
// A transaction with a bigint, as ethers gives it: the saved job must survive the round trip.
const job = (txHash: string, at?: number) => ({ txHash, transaction: { to: '0xaa', data: '0x', value: 5n } as never, useRelayAdapt: false, pois: {}, at });
const settle = () => new Promise((r) => queueMicrotask(() => r(null)));

// Finished: submitted, then dropped from the book.
await assurePOI(job('0x1'));
assert.deepEqual(submitted, ['0xc0']);
assert.equal(book.size, 0, 'a submitted job is dropped');

// Never possible (its own POIs invalid): dropped, not retried.
valid = false;
await assurePOI(job('0x2'));
assert.equal(book.size, 0, 'an invalid job is dropped');
valid = true;

// Locked mid-way: kept for the next unlock.
unlocked = false;
await assurePOI(job('0x3'));
assert.ok(book.has('0x3'), 'a job interrupted by a lock is kept');

// Never indexed in this session: kept.
unlocked = true;
indexed = false;
await assurePOI(job('0x4'));
assert.ok(book.has('0x4'), 'a job whose transaction was not indexed yet is kept');
indexed = true;

// Unlock: both resume and finish; the bigint came back as a bigint.
submitted.length = 0;
await resumePOI();
for (let i = 0; i < 50 && book.size; i += 1) await settle();
assert.equal(book.size, 0, 'resumed jobs finish and are dropped');
assert.equal(submitted.length, 2);
assert.equal(typeof lastTx.value, 'bigint', 'the saved transaction keeps its bigints');

// Older than 7 days: dropped on resume without running.
book.set('0x5', encode(job('0x5', Date.now() - 8 * 24 * 60 * 60_000)));
runs = 0;
await resumePOI();
assert.equal(book.size, 0, 'a job older than 7 days is dropped');
assert.equal(runs, 0, 'and not run');

// One run at a time per transaction: a resume during a running job does not start a second.
runs = 0;
const a = assurePOI(job('0x6'));
const b = assurePOI(job('0x6'));
await Promise.all([a, b]);
assert.equal(runs, 1, 'the same job runs once at a time');

console.log('pass  poi-resume');
