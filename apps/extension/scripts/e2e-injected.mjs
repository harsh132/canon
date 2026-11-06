// Injected provider, end to end, against a local dapp page served on two hosts.
//   PANGOLIN_PROFILE=/new/dir bun scripts/e2e-injected.mjs
//
// Checks: EIP-6963 announces Pangolin; eth_chainId is Sepolia; a read goes
// through the core; eth_requestAccounts prompts and returns a fresh address;
// personal_sign recovers to it; a second origin gets a different address;
// reloading the first origin returns the same address without a prompt.
import { verifyMessage } from 'ethers';
import { launch } from './smoke.mjs';

const PORT = 8791;
const PASSWORD = 'correct horse battery';
const server = Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch: () => new Response('<!doctype html><title>dapp</title><h1>test dapp</h1>', { headers: { 'content-type': 'text/html' } }),
});

const { browser, popup } = await launch();
setTimeout(() => {
  console.error('[inj] watchdog: no finish in 180 s');
  browser.close().finally(() => process.exit(1));
}, 180_000).unref();

const t0 = Date.now();
const log = (...a) => console.log(`[inj ${Math.round((Date.now() - t0) / 1000)}s]`, ...a);
const text = async () => (await popup.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const click = (re) =>
  popup.evaluate((src) => {
    const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src, 'i').test((x.textContent ?? '').trim()));
    if (!b) throw new Error(`no button ${src}`);
    b.click();
  }, re);
const waitText = async (re, timeout = 30000) => {
  try {
    await popup.waitForFunction((src) => new RegExp(src, 'i').test(document.body.innerText), { timeout, polling: 300 }, re);
  } catch (e) {
    console.log('[inj] waiting for', re, 'screen was:', (await text()).slice(0, 300));
    throw e;
  }
};
const fail = (m) => {
  throw new Error(m);
};

await popup.waitForSelector('input[type=password]');
const pw = await popup.$$('input[type=password]');
await pw[0].type(PASSWORD);
await pw[1].type(PASSWORD);
await click('^create$');
await waitText('saved it');
await click('saved it');
await waitText('Private balance');
log('wallet ready');

const openDapp = async (host) => {
  const page = await browser.newPage();
  page.on('console', (m) => console.log(`[dapp:${host}]`, m.text().slice(0, 200)));
  await page.goto(`http://${host}:${PORT}/`);
  return page;
};

// Origin 1
const d1 = await openDapp('127.0.0.1');
const announced = await d1.evaluate(
  () =>
    new Promise((resolve) => {
      const seen = [];
      window.addEventListener('eip6963:announceProvider', (e) => seen.push(e.detail.info.name));
      window.dispatchEvent(new Event('eip6963:requestProvider'));
      setTimeout(() => resolve(seen), 300);
    }),
);
if (!announced.includes('Pangolin')) fail(`EIP-6963 announced ${JSON.stringify(announced)}`);
log('PASS EIP-6963 announces Pangolin; window.ethereum.isPangolin =', await d1.evaluate(() => window.ethereum?.isPangolin));

const chainId = await d1.evaluate(() => window.ethereum.request({ method: 'eth_chainId' }));
if (chainId !== '0xaa36a7') fail(`chainId ${chainId}`);
const before = await d1.evaluate(() => window.ethereum.request({ method: 'eth_accounts' }));
if (before.length) fail('accounts visible before connecting');
const block = await d1.evaluate(() => window.ethereum.request({ method: 'eth_blockNumber' }));
log('PASS chainId Sepolia, no accounts before connect, block', parseInt(block, 16));

const req1 = d1.evaluate(() => window.ethereum.request({ method: 'eth_requestAccounts' }));
await waitText('Sees', 20000);
log('prompt:', (await text()).slice(0, 160));
await click('^connect$');
const [addr1] = await req1;
log('PASS 127.0.0.1 sees', addr1);

const sig = await (async () => {
  const p = d1.evaluate((a) => window.ethereum.request({ method: 'personal_sign', params: ['0x68656c6c6f', a] }), addr1);
  await waitText('Sign message', 20000);
  await click('^sign$');
  return p;
})();
if (verifyMessage('hello', sig).toLowerCase() !== addr1.toLowerCase()) fail('signature recovers to someone else');
log('PASS personal_sign recovers to the site address');

// Origin 2: a different host is a different dapp.
const d2 = await openDapp('localhost');
const req2 = d2.evaluate(() => window.ethereum.request({ method: 'eth_requestAccounts' }));
await waitText('Sees', 20000);
await click('^connect$');
const [addr2] = await req2;
if (addr2.toLowerCase() === addr1.toLowerCase()) fail('two origins share an address');
log('PASS localhost sees a different address', addr2);

// Reload origin 1: same address, no prompt.
await d1.reload();
const again = await d1.evaluate(() => window.ethereum.request({ method: 'eth_requestAccounts' }));
if (again[0]?.toLowerCase() !== addr1.toLowerCase()) fail(`reload returned ${again[0]}`);
log('PASS reload keeps the address without a prompt');

const counts = (await text()).match(/(\d+) clear · (\d+) mixed/);
log('read counter:', counts?.[0] ?? 'n/a');
await browser.close();
server.stop();
process.exit(0);
