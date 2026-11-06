// Creates a wallet in a fresh profile and waits for the first RAILGUN sync.
//   PANGOLIN_PROFILE=/some/new/dir bun scripts/e2e-create.mjs
import { launch } from './smoke.mjs';

const PASSWORD = process.env.PANGOLIN_PASSWORD ?? 'correct horse battery';
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

await popup.waitForSelector('input[type=password]');
const pw = await popup.$$('input[type=password]');
await pw[0].type(PASSWORD);
await pw[1].type(PASSWORD);
const t0 = Date.now();
await click('^create$');
await popup.waitForFunction(() => /saved it/i.test(document.body.innerText), { timeout: 60000 });
console.log('created in', Date.now() - t0, 'ms');
await click('saved it');
for (let i = 0; i < 50; i += 1) {
  await new Promise((r) => setTimeout(r, 6000));
  const t = await text();
  console.log(`[${Math.round((Date.now() - t0) / 1000)}s]`, t.slice(0, 170));
  if (/Synced|Sync failed|Engine error/i.test(t)) break;
}
await popup.screenshot({ path: new URL('../.cache/home.png', import.meta.url).pathname });
await browser.close();
