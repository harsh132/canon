// Screenshots of the wallet frame (dark): Home, menu open, Send, Recovery phrase,
// and a panel with a connected dapp. Into .cache/frame-shots/.
//   CANON_PROFILE=/new/dir bun scripts/shot-frame.mjs
import { fileURLToPath } from 'node:url';
import { createWallet, launch } from './smoke.mjs';

const PORT = 8797;
const server = Bun.serve({ port: PORT, hostname: '127.0.0.1', fetch: () => new Response('<!doctype html><title>dapp</title><h1>dapp</h1>', { headers: { 'content-type': 'text/html' } }) });
const { browser, popup, corePage, id } = await launch();
const out = fileURLToPath(new URL('../.cache/frame-shots/', import.meta.url));
await Bun.write(`${out}.keep`, '');
await popup.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
const click = (page, re) =>
  page.evaluate((src) => [...document.querySelectorAll('button')].find((b) => new RegExp(src, 'i').test((b.textContent ?? '').trim())).click(), re);
const waitText = (page, re) => page.waitForFunction((src) => new RegExp(src, 'i').test(document.body.innerText), { timeout: 30000, polling: 200 }, re);
const shot = async (page, name) => {
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${out}${name}.png` });
};

await createWallet(popup, 'correct horse battery');
await waitText(popup, 'private balance');
await shot(popup, '1-home');
await click(popup, '^menu$');
await shot(popup, '2-menu');
await click(popup, '^close menu$').catch(() => popup.mouse.click(10, 300));
await click(popup, '^send$');
await shot(popup, '3-send');
await click(popup, '^menu$');
await click(popup, '^recovery phrase$');
await popup.type('input[type=password]', 'correct horse battery');
await click(popup, '^show$');
await waitText(popup, 'anyone with these words');
await shot(popup, '4-phrase');
await click(popup, '^hide$');

// A dapp in a tab, and that tab's panel.
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${PORT}/`);
const req = page.evaluate(() => window.ethereum.request({ method: 'eth_requestAccounts' }));
await popup.bringToFront();
await waitText(popup, 'sees');
await popup.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /^connect$/i.test(b.textContent.trim())).pop().click());
await req;
const tabs = await corePage.evaluate(() => globalThis.__canonState.tabs);
const tabId = Object.entries(tabs).find(([, o]) => o === `http://127.0.0.1:${PORT}`)?.[0];
const panel = await browser.newPage();
await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
await panel.setViewport({ width: 380, height: 720 });
await panel.goto(`chrome-extension://${id}/panel.html?tab=${tabId}`);
await waitText(panel, '127.0.0.1');
await shot(panel, '5-panel-dapp');
await browser.close();
server.stop();
process.exit(0);
