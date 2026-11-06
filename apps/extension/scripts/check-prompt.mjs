// With no Pangolin UI open, a dapp's connect request should open the toolbar
// popup (popup.html), not the fallback window (popup.html?window=1), and the
// icon should go back to opening the side panel afterwards.
//   PANGOLIN_PROFILE=/new/dir bun scripts/check-prompt.mjs
import { launch } from './smoke.mjs';

const PORT = 8793;
const server = Bun.serve({ port: PORT, hostname: '127.0.0.1', fetch: () => new Response('<!doctype html><h1>dapp</h1>', { headers: { 'content-type': 'text/html' } }) });
const { browser, popup } = await launch();
const sw = await (await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'))).worker();
const click = (page, re) =>
  page.evaluate((src) => [...document.querySelectorAll('button')].find((b) => new RegExp(src, 'i').test(b.textContent.trim())).click(), re);

await popup.waitForSelector('input[type=password]');
const pw = await popup.$$('input[type=password]');
await pw[0].type('correct horse battery');
await pw[1].type('correct horse battery');
await click(popup, '^create$');
await popup.waitForFunction(() => /saved it/i.test(document.body.innerText));
await click(popup, 'saved it');
await popup.waitForFunction(() => /private balance/i.test(document.body.innerText));

const dapp = await browser.newPage();
await dapp.goto(`http://127.0.0.1:${PORT}/`);
await popup.close(); // no Pangolin UI open now
await new Promise((r) => setTimeout(r, 500));
console.log('icon popup before request:', JSON.stringify(await sw.evaluate(() => chrome.action.getPopup({}))));

const req = dapp.evaluate(() => window.ethereum.request({ method: 'eth_requestAccounts' }));
const target = await browser.waitForTarget((t) => /\/popup\.html/.test(t.url()), { timeout: 15000 });
const kind = target.url().includes('window=1') ? 'FALLBACK WINDOW' : 'TOOLBAR POPUP';
console.log('opened:', kind, target.url().replace(/^chrome-extension:\/\/[a-z]+/, ''));
await new Promise((r) => setTimeout(r, 800));
console.log('icon popup after:', JSON.stringify(await sw.evaluate(() => chrome.action.getPopup({}))), '(empty = icon opens the panel)');
console.log('panel on icon click:', JSON.stringify(await sw.evaluate(() => chrome.sidePanel.getPanelBehavior())));

const page = await target.asPage();
await page.waitForFunction(() => /connect/i.test(document.body.innerText), { timeout: 15000 });
await click(page, '^connect$');
console.log('dapp got:', JSON.stringify(await req));

// Locked wallet: the popup must show the unlock screen first, naming the site,
// then the connect screen after unlocking. Then: rejecting while locked.
const extId = new URL(target.url()).host;
const lockWallet = async () => {
  const ui = await browser.newPage();
  await ui.goto(`chrome-extension://${extId}/popup.html`);
  await ui.waitForFunction(() => /lock/i.test(document.body.innerText), { timeout: 15000 });
  await click(ui, '^lock$');
  await ui.waitForFunction(() => /unlock/i.test(document.body.innerText), { timeout: 15000 });
  await ui.close();
  await new Promise((r) => setTimeout(r, 500));
};
const popupFor = async (dappPage, method) => {
  const before = new Set(browser.targets().map((t) => t));
  const pending = dappPage.evaluate((m) => window.ethereum.request({ method: m }).then((v) => ({ ok: v }), (e) => ({ err: e.code })), method);
  const t = await browser.waitForTarget((x) => /\/popup\.html/.test(x.url()) && !before.has(x), { timeout: 15000 });
  const p = await t.asPage();
  await p.waitForFunction(() => document.body.innerText.length > 20, { timeout: 15000 });
  return { p, pending };
};

await lockWallet();
const dapp2 = await browser.newPage();
await dapp2.goto(`http://localhost:${PORT}/`);
{
  const { p, pending } = await popupFor(dapp2, 'eth_requestAccounts');
  const first = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  console.log(/unlock to review/i.test(first) && /localhost:8793 wants to connect/i.test(first) ? 'ok   locked: unlock screen first, names the site' : `FAIL locked first screen: ${first.slice(0, 160)}`);
  await (await p.$('input[type=password]')).type('correct horse battery');
  await click(p, '^unlock$');
  await p.waitForFunction(() => /sees/i.test(document.body.innerText), { timeout: 30000 });
  console.log('ok   after unlock: connect screen');
  await click(p, '^connect$');
  console.log('dapp2 got:', JSON.stringify(await pending));
}

await lockWallet();
const dapp3 = await browser.newPage();
await dapp3.goto(`http://[::1]:${PORT}/`).catch(() => dapp3.goto(`http://127.0.0.1:${PORT}/?third`));
{
  const { p, pending } = await popupFor(dapp3, 'eth_requestAccounts');
  await click(p, '^reject request$');
  const res = await pending;
  console.log(res.err === 4001 ? 'ok   reject while locked: dapp got 4001' : `FAIL reject while locked: ${JSON.stringify(res)}`);
}
await browser.close();
server.stop();
process.exit(0);
