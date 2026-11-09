// "No tunnel exits": when every Nox TLS-tunnel exit is down, the status line and the
// Privacy screen say so, and switching to direct clears it. Needs a --dev build.
//   CANON_PROFILE=/new/dir bun scripts/check-no-exits.mjs
import { createWallet, launch } from './smoke.mjs';

const { browser, popup, corePage } = await launch();
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed += 1;
};
const text = () => popup.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
const click = (re) =>
  popup.evaluate((src) => [...document.querySelectorAll('button')].find((b) => new RegExp(src, 'i').test(b.textContent.trim())).click(), re);

await createWallet(popup, 'correct horse battery');
await popup.waitForFunction(() => /private balance/i.test(document.body.innerText), { timeout: 60000 });
check(!/no exits/i.test(await text()), 'status line normal before');

// What transport.ts sets when a Nox call fails with "No exit offers TLS tunnels".
await corePage.evaluate(() => {
  globalThis.__canonState.rpc.mode = 'nox';
  globalThis.__canonState.rpc.noTunnelsAt = Date.now();
  globalThis.__canonEmit();
});
await popup.waitForFunction(() => /no exits/i.test(document.body.innerText), { timeout: 10000 }).catch(() => {});
check(/Nox · no exits/i.test(await text()), 'status line says "Nox · no exits"');

await click('no exits');
await popup.waitForFunction(() => /Network reads/i.test(document.body.innerText), { timeout: 10000 });
check(/no tunnel exits now/i.test(await text()), 'Privacy screen explains it');

await click('^use direct rpc$');
await popup.waitForFunction(() => /route through nox/i.test(document.body.innerText), { timeout: 10000 });
check(!/no tunnel exits now/i.test(await text()), 'direct mode clears it');

await click('^route through nox$');
await browser.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
