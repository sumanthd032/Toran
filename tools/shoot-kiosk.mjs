/**
 * Photographs a standalone kiosk in each proximity state, walking a simulated
 * visitor up to it with the keyboard simulator. For looking at, not grading.
 */
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const device = process.argv[2] ?? 'dev-01';
const size = (process.argv[3] ?? '1280x800').split('x').map(Number);

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: size[0], height: size[1], deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`${BASE}/kiosk/${device}/?sensor=sim&status`, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
const state = () => page.$eval('[data-testid="kiosk"]', (n) => n.getAttribute('data-state'));
const settle = () => new Promise((r) => setTimeout(r, 1300));

await settle();
const steps = [['0', 'ambient'], ['2', 'implicit'], ['3', 'subtle'], ['4', 'personal']];
for (const [key, name] of steps) {
  await page.keyboard.press(key);
  await settle();
  const s = await state();
  await page.screenshot({ path: `tools/shots/kiosk-${device}-${name}.png` });
  console.log(`  key ${key}  expected ${name.padEnd(9)} got ${s}`);
}
if (errors.length) console.log('console:', errors.slice(0, 4).join(' | '));
await browser.close();
