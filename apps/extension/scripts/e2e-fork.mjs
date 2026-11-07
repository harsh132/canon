// End-to-end RAILGUN flow through the popup, against a local anvil fork of Sepolia.
// Build first with:  CANON_FORK=1 CANON_SEPOLIA_RPC=http://127.0.0.1:8545 bun scripts/build.mjs --dev
// Then:              CANON_PROFILE=/new/dir bun scripts/e2e-fork.mjs
//
// 1. create wallet  2. fund Main on the fork  3. Make private 1 ETH
// 4. Send privately 0.2 to self  5. Make public 0.3 to a fresh 0x
import { Wallet } from 'ethers';
import { createWallet, launch } from './smoke.mjs';

const RPC = 'http://127.0.0.1:8545';
const PASSWORD = 'correct horse battery';
const rpc = async (method, params) => {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
};

const { browser, popup, corePage } = await launch();
corePage.on('response', (r) => {
  if (r.status() >= 400) console.log(`[net:${r.status()}]`, r.url().slice(0, 140));
});
const t0 = Date.now();
const log = (...a) => console.log(`[e2e ${Math.round((Date.now() - t0) / 1000)}s]`, ...a);
const text = async () => (await popup.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const click = (re) =>
  popup.evaluate((src) => {
    const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src, 'i').test((x.textContent ?? '').trim()));
    if (!b) throw new Error(`no button ${src}`);
    b.click();
  }, re);
const waitText = (re, timeout = 120000) =>
  popup.waitForFunction((src) => new RegExp(src, 'i').test(document.body.innerText), { timeout, polling: 500 }, re);
const privateBalance = async () => Number((await text()).match(/PRIVATE BALANCE ([\d.]+)/i)?.[1] ?? NaN);

// 1. create
const phrase = await createWallet(popup, PASSWORD);
await waitText('Synced', 300000);
log('wallet created and synced');

// read addresses from Receive
await click('^receive$');
await waitText('0zk');
const recv = await text();
const zk = recv.match(/0zk[0-9a-z]+/)[0];
const main = recv.match(/0x[0-9a-fA-F]{40}/)[0];
log('0zk', zk.slice(0, 16), 'main', main);

// 2. fund
await rpc('anvil_setBalance', [main, '0x8AC7230489E80000']); // 10 ETH
log('funded Main with 10 ETH on the fork');

const send = async ({ from, to, amount, expect }) => {
  await popup.evaluate(() => [...document.querySelectorAll('nav button')].find((b) => /send/i.test(b.textContent)).click());
  await popup.waitForSelector('select');
  await popup.select('select', String(from));
  const [toInput] = await popup.$$('input:not([inputmode])');
  await toInput.click({ clickCount: 3 });
  await toInput.type(to);
  const amountInput = await popup.$('input[inputmode=decimal]');
  await amountInput.click({ clickCount: 3 });
  await amountInput.type(amount);
  await click('^review$');
  await waitText(`This will\\s*${expect}`, 120000);
  const review = (await text()).match(/THIS WILL.*?(?=SEND PRIVATELY$|MAKE|$)/i)?.[0] ?? '';
  log('review:', review.slice(0, 160));
  const started = Date.now();
  await click(`^${expect}$`);
  await popup.waitForFunction(() => /submitted|error|failed|more than/i.test(document.body.innerText), { timeout: 600000, polling: 1000 });
  const after = await text();
  if (!/submitted/i.test(after)) throw new Error(`send failed: ${after.slice(0, 300)}`);
  log(`${expect} submitted in ${Math.round((Date.now() - started) / 1000)}s`);
  await click('^done$');
};

const waitPrivate = async (pred, label) => {
  for (let i = 0; i < 60; i += 1) {
    const b = await privateBalance();
    if (pred(b)) return log(`${label}: private balance ${b}`);
    if (i % 5 === 4) await click('^(synced|sync)').catch(() => {});
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error(`${label}: private balance never matched, last ${await privateBalance()}`);
};

// 3. make private
await send({ from: 0, to: zk, amount: '1', expect: 'Make private' });
await waitPrivate((b) => b > 0.99, 'after Make private');

// 4. send privately to self
await send({ from: 'private', to: zk, amount: '0.2', expect: 'Send privately' });
await waitPrivate((b) => b > 0.99, 'after Send privately (self, so unchanged)');

// 5. make public to a fresh address
const target = Wallet.createRandom().address;
await send({ from: 'private', to: target, amount: '0.3', expect: 'Make public' });
for (let i = 0; i < 30; i += 1) {
  const bal = BigInt(await rpc('eth_getBalance', [target, 'latest']));
  if (bal > 0n) {
    log('recipient ETH on fork:', Number(bal) / 1e18);
    break;
  }
  await new Promise((r) => setTimeout(r, 2000));
}
await waitPrivate((b) => b < 0.75, 'after Make public');
await popup.screenshot({ path: new URL('../.cache/after-flow.png', import.meta.url).pathname });
log('done');
await browser.close();
