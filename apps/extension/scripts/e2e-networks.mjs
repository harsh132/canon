// Networks: per-site chains, dapp switches accepted without a prompt, reads on
// the site's chain, persistence across reload and lock, the panel's chip, and
// switching RAILGUN's network to Arbitrum and back. No transactions.
// Needs a --dev build (reads the core's tab map).
//   PANGOLIN_PROFILE=/new/dir bun scripts/e2e-networks.mjs
import { createWallet, launch } from './smoke.mjs';

const PORT = 8798;
const PASSWORD = 'correct horse battery';
const server = Bun.serve({ port: PORT, hostname: '127.0.0.1', fetch: () => new Response('<!doctype html><title>dapp</title><h1>dapp</h1>', { headers: { 'content-type': 'text/html' } }) });
const { browser, popup, corePage, id } = await launch();
let fails = 0;
const check = (ok, what, extra = '') => {
  if (!ok) fails += 1;
  console.log(ok ? 'ok  ' : 'FAIL', what, extra);
};
const text = async (p = popup) => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const click = (re, p = popup) =>
  p.evaluate((src) => {
    const b = [...document.querySelectorAll('button')].filter((x) => new RegExp(src, 'i').test((x.textContent ?? '').trim())).pop();
    if (!b) throw new Error(`no button ${src}`);
    b.click();
  }, re);
const waitText = async (re, p = popup, timeout = 60000) => {
  try {
    await p.waitForFunction((src) => new RegExp(src, 'i').test(document.body.innerText), { timeout, polling: 300 }, re);
  } catch (e) {
    console.log('waiting for', re, '| screen:', (await text(p)).slice(0, 240));
    throw e;
  }
};
const rpc = (page, method, params = []) =>
  page.evaluate(
    (m, p) => window.ethereum.request({ method: m, params: p }).then((r) => ({ r }), (e) => ({ code: e.code, message: e.message })),
    method,
    params,
  );

await createWallet(popup, PASSWORD);
await waitText('private balance');

const open = async (host) => {
  const page = await browser.newPage();
  await page.goto(`http://${host}:${PORT}/`);
  await page.evaluate(() => {
    window.__chains = [];
    window.ethereum.on('chainChanged', (c) => window.__chains.push(c));
  });
  return page;
};
const a = await open('127.0.0.1');
const b = await open('localhost');

check((await rpc(a, 'eth_chainId')).r === '0xaa36a7', 'new site starts on Sepolia');
const conn = rpc(a, 'eth_requestAccounts');
await popup.bringToFront();
await waitText('sees');
await click('^connect$');
const [addr] = (await conn).r;
await a.bringToFront();

// Switch to Arbitrum: no prompt, an event, and reads from Arbitrum.
const t0 = Date.now();
check((await rpc(a, 'wallet_switchEthereumChain', [{ chainId: '0xa4b1' }])).r === null, 'switch to Arbitrum accepted without a prompt', `${Date.now() - t0} ms`);
check((await rpc(a, 'eth_chainId')).r === '0xa4b1', 'eth_chainId follows the switch');
await new Promise((r) => setTimeout(r, 300));
check((await a.evaluate(() => window.__chains)).includes('0xa4b1'), 'chainChanged event fired');
check((await a.evaluate(() => window.ethereum.chainId)) === '0xa4b1', 'provider.chainId updated');
const block = await rpc(a, 'eth_blockNumber');
check(block.r && Number(block.r) > 100_000_000, 'reads go to Arbitrum (block number)', JSON.stringify(block).slice(0, 120));
check((await rpc(b, 'eth_chainId')).r === '0xaa36a7', 'another site keeps its own network (Sepolia)');

// Unsupported and add-chain.
check((await rpc(a, 'wallet_switchEthereumChain', [{ chainId: '0x539' }])).code === 4902, 'unsupported switch: 4902');
check((await rpc(a, 'wallet_addEthereumChain', [{ chainId: '0x2105', chainName: 'Base', rpcUrls: ['https://evil.example'] }])).r === null, 'add a supported chain (Base): switches');
check((await rpc(a, 'eth_chainId')).r === '0x2105', 'now on Base');
check((await rpc(a, 'wallet_addEthereumChain', [{ chainId: '0xfa', chainName: 'Fantom', rpcUrls: ['https://x'] }])).code === 4200, 'add an unknown chain: 4200');
const caps = (await rpc(a, 'wallet_getCapabilities', [addr])).r ?? {};
check(Object.keys(caps).join() === '0xaa36a7', 'capabilities only for Sepolia', JSON.stringify(caps));

// Persistence: reload the page, then lock and unlock.
await a.reload();
check((await rpc(a, 'eth_chainId')).r === '0x2105', 'reload keeps the network');
await popup.bringToFront();
await click('^lock$');
await waitText('unlock');
await popup.type('input[type=password]', PASSWORD);
await click('^unlock$');
await waitText('private balance');
check((await rpc(a, 'eth_chainId')).r === '0x2105', 'lock and unlock keep the network');

// The panel for that tab: Base chip, Base balances, no Fund.
const tabs = await corePage.evaluate(() => globalThis.__pangolinState.tabs);
const tabId = Object.entries(tabs).find(([, o]) => o === `http://127.0.0.1:${PORT}`)?.[0];
const panel = await browser.newPage();
await panel.setViewport({ width: 380, height: 720 });
await panel.goto(`chrome-extension://${id}/panel.html?tab=${tabId}`);
await waitText('127.0.0.1', panel);
await new Promise((r) => setTimeout(r, 2500));
const pt = await text(panel);
check(/\bBase\b/i.test(pt) && !/\bFund\b/i.test(pt), 'panel shows the site on Base, no Fund', pt.slice(0, 160));
await click('^base$', panel);
await click('^optimism$', panel);
await new Promise((r) => setTimeout(r, 500));
check((await rpc(a, 'eth_chainId')).r === '0xa', 'panel picker switches the site (Optimism)');
await panel.close();

// RAILGUN on Arbitrum, then back to Sepolia. Switching restarts the core and locks.
await popup.bringToFront();
await popup.evaluate(() => document.querySelector('button[title="Private network"]').click());
await click('^arbitrum$');
await waitText('unlock', popup, 60000);
await popup.type('input[type=password]', PASSWORD);
await click('^unlock$');
await waitText('private balance');
check(/ARBITRUM/i.test(await text()), 'header shows Arbitrum as the private network');
const syncStart = Date.now();
await popup.waitForFunction(() => /Synced|Sync failed|Engine error/i.test(document.querySelector('footer')?.innerText ?? ''), { timeout: 600000, polling: 1000 }).catch(() => {});
const foot = await popup.evaluate(() => document.querySelector('footer')?.innerText.replace(/\s+/g, ' '));
check(/Synced/i.test(foot), 'RAILGUN syncs on Arbitrum', `${Math.round((Date.now() - syncStart) / 1000)} s · ${foot}`);
await click('^send$');
check(/sepolia only/i.test(await text()), 'Send says Sepolia only while private network is Arbitrum');
await popup.evaluate(() => document.querySelector('button[title="Private network"]').click());
await click('^sepolia');
await waitText('unlock', popup, 60000);
await popup.type('input[type=password]', PASSWORD);
await click('^unlock$');
await waitText('private balance');
check(/SEPOLIA/i.test(await text()), 'back on Sepolia');

await browser.close();
server.stop();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
