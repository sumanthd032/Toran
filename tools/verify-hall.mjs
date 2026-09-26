/**
 * The Twin as deployed: one Toran Core serving the built Twin and running the
 * living hall, opened in a browser at Core's own origin. D-160, D-161, D-162.
 *
 * This is the product as a visitor to the deployed site meets it, so every
 * check reads what is on the page, not what Core says it sent. The drift can
 * take a few minutes to appear, because the simulated visitors keep the real
 * timings: an empty spell, an arrival, 30 s with one work, then a beat.
 *
 *   npm run build:hall && npm run verify:hall
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep, startCore } from './lib/stage.mjs';

const ROOT = process.cwd();
const PORT = Number(process.env.CORE_PORT ?? 8797);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOTS ?? null;

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${detail === '' ? '' : `  (${detail})`}`);
};

const built = fs.readFileSync(path.join(ROOT, 'apps/web/out/index.html'), 'utf8');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'toran-hall-'));
const stopCore = await startCore(PORT, {
  TORAN_CORE_DB: path.join(scratch, 'core.sqlite'),
  TORAN_WEB_ROOT: 'apps/web/out',
  TORAN_SIMULATE_HALL: '1',
});
const { browser, engine } = await launchBrowser();

const sheet = async (page) => {
  await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .find((b) => /^\d+ devices$/.test(b.textContent?.trim() ?? ''))
      ?.click(),
  );
  return page.evaluate(() => document.querySelector('dialog[open]')?.textContent ?? '');
};
const closeSheet = (page) => page.keyboard.press('Escape');

console.log(`The Twin as deployed, in ${engine}\n`);

try {
  // 1
  const index = await fetch(`${ORIGIN}/`);
  const api = await fetch(`${ORIGIN}/v1/status`);
  check(
    '1 one origin serves the Twin and the API',
    index.ok &&
      (await index.text()) === built &&
      (await api.json()).service === 'toran-core',
  );

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${ORIGIN}/`, { waitUntil: 'load' });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('button')].some((b) =>
        /^\d+ devices$/.test(b.textContent?.trim() ?? ''),
      ),
    { timeout: 90_000 },
  );
  // Every simulated device reports within one 30 s beat of Core starting.
  await sleep(35_000);

  // 2
  const first = await sheet(page);
  await closeSheet(page);
  const simulated = /(\d+) of these devices are simulated visitors/.exec(first)?.[1];
  check(
    '2 with no ?core= in the address, the Twin shows the hall as Core reports it, and says which visitors are simulated',
    first.includes('As Toran Core reported it') && Number(simulated) >= 10,
    `${String(simulated)} simulated`,
  );

  // 3. The Honeypot Fleet, read off the device list: a device drifting toward a work.
  let drifting = null;
  const started = Date.now();
  while (drifting === null && Date.now() - started < 420_000) {
    await sleep(15_000);
    await sheet(page);
    drifting = await page.evaluate(
      () =>
        document.querySelector('dialog[open] [data-testid="fleet-drift"]')?.textContent ??
        null,
    );
    await closeSheet(page);
  }
  check(
    '3 a simulated reader drifts a neighbour, and the Twin names the work it drifts toward',
    drifting !== null,
    drifting === null
      ? 'no drift in 7 minutes'
      : `${Math.round((Date.now() - started) / 1000)} s: "${drifting.trim()}"`,
  );
  if (SHOTS !== null) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'hall.png') });
  }

  // 4. ?visitors=0 shows only what real kiosks report, which here is nothing.
  const quiet = await browser.newPage();
  await quiet.setViewport({ width: 1440, height: 900 });
  await quiet.goto(`${ORIGIN}/?visitors=0`, { waitUntil: 'load' });
  await quiet.waitForFunction(
    () =>
      [...document.querySelectorAll('button')].some((b) =>
        /^\d+ devices$/.test(b.textContent?.trim() ?? ''),
      ),
    { timeout: 90_000 },
  );
  await sleep(6000);
  const quietText = await sheet(quiet);
  check(
    '4 with ?visitors=0 the simulated visitors are gone, and so is their drift',
    quietText.includes('As Toran Core reported it') &&
      !quietText.includes('simulated visitor') &&
      !quietText.includes('Read nearby'),
  );
  await quiet.close();
} catch (error) {
  failures++;
  console.log(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser.close();
  stopCore();
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log(
  failures === 0 ? '\nverify:hall passed' : `\nverify:hall: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
