// Per-tab side panel: two dapps in two tabs, each connected; each tab's panel
// shows that site and the address it sees. A tab with no dapp shows none.
// Needs a --dev build (reads core state through a debug handle).
//   PANGOLIN_PROFILE=/new/dir bun scripts/check-site-panel.mjs
import { createWallet, launch } from './smoke.mjs';

const PORT = 8795;
const server = Bun.serve({ port: PORT, hostname: '127.0.0.1', fetch: () => new Response('<!doctype html><h1>dapp</h1>', { headers: { 'content-type': 'text/html' } }) });
const { browser, popup, corePage, id } = await launch();
const sw = await (await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'))).worker();
const click = (page, re) =>
  page.evaluate((src) => [...document.querySelectorAll('button')].find((b) => new RegExp(src, 'i').test(b.textContent.trim())).click(), re);
const text = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));

console.log('icon opens panel everywhere:', JSON.stringify(await sw.evaluate(() => chrome.sidePanel.getPanelBehavior())));
console.log('panel enabled globally:', JSON.stringify(await sw.evaluate(() => chrome.sidePanel.getOptions({}))));

const phrase = await createWallet(popup, 'correct horse battery');
await popup.waitForFunction(() => /private balance/i.test(document.body.innerText));

const connect = async (host) => {
  const page = await browser.newPage();
  await page.goto(`http://${host}:${PORT}/`);
  const req = page.evaluate(() => window.ethereum.request({ method: 'eth_requestAccounts' }));
  await popup.bringToFront();
  await popup.waitForFunction(() => /sees/i.test(document.body.innerText), { timeout: 20000 });
  await click(popup, '^connect$');
  const [addr] = await req;
  return { page, addr };
};
const a = await connect('127.0.0.1');
const b = await connect('localhost');
const tabs = await corePage.evaluate(() => globalThis.__pangolinState.tabs);
console.log('core tab map:', JSON.stringify(tabs));

const findTab = (origin) => Object.entries(tabs).find(([, o]) => o === origin)?.[0];
let fails = 0;
for (const [origin, addr] of [[`http://127.0.0.1:${PORT}`, a.addr], [`http://localhost:${PORT}`, b.addr]]) {
  const tabId = findTab(origin);
  const panel = await browser.newPage();
  await panel.setViewport({ width: 380, height: 700 });
  await panel.goto(`chrome-extension://${id}/panel.html?tab=${tabId}`);
  await panel.waitForFunction((o) => document.body.innerText.includes(o), { timeout: 20000 }, origin);
  await panel.waitForFunction(() => /ETH\s+\d/.test(document.body.innerText), { timeout: 30000 }).catch(() => {});
  const t = await text(panel);
  const shown = t.match(/0x[0-9a-f]{4,}…[0-9a-f]{4}/i)?.[0] ?? '';
  const ok = t.includes(origin) && shown && addr.toLowerCase().startsWith(shown.split('…')[0].toLowerCase()) && addr.toLowerCase().endsWith(shown.split('…')[1].toLowerCase());
  if (!ok) fails += 1;
  console.log(ok ? 'ok  ' : 'FAIL', `tab ${tabId} panel shows ${origin} as ${shown} (dapp sees ${addr.slice(0, 8)}…)`);
  await panel.screenshot({ path: new URL(`../.cache/site-panel-${tabId}.png`, import.meta.url).pathname, clip: { x: 0, y: 0, width: 380, height: 330 } });
  await panel.close();
}
const none = await browser.newPage();
await none.goto(`chrome-extension://${id}/panel.html?tab=999999`);
await none.waitForFunction(() => /private balance/i.test(document.body.innerText) && !/\bfund\b/i.test(document.body.innerText), { timeout: 15000 }).then(
  () => console.log('ok   tab without a dapp: no site card'),
  () => {
    fails += 1;
    console.log('FAIL tab without a dapp');
  },
);
await browser.close();
server.stop();
process.exit(fails ? 1 : 0);
