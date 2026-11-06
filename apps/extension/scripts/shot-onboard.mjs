// Screenshots of the onboarding screens (light), into .cache/onboard-shots/.
//   PANGOLIN_PROFILE=/new/dir bun scripts/shot-onboard.mjs
import { launch } from './smoke.mjs';

const { browser, popup } = await launch();
const out = new URL('../.cache/onboard-shots/', import.meta.url).pathname;
await Bun.write(`${out}.keep`, '');
const click = (re, last = false) =>
  popup.evaluate(
    (src, last) => {
      const all = [...document.querySelectorAll('button')].filter((x) => new RegExp(src, 'i').test((x.textContent ?? '').trim()));
      (last ? all.pop() : all[0]).click();
    },
    re,
    last,
  );
const waitText = (re) => popup.waitForFunction((src) => new RegExp(src, 'i').test(document.body.innerText), { timeout: 30000, polling: 200 }, re);
const shot = async (name) => {
  await new Promise((r) => setTimeout(r, 300));
  await popup.screenshot({ path: `${out}${name}.png` });
};
const cdp = await popup.createCDPSession();
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true },
});

await waitText('new wallet');
await shot('1-welcome');
await click('^restore');
await popup.waitForSelector('input[aria-label="Word 1"]');
await popup.type('input[aria-label="Word 1"]', 'abandon');
await popup.type('input[aria-label="Word 2"]', 'abaxyz');
await shot('2-restore');
await click('^restore$');
await click('^passkey');
await waitText('create passkey');
await shot('3-passkey');
await click('^create passkey$');
await waitText('skip');
await shot('4-backup-optional');
await click('^saved it$');
await popup.waitForSelector('input[aria-label^="Word"]');
await shot('5-check');
await click('^check$');
await click('^skip$');
await waitText('private balance');
await click('^lock$');
await waitText('unlock with passkey');
await shot('6-unlock-passkey');
await browser.close();
process.exit(0);
