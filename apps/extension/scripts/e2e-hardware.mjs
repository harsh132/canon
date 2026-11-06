// Hardware wallet, end to end against the JavaScript mock device (apps/hw-mock)
// over its WebSocket. Needs a --dev build (the mock URL is honoured only there).
//   PANGOLIN_PROFILE=/new/dir bun scripts/e2e-hardware.mjs
import { spawn } from 'node:child_process';
import { HDNodeWallet, Mnemonic, keccak256, randomBytes, toUtf8Bytes, verifyMessage, verifyTypedData } from 'ethers';
import { deriveNodes, encodeAddress, WalletNode } from '../../hw-mock/src/engine.ts';
import { launch } from './smoke.mjs';

// A fresh seed per run: the public test seed has other people's Sepolia notes, and
// proving their proofs of innocence swamps the extension.
const SEED = process.env.HW_SEED ?? Mnemonic.fromEntropy(randomBytes(16)).phrase;
const MOCK = 8799;
const PORT = 8800;
const mock = spawn('bun', [new URL('../../hw-mock/src/server.ts', import.meta.url).pathname], {
  env: { ...process.env, HW_MOCK_SEED: SEED, HW_MOCK_PORT: String(MOCK), HW_MOCK_DELAY_MS: '700' },
  stdio: ['ignore', 'inherit', 'inherit'],
});
// Never leave the mock running, whatever ends this script.
process.on('exit', () => mock.kill());
await new Promise((r) => setTimeout(r, 1500));
const server = Bun.serve({ port: PORT, hostname: '127.0.0.1', fetch: () => new Response('<!doctype html><title>dapp</title><h1>dapp</h1>', { headers: { 'content-type': 'text/html' } }) });

const { browser, popup } = await launch();
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
    await p.waitForFunction((src) => new RegExp(src, 'i').test(document.body.innerText), { timeout, polling: 150 }, re);
  } catch (e) {
    console.log('waiting for', re, '| screen:', (await text(p)).slice(0, 260));
    throw e;
  }
};
const sawBanner = () =>
  popup.waitForFunction(() => /confirm on your device/i.test(document.body.innerText), { timeout: 15000, polling: 50 }).then(
    () => true,
    () => false,
  );

