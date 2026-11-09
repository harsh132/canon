// Real Sepolia, through Nox, in a persistent profile so funds survive between runs.
//   bun scripts/e2e-sepolia.mjs setup     create the wallet (once), print Main and 0zk
//   bun scripts/e2e-sepolia.mjs shield    Make private AMOUNT (default 0.01) from Main
//   bun scripts/e2e-sepolia.mjs status    sync and print private balance (spendable / pending)
//   bun scripts/e2e-sepolia.mjs broadcasters  wait for Waku to find Sepolia broadcasters
//   bun scripts/e2e-sepolia.mjs private   Send privately AMOUNT (of TOKEN, an ERC-20 address, if set) to TO (default alice.pangolin.eth) with VIA gas
//   bun scripts/e2e-sepolia.mjs swap      private swap AMOUNT (default 0.001) WETH -> USDC on Uniswap v4
//   bun scripts/e2e-sepolia.mjs name      claim LABEL.canon.eth, then pay it from Main by name
//   bun scripts/e2e-sepolia.mjs spend     Send privately 0.002 to self
//   bun scripts/e2e-sepolia.mjs public    Make public 0.002 to Main (after the new notes clear POI)
//   bun scripts/e2e-sepolia.mjs dapp      a local dapp on its site address: EIP-5792 + sponsored 7702 calls, then Fund
// The profile and the test phrase live in .cache/sepolia (gitignored). Test funds only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWallet, launch } from './smoke.mjs';

const dir = fileURLToPath(new URL('../.cache/sepolia/', import.meta.url));
mkdirSync(dir, { recursive: true });
process.env.CANON_PROFILE ??= `${dir}profile`;
const walletFile = `${dir}wallet.json`;
const PASSWORD = 'canon sepolia test';
const phase = process.argv[2] ?? 'status';
const AMOUNT = process.env.AMOUNT ?? '0.01';
// Gas for private sends: 'sponsor' (default), 'broadcaster' or 'self' (Main pays).
const VIA = process.env.VIA ?? 'sponsor';

const { browser, popup, corePage, id: extId } = await launch();
const WATCHDOG_MIN = Number(process.env.WATCHDOG_MIN ?? 25);
setTimeout(() => {
  console.error(`[sep] watchdog: ${WATCHDOG_MIN} min`);
  browser.close().finally(() => process.exit(1));
}, WATCHDOG_MIN * 60_000).unref();

const t0 = Date.now();
const log = (...a) => console.log(`[sep ${Math.round((Date.now() - t0) / 1000)}s]`, ...a);
const text = async () => (await popup.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const click = (re) =>
  popup.evaluate((src) => {
    const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src, 'i').test((x.textContent ?? '').trim()));
    if (!b) throw new Error(`no button ${src}`);
    b.click();
  }, re);
const waitText = async (re, timeout = 60000) => {
  try {
    await popup.waitForFunction((src) => new RegExp(src, 'i').test(document.body.innerText), { timeout, polling: 500 }, re);
  } catch (e) {
    console.log('[sep] waiting for', re, 'screen was:', (await text()).slice(0, 300));
    throw e;
  }
};
const nav = (re) => popup.evaluate((src) => [...document.querySelectorAll('nav button')].find((b) => new RegExp(src, 'i').test(b.textContent)).click(), re);

const waitSynced = async (timeout = 600000) => {
  await waitText('Synced|Sync failed|Engine error', timeout);
  const t = await text();
  if (/Sync failed|Engine error/i.test(t)) throw new Error(`sync: ${t.slice(0, 200)}`);
};

const balances = async () => {
  const t = await text();
  return {
    spendable: t.match(/PRIVATE BALANCE ([\d.]+)/i)?.[1],
    pending: t.match(/PENDING ([\d.]+) W?ETH/i)?.[1] ?? '0',
    reads: t.match(/(\d+) clear · (\d+) mixed/)?.[0],
    eta: t.match(/Spendable in about \d+ min|Clearing proof of innocence/i)?.[0],
    usdc: t.match(/USDC [\d.]+( · [\d.]+ pending)?/)?.[0],
  };
};

// WAIT_SPENDABLE=1: stay open, resyncing, until enough clears proof of innocence
// (the wallet submits those proofs only while it runs).
// pendingAtMost: also wait until pending falls back to that total.
const waitSpendable = async (need, pendingAtMost = Infinity) => {
  const done = (b) => Number(b.spendable) >= need && Number(b.pending) <= pendingAtMost;
  for (let i = 0; i < 25 && !done(await balances()); i += 1) {
    await new Promise((r) => setTimeout(r, 60_000));
    await resync();
    log(`waiting to clear +${i + 1}m`, await balances());
  }
};

