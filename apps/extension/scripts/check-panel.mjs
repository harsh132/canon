// Side panel check: the service worker opens the panel on icon click, and the
// panel page fills narrow, medium and wide panels at full height.
//   PANGOLIN_PROFILE=/new/dir bun scripts/check-panel.mjs
import { launch } from './smoke.mjs';

const { browser, popup, id } = await launch();
const sw = await (await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'))).worker();
console.log('panel behavior:', JSON.stringify(await sw.evaluate(() => chrome.sidePanel.getPanelBehavior())));
console.log('panel options:', JSON.stringify(await sw.evaluate(() => chrome.sidePanel.getOptions({}))));

// Create a wallet in the popup tab first so the panel shows Home.
const click = (page, re) =>
  page.evaluate((src) => [...document.querySelectorAll('button')].find((b) => new RegExp(src, 'i').test(b.textContent.trim())).click(), re);
await popup.waitForSelector('input[type=password]');
const pw = await popup.$$('input[type=password]');
await pw[0].type('correct horse battery');
await pw[1].type('correct horse battery');
await click(popup, '^create$');
await popup.waitForFunction(() => /saved it/i.test(document.body.innerText));
await click(popup, 'saved it');
await popup.waitForFunction(() => /private balance/i.test(document.body.innerText));
const popupBox = await popup.evaluate(() => ({ w: document.body.offsetWidth, h: document.body.offsetHeight }));
console.log('popup body:', popupBox);

const panel = await browser.newPage();
await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
await panel.goto(`chrome-extension://${id}/panel.html`);
await panel.waitForFunction(() => /private balance/i.test(document.body.innerText), { timeout: 30000 });
for (const [w, h] of [[320, 900], [420, 900], [560, 900], [420, 520]]) {
  await panel.setViewport({ width: w, height: h });
  await new Promise((r) => setTimeout(r, 300));
  const m = await panel.evaluate(() => {
    const nav = document.querySelector('nav').getBoundingClientRect();
    return {
      bodyW: document.body.offsetWidth,
      scrollW: document.documentElement.scrollWidth,
      navBottom: Math.round(nav.bottom),
      viewH: innerHeight,
    };
  });
  const fits = m.scrollW <= w && m.bodyW === w && m.navBottom === m.viewH;
  console.log(`${fits ? 'ok  ' : 'FAIL'} ${w}x${h}`, JSON.stringify(m));
  await panel.screenshot({ path: new URL(`../.cache/panel-${w}x${h}.png`, import.meta.url).pathname });
}
await browser.close();
process.exit(0);
