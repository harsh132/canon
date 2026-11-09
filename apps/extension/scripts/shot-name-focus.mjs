// Visual check: the name field focused, in dark mode. Fresh profile each run.
//   CANON_PROFILE=/new/dir bun scripts/shot-name-focus.mjs
import { fileURLToPath } from 'node:url';
import { createWallet, launch } from './smoke.mjs';

const { browser, popup } = await launch();
await popup.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
const click = (re) =>
  popup.evaluate((src) => [...document.querySelectorAll('button')].find((b) => new RegExp(src, 'i').test(b.textContent.trim())).click(), re);
const phrase = await createWallet(popup, 'correct horse battery');
await popup.waitForFunction(() => /private balance/i.test(document.body.innerText));
await click('^menu$');
await click('get a name');
const input = await popup.waitForSelector('input[aria-label="Name label"]');
await input.type('alice');
console.log('focused input outline-style:', await popup.evaluate(() => getComputedStyle(document.activeElement).outlineStyle));
await popup.screenshot({ path: fileURLToPath(new URL('../.cache/name-focus.png', import.meta.url)), clip: { x: 0, y: 0, width: 380, height: 200 } });
await browser.close();
process.exit(0);
