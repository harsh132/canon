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
