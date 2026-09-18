/**
 * Captures a device transition, in and out, on the real GPU. Screenshots stall
 * the page, so frame times from this run mean nothing; verify-transition.mjs
 * measures timing in a clean run.
 */
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const label = process.argv[2] ?? 'Reading Room';
const tier = process.argv[3] ?? 'high';
const GPU = ['--no-sandbox', '--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'];

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: GPU });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`${BASE}/?quality=${tier}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__toranTwin?.entryEnd != null, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 900));

async function pressButton(pattern) {
  for (const h of await page.$$('button')) {
    const text = await h.evaluate((n) => n.textContent ?? '');
    if (pattern.test(text)) { await h.click(); return true; }
  }
  return false;
}

await pressButton(/13 devices/);
await page.waitForSelector('dialog[open]');
const rows = await page.$$('dialog[open] li button');
for (const r of rows) {
  if ((await r.evaluate((n) => n.textContent ?? '')).includes(label)) { await r.click(); break; }
}
const t0 = Date.now();
for (const [at, name] of [[350, '1-flight'], [880, '2-reveal'], [1180, '3-arrive'], [1400, '4-expand']]) {
  const wait = at - (Date.now() - t0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  await page.screenshot({ path: `tools/shots/transition-${name}.png` });
}
await page.waitForFunction(() => window.__toranTwin?.transitionPhase === 'open', { timeout: 10000 });
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: 'tools/shots/transition-5-open.png' });

await page.keyboard.press('Escape');
const t1 = Date.now();
for (const [at, name] of [[250, '6-collapse'], [900, '7-flyout']]) {
  const wait = at - (Date.now() - t1);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  await page.screenshot({ path: `tools/shots/transition-${name}.png` });
}
await page.waitForFunction(() => window.__toranTwin?.transitionPhase === 'hall', { timeout: 10000 });
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'tools/shots/transition-8-hall.png' });

const t = await page.evaluate(() => window.__toranTwin);
console.log(JSON.stringify({ arrivalRect: t.arrivalRect, before: t.poseBeforeOpen, after: t.poseAfterClose, url: page.url() }, null, 1));
if (errors.length) console.log('console:', errors.slice(0, 4).join(' | '));
await browser.close();
