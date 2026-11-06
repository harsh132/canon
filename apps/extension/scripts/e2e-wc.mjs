// WalletConnect per-dapp addresses, end to end. Plays two dapps with the
// WalletConnect sign client and drives the popup to approve them.
//   PANGOLIN_PROFILE=/new/dir PANGOLIN_WC_PROJECT_ID=… bun scripts/e2e-wc.mjs
//
// Checks: dapp A and dapp B see different addresses; A reconnecting sees the
// same address as before; personal_sign from A recovers to A's address.
import { readFileSync } from 'node:fs';
import { SignClient } from '@walletconnect/sign-client';
import { hexlify, toUtf8Bytes, verifyMessage, verifyTypedData } from 'ethers';
import { createWallet, launch } from './smoke.mjs';

const projectId =
  process.env.PANGOLIN_WC_PROJECT_ID ??
  readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/PANGOLIN_WC_PROJECT_ID=(\w+)/)?.[1];
const PASSWORD = 'correct horse battery';
const CHAIN = 'eip155:11155111';

const { browser, popup } = await launch();
// Hard stop: a hung wait must still end the run and close Chromium.
setTimeout(() => {
  console.error('[wc] watchdog: no finish in 150 s');
  browser.close().finally(() => process.exit(1));
}, 150_000).unref();
const t0 = Date.now();
const log = (...a) => console.log(`[wc ${Math.round((Date.now() - t0) / 1000)}s]`, ...a);
const text = async () => (await popup.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const click = (re) =>
  popup.evaluate((src) => {
    const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src, 'i').test((x.textContent ?? '').trim()));
    if (!b) throw new Error(`no button ${src}`);
    b.click();
  }, re);
const waitText = async (re, timeout = 60000) => {
  try {
    await popup.waitForFunction((src) => new RegExp(src, 'i').test(document.body.innerText), { timeout, polling: 300 }, re);
  } catch (e) {
    console.log('[wc] waiting for', re, 'screen was:', (await text()).slice(0, 400));
    throw e;
  }
};

const phrase = await createWallet(popup, PASSWORD);
await waitText('Private balance');
log('wallet ready');

const dapp = async (name, url) =>
  SignClient.init({ projectId, metadata: { name, description: 'e2e', url, icons: [] } });

const connect = async (client, label) => {
  const { uri, approval } = await client.connect({
    optionalNamespaces: { eip155: { chains: [CHAIN], methods: ['personal_sign', 'eth_signTypedData_v4'], events: ['accountsChanged'] } },
  });
  await popup.evaluate(() => [...document.querySelectorAll('nav button')].find((b) => /apps/i.test(b.textContent)).click());
  const input = await popup.waitForSelector('input[placeholder="wc:…"]');
  await input.type(uri);
  await click('^connect$');
  await waitText('Sees', 30000);
  log(`${label} prompt:`, (await text()).slice(0, 200));
  await click('^connect$');
  const session = await approval();
  const address = session.namespaces.eip155.accounts[0].split(':')[2];
  log(`${label} sees`, address);
  return { session, address };
};

const A = await dapp('Dapp A', 'https://a.example');
const B = await dapp('Dapp B', 'https://b.example');
const a1 = await connect(A, 'A');
const b1 = await connect(B, 'B');
if (a1.address.toLowerCase() === b1.address.toLowerCase()) throw new Error('A and B share an address');
log('PASS distinct addresses per dapp');

// personal_sign from A
const message = 'pangolin e2e';
const pending = A.request({
  topic: a1.session.topic,
  chainId: CHAIN,
  request: { method: 'personal_sign', params: [hexlify(toUtf8Bytes(message)), a1.address] },
});
log('sent personal_sign');
await waitText('Sign message', 30000);
log('prompt shown');
await click('^sign$');
const signature = await pending;
const recovered = verifyMessage(message, signature);
if (recovered.toLowerCase() !== a1.address.toLowerCase()) throw new Error(`signature recovered ${recovered}`);
log('PASS personal_sign recovers to A');

// eth_signTypedData_v4 from B
const typed = {
  domain: { name: 'Pangolin e2e', version: '1', chainId: 11155111 },
  types: {
    EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }],
    Mail: [{ name: 'contents', type: 'string' }],
  },
  primaryType: 'Mail',
  message: { contents: 'hello' },
};
const pendingTyped = B.request({
  topic: b1.session.topic,
  chainId: CHAIN,
  request: { method: 'eth_signTypedData_v4', params: [b1.address, JSON.stringify(typed)] },
});
await waitText('Sign Mail', 30000);
await click('^sign$');
const typedSig = await pendingTyped;
const { EIP712Domain: _drop, ...types } = typed.types;
if (verifyTypedData(typed.domain, types, typed.message, typedSig).toLowerCase() !== b1.address.toLowerCase()) {
  throw new Error('typed signature does not recover to B');
}
log('PASS signTypedData_v4 recovers to B');

// A disconnects and reconnects with a new pairing: same address.
await A.disconnect({ topic: a1.session.topic, reason: { code: 6000, message: 'bye' } });
const A2 = await dapp('Dapp A', 'https://a.example');
const a2 = await connect(A2, 'A again');
if (a2.address.toLowerCase() !== a1.address.toLowerCase()) throw new Error('A got a new address on reconnect');
log('PASS reconnect keeps the address');

await popup.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^menu$/i.test(b.textContent.trim())).click());
await popup.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].find((b) => /addresses/i.test(b.textContent)).click());
await waitText('Main');
log('addresses:', (await text()).slice(0, 300));
await popup.screenshot({ path: new URL('../.cache/wc-addresses.png', import.meta.url).pathname });
await browser.close();
process.exit(0);
