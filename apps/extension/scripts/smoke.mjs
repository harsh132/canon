// Loads dist/ into Chromium and drives the popup. Prints the core's console.
//   bun scripts/smoke.mjs [--headful] [--keep]
// Env: PANGOLIN_PROFILE (user-data dir, default .cache/profile), CHROME (binary).
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(app, 'dist');
export const launch = async ({ headful = process.argv.includes('--headful') } = {}) => {
  // Read at call time: importers may set it after this module has loaded.
  const profile = process.env.PANGOLIN_PROFILE ?? join(app, '.cache', 'profile');
  mkdirSync(profile, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME ?? '/usr/bin/chromium',
    headless: !headful,
    userDataDir: profile,
    // Proving blocks the extension's renderer (core and UI share it) for minutes.
    protocolTimeout: 900_000,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, '--no-first-run', '--window-size=420,720'],
  });
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'), { timeout: 15000 });
  const id = new URL(sw.url()).host;
  const core = await browser.waitForTarget((t) => t.url().endsWith('/offscreen.html'), { timeout: 15000 });
  const corePage = await core.asPage();
  corePage.on('console', (m) => console.log(`[core:${m.type()}]`, m.text().slice(0, 400)));
  corePage.on('pageerror', (e) => console.log('[core:pageerror]', String(e).slice(0, 400)));
  // A failed script must not leave Chromium holding the terminal.
  const bail = async (e) => {
    console.error('[smoke] failed:', e?.message ?? e);
    await browser.close().catch(() => {});
    process.exit(1);
  };
  process.on('uncaughtException', bail);
  process.on('unhandledRejection', bail);
  const popup = await browser.newPage();
  await popup.setViewport({ width: 380, height: 640 });
  popup.on('console', (m) => console.log(`[popup:${m.type()}]`, m.text().slice(0, 300)));
  popup.on('pageerror', (e) => console.log('[popup:pageerror]', String(e).slice(0, 300)));
  await popup.goto(`chrome-extension://${id}/popup.html`);
  return { browser, id, popup, corePage };
};

if (import.meta.main) {
  const { browser, popup } = await launch();
  await new Promise((r) => setTimeout(r, 4000));
  console.log('popup text:', (await popup.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 300));
  await popup.screenshot({ path: join(app, '.cache', 'popup.png') });
  if (!process.argv.includes('--keep')) await browser.close();
}

/** Onboard a new phrase wallet: pick New wallet, set the password, read the phrase, pass the word check. Returns the phrase. */
export const createWallet = async (page, password) => {
  const click = (re) =>
    page.evaluate((src) => {
      const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src, 'i').test((x.textContent ?? '').trim()));
      if (!b) throw new Error(`no button ${src}`);
      b.click();
    }, re);
  const waitText = (re, timeout = 60000) => page.waitForFunction((src) => new RegExp(src, 'i').test(document.body.innerText), { timeout, polling: 200 }, re);
  await waitText('new wallet');
  await click('^new wallet');
  await page.waitForSelector('input[type=password]');
  const pw = await page.$$('input[type=password]');
  await pw[0].type(password);
  await pw[1].type(password);
  await click('^create$');
  await waitText('saved it');
  const phrase = await page.evaluate(() => [...document.querySelectorAll('ol li')].map((li) => li.textContent.replace(/^\d+/, '').trim()).join(' '));
  await click('^saved it$');
  await page.waitForSelector('input[aria-label^="Word"]');
  const words = phrase.split(' ');
  for (const input of await page.$$('input[aria-label^="Word"]')) {
    const n = Number((await input.evaluate((el) => el.getAttribute('aria-label'))).split(' ')[1]);
    await input.type(words[n - 1]);
  }
  await click('^done$');
  return phrase;
};
