// Focuses every input, textarea and select on every popup screen (dark mode)
// and checks: no outline is drawn on the field itself, and the field or its
// wrapper shows the accent border. Saves a strip of screenshots.
//   PANGOLIN_PROFILE=/new/dir bun scripts/check-focus.mjs
import { launch } from './smoke.mjs';

const { browser, popup } = await launch();
await popup.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
const out = new URL('../.cache/focus/', import.meta.url).pathname;
await Bun.write(`${out}.keep`, '');
const click = (re) =>
  popup.evaluate((src) => {
    const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src, 'i').test(x.textContent.trim()));
    if (!b) throw new Error(`no button ${src}`);
    b.click();
  }, re);
const nav = (re) => popup.evaluate((src) => [...document.querySelectorAll('nav button')].find((b) => new RegExp(src, 'i').test(b.textContent)).click(), re);
const settle = () => new Promise((r) => setTimeout(r, 400));

const results = [];
const checkScreen = async (screen) => {
  await settle();
  const count = await popup.evaluate(() => document.querySelectorAll('input, textarea, select').length);
  for (let i = 0; i < count; i += 1) {
    const r = await popup.evaluate((i) => {
      const el = document.querySelectorAll('input, textarea, select')[i];
      el.focus();
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const toRgb = (hex) => {
        const n = parseInt(hex.slice(1), 16);
        return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
      };
      const accentRgb = toRgb(accent);
      const cs = getComputedStyle(el);
      // The field or the nearest bordered ancestor should carry the focus border.
      let box = el;
      while (box && getComputedStyle(box).borderTopWidth === '0px') box = box.parentElement;
      const border = box ? getComputedStyle(box).borderTopColor : 'none';
      const rect = (box ?? el).getBoundingClientRect();
      return {
        label: el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.type || el.tagName.toLowerCase(),
        tag: el.tagName.toLowerCase(),
        outline: cs.outlineStyle,
        accentBorder: border === accentRgb,
        border,
        rect: { x: Math.max(0, rect.x - 6), y: Math.max(0, rect.y - 6), width: Math.min(380, rect.width + 12), height: rect.height + 12 },
      };
    }, i);
    const ok = r.outline === 'none' && r.accentBorder;
    results.push({ screen, ...r, ok });
    await popup.screenshot({ path: `${out}${screen}-${i}.png`, clip: r.rect });
  }
};

// Onboarding: create (two passwords), then import (textarea + two passwords).
await popup.waitForSelector('input[type=password]');
await checkScreen('onboard-create');
await click('^import$');
await checkScreen('onboard-import');
await click('^new wallet$');
const pw = await popup.$$('input[type=password]');
await pw[0].type('correct horse battery');
await pw[1].type('correct horse battery');
await click('^create$');
await popup.waitForFunction(() => /saved it/i.test(document.body.innerText));
await click('saved it');
await popup.waitForFunction(() => /private balance/i.test(document.body.innerText));

await nav('send');
await checkScreen('send');
await nav('home');
await click('^swap$');
await checkScreen('swap');
await nav('apps');
await checkScreen('apps');
await nav('addresses');
await checkScreen('addresses');
await nav('home');
await click('get a name');
await checkScreen('name');
await nav('home');
await click('^lock$');
await popup.waitForFunction(() => /unlock/i.test(document.body.innerText));
await checkScreen('unlock');

for (const r of results) console.log(r.ok ? 'ok  ' : 'FAIL', r.screen.padEnd(15), r.tag.padEnd(8), r.label.padEnd(18), `outline=${r.outline}`, `accentBorder=${r.accentBorder}`, r.ok ? '' : r.border);
console.log(`${results.filter((r) => r.ok).length}/${results.length} fields ok`);
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