// Unlock or create.
await waitText('Password|New wallet');
if (/new wallet/i.test(await text())) {
  const phrase = await createWallet(popup, PASSWORD);
  writeFileSync(walletFile, JSON.stringify({ phrase, note: 'Sepolia test wallet for e2e-sepolia.mjs' }, null, 2));
  log('created wallet; phrase saved to .cache/sepolia/wallet.json');
} else {
  await (await popup.$('input[type=password]')).type(PASSWORD);
  await click('^unlock$');
}
await waitText('Private balance');
log('waiting for first sync through Nox…');
await waitSynced();

await nav('home');
await click('^receive$');
await waitText('0zk');
const recv = await text();
const zk = recv.match(/0zk[0-9a-z]+/)[0];
const main = recv.match(/0x[0-9a-fA-F]{40}/)[0];
await nav('home');
log('Main', main);
log('0zk ', zk);
if (existsSync(walletFile)) {
  const w = JSON.parse(readFileSync(walletFile, 'utf8'));
  writeFileSync(walletFile, JSON.stringify({ ...w, main, zk }, null, 2));
}

const send = async ({ from, to, amount, expect }) => {
  await nav('send');
  await popup.waitForSelector('select');
  await popup.select('select', String(from));
  // TOKEN=<address>: send that ERC-20 instead of ETH.
  if (process.env.TOKEN) {
    const want = process.env.TOKEN.toLowerCase();
    const tokenSelect = (await popup.$$('select'))[1];
    const value = await tokenSelect?.evaluate((el, w) => [...el.options].find((o) => o.value.toLowerCase() === w)?.value, want);
    if (!value) throw new Error(`token ${process.env.TOKEN} is not offered in Send`);
    const picked = await tokenSelect.select(value);
    if (picked[0] !== value) throw new Error(`could not pick token ${value}`);
  }
  if (from === 'private' && VIA === 'broadcaster') await click('^broadcaster$');
  if (from === 'private' && VIA === 'self') await click('^main$');
  const [toInput] = await popup.$$('input:not([inputmode])');
  await toInput.click({ clickCount: 3 });
  await toInput.type(to);
  const amountInput = await popup.$('input[inputmode=decimal]');
  await amountInput.click({ clickCount: 3 });
  await amountInput.type(amount);
  await click('^review$');
  await waitText(`This will\\s*${expect}`, 180000);
  log('review:', (await text()).match(/THIS WILL.*?(?=Home Send)/i)?.[0]?.slice(0, 260));
  const started = Date.now();
  await click(`^${expect}$`);
  await popup.waitForFunction(() => /submitted|more than|error|failed|insufficient/i.test(document.body.innerText), { timeout: 900000, polling: 1000 });
  const after = await text();
  if (!/submitted/i.test(after)) throw new Error(`${expect} failed: ${after.slice(0, 300)}`);
  const hash = await popup.evaluate(() => document.querySelector('a[href*="etherscan"]')?.href);
  log(`${expect} submitted in ${Math.round((Date.now() - started) / 1000)}s`, hash);
  await click('^done$');
  return hash;
};

const resync = async () => {
  await nav('home');
  await click('^(synced|sync)');
  await new Promise((r) => setTimeout(r, 1500));
  await waitSynced();
};

