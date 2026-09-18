/**
 * Step 4 verification. Runs the shipped build in Chrome on the real GPU.
 *
 * The GPU here is an AMD Radeon 680M, an integrated laptop part. It is not the
 * tablet, and nothing this script measures is reported as the tablet's
 * number. The tablet is measured by opening the hall with ?perf on it.
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const GPU = [
  '--no-sandbox',
  '--use-angle=vulkan',
  '--enable-gpu',
  '--ignore-gpu-blocklist',
];
const axeSource = fs.readFileSync('node_modules/axe-core/axe.min.js', 'utf8');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

async function open(browser, query, { reduced = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  if (reduced)
    await page.emulateMediaFeatures([
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ]);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const external = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:'))
      external.push(u);
  });
  await page.goto(`${BASE}/${query}`, { waitUntil: 'domcontentloaded' });
  return { page, errors, external };
}

console.log('\nToran step 4 verification  (AMD Radeon 680M, not the tablet)\n');

// ---- cold load and entry, each tier in a fresh browser so the cache is cold ----
for (const tier of ['high', 'low']) {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: GPU,
  });
  const { page, errors, external } = await open(browser, `?quality=${tier}`);
  await page.waitForFunction(() => window.__toranTwin?.entryEnd != null, {
    timeout: 30000,
  });
  await new Promise((r) => setTimeout(r, 1200));
  const t = await page.evaluate(() => window.__toranTwin);
  const frames = [...t.entryFrames].sort((a, b) => a - b);
  const p95 = frames[Math.floor(frames.length * 0.95)] ?? 0;
  const worst = frames[frames.length - 1] ?? 0;
  const entryMs = t.entryEnd - t.entryStart;
  check(
    `[${tier}] cold load to steady flight under 3s`,
    t.entryStart < 3000,
    `${Math.round(t.entryStart)}ms from navigation`,
  );
  check(`[${tier}] entry under 4s`, entryMs < 4000, `${Math.round(entryMs)}ms`);
  check(
    `[${tier}] flight holds 60fps`,
    p95 < 20,
    `${frames.length} frames, p95 ${p95.toFixed(1)}ms, worst ${worst.toFixed(1)}ms`,
  );
  check(
    `[${tier}] steady state 60fps`,
    t.frame.fps > 57,
    `${t.frame.fps.toFixed(1)} fps, ${t.frame.calls} draws, ${t.frame.triangles.toLocaleString('en')} triangles`,
  );
  check(`[${tier}] draw call budget`, t.frame.calls <= 150, `${t.frame.calls} of 150`);
  check(
    `[${tier}] triangle budget`,
    t.frame.triangles <= 250000,
    `${t.frame.triangles.toLocaleString('en')} of 250,000`,
  );
  const mb = t.textureBytes / 1048576;
  check(
    `[${tier}] texture memory budget`,
    mb <= 40,
    `${mb.toFixed(1)} MB of 40, render targets excluded`,
  );
  check(
    `[${tier}] no third party requests`,
    external.length === 0,
    external.slice(0, 2).join(' '),
  );
  check(
    `[${tier}] no console errors`,
    errors.length === 0,
    errors.slice(0, 2).join(' | '),
  );
  await browser.close();
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: GPU,
});

// ---- reduced motion: instant cut ----
{
  const { page } = await open(browser, '?quality=low', { reduced: true });
  await page.waitForFunction(() => window.__toranTwin?.entryEnd != null, {
    timeout: 30000,
  });
  const t = await page.evaluate(() => window.__toranTwin);
  const cut = t.entryEnd - t.entryStart;
  check(
    'reduced motion gives an instant cut',
    cut < 50,
    `${Math.round(cut)}ms, no flight`,
  );
  await page.close();
}

// ---- tap to skip ----
{
  const { page } = await open(browser, '?quality=low');
  await page.waitForFunction(() => window.__toranTwin?.entryStart != null, {
    timeout: 30000,
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.mouse.click(640, 400);
  await page.waitForFunction(() => window.__toranTwin?.entryEnd != null, {
    timeout: 5000,
  });
  const t = await page.evaluate(() => window.__toranTwin);
  const took = t.entryEnd - t.entryStart;
  check(
    'a tap during the entry skips it',
    took < 1500,
    `ended at ${Math.round(took)}ms of 3600`,
  );
  await page.close();
}

// ---- device sheet, selection round trip, accessibility of the DOM ----
{
  const { page, errors } = await open(browser, '?quality=low');
  await page.waitForFunction(() => window.__toranTwin?.entryEnd != null, {
    timeout: 30000,
  });
  await new Promise((r) => setTimeout(r, 900));

  const clickButton = async (pattern) => {
    const handles = await page.$$('button');
    for (const h of handles) {
      const text = await h.evaluate((n) => n.textContent ?? '');
      if (pattern.test(text)) {
        await h.click();
        return true;
      }
    }
    return false;
  };

  check('device sheet opens', await clickButton(/13 devices/), '');
  await page.waitForSelector('dialog[open]', { timeout: 3000 });
  const rows = await page.$$eval('dialog[open] li button', (b) => b.length);
  check('sheet lists all thirteen devices', rows === 13, `${rows} rows`);
  const offline = await page.$$eval(
    'dialog[open] li',
    (li) => li.filter((n) => /Offline \d+ min/.test(n.textContent ?? '')).length,
  );
  check(
    'an offline device reports how long it has been offline',
    offline >= 1,
    `${offline} offline`,
  );

  await clickButton(/Manuscripts/);
  await page.waitForFunction(() => !document.querySelector('dialog[open]'), {
    timeout: 3000,
  });
  await clickButton(/13 devices/);
  await page.waitForSelector('dialog[open]', { timeout: 3000 });
  const pressed = await page.$$eval('dialog[open] li button[aria-pressed="true"]', (b) =>
    b.map((n) => n.textContent),
  );
  check(
    'selection survives the round trip',
    pressed.length === 1 && /Manuscripts/.test(pressed[0] ?? ''),
    pressed.join(' '),
  );

  const targets = await page.$$eval('dialog[open] li button', (b) =>
    b.map((n) => n.getBoundingClientRect().height),
  );
  const mm30 = await page.evaluate(() => {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;height:30mm;visibility:hidden';
    document.body.appendChild(d);
    const h = d.getBoundingClientRect().height;
    d.remove();
    return h;
  });
  check(
    'device rows meet the 30mm target',
    Math.min(...targets) >= mm30 - 0.5,
    `smallest ${Math.min(...targets).toFixed(0)}px, 30mm is ${mm30.toFixed(0)}px`,
  );

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'), {
    timeout: 3000,
  });
  await page.screenshot({ path: 'tools/shots/twin-selected.png' });

  await page.evaluate(axeSource);
  const results = await page.evaluate(
    async () =>
      // eslint-disable-next-line no-undef
      await axe.run(document, {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
        },
      }),
  );
  check(
    'no accessibility violations',
    results.violations.length === 0,
    results.violations.map((v) => `${v.id} (${v.nodes.length})`).join(', '),
  );
  check(
    'no console errors in the hall',
    errors.length === 0,
    errors.slice(0, 2).join(' | '),
  );
  await page.close();
}

await browser.close();
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
