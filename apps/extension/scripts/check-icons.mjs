// Dapp icons: a browser dapp's favicon on the connect and sign prompts and the
// Apps / Addresses lists, and a WalletConnect proposal's metadata icon fetched
// by the core (through Nox) and shown inline. Screenshots in .cache/icons/.
//   CANON_PROFILE=/new/dir bun scripts/check-icons.mjs
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { SignClient } from '@walletconnect/sign-client';
import { createWallet, launch } from './smoke.mjs';

const PORT = 8794;
const png = readFileSync(new URL('../public/icons/128.png', import.meta.url));
const server = Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch: (req) =>
    new URL(req.url).pathname === '/icon.png'
      ? new Response(png, { headers: { 'content-type': 'image/png' } })
      : new Response('<!doctype html><link rel="icon" href="/icon.png"><h1>icon dapp</h1>', { headers: { 'content-type': 'text/html' } }),
});
const out = fileURLToPath(new URL('../.cache/icons/', import.meta.url));
await Bun.write(`${out}.keep`, '');

const { browser, popup } = await launch();
const click = (page, re) =>
  page.evaluate((src) => [...document.querySelectorAll('button, nav button')].find((b) => new RegExp(src, 'i').test(b.textContent.trim())).click(), re);
const iconState = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('img')].map((i) => ({ src: i.src.slice(0, 40), loaded: i.complete && i.naturalWidth > 0 })),
  );

await popup.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
const phrase = await createWallet(popup, 'correct horse battery');
await popup.waitForFunction(() => /private balance/i.test(document.body.innerText));

// Browser dapp: connect prompt shows in the open popup tab.
const dapp = await browser.newPage();
await dapp.goto(`http://127.0.0.1:${PORT}/`);
await new Promise((r) => setTimeout(r, 1500)); // let Chrome cache the favicon
const req = dapp.evaluate(() => window.ethereum.request({ method: 'eth_requestAccounts' }));
await popup.bringToFront();
await popup.waitForFunction(() => /sees/i.test(document.body.innerText), { timeout: 20000 });
await new Promise((r) => setTimeout(r, 500));
console.log('connect prompt icons:', JSON.stringify(await iconState(popup)));
await popup.screenshot({ path: `${out}connect-browser.png`, clip: { x: 0, y: 0, width: 380, height: 260 } });
await click(popup, '^connect$');
const [addr] = await req;

const sig = dapp.evaluate((a) => window.ethereum.request({ method: 'personal_sign', params: ['0x6869', a] }), addr);
await popup.waitForFunction(() => /sign message/i.test(document.body.innerText), { timeout: 20000 });
await new Promise((r) => setTimeout(r, 500));
console.log('sign prompt icons:', JSON.stringify(await iconState(popup)));
await popup.screenshot({ path: `${out}sign-browser.png`, clip: { x: 0, y: 0, width: 380, height: 200 } });
await click(popup, '^sign$');
await sig;

await popup.waitForFunction(() => document.querySelector('nav'), { timeout: 20000 });
await click(popup, '^apps$');
await popup.waitForFunction(() => /browser/i.test(document.body.innerText));
await new Promise((r) => setTimeout(r, 500));
console.log('apps list icons:', JSON.stringify(await iconState(popup)));
await popup.screenshot({ path: `${out}apps.png` });
await click(popup, '^menu$');
await click(popup, '^addresses$');
await new Promise((r) => setTimeout(r, 500));
await popup.screenshot({ path: `${out}addresses.png`, clip: { x: 0, y: 0, width: 380, height: 220 } });

// WalletConnect proposal with an https icon in its metadata.
const projectId = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/CANON_WC_PROJECT_ID=(\w+)/)?.[1];
const wc = await SignClient.init({
  projectId,
  metadata: { name: 'Icon Dapp', description: 'icons', url: 'https://icons.example', icons: ['https://avatars.githubusercontent.com/u/37784886'] },
});
const { uri } = await wc.connect({ optionalNamespaces: { eip155: { chains: ['eip155:11155111'], methods: ['personal_sign'], events: [] } } });
await click(popup, '^apps$');
const input = await popup.waitForSelector('input[placeholder="wc:…"]');
await input.type(uri);
await click(popup, '^connect$');
await popup.waitForFunction(() => /sees/i.test(document.body.innerText), { timeout: 30000 });
for (let i = 0; i < 20; i += 1) {
  const st = await iconState(popup);
  if (st.some((x) => x.loaded)) break;
  await new Promise((r) => setTimeout(r, 1000));
}
console.log('wc prompt icons:', JSON.stringify(await iconState(popup)));
await popup.screenshot({ path: `${out}connect-wc.png`, clip: { x: 0, y: 0, width: 380, height: 260 } });
await click(popup, '^reject$');

await browser.close();
server.stop();
process.exit(0);
