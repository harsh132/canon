// Creates a wallet in a fresh profile and waits for the first RAILGUN sync.
//   CANON_PROFILE=/some/new/dir bun scripts/e2e-create.mjs
import { createWallet, launch } from './smoke.mjs';

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
await popup.screenshot({ path: new URL('../.cache/home.png', import.meta.url).pathname });
await click('clear ·');
await popup.waitForFunction(() => /network reads/i.test(document.body.innerText), { timeout: 5000 });
console.log('privacy:', (await text()).slice(0, 220));
await popup.screenshot({ path: new URL('../.cache/privacy.png', import.meta.url).pathname });
await browser.close();
