/**
 * Step 5 kiosk verification, against the shipped build.
 *
 * The idle timings (45, 90 and 120 seconds) are covered by the state machine's
 * unit tests with exact timestamps; waiting two minutes in a browser proves
 * nothing those do not.
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startDaemon } from './fake-daemon.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const axeSource = fs.readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const PANEL_PPI = Math.hypot(1920, 1080) / 15.6;
const CAP = 0.672;
const ADA_3M_MM = (5 / 8 + (3 / 0.3048 - 6) / 8) * 25.4;

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });

async function open(path, viewport = { width: 1280, height: 800 }) {
  const page = await browser.newPage();
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error' && !/8765/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  return { page, errors };
}
const stateOf = (page) => page.$eval('[data-testid="kiosk"]', (n) => n.getAttribute('data-state'));

console.log('\nToran step 5 kiosk verification\n');

// ---- the tablet case: no sensor ----
{
  const { page, errors } = await open('/kiosk/dev-01/');
  await wait(600);
  check('null driver boots to subtle', (await stateOf(page)) === 'subtle', await stateOf(page));
  check('no console errors, no hydration mismatch', errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.close();
}

// ---- the simulator walks every state ----
{
  const { page } = await open('/kiosk/dev-01/?sensor=sim');
  const trail = [];
  for (const key of ['0', '2', '3', '4', '0']) {
    await page.keyboard.press(key);
    await wait(700);
    trail.push(await stateOf(page));
  }
  const expected = ['ambient', 'implicit', 'subtle', 'personal', 'decaying'];
  check('simulator walks ambient, implicit, subtle, personal, and leaving decays', trail.join() === expected.join(), trail.join(' > '));
  await page.close();
}

// ---- the hardware driver, through a daemon on the real socket ----
{
  const daemon = await startDaemon();
  const { page } = await open('/kiosk/dev-01/?sensor=hw&status');
  await wait(900);
  check('hardware driver connects to the daemon', daemon.connected() >= 1, `${daemon.connected()} connection`);
  const trail = [];
  for (const m of [4.0, 2.2, 1.0, 0.3]) {
    daemon.set(m);
    await wait(900);
    trail.push(await stateOf(page));
  }
  check('daemon readings drive the kiosk through each zone', trail.join() === 'ambient,implicit,subtle,personal', trail.join(' > '));

  // Jitter across the 1.5 m boundary must not flicker the screen.
  daemon.set(1.0);
  await wait(900);
  const seen = new Set();
  for (const m of [1.45, 1.55, 1.48, 1.62, 1.51, 1.58]) {
    daemon.set(m);
    await wait(250);
    seen.add(await stateOf(page));
  }
  check('a reading jittering around 1.5 m does not flicker', seen.size === 1 && seen.has('subtle'), [...seen].join(','));

  daemon.set(0.3);
  await wait(900);
  await daemon.stop();
  await wait(4200);
  const after = await stateOf(page);
  const session = await page.$eval('[data-testid="kiosk-status"]', (n) => n.textContent ?? '');
  check('losing the daemon mid session keeps the visitor', after === 'personal' && /held/.test(session), `${after}, session ${/held/.test(session) ? 'held' : 'lost'}`);
  await page.close();
}

// ---- the hardware driver with no daemon at all degrades to a touch kiosk ----
{
  const { page } = await open('/kiosk/dev-01/?sensor=hw');
  await wait(4200);
  check('no daemon: the kiosk is a touch kiosk, not stuck in its attract loop', (await stateOf(page)) === 'subtle', await stateOf(page));
  await page.close();
}

// ---- legibility at 3 m on the kiosk panel ----
{
  const scale = (PANEL_PPI / 96).toFixed(3);
  const { page } = await open(`/kiosk/dev-01/?sensor=sim&scale=${scale}`, { width: 1920, height: 1080 });
  await page.keyboard.press('0');
  await wait(900);
  const px = await page.$eval('[data-testid="kiosk-ambient"] h1', (n) => parseFloat(getComputedStyle(n).fontSize));
  const capMm = px * CAP * (25.4 / PANEL_PPI);
  check(
    'ambient headline legible at 3 m on the 15.6 inch panel',
    capMm >= ADA_3M_MM,
    `capital ${capMm.toFixed(1)} mm, ADA 703.5.5 minimum at 3 m is ${ADA_3M_MM.toFixed(1)} mm (${px.toFixed(0)} px at ${PANEL_PPI.toFixed(0)} ppi)`,
  );
  await page.screenshot({ path: 'tools/shots/kiosk-panel-ambient.png' });
  await page.close();
}

// ---- every ambient passage is cited, and a debate names who spoke ----
{
  const { page } = await open('/kiosk/dev-01/?sensor=sim');
  await page.keyboard.press('0');
  await wait(900);
  const r = await page.evaluate(async () => {
    const data = await (await fetch('/kiosk/ambient.json')).json();
    const quotes = [...document.querySelectorAll('[data-testid="kiosk-ambient"] blockquote')];
    const shown = (p) => quotes.find((q) => q.textContent.includes(p.text.slice(0, 40)));
    const spoken = data.filter((p) => p.speaker !== null);
    return {
      quotes: quotes.length,
      cited: quotes.filter((q) => q.querySelector('cite') !== null).length,
      spoken: spoken.length,
      named: spoken.filter((p) => shown(p)?.textContent.includes(p.speaker)).length,
    };
  });
  check('every ambient passage carries its citation', r.quotes > 0 && r.cited === r.quotes, `${r.cited} of ${r.quotes}`);
  check('every ambient passage from a debate names who spoke', r.named === r.spoken, `${r.named} of ${r.spoken}`);
  await page.close();
}

// ---- kiosk contracts in the engaged state ----
{
  const { page } = await open('/kiosk/dev-01/');
  await page.mouse.click(640, 300);
  await wait(700);
  const nav = await page.$$eval('nav button', (b) => b.map((n) => n.getAttribute('aria-label')).filter(Boolean));
  check('exactly three navigation affordances', ['Back', 'Home', 'Forward'].every((l) => nav.includes(l)) && nav.filter((l) => /Back|Home|Forward/.test(l)).length === 3, nav.join(', '));
  const help = await page.$$eval('button, a', (b) => b.filter((n) => /\bhelp\b|\?$/i.test(n.textContent ?? '')).length);
  check('zero help buttons', help === 0, `${help}`);
  const mm30 = await page.evaluate(() => {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;height:30mm;visibility:hidden';
    document.body.appendChild(d);
    const h = d.getBoundingClientRect().height;
    d.remove();
    return h;
  });
  const heights = await page.$$eval('nav button', (b) => b.map((n) => n.getBoundingClientRect().height));
  check('every control in the reach zone is at least 30 mm', Math.min(...heights) >= mm30 - 0.5, `smallest ${Math.min(...heights).toFixed(0)} px, 30 mm is ${mm30.toFixed(0)} px`);
  const reachTop = await page.$eval('nav', (n) => n.getBoundingClientRect().top);
  check('controls sit in the bottom third', reachTop >= 800 * (2 / 3) - 1, `nav begins at ${reachTop.toFixed(0)} px of 800`);

  await page.evaluate(axeSource);
  for (const state of ['personal', 'ambient']) {
    if (state === 'ambient') {
      await page.goto(`${BASE}/kiosk/dev-01/?sensor=sim`, { waitUntil: 'networkidle0' });
      await page.keyboard.press('0');
      await wait(900);
      await page.evaluate(axeSource);
    }
    const r = await page.evaluate(async () =>
      // eslint-disable-next-line no-undef
      await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }),
    );
    check(`no accessibility violations, ${state}`, r.violations.length === 0, r.violations.map((v) => `${v.id}(${v.nodes.length})`).join(', '));
  }
  await page.close();
}

// ---- the kiosk in the Twin is the kiosk that ships ----
{
  const fingerprint = (page) =>
    page.$eval('[data-testid="kiosk"]', (root) => {
      const skip = root.querySelector('[data-testid="kiosk-status"]');
      return [...root.querySelectorAll('h1, h2, button, input, label, nav, [role]')]
        .filter((n) => !skip || !skip.contains(n))
        .map((n) => `${n.tagName.toLowerCase()}|${n.getAttribute('aria-label') ?? ''}|${(n.textContent ?? '').trim().slice(0, 40)}`);
    });
  // Compare both at the same point: engaged, with on-device search loaded.
  // The suggestions only appear once the model is ready, and the second page
  // gets the model from cache, so comparing on a timer compared two different
  // moments rather than two different builds.
  const ready = (page) =>
    page.waitForFunction(
      () => [...document.querySelectorAll('[data-testid="kiosk"] button')].some((b) => /Mahad/.test(b.textContent ?? '')),
      { timeout: 60000 },
    );
  const a = await open('/kiosk/dev-01/');
  await a.page.mouse.click(640, 300);
  await ready(a.page);
  const standalone = await fingerprint(a.page);
  const b = await open('/?device=dev-01&quality=low');
  await b.page.waitForSelector('[data-testid="kiosk"]');
  await ready(b.page);
  const twin = await fingerprint(b.page);
  const same = standalone.length > 0 && standalone.join('\n') === twin.join('\n');
  check('the kiosk inside the Twin is identical to the standalone route', same, `${standalone.length} elements compared`);
  if (!same) {
    const onlyA = standalone.filter((x) => !twin.includes(x)).slice(0, 3);
    const onlyB = twin.filter((x) => !standalone.includes(x)).slice(0, 3);
    console.log('        standalone only:', onlyA.join(' ; '));
    console.log('        twin only:', onlyB.join(' ; '));
  }
  await a.page.close();
  await b.page.close();
}

await browser.close();
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
