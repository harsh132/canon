// Checks checkToken (src/shared/networks.ts): what Canon accepts from a token contract.
//   bun scripts/check-token.ts
import assert from 'node:assert/strict';
import { SEPOLIA_ID, checkToken } from '../src/shared/networks';

const ANY = '0x779877A7B0D9E8603169DdbD7836e478b4624789';
const WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';
const throws = (symbol: unknown, decimals: unknown, msg: RegExp) => assert.throws(() => checkToken(SEPOLIA_ID, ANY, symbol, decimals), msg);

assert.deepEqual(checkToken(SEPOLIA_ID, ANY, 'LINK', 18n), { symbol: 'LINK', decimals: 18, warning: null });
assert.deepEqual(checkToken(SEPOLIA_ID, ANY, ' DAI ', 18), { symbol: 'DAI', decimals: 18, warning: null });

// A known symbol on another address is marked, whatever its case or punctuation.
for (const fake of ['WETH', 'weth', 'W-ETH', 'USDC', 'ETH', 'u.s.d.c']) {
  const t = checkToken(SEPOLIA_ID, ANY, fake, 6);
  assert.equal(t.symbol, `${fake}?`, fake);
  assert.match(t.warning ?? '', /is not the/, fake);
}
// Lookalikes in other scripts are refused outright (Cyrillic С, zero-width space).
throws('USDС', 6, /not plain text/);
throws('US​DC', 6, /not plain text/);
// The real listed token keeps the list's own symbol, whatever the contract says.
assert.deepEqual(checkToken(SEPOLIA_ID, WETH.toLowerCase(), 'anything', 18), { symbol: 'WETH', decimals: 18, warning: null });

throws('', 18, /not plain text/);
throws(42, 18, /not plain text/);
throws('ABCDEFGHIJKL', 18, /longer than 11/);
throws('<b>', 18.5, /decimals/);
throws('OK', 37, /decimals/);
throws('OK', -1, /decimals/);
throws('OK', 'x', /decimals/);
console.log('check-token: all pass');
