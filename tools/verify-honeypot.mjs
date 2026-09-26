/**
 * Step 10 verification: the Honeypot Fleet. PROJECT.md section 6.3.
 *
 * Two real kiosks and a real Core. A visitor at the Provenance kiosk (dev-03)
 * traces the Mahad Satyagraha; after the engagement threshold and a beat, the
 * Manuscript kiosk 5.6 m away (dev-07) drifts its attract loop to passages of
 * the same work and says why. The visitor leaves, and the drift ends. Then the
 * Timeline Wall (dev-04) is checked against a neighbour reporting a work, so
 * the wall's own loop is seen drifting too, as PROJECT.md's example has it.
 *
 * The timings are the real ones: 30 s of engagement and a beat every 30 s,
 * so this check takes about three minutes and waits honestly for each.
 *
 *   npm run build:quiet && npm run verify:honeypot
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, serveExport, sleep, startCore } from './lib/stage.mjs';

const ROOT = process.cwd();
const CORE_PORT = Number(process.env.CORE_PORT ?? 8792);
const WEB_PORT = Number(process.env.WEB_PORT ?? 4192);
const CORE = `http://127.0.0.1:${CORE_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const OUT = path.join(ROOT, 'apps/web/out');
const WORK = 'baws-v17-1';

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${detail === '' ? '' : `  (${detail})`}`);
};

// The passages a drift toward the work may show, read from the same files the kiosk reads.
const ambient = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'apps/web/public/kiosk/ambient.json'), 'utf8'),
);
const timeline = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'apps/web/public/archive/timeline.json'), 'utf8'),
);
const ofWork = new Set(
  [...ambient, ...timeline.events.flatMap((e) => e.passages)]
    .filter((p) => p.workId === WORK)
    .map((p) => p.text.trim()),
);

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'toran-honeypot-'));
const stopCore = await startCore(CORE_PORT, {
  TORAN_CORE_DB: path.join(scratch, 'core.sqlite'),
});
const stopSite = await serveExport(OUT, WEB_PORT);
const { browser, engine } = await launchBrowser();

const kioskUrl = (device) =>
  `${WEB}/kiosk/${device}/?core=${encodeURIComponent(CORE)}&sensor=sim&status`;

/** The Timeline Wall is a 1920 x 1080 panel; the rest are the 1280 x 800 tablet. */
async function kiosk(device, size = { width: 1280, height: 800 }) {
  const page = await browser.newPage();
  await page.setViewport(size);
  await page.goto(kioskUrl(device), { waitUntil: 'load' });
  await page.waitForSelector('[data-testid="kiosk"]');
  return page;
}

/** The passage the attract loop is showing, and whether it says it drifted. */
const loop = (page) =>
  page.evaluate(() => ({
    nearby: document.querySelector('[data-testid="kiosk-nearby"]')?.textContent ?? null,
    shown:
      document.querySelector(
        '[data-testid="kiosk-ambient"] blockquote[data-shown="true"] p',
      )?.textContent ?? null,
  }));

async function until(test, timeout, step = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await test()) return Date.now() - started;
    await sleep(step);
  }
  return null;
}

console.log(`Step 10: the Honeypot Fleet, in ${engine}\n`);

