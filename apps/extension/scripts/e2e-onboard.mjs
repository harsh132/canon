// Onboarding, all three ways in, in one fresh profile (reset between):
//   1. first install opens the onboarding tab
//   2. New wallet: password, phrase, a wrong word is refused, the right ones pass
//   3. Restore: a pasted phrase fills the grid, a bad word is flagged, the wallet matches the phrase
//   4. Passkey (virtual authenticator with PRF): create, lock, unlock with it,
//      erase, then "Use existing passkey" brings back the same wallet
//   PANGOLIN_PROFILE=/new/dir bun scripts/e2e-onboard.mjs
import { HDNodeWallet, Mnemonic, randomBytes } from 'ethers';
import { createWallet, launch } from './smoke.mjs';

const { browser, popup } = await launch();
let fails = 0;
const check = (ok, what) => {
  if (!ok) fails += 1;
  console.log(ok ? 'ok  ' : 'FAIL', what);
};
const text = async () => (await popup.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const click = (re) =>
  popup.evaluate((src) => {
    const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src, 'i').test((x.textContent ?? '').trim()));
    if (!b) throw new Error(`no button ${src}`);
    b.click();
  }, re);
const waitText = async (re, timeout = 30000) => {
  try {
    await popup.waitForFunction((src) => new RegExp(src, 'i').test(document.body.innerText), { timeout, polling: 200 }, re);
  } catch (e) {
    console.log('waiting for', re, '| screen:', (await text()).slice(0, 300));
    throw e;
  }
};
const nav = (re) => popup.evaluate((src) => [...document.querySelectorAll('nav button')].find((b) => new RegExp(src, 'i').test(b.textContent)).click(), re);
// React-controlled fields: set the value natively, then fire input.
const setValue = (handle, v) =>
  handle.evaluate((el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
const mainOf = (phrase) => HDNodeWallet.fromPhrase(phrase, undefined, "m/44'/60'/0'/0/0").address;
const shownMain = async () => {
  await nav('home');
  await click('^receive$');
  await waitText('0zk');
  const addr = (await text()).match(/0x[0-9a-fA-F]{40}/)?.[0];
  await nav('home');
  return addr;
};
const erase = async () => {
  await click('^lock$');
  await waitText('^reset$|reset');
  await click('^reset$');
  await click('^erase this wallet$');
  await waitText('new wallet');
};

// 1. Onboarding tab on first install.
const tab = await browser.waitForTarget((t) => t.url().endsWith('/onboard.html'), { timeout: 10000 }).catch(() => null);
check(!!tab, 'first install opens onboard.html in a tab');
const onboardPage = tab ? await tab.page() : null;

// 2. New wallet, with the word check.
await waitText('new wallet');
await click('^new wallet');
await popup.waitForSelector('input[type=password]');
let pw = await popup.$$('input[type=password]');
await pw[0].type('correct horse battery');
await pw[1].type('correct horse battery');
await click('^create$');
await waitText('saved it');
const phrase1 = await popup.evaluate(() => [...document.querySelectorAll('ol li')].map((li) => li.textContent.replace(/^\d+/, '').trim()).join(' '));
await click('^saved it$');
await popup.waitForSelector('input[aria-label^="Word"]');
const asks = await popup.$$('input[aria-label^="Word"]');
for (const input of asks) await input.type('zoo');
await click('^done$');
await waitText("doesn't match");
check(true, `wrong words refused (asked ${asks.length})`);
const words1 = phrase1.split(' ');
for (const input of asks) {
  const n = Number((await input.evaluate((el) => el.getAttribute('aria-label'))).split(' ')[1]);
  await setValue(input, words1[n - 1]);
}
await click('^done$');
await waitText('private balance');
check((await shownMain())?.toLowerCase() === mainOf(phrase1).toLowerCase(), 'new wallet: Main matches its phrase');
if (onboardPage) {
  await onboardPage.waitForFunction(() => /open pangolin from the toolbar/i.test(document.body.innerText), { timeout: 10000 }).then(
    () => check(true, 'onboarding tab shows Ready once the wallet exists'),
    () => check(false, 'onboarding tab shows Ready once the wallet exists'),
  );
}

// 3. Restore from a phrase.
await erase();
const phrase2 = Mnemonic.fromEntropy(randomBytes(16)).phrase;
await click('^restore');
await popup.waitForSelector('input[aria-label="Word 1"]');
const first = await popup.$('input[aria-label="Word 1"]');
await first.focus();
await popup.evaluate((v) => {
  const el = document.querySelector('input[aria-label="Word 1"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, phrase2);
const filled = await popup.evaluate(() => [...document.querySelectorAll('input[aria-label^="Word"]')].map((i) => i.value).join(' '));
check(filled === phrase2, 'pasted phrase fills all 12 words');
const w5 = await popup.$('input[aria-label="Word 5"]');
await setValue(w5, 'notaword');
const flagged = await popup.evaluate(() => document.querySelector('input[aria-label="Word 5"]').closest('label').className.includes('border-danger'));
check(flagged && !(await popup.$('input[type=password]')), 'a bad word is flagged and blocks the password step');
await setValue(w5, phrase2.split(' ')[4]);
await popup.waitForSelector('input[type=password]');
pw = await popup.$$('input[type=password]');
await pw[0].type('correct horse battery');
await pw[1].type('correct horse battery');
// The header's back button is also called Restore; submit is the last one.
await popup.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /^restore$/i.test(b.textContent.trim())).pop().click());
await waitText('private balance');
check((await shownMain())?.toLowerCase() === mainOf(phrase2).toLowerCase(), 'restore: Main matches the phrase');

// 4. Passkey.
await erase();
const cdp = await popup.createCDPSession();
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true },
});
await click('^passkey');
await click('^create passkey$');
await waitText('saved it|skip');
const phrase3 = await popup.evaluate(() => [...document.querySelectorAll('ol li')].map((li) => li.textContent.replace(/^\d+/, '').trim()).join(' '));
check(/optional/i.test(await text()), 'passkey: phrase backup is optional');
await click('^skip$');
await waitText('private balance');
const main3 = await shownMain();
check(main3?.toLowerCase() === mainOf(phrase3).toLowerCase(), 'passkey: Main matches the phrase shown');

await click('^lock$');
await waitText('unlock with passkey');
check(!(await popup.$('input[type=password]')), 'passkey wallet: no password field on unlock');
await click('^unlock with passkey$');
await waitText('private balance');
check((await shownMain())?.toLowerCase() === main3.toLowerCase(), 'passkey unlock opens the same wallet');

// Recovery phrase from the menu, behind the passkey.
await click('^menu$');
await click('^recovery phrase$');
await click('^show with passkey$');
await waitText('anyone with these words');
const revealed = await popup.evaluate(() => [...document.querySelectorAll('ol li')].map((li) => li.textContent.replace(/^\d+/, '').trim()).join(' '));
check(revealed === phrase3, 'menu: recovery phrase shown after the passkey, and it matches');
await click('^hide$');

await erase();
await click('^passkey');
await click('^use existing passkey$');
await waitText('private balance');
check((await shownMain())?.toLowerCase() === main3.toLowerCase(), 'existing passkey restores the same wallet after erase');

// The phrase path still works after all that.
await erase();
await createWallet(popup, 'correct horse battery');
await waitText('private balance');
check(true, 'createWallet helper');

await browser.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