if (phase === 'setup') {
  log('fund Main with Sepolia ETH, then run: bun scripts/e2e-sepolia.mjs shield');
} else if (phase === 'shield') {
  await click('^check$').catch(() => {});
  await new Promise((r) => setTimeout(r, 8000));
  log('public:', (await text()).match(/PUBLIC ([\d.]+ ETH|Check)/i)?.[1]);
  // The wait below reads 4-decimal UI totals: an amount near that step cannot be told from rounding.
  if (process.env.WAIT_SPENDABLE && !(Number(AMOUNT) >= 0.001)) throw new Error('WAIT_SPENDABLE needs AMOUNT >= 0.001');
  const before = await balances();
  await send({ from: 0, to: zk, amount: AMOUNT, expect: 'Make private' });
  log('waiting for the shield to land and sync…');
  await new Promise((r) => setTimeout(r, 30000));
  await resync();
  const after = await balances();
  log('balances:', after);
  // WAIT_SPENDABLE=1: stay open until the new notes clear, logging the countdown each minute:
  // spendable up by the shield and pending back to its total, both read before the submit.
  // ponytail: totals, not per-note; an older pending note clearing meanwhile can end the wait
  // early. Track the shield's own notes if a run ever has other notes clearing at once.
  // The UI rounds down to 4 decimals: allow one step.
  if (process.env.WAIT_SPENDABLE) await waitSpendable(Number(before.spendable ?? 0) + Number(AMOUNT) * 0.99 - 0.0001, Number(before.pending));
} else if (phase === 'status') {
  // WAIT_SPENDABLE=1: stay open until some private balance is spendable, for example
  // while the wallet resumes POI submissions a closed session left.
  if (process.env.WAIT_SPENDABLE) await waitSpendable(0.0001);
  log('balances:', await balances());
} else if (phase === 'name') {
  // Claim LABEL.canon.eth through the sponsor, then pay it from Main by name.
  const label = process.env.LABEL ?? 'alice';
  await click('^menu$');
  await click('get a name|canon\\.eth');
  await waitText('Your name');
  if (!/Yours/i.test(await text())) {
    const input = await popup.$('input[aria-label="Name label"]');
    await input.type(label);
    const started = Date.now();
    await click('^claim ');
    await waitText('Yours|Name taken|Sponsor error|failed', 300000);
    log(`claim took ${Math.round((Date.now() - started) / 1000)}s:`, (await text()).slice(0, 200));
  } else {
    log('already named:', (await text()).slice(0, 120));
  }
  const name = (await text()).match(/([a-z0-9-]+\.canon\.eth)/i)?.[1];
  if (!name) throw new Error('no name on screen');
  await nav('home');
  await send({ from: 0, to: name, amount: process.env.AMOUNT ?? '0.001', expect: 'Make private' });
} else if (phase === 'private') {
  // Send privately (gas route from VIA, default sponsor) to TO, default a name.
  const to = process.env.TO ?? 'alice.pangolin.eth';
  if (process.env.WAIT_SPENDABLE && !process.env.TOKEN) await waitSpendable(Number(process.env.AMOUNT ?? '0.001'));
  await send({ from: 'private', to, amount: process.env.AMOUNT ?? '0.001', expect: 'Send privately' });
  // Stay open: the wallet submits the send's POIs in the background, like a broadcaster.
  const t1 = Date.now();
  for (let i = 0; i < 25; i += 1) {
    await new Promise((r) => setTimeout(r, 60_000));
    await resync();
    const b = await balances();
    log(`+${Math.round((Date.now() - t1) / 60000)}m`, b);
    if (b.pending === '0' || b.pending === '0.0000') break;
  }
} else if (phase === 'swap') {
  // Private swap WETH -> USDC on Uniswap v4 through Relay Adapt, sponsor paying gas.
  const amount = process.env.AMOUNT ?? '0.001';
  log('before:', await balances());
  await click('^swap$');
  await waitText('Uniswap v4');
  const input = await popup.$('input[inputmode=decimal]');
  await input.type(amount);
  await click('^quote$');
  await waitText('Swap privately', 120000);
  log('review:', (await text()).match(/THIS WILL.*?(?=SWAP PRIVATELY)/i)?.[0]?.slice(0, 260));
  const started = Date.now();
  await click('^swap privately$');
  await popup.waitForFunction(() => /submitted|error|failed|more than|revert/i.test(document.body.innerText), { timeout: 900000, polling: 1000 });
  const after = await text();
  if (!/submitted/i.test(after)) throw new Error(`swap failed: ${after.slice(0, 300)}`);
  log(`swap submitted in ${Math.round((Date.now() - started) / 1000)}s`, await popup.evaluate(() => document.querySelector('a[href*="etherscan"]')?.href));
  await click('^done$');
  // Stay open: the wallet submits the swap's POIs in the background.
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 60_000));
    await resync();
    const t = await text();
    log(`+${i + 1}m`, await balances(), 'USDC row:', t.match(/USDC [\d.]+[^A-Z]*/)?.[0] ?? '—');
    if (/USDC [\d.]+/.test(t) && !/PENDING/i.test(t.match(/USDC.{0,40}/)?.[0] ?? '')) break;
  }
} else if (phase === 'broadcasters') {
  // Waku discovery takes a while; read the Privacy screen until one shows up.
  await popup.evaluate(() => [...document.querySelectorAll('button')].find((b) => /clear ·|no exits/.test(b.textContent)).click());
  for (let i = 0; i < 36; i += 1) {
    const row = (await text()).match(/BROADCASTERS (\S+)( · \d+)?/i)?.[0];
    log(row);
    if (/connected · [1-9]/i.test(row ?? '')) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
} else if (phase === 'spend') {
  const b = await balances();
  log('balances:', b);
  if (!(Number(b.spendable) > 0.004)) throw new Error('not enough spendable yet; run status until pending clears');
  await send({ from: 'private', to: zk, amount: '0.002', expect: 'Send privately' });
  await new Promise((r) => setTimeout(r, 30000));
  await resync();
  log('after send privately:', await balances());
} else if (phase === 'public') {
  if (process.env.WAIT_SPENDABLE) await waitSpendable(0.0021);
  const b = await balances();
  log('balances:', b);
  if (!(Number(b.spendable) > 0.002)) throw new Error('not enough spendable yet; new notes wait for proof of innocence');
  await send({ from: 'private', to: main, amount: '0.002', expect: 'Make public' });
  await new Promise((r) => setTimeout(r, 30000));
  await resync();
  log('after make public:', await balances());
  // WAIT_SPENDABLE=1: stay open while the wallet submits the change note's POI proof;
  // the change is the only note that can turn spendable, since the send used the rest.
  if (process.env.WAIT_SPENDABLE) {
    const t1 = Date.now();
    for (let i = 0; i < 15 && !(Number((await balances()).spendable) > 0); i += 1) {
      await new Promise((r) => setTimeout(r, 60_000));
      await resync();
      log(`change clearing +${i + 1}m`, await balances());
    }
    log(`change ${Number((await balances()).spendable) > 0 ? 'spendable' : 'still pending'} after ${Math.round((Date.now() - t1) / 60000)} min`);
  }
}

// RPC_DIRECT=1: reads go direct for this run (when Nox has no TLS exits), then back to Nox.
const setRpc = async (mode) => {
  await nav('home');
  await popup.evaluate(() => [...document.querySelectorAll('button')].find((b) => /clear ·|no exits/.test(b.textContent)).click());
  await waitText('use direct rpc|route through nox');
  const want = mode === 'direct' ? 'use direct rpc' : 'route through nox';
  if (new RegExp(want, 'i').test(await text())) await click(`^${want}$`);
  await waitText(mode === 'direct' ? 'route through nox' : 'use direct rpc');
  log('reads now', mode);
  await nav('home');
};
if (process.env.RPC_DIRECT) await setRpc('direct');

if (phase === 'dapp') {
  // A dapp on a fresh site address (no ETH): EIP-5792 capabilities, a sponsored
  // eth_sendTransaction (delegates to Calibur), a batch via wallet_sendCalls, then
  // Fund from the panel and a batch that carries value. Needs a --dev build.
  const { Interface, JsonRpcProvider } = await import('ethers');
  const rpc = new JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com', 11155111, { staticNetwork: true });
  const WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';
  const erc20 = new Interface(['function approve(address,uint256)', 'function deposit() payable']);
  const PORT = 8796;
  const server = Bun.serve({ port: PORT, hostname: '127.0.0.1', fetch: () => new Response('<!doctype html><title>dapp</title><h1>dapp</h1>', { headers: { 'content-type': 'text/html' } }) });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  const req = (method, params = []) => page.evaluate((m, p) => window.ethereum.request({ method: m, params: p }), method, params);
  // The prompt's approve button sits next to its Reject button.
  const approveNext = async (label) => {
    await popup.bringToFront();
    const find = (l) => [...document.querySelectorAll('button')].find((b) => new RegExp(l, 'i').test(b.textContent.trim()) && /^reject$/i.test(b.previousElementSibling?.textContent.trim() ?? ''));
    await popup.waitForFunction(find, { timeout: 60000, polling: 300 }, `^${label}$`);
    log('prompt:', (await text()).slice(0, 220));
    await popup.evaluate(`(${find})(${JSON.stringify(`^${label}$`)}).click()`);
  };
  // A site connected on an earlier run answers without a prompt.
  const pConnect = req('eth_requestAccounts');
  const quick = await Promise.race([pConnect.then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 3000))]);
  if (!quick) await approveNext('connect');
  const [addr] = await pConnect;
  log('site address', addr, 'ETH', await rpc.getBalance(addr), 'code', await rpc.getCode(addr));
  log('capabilities', JSON.stringify(await req('wallet_getCapabilities', [addr])));

  if (!process.env.FUND_ONLY) {
  const t1 = Date.now();
  const pTx = req('eth_sendTransaction', [{ from: addr, to: WETH, data: erc20.encodeFunctionData('approve', [WETH, 7n]) }]);
  await approveNext('send');
  const h1 = await pTx;
  const r1 = await rpc.waitForTransaction(h1, 1, 300000);
  log(`eth_sendTransaction ${Math.round((Date.now() - t1) / 1000)}s`, h1, 'status', r1.status, 'tx.from', r1.from, 'type', (await rpc.getTransaction(h1)).type);
  log('code now', await rpc.getCode(addr));

  const pCalls = req('wallet_sendCalls', [{ version: '2.0.0', from: addr, chainId: '0xaa36a7', atomicRequired: true, calls: [
    { to: WETH, data: erc20.encodeFunctionData('approve', [WETH, 8n]) },
    { to: WETH, data: erc20.encodeFunctionData('approve', ['0x000000000022D473030F116dDEE9F6B43aC78BA3', 9n]) },
  ] }]);
  await approveNext('send');
  const { id } = await pCalls;
  let st;
  for (let i = 0; i < 60; i += 1) {
    st = await req('wallet_getCallsStatus', [id]);
    if (st.status !== 100) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  log('wallet_sendCalls id', id, 'status', st.status, 'receipts', st.receipts.length, 'logs', st.receipts[0]?.logs.length);
  }

  // Fund from the panel: private WETH arrives as ETH.
  const tabs = await corePage.evaluate(() => globalThis.__canonState.tabs);
  const tabId = Object.entries(tabs).find(([, o]) => o === `http://127.0.0.1:${PORT}`)?.[0];
  const panel = await browser.newPage();
  await panel.setViewport({ width: 380, height: 760 });
  log('panel for tab', tabId);
  panel.on('framenavigated', (f) => log('panel navigated', f.url()));
  panel.on('console', (m) => log('[panel]', m.type(), m.text().slice(0, 200)));
  panel.on('pageerror', (e) => log('[panel:error]', String(e).slice(0, 300)));
  try {
    await panel.goto(`chrome-extension://${extId}/panel.html?tab=${tabId}`);
    await panel.bringToFront();
    const ptext = async () => (await panel.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
    // A header back button carries its screen's title ("Fund"), so the submit button is the last match.
    const pclick = (re) => panel.evaluate((src) => [...document.querySelectorAll('button')].filter((b) => new RegExp(src, 'i').test(b.textContent.trim())).pop().click(), re);
    await panel.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /^fund$/i.test(b.textContent.trim())), { timeout: 60000, polling: 500 });
    await pclick('^fund$');
    await new Promise((r) => setTimeout(r, 1000));
    log('fund screen:', (await ptext()).slice(0, 200));
    await panel.waitForFunction(() => /From private/i.test(document.body.innerText), { timeout: 30000, polling: 500 });
    await pclick('^ETH');
    log('picked:', (await ptext()).slice(0, 200));
    await panel.waitForSelector('input[inputmode=decimal]', { timeout: 30000 });
    // React-compatible value set: native setter, then an input event.
    await panel.evaluate((v) => {
      const el = document.querySelector('input[inputmode=decimal]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, process.env.AMOUNT ?? '0.0005');
    log('amount set:', (await ptext()).slice(0, 300));
    const t2 = Date.now();
    await panel.waitForFunction(() => [...document.querySelectorAll('button')].filter((b) => /^fund$/i.test(b.textContent.trim())).pop()?.disabled === false, { timeout: 30000, polling: 500 });
    await pclick('^fund$');
    log('fund clicked');
    await panel.waitForFunction(() => /submitted|error|failed|more than/i.test(document.body.innerText), { timeout: 900000, polling: 1000 });
    const fundText = (await panel.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
    await panel.screenshot({ path: `${dir}dapp-fund.png` });
    if (!/submitted/i.test(fundText)) throw new Error(`fund failed: ${fundText.slice(0, 300)}`);
    const fundHash = await panel.evaluate(() => document.querySelector('a[href*="etherscan"]')?.href.split('/').pop());
    await rpc.waitForTransaction(fundHash, 1, 600000);
    log(`fund ${Math.round((Date.now() - t2) / 1000)}s`, fundHash, 'site ETH now', await rpc.getBalance(addr));
  } catch (e) {
    log('panel step failed:', e.message, '| panel:', (await panel.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 400));
    await panel.screenshot({ path: `${dir}dapp-fund-fail.png` });
    if (process.env.RPC_DIRECT) await setRpc('nox').catch(() => {});
    throw e;
  }

  const pVal = req('wallet_sendCalls', [{ version: '2.0.0', from: addr, chainId: '0xaa36a7', atomicRequired: true, calls: [
    { to: WETH, value: '0x5af3107a4000', data: erc20.encodeFunctionData('deposit') },
  ] }]);
  await approveNext('send');
  const { id: id2 } = await pVal;
  const r3 = await rpc.waitForTransaction(id2, 1, 300000);
  log('value batch', id2, 'status', r3.status, 'site ETH after', await rpc.getBalance(addr));
  server.stop();
}
if (process.env.RPC_DIRECT) await setRpc('nox');
await popup.screenshot({ path: `${dir}${phase}.png` });
await browser.close();
process.exit(0);
