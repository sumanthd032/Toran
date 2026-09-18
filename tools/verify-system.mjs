/**
 * Step 1 verification. Renders /system in a real browser and checks the
 * things CLAUDE.md section 10 states as numbers, rather than asserting them.
 */
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const TABLET = { width: 1280, height: 800, deviceScaleFactor: 2 };

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--font-render-hinting=none'],
});

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
};

const page = await browser.newPage();
await page.setViewport(TABLET);

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e.message)));

const resp = await page.goto(`${BASE}/system/`, {
  waitUntil: 'networkidle0',
  timeout: 30000,
});
console.log(
  `\nToran step 1 verification  (${TABLET.width}x${TABLET.height} @${TABLET.deviceScaleFactor}x)\n`,
);
check('page responds 200', resp.status() === 200, `status ${resp.status()}`);

// --- fonts actually loaded, not fallbacks ---
const fonts = await page.evaluate(async () => {
  await document.fonts.ready;
  return [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.style}`).sort();
});
const families = new Set(fonts.map((f) => f.split(' ')[0]));
check(
  'Spectral loaded',
  [...families].some((f) => f === 'Spectral'),
);
check(
  'Archivo loaded',
  [...families].some((f) => f === 'Archivo'),
);
check(
  'Noto loaded',
  fonts.some((f) => f.startsWith('Noto')),
);
check(
  'JetBrains loaded',
  fonts.some((f) => f.startsWith('JetBrains')),
);

// --- the 30mm touch contract, measured on a real button ---
const geom = await page.evaluate(() => {
  const btn = document.querySelector('button');
  const r = btn.getBoundingClientRect();
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;width:30mm;visibility:hidden';
  document.body.appendChild(probe);
  const mm30 = probe.getBoundingClientRect().width;
  probe.remove();
  return { h: r.height, w: r.width, mm30 };
});
check(
  'button meets 30mm minimum height',
  geom.h >= geom.mm30 - 0.5,
  `${geom.h.toFixed(1)}px vs 30mm = ${geom.mm30.toFixed(1)}px`,
);

// --- body text is at least 24px ---
const bodyPx = await page.evaluate(() => {
  const p = [...document.querySelectorAll('p')].find((n) => n.textContent.length > 40);
  return parseFloat(getComputedStyle(p).fontSize);
});
check('body text >= 24px', bodyPx >= 24, `${bodyPx}px`);

// --- baseline grid is shared between scripts ---
const baseline = await page.evaluate(() => {
  const root = getComputedStyle(document.documentElement);
  return root.getPropertyValue('--baseline').trim();
});
check('baseline token resolves', baseline.length > 0, baseline);

// --- no help buttons anywhere, per Gammon and Burch ---
const helpCount = await page.evaluate(
  () =>
    [...document.querySelectorAll('button,a')].filter((n) =>
      /help|\?/i.test(n.textContent),
    ).length,
);
check('zero help buttons', helpCount === 0, `found ${helpCount}`);

// --- light theme shot ---
await page.screenshot({ path: 'tools/shots/system-light.png', fullPage: true });

// --- switch to hall (dark) ---
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  const hall = btns.find((b) => /hall|कक्ष|दालन/i.test(b.textContent));
  hall?.click();
});
await new Promise((r) => setTimeout(r, 400));
const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
check('hall theme applies', darkBg === 'rgb(20, 18, 16)', darkBg);
await page.screenshot({ path: 'tools/shots/system-dark.png', fullPage: true });

// --- switch language to Marathi and confirm the UI actually changes ---
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  btns.find((b) => b.textContent.trim() === 'मराठी')?.click();
});
await new Promise((r) => setTimeout(r, 400));
const langState = await page.evaluate(() => ({
  lang: document.documentElement.lang,
  heading: document.querySelector('h1')?.textContent ?? '',
}));
check('language switches to mr', langState.lang === 'mr', `lang=${langState.lang}`);
check('UI text is translated', /रचना|प्रणाली/.test(langState.heading), langState.heading);
await page.screenshot({ path: 'tools/shots/system-marathi.png', fullPage: true });

check(
  'no console errors',
  consoleErrors.length === 0,
  consoleErrors.slice(0, 3).join(' | '),
);

await browser.close();
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
