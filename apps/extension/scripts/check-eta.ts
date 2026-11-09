// The spendable-countdown estimate (src/shared/eta.ts). No network, no browser.
//   bun scripts/check-eta.ts
import assert from 'node:assert/strict';
import { etaText, pendingEta } from '../src/shared/eta';

const HOLD = 12 * 60_000;
const now = 1_800_000_000_000;
const shield = (ageMs: number) => ({ shield: true, at: (now - ageMs) / 1000 });

// No data: no pending notes, no hold known for the network, or no block time.
assert.equal(pendingEta([], HOLD), null);
assert.equal(pendingEta([shield(0)], undefined), null);
assert.equal(pendingEta([{ shield: true, at: 0 }], HOLD), null);
assert.equal(etaText(null, now), null);

// Hold running: whole minutes, rounded up.
assert.equal(etaText(pendingEta([shield(0)], HOLD), now), 'Spendable in about 12 min');
assert.equal(etaText(pendingEta([shield(60_000)], HOLD), now), 'Spendable in about 11 min');
assert.equal(etaText(pendingEta([shield(HOLD - 1)], HOLD), now), 'Spendable in about 1 min');

// The oldest shield decides.
assert.equal(etaText(pendingEta([shield(0), shield(10 * 60_000)], HOLD), now), 'Spendable in about 2 min');

// Hold over, proof of innocence still pending: never zero, never negative.
assert.equal(etaText(pendingEta([shield(HOLD)], HOLD), now), 'Clearing proof of innocence');
assert.equal(etaText(pendingEta([shield(HOLD + 3_600_000)], HOLD), now), 'Clearing proof of innocence');

// A note from a private send has no hold; a shield with no data adds nothing.
assert.equal(etaText(pendingEta([{ shield: false, at: 0 }], undefined), now), 'Clearing proof of innocence');
assert.equal(etaText(pendingEta([{ shield: true, at: 0 }, shield(0)], HOLD), now), 'Spendable in about 12 min');

// The popup's minute tick: the text counts down from the stored time alone.
const eta = pendingEta([shield(0)], HOLD);
assert.equal(etaText(eta, now + 5 * 60_000), 'Spendable in about 7 min');
assert.equal(etaText(eta, now + HOLD), 'Clearing proof of innocence');

console.log('pass  eta');
