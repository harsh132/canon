// Prints proof-of-innocence state for the Sepolia test wallet. Needs a --dev build.
//   bun scripts/poi-probe.mjs
import { launch } from './smoke.mjs';

process.env.PANGOLIN_PROFILE ??= new URL('../.cache/sepolia/profile', import.meta.url).pathname;
const { browser, popup, corePage } = await launch();
const text = async () => (await popup.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
await popup.waitForFunction(() => /password/i.test(document.body.innerText), { timeout: 30000 });
await (await popup.$('input[type=password]')).type('pangolin sepolia test');
await popup.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^unlock$/i.test(b.textContent.trim())).click());
await popup.waitForFunction(() => /Synced|Sync failed/i.test(document.body.innerText), { timeout: 600000, polling: 1000 });
console.log('[probe] home:', (await text()).slice(0, 160));
const out = await corePage.evaluate(async () => {
  const d = globalThis.__railgunDebug;
  const safe = async (f) => {
    try {
      return await f();
    } catch (e) {
      return `ERR ${e?.message ?? e}`;
    }
  };
  return JSON.stringify(
    {
      buckets: d.buckets(),
      pendingTxids: await safe(d.pendingTxids),
      spent: await safe(d.spent),
      received: await safe(d.received),
    },
    (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
    1,
  );
});
console.log(out.slice(0, 4000));
await browser.close();
process.exit(0);
