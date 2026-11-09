// Screenshots Home with activity and the full Activity screen (dark) into .cache/activity-shots/.
// Needs a --dev build: it plants entries in the core's state, then reloads the popup to get the push.
//   CANON_PROFILE=/new/dir bun scripts/shot-activity.mjs
import { fileURLToPath } from 'node:url';
import { createWallet, launch } from './smoke.mjs';

const { browser, popup, corePage, id } = await launch();
const out = new URL('../.cache/activity-shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
await Bun.write(`${out}.keep`, '');
await popup.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
const click = (re) =>
  popup.evaluate((src) => [...document.querySelectorAll('button')].find((b) => new RegExp(src, 'i').test((b.textContent ?? '').trim())).click(), re);
const waitText = async (re) => { console.log('wait', re); await popup.waitForFunction((src) => new RegExp(src, 'i').test(document.body.innerText), { timeout: 30000, polling: 200 }, re).catch(async (e) => { console.log('TEXT:', (await popup.evaluate(() => document.body.innerText)).replace(/s+/g, ' ').slice(0, 300)); throw e; }); };
const shot = async (name) => {
  await new Promise((r) => setTimeout(r, 400));
  await popup.screenshot({ path: `${out}${name}.png` });
};

await createWallet(popup, 'correct horse battery');
await waitText('private balance');
await waitText('nothing yet');
const now = Date.now();
const h = (n) => `0x${n.toString(16).padStart(64, 'a')}`;
const entries = [
  { id: '1', kind: 'transfer', label: 'Sent privately to alice.canon.eth', amount: '0.0100', hash: h(1), at: now - 60_000, status: 'pending' },
  { id: '2', kind: 'shield', label: 'Made 0.5 ETH private', amount: '0.5000', hash: h(2), at: now - 3_600_000, status: 'done' },
  { id: '3', kind: 'dapp', label: 'app.uniswap.org', hash: h(3), at: now - 7_200_000, status: 'done', chainId: 11155111 },
  { id: '4', kind: 'unshield', label: 'Made 0.2 ETH public', amount: '0.2000', hash: h(4), at: now - 86_400_000, status: 'failed' },
  { id: '5', kind: 'transfer', label: 'Swapped privately WETH → USDC', hash: h(5), at: now - 172_800_000, status: 'done' },
  { id: '6', kind: 'send', label: 'Sent 0.01 ETH to 0xabc…1234', amount: '0.0100', hash: h(6), at: now - 259_200_000, status: 'done' },
];
await corePage.evaluate((e) => (globalThis.__canonState.activity = e), entries);
await popup.goto(`chrome-extension://${id}/popup.html`);
await waitText('see all');
await shot('1-home');
await click('^see all$');
await waitText('done · ');
await shot('2-activity');
const rows = await popup.evaluate(() => [...document.querySelectorAll('a[href*="/tx/"]')].map((a) => a.href));
console.log('explorer links:', rows.length, rows[0]);
await click('^activity$'); // the back button
await waitText('private balance');
console.log('back to Home: ok');
await browser.close();
process.exit(0);
