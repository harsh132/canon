// Creates a wallet in a fresh profile and waits for the first RAILGUN sync.
//   CANON_PROFILE=/some/new/dir bun scripts/e2e-create.mjs
import { fileURLToPath } from 'node:url';
import { createWallet, launch } from './smoke.mjs';

// fileURLToPath, not .pathname: on Windows the pathname starts /C:/.
const shot = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const PASSWORD = process.env.CANON_PASSWORD ?? 'correct horse battery';
const { browser, popup, corePage } = await launch();
corePage.on('requestfailed', (r) => console.log('[net:fail]', r.url().slice(0, 120), r.failure()?.errorText));
corePage.on('response', (r) => {
  if (r.status() >= 400) console.log(`[net:${r.status()}]`, r.url().slice(0, 140));
});
const text = async () => (await popup.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const click = (re) =>
  popup.evaluate((src) => {
    const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src, 'i').test(x.textContent ?? ''));
    if (!b) throw new Error(`no button ${src}`);
    b.click();
  }, re);

const t0 = Date.now();
const phrase = await createWallet(popup, PASSWORD);
console.log('created in', Date.now() - t0, 'ms');
for (let i = 0; i < 50; i += 1) {
  await new Promise((r) => setTimeout(r, 6000));
  const t = await text();
  console.log(`[${Math.round((Date.now() - t0) / 1000)}s]`, t.slice(0, 170));
  if (/Synced|Sync failed|Engine error/i.test(t)) break;
}
await popup.screenshot({ path: shot('../.cache/home.png') });
await click('clear ·');
await popup.waitForFunction(() => /network reads/i.test(document.body.innerText), { timeout: 5000 });
console.log('privacy:', (await text()).slice(0, 220));
await popup.screenshot({ path: shot('../.cache/privacy.png') });

// Custom token: look up Sepolia LINK through Nox, add it, see it in Send, remove it.
const LINK = '0x779877A7B0D9E8603169DdbD7836e478b4624789';
const until = (re, timeout = 90000) => popup.waitForFunction((src) => new RegExp(src, 'i').test(document.body.innerText), { timeout }, re);
const openTokens = async () => {
  await popup.click('button[title="Menu"]');
  await click('^Tokens$');
  await until('Add token');
};
await openTokens();
await popup.type('input[placeholder="0x…"]', '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14');
await click('^Look up$');
await until('Already in the list');
console.log('tokens: built-in WETH refused');
await popup.$eval('input[placeholder="0x…"]', (el) => el.select());
await popup.type('input[placeholder="0x…"]', LINK);
const t1 = Date.now();
await click('^Look up$');
await until('Add LINK');
console.log('tokens: looked up LINK in', Date.now() - t1, 'ms');
await click('^Add LINK$');
await until('· added');
await click('^Balances$');
await until('public');
console.log('tokens: Main public balances read');
await popup.screenshot({ path: shot('../.cache/tokens.png') });
await click('^Send$');
await until('Token');
const options = await popup.$$eval('select option', (os) => os.map((o) => o.textContent));
if (!options.some((o) => /^LINK · /.test(o))) throw new Error(`LINK missing from Send: ${options.join(', ')}`);
console.log('tokens: Send offers', options.filter((o) => !/^(Private|Main) /.test(o)).join(', '));
await openTokens();
await click('^Remove$');
await popup.waitForFunction(() => !/· added/.test(document.body.innerText), { timeout: 10000 });
console.log('tokens: removed');
await browser.close();
