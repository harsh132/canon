// Visual check: the name field focused, in dark mode. Fresh profile each run.
//   PANGOLIN_PROFILE=/new/dir bun scripts/shot-name-focus.mjs
import { launch } from './smoke.mjs';

const { browser, popup } = await launch();
await popup.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
const click = (re) =>
  popup.evaluate((src) => [...document.querySelectorAll('button')].find((b) => new RegExp(src, 'i').test(b.textContent.trim())).click(), re);
await popup.waitForSelector('input[type=password]');
const pw = await popup.$$('input[type=password]');
await pw[0].type('correct horse battery');
await pw[1].type('correct horse battery');
await click('^create$');
await popup.waitForFunction(() => /saved it/i.test(document.body.innerText));
await click('saved it');
await popup.waitForFunction(() => /get a name/i.test(document.body.innerText));
await click('get a name');
const input = await popup.waitForSelector('input[aria-label="Name label"]');
await input.type('alice');
console.log('focused input outline-style:', await popup.evaluate(() => getComputedStyle(document.activeElement).outlineStyle));
await popup.screenshot({ path: new URL('../.cache/name-focus.png', import.meta.url).pathname, clip: { x: 0, y: 0, width: 380, height: 200 } });
await browser.close();
process.exit(0);