// Expected keys from the seed.
const main = HDNodeWallet.fromPhrase(SEED, undefined, "m/44'/60'/0'/0/0").address;
const nodes = deriveNodes(SEED, 0);
const spending = nodes.spending.getSpendingKeyPair();
const viewing = await nodes.viewing.getViewingKeyPair();
const zk = encodeAddress({ masterPublicKey: WalletNode.getMasterPublicKey(spending.pubkey, await nodes.viewing.getNullifyingKey()), viewingPublicKey: viewing.pubkey });
const purposeOf = (key) => Number.parseInt(keccak256(toUtf8Bytes(key)).slice(2, 10), 16) & 0x7fffffff;
const site = HDNodeWallet.fromPhrase(SEED, undefined, `m/44'/60'/1984'/7702'/0'/${purposeOf(`http://127.0.0.1:${PORT}`)}'/0'`).address;

// Onboard with the hardware wallet.
await popup.evaluate((url) => localStorage.setItem('pangolin.hwMock', url), `ws://127.0.0.1:${MOCK}`);
await waitText('hardware wallet');
await click('^hardware wallet');
await click('^connect device$');
check(await sawBanner(), 'banner: "Confirm on your device" while the device waits');
await waitText('private balance', popup, 120000);
check(true, 'onboarded with three approvals on the device');

// A dapp: its address comes from the device.
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${PORT}/`);
const rpc = (method, params = []) =>
  page.evaluate((m, p) => window.ethereum.request({ method: m, params: p }).then((r) => ({ r }), (e) => ({ code: e.code, message: e.message })), method, params);
const conn = rpc('eth_requestAccounts');
await popup.bringToFront();
await waitText('sees');
await popup.waitForFunction(() => /0x[0-9a-f]{6}/i.test(document.body.innerText), { timeout: 20000 }).catch(() => {});
await click('^connect$');
const [addr] = (await conn).r ?? [];
check(addr?.toLowerCase() === site.toLowerCase(), 'site address read from the device (RAILGUN app path)', addr);

// The prompt's approve button (Sign or Send) sits right after its Reject button.
const approve = async (call) => {
  const p = call();
  const pick = () => [...document.querySelectorAll('button')].find((b) => /^reject$/i.test(b.previousElementSibling?.textContent?.trim() ?? ''));
  const t0 = Date.now();
  for (;;) {
    const found = await Promise.race([popup.evaluate(`!!(${pick})()`), new Promise((r) => setTimeout(() => r('busy'), 5000))]);
    if (found === true) break;
    if (Date.now() - t0 > 90000) throw new Error(`no prompt; screen: ${(await text()).slice(0, 200)}`);
    if ((Date.now() - t0) % 10000 < 1200) console.log(`[test] waiting for the prompt (${found})`, Math.round((Date.now() - t0) / 1000), 's');
    await new Promise((r) => setTimeout(r, 1000));
  }
  await popup.evaluate(`(${pick})().click()`);
  return p;
};
const message = '0x48656c6c6f2066726f6d2050616e676f6c696e';
const ps = await approve(() => rpc('personal_sign', [message, addr]));
check(ps.r && verifyMessage(toUtf8Bytes('Hello from Pangolin'), ps.r).toLowerCase() === addr.toLowerCase(), 'personal_sign signed on the device');

const typed = {
  domain: { name: 'Demo', version: '1', chainId: 11155111 },
  types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }], Note: [{ name: 'text', type: 'string' }] },
  primaryType: 'Note',
  message: { text: 'hi' },
};
const td = await approve(() => rpc('eth_signTypedData_v4', [addr, JSON.stringify(typed)]));
check(td.r && verifyTypedData(typed.domain, { Note: typed.types.Note }, typed.message, td.r).toLowerCase() === addr.toLowerCase(), 'eth_signTypedData_v4 signed on the device');

await fetch(`http://127.0.0.1:${MOCK}/reject-next`, { method: 'POST' });
const rejected = await approve(() => rpc('personal_sign', [message, addr]));
check(rejected.code === 4001, 'reject on the device reaches the dapp as 4001', JSON.stringify(rejected));

// Lock, unlock with the device; no recovery phrase in the menu.
await popup.bringToFront();
await waitText('private balance');
await click('^lock$');
await waitText('unlock with device');
check(!(await popup.$('input[type=password]')), 'unlock screen: no password field');
await click('^unlock with device$');
await waitText('private balance');
check(true, 'unlocked with the device');
await click('^menu$');
check(!/recovery phrase/i.test(await text()), 'menu has no recovery phrase for a hardware wallet');

await popup.evaluate(() => document.body.click());
// The 0zk exists once RAILGUN has loaded the wallet from the device's viewing key.
await popup.waitForFunction(() => /Synced|Syncing/i.test(document.querySelector('footer')?.innerText ?? ''), { timeout: 240000, polling: 1000 });
await click('^receive$');
await waitText('0zk');
const recv = await text();
check(recv.includes(main), 'Main is the device\'s m/44\'/60\'/0\'/0/0', main);
const shownZk = recv.match(/0zk[0-9a-z]+/)?.[0];
check(shownZk === zk, 'private balance 0zk matches the seed (viewing key from the device)', `${shownZk?.slice(0, 24)}… vs ${zk.slice(0, 24)}…`);
await popup.evaluate(() => [...document.querySelectorAll('nav button')].find((b) => /home/i.test(b.textContent)).click());

// SPONSORED=1: a gasless dapp transaction from the site address on Sepolia, through
// the hosted sponsor. The device signs Calibur's batch and the 7702 authorization.
// Reads go direct for this step (Nox exits may lack TLS), then back to Nox.
if (process.env.SPONSORED) {
  const { JsonRpcProvider, Interface } = await import('ethers');
  const rpcSepolia = new JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com', 11155111, { staticNetwork: true });
  const WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';
  const setRpc = async (want) => {
    await popup.evaluate(() => document.querySelector('footer button').click());
    await waitText('use direct rpc|route through nox');
    if (new RegExp(want, 'i').test(await text())) await click(`^${want}$`);
    await popup.evaluate(() => [...document.querySelectorAll('nav button')].find((b) => /home/i.test(b.textContent)).click());
  };
  await setRpc('use direct rpc');
  const data = new Interface(['function approve(address,uint256)']).encodeFunctionData('approve', [WETH, 1n]);
  const t0 = Date.now();
  const sent = await approve(() => rpc('eth_sendTransaction', [{ from: addr, to: WETH, data }]));
  if (sent.r) {
    const r = await rpcSepolia.waitForTransaction(sent.r, 1, 180000);
    const code = await rpcSepolia.getCode(addr);
    check(r?.status === 1, 'gasless dapp transaction via the hosted sponsor, signed on the device', `${Math.round((Date.now() - t0) / 1000)} s ${sent.r}`);
    check(code.toLowerCase().startsWith('0xef0100000000009b1d0af20d8c6d0a44e162d11f9b8f00'), 'site address delegated to Calibur by the device-signed authorization');
  } else {
    check(false, 'gasless dapp transaction via the hosted sponsor', JSON.stringify(sent));
  }
  await setRpc('route through nox');
}

const log = await (await fetch(`http://127.0.0.1:${MOCK}/log`)).json();
console.log('device screens:', log.map((s) => `${s.title}${s.approved ? '' : ' (rejected)'}`).join(' · '));

await browser.close();
server.stop();
mock.kill();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