try {
  const reader = await kiosk('dev-03');
  const neighbour = await kiosk('dev-07');

  // 1
  const before = await loop(neighbour);
  check(
    '1 with nobody reading nearby, the neighbour shows its own loop and no drift line',
    before.nearby === null,
  );

  // A visitor steps up to the Provenance kiosk and traces the Mahad Satyagraha.
  await reader.keyboard.press('4');
  await reader.waitForFunction(
    () =>
      document.querySelector('[data-testid="kiosk"]')?.getAttribute('data-state') ===
      'personal',
  );
  await reader.waitForSelector('[data-node="mahad-1927"]', { timeout: 20_000 });
  // Dispatched in the page: the node's button sits on a transformed canvas
  // that Firefox's pointer emulation will not aim at.
  const traceMahad = () =>
    reader.evaluate(() => {
      document
        .querySelector('[data-testid="kiosk"]')
        ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      document.querySelector('[data-node="mahad-1927"]')?.click();
    });
  const startedReading = Date.now();
  // Reading is not standing still: a finger on the page every ten seconds,
  // so the kiosk does not decay under someone who is plainly there.
  const keepReading = setInterval(() => void traceMahad().catch(() => undefined), 10_000);
  await traceMahad();

  // 2
  const drifted = await until(async () => {
    const now = await loop(neighbour);
    return now.nearby !== null && now.shown !== null && ofWork.has(now.shown.trim());
  }, 120_000);
  const during = await loop(neighbour);
  if (process.env.SHOTS) {
    fs.mkdirSync(process.env.SHOTS, { recursive: true });
    await neighbour.screenshot({
      path: path.join(process.env.SHOTS, 'honeypot-neighbour.png'),
    });
  }
  check(
    '2 after the engagement threshold and a beat, the neighbour 5.6 m away drifts to the same work, and says so',
    drifted !== null && Date.now() - startedReading >= 30_000,
    drifted === null
      ? 'no drift in 120 s'
      : `${Math.round((Date.now() - startedReading) / 1000)} s after the visitor began, "${during.nearby}"`,
  );

  // 3. What crossed the wire is a work id and nothing else. The fleet view
  // says which devices drift and toward what, never which device is being
  // read, and carries no card at all. D-162.
  const fleet = await (await fetch(`${CORE}/v1/fleet`)).json();
  const { drift, ...rest } = fleet;
  const readerNamed = drift.some((d) => d.deviceId === 'dev-03');
  check(
    '3 the fleet view names the drifting neighbour, never the device being read, and no card',
    drift.some((d) => d.deviceId === 'dev-07' && d.work === WORK) &&
      !readerNamed &&
      !JSON.stringify(rest).includes(WORK) &&
      !JSON.stringify(fleet).includes('sim-card'),
    drift.map((d) => `${d.deviceId} toward ${d.work}`).join(', '),
  );

  // 4. The visitor walks away. The drift ends within two beats.
  clearInterval(keepReading);
  await reader.keyboard.press('0');
  const ended = await until(async () => (await loop(neighbour)).nearby === null, 90_000);
  check(
    '4 when the visitor leaves, the neighbour returns to its own loop',
    ended !== null,
    ended === null ? 'still drifting after 90 s' : `${Math.round(ended / 1000)} s`,
  );

  // 5. A device more than 8 m away never drifts. dev-12 is 21 m from dev-03.
  const far = await fetch(`${CORE}/v1/fleet/dev-12/beat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      state: 'ambient',
      configVersion: 1,
      uptimeSeconds: 1,
      topic: null,
    }),
  }).then((r) => r.json());
  check('5 a device beyond the radius is not drifted', far.drift === null);

  // 6. The Timeline Wall's own loop. A neighbour 6 m away (dev-05) reports
  // the work, the way its kiosk would; the wall at dev-04 drifts its story.
  const report = () =>
    fetch(`${CORE}/v1/fleet/dev-05/beat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        state: 'personal',
        configVersion: 1,
        uptimeSeconds: 60,
        topic: WORK,
      }),
    });
  await report();
  const keepReporting = setInterval(() => void report(), 20_000);
  const wall = await kiosk('dev-04', { width: 1920, height: 1080 });
  const wallDrifted = await until(
    () =>
      wall.evaluate(
        () => document.querySelector('[data-testid="timeline-nearby"]') !== null,
      ),
    60_000,
  );
  clearInterval(keepReporting);
  if (process.env.SHOTS) {
    // After the ambient fade, which takes about two seconds.
    await sleep(4000);
    await wall.screenshot({ path: path.join(process.env.SHOTS, 'honeypot-wall.png') });
  }
  check(
    '6 the Timeline Wall drifts its own story toward a work read 6 m away',
    wallDrifted !== null,
    wallDrifted === null
      ? 'no drift in 60 s'
      : `${Math.round(wallDrifted / 1000)} s after the wall loaded`,
  );
} catch (error) {
  failures++;
  console.log(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser.close();
  stopCore();
  await stopSite();
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log(
  failures === 0 ? '\nverify:honeypot passed' : `\nverify:honeypot: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
