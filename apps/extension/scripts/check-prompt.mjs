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
await browser.close();
server.stop();
process.exit(0);
