// Dapp requests and the side panel: with the requesting tab's panel open, no
// toolbar popup opens and the panel shows the request in full; with no panel,
// the popup opens as before.
//   CANON_PROFILE=/new/dir bun scripts/e2e-panel-prompt.mjs
import { createWallet, launch } from './smoke.mjs';

const PORT = 8801;
const server = Bun.serve({ port: PORT, hostname: '127.0.0.1', fetch: () => new Response('<!doctype html><title>dapp</title><h1>dapp</h1>', { headers: { 'content-type': 'text/html' } }) });

const { browser, popup, id } = await launch();
let fails = 0;
const check = (ok, what, extra = '') => {
  if (!ok) fails += 1;
  console.log(ok ? 'ok  ' : 'FAIL', what, extra);
};
const sw = await (await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'))).worker();
const text = async (p) => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const click = (p, re) =>
  p.evaluate((src) => {
    const b = [...document.querySelectorAll('button')].filter((x) => new RegExp(src, 'i').test((x.textContent ?? '').trim())).pop();
    if (!b) throw new Error(`no button ${src}`);
    b.click();
  }, re);
const badge = () => sw.evaluate(() => chrome.action.getBadgeText({}));
// Any popup.html page that opened after `since` (the toolbar popup, or its window fallback).
const popupsSince = (since) => browser.targets().filter((t) => t.url().includes('/popup.html') && !since.has(t));

await createWallet(popup, 'correct horse battery');
await popup.waitForFunction(() => /private balance/i.test(document.body.innerText), { timeout: 60000 });
// An open popup shows every request itself; close it so only the panel is open.
await popup.close();

const dapp = await browser.newPage();
await dapp.goto(`http://127.0.0.1:${PORT}/`);
// No "tabs" permission, so tab URLs are hidden: the dapp is the active tab right now.
await dapp.bringToFront();
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true })).at(0)?.id);
console.log('[test] dapp tab', tabId);
const rpc = (method, params = []) =>
  dapp.evaluate((m, p) => window.ethereum.request({ method: m, params: p }).then((r) => ({ r }), (e) => ({ code: e.code, message: e.message })), method, params);

// The tab's panel, as the service worker opens it (panel.html?tab=N).
const panel = await browser.newPage();
await panel.setViewport({ width: 380, height: 700 });
await panel.goto(`chrome-extension://${id}/panel.html?tab=${tabId}`);
await panel.waitForFunction(() => /private balance/i.test(document.body.innerText), { timeout: 30000 });

const before = new Set(browser.targets());
const conn = rpc('eth_requestAccounts');
await panel.waitForFunction(() => /^\s*connect\s*$/im.test([...document.querySelectorAll('button')].map((b) => b.textContent).join('\n')), { timeout: 15000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
const shown = await text(panel);
check(!/review/i.test(shown) && /connect/i.test(shown), 'panel open: the connect request shows in full in the panel', shown.slice(0, 120));
check(popupsSince(before).length === 0, 'panel open: no popup opened');
check((await badge()) === '', 'panel open: no badge on the icon');
await click(panel, '^connect$');
const [addr] = (await conn).r ?? [];
check(/^0x[0-9a-f]{40}$/i.test(addr ?? ''), 'connected from the panel', addr);

// Panel closed: the popup opens again.
await panel.close();
await new Promise((r) => setTimeout(r, 500));
const before2 = new Set(browser.targets());
const signing = rpc('personal_sign', ['0x6869', addr]);
await new Promise((r) => setTimeout(r, 3000));
const opened = popupsSince(before2);
check(opened.length > 0 || (await badge()) === '1', 'panel closed: the popup opens', opened.map((t) => t.url().split('/').pop()).join(', '));
for (const t of opened) {
  const p = await t.asPage().catch(() => null);
  if (p) await click(p, '^reject$').catch(() => {});
}
await Promise.race([signing, new Promise((r) => setTimeout(r, 5000))]);

await browser.close();
server.stop();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
