// POI assurance survives a closed wallet (src/core/poi-assurance.ts): a job is saved
// before it runs, dropped only when every owned output is accepted, resumed after unlock
// on its own network, and run once at a time. RAILGUN, the POI node and the book are
// fakes. No network, no browser.
//   bun scripts/check-poi-resume.ts
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { decode, encode } from '../src/shared/codec';

// Sleeps in the job's wait loop return at once.
(globalThis as { setTimeout: unknown }).setTimeout = (fn: () => void) => (queueMicrotask(fn), 0);

const book = new Map<string, string>();
let unlocked = true;
let valid = true;
let indexed = true;
let rejectOutput = false;
let gate: Promise<void> | null = null;
let failOnce = false;
const submitted: string[] = [];
let runs = 0;
let lastTx: { value?: unknown } = {};
// The wallet's own note at position 1 of each transaction: its change.
let txos: { txid: string; tree: number; position: number; note: { notePublicKey: bigint } }[] = [];

mock.module('../src/core/book', () => ({
  pendingPOIs: () => [...book.values()],
  savePendingPOI: async (h: string, j: string) => {
    if (!unlocked) throw new Error('Wallet is locked');
    book.set(h, j);
  },
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
      if (gate) await gate;
      if (!unlocked) throw new Error('Wallet is locked');
      if (failOnce) {
        failOnce = false;
        throw new Error('node network timeout');
      }
      // The SDK turns a node timeout into this result too.
      return valid ? { isValid: true, extractedRailgunTransactionData: [first] } : { isValid: false, error: 'node network timeout' };
    },
  },
  walletForID: () => ({ TXOs: async () => txos }),
  getRailgunTransactionsForTxid: async () => (indexed ? [{ commitments: ['0xc0', '0xc1'], utxoTreeOut: 0, utxoBatchStartPositionOut: 0 }] : []),
  POINodeRequest: class {
    submitSingleCommitmentProof = async (_v: unknown, _c: unknown, p: { commitment: string }) => {
      if (rejectOutput && p.commitment === '0xc1') throw new Error('node timeout');
      submitted.push(p.commitment);
    };
  },
  ByteLength: { UINT_256: 32 },
  ByteUtils: { nToHex: (n: bigint) => `0x${n.toString(16)}` },
}));

const { assurePOI, resumePOI } = await import('../src/core/poi-assurance');
// A transaction with a bigint, as ethers gives it: the saved job must survive the round trip.
const job = (txHash: string, extra: Record<string, unknown> = {}) => ({
  txHash,
  transaction: { to: '0xaa', data: '0x', value: 5n } as never,
  useRelayAdapt: false,
  pois: {},
  ...extra,
});
const ownChange = (txHash: string) => (txos = [{ txid: txHash, tree: 0, position: 1, note: { notePublicKey: 2n } }]);
const settle = async (n = 50) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => queueMicrotask(() => r(null)));
};
const saved = (h: string) => decode<{ done: string[]; chainId: number }>(book.get(h)!);

// Finished: the first output and the change accepted, then dropped from the book.
ownChange('0x1');
await assurePOI(job('0x1'));
assert.deepEqual(submitted, ['0xc0', '0xc1']);
assert.equal(book.size, 0, 'a job with every owned output accepted is dropped');

// "Invalid" (a node timeout looks the same): kept.
valid = false;
await assurePOI(job('0x2'));
assert.ok(book.has('0x2'), 'a job that did not validate is kept');
valid = true;
book.delete('0x2');

// A rejected change proof: kept, with the first output marked done.
submitted.length = 0;
ownChange('0x3');
rejectOutput = true;
await assurePOI(job('0x3'));
assert.ok(book.has('0x3'), 'a job with a rejected owned output is kept');
assert.deepEqual(saved('0x3').done, ['0xc0']);
rejectOutput = false;

// Locked mid-way: kept.
unlocked = false;
await assurePOI(job('0x4'));
unlocked = true;
await assurePOI(job('0x4')); // saved while unlocked, then interrupted below
book.set('0x4', encode({ ...job('0x4'), at: Date.now(), chainId: 11155111, done: [] }));

// Another network's job: left alone on this one.
book.set('0x5', encode({ ...job('0x5'), at: Date.now(), chainId: 42161, done: [] }));

// Unlock: 0x3 resumes and sends only the change; 0x4 runs; 0x5 waits; bigints come back.
submitted.length = 0;
ownChange('0x3');
await resumePOI();
await settle();
assert.ok(!book.has('0x3') && !book.has('0x4'), 'resumed jobs finish and are dropped');
assert.ok(submitted.includes('0xc1') && submitted.filter((c) => c === '0xc0').length === 1, 'an accepted proof is not sent again');
assert.ok(book.has('0x5'), "another network's job is kept");
assert.equal(typeof lastTx.value, 'bigint', 'the saved transaction keeps its bigints');
book.delete('0x5');

// Older than 7 days: dropped on resume without running.
book.set('0x6', encode({ ...job('0x6'), at: Date.now() - 8 * 24 * 60 * 60_000, chainId: 11155111, done: [] }));
runs = 0;
await resumePOI();
assert.ok(!book.has('0x6'), 'a job older than 7 days is dropped');
assert.equal(runs, 0, 'and not run');

// One run at a time: a second start during a run does nothing.
runs = 0;
await Promise.all([assurePOI(job('0x7')), assurePOI(job('0x7'))]);
assert.equal(runs, 1, 'the same job runs once at a time');

// An unlock during a run from before the lock: when that run fails, the job starts again.
let open!: () => void;
gate = new Promise((r) => (open = r));
runs = 0;
ownChange('0x8');
const old = assurePOI(job('0x8'));
await settle(5);
await resumePOI(); // an unlock's resume finds it still running
failOnce = true; // and that old run then fails
open();
gate = null;
await old;
await settle();
assert.equal(runs, 2, 'the skipped job ran again after the old run ended');
assert.ok(!book.has('0x8'), 'and finished');

console.log('pass  poi-resume');
