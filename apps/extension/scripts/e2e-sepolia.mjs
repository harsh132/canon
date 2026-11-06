// Real Sepolia, through Nox, in a persistent profile so funds survive between runs.
//   bun scripts/e2e-sepolia.mjs setup     create the wallet (once), print Main and 0zk
//   bun scripts/e2e-sepolia.mjs shield    Make private AMOUNT (default 0.01) from Main
//   bun scripts/e2e-sepolia.mjs status    sync and print private balance (spendable / pending)
//   bun scripts/e2e-sepolia.mjs broadcasters  wait for Waku to find Sepolia broadcasters
//   bun scripts/e2e-sepolia.mjs private   Send privately AMOUNT to TO (default alice.pangolin.eth) with VIA gas
//   bun scripts/e2e-sepolia.mjs name      claim LABEL.pangolin.eth, then pay it from Main by name
//   bun scripts/e2e-sepolia.mjs spend     Send privately 0.002 to self
//   bun scripts/e2e-sepolia.mjs public    Make public 0.002 to Main (after the new notes clear POI)
// The profile and the test phrase live in .cache/sepolia (gitignored). Test funds only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { launch } from './smoke.mjs';

const dir = new URL('../.cache/sepolia/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
process.env.PANGOLIN_PROFILE ??= `${dir}profile`;
const walletFile = `${dir}wallet.json`;
const PASSWORD = 'pangolin sepolia test';
const phase = process.argv[2] ?? 'status';
const AMOUNT = process.env.AMOUNT ?? '0.01';
// Gas for private sends: 'sponsor' (default), 'broadcaster' or 'self' (Main pays).
const VIA = process.env.VIA ?? 'sponsor';

const { browser, popup } = await launch();
setTimeout(() => {
  console.error('[sep] watchdog: 25 min');
  browser.close().finally(() => process.exit(1));
}, 25 * 60_000).unref();

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
    pending: t.match(/PENDING ([\d.]+) WETH/i)?.[1] ?? '0',
    reads: t.match(/(\d+) clear · (\d+) mixed/)?.[0],
  };
};

// Unlock or create.
await waitText('Password|New wallet');
if (/new wallet/i.test(await text())) {
  const pw = await popup.$$('input[type=password]');
  await pw[0].type(PASSWORD);
  await pw[1].type(PASSWORD);
  await click('^create$');
  await waitText('saved it');
  const phrase = await popup.evaluate(() =>
    [...document.querySelectorAll('ol li')].map((li) => li.textContent.replace(/^\d+/, '').trim()).join(' '),
  );
  writeFileSync(walletFile, JSON.stringify({ phrase, note: 'Sepolia test wallet for e2e-sepolia.mjs' }, null, 2));
  await click('saved it');
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
  await send({ from: 0, to: zk, amount: AMOUNT, expect: 'Make private' });
  log('waiting for the shield to land and sync…');
  await new Promise((r) => setTimeout(r, 30000));
  await resync();
  log('balances:', await balances());
} else if (phase === 'status') {
  log('balances:', await balances());
} else if (phase === 'name') {
  // Claim LABEL.pangolin.eth through the sponsor, then pay it from Main by name.
  const label = process.env.LABEL ?? 'alice';
  await click('get a name|pangolin\\.eth');
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
  const name = (await text()).match(/([a-z0-9-]+\.pangolin\.eth)/i)?.[1];
  if (!name) throw new Error('no name on screen');
  await nav('home');
  await send({ from: 0, to: name, amount: process.env.AMOUNT ?? '0.001', expect: 'Make private' });
} else if (phase === 'private') {
  // Send privately (gas route from VIA, default sponsor) to TO, default a name.
  const to = process.env.TO ?? 'alice.pangolin.eth';
  await send({ from: 'private', to, amount: process.env.AMOUNT ?? '0.001', expect: 'Send privately' });
} else if (phase === 'broadcasters') {
  // Waku discovery takes a while; read the Privacy screen until one shows up.
  await popup.evaluate(() => [...document.querySelectorAll('button')].find((b) => /clear ·/.test(b.textContent)).click());
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
  const b = await balances();
  log('balances:', b);
  if (!(Number(b.spendable) > 0.002)) throw new Error('not enough spendable yet; new notes wait for proof of innocence');
  await send({ from: 'private', to: main, amount: '0.002', expect: 'Make public' });
  await new Promise((r) => setTimeout(r, 30000));
  await resync();
  log('after make public:', await balances());
}
await popup.screenshot({ path: `${dir}${phase}.png` });
await browser.close();
process.exit(0);
