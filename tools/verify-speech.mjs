/**
 * Step 10 verification: a search asked aloud. D-129, D-158.
 *
 * A kiosk with no Core shows no microphone. A kiosk pointed at a Core that
 * holds Bhashini credentials shows one; a tap listens, a second tap stops,
 * and the recording goes to Core as the WAV the recogniser asks for. What
 * comes back is either the words, which then run as a search, or a plain
 * "that did not come through". Both are the kiosk doing its job; which one
 * happened is reported, because only the first measures Bhashini itself.
 *
 * The microphone is the browser's fake one: Firefox's generated tone, or
 * Chrome's --use-fake-device-for-media-stream. A tone is not speech, so a
 * recogniser that is up may still hear nothing in it.
 *
 *   npm run build:quiet && npm run verify:speech
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { serveExport, sleep, startCore } from './lib/stage.mjs';

const ROOT = process.cwd();
const CORE_PORT = Number(process.env.CORE_PORT ?? 8795);
const WEB_PORT = Number(process.env.WEB_PORT ?? 4195);
const CORE = `http://127.0.0.1:${CORE_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const OUT = path.join(ROOT, 'apps/web/out');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${detail === '' ? '' : `  (${detail})`}`);
};

const chrome = process.env.CHROME ?? '/usr/bin/google-chrome';
const browser = fs.existsSync(chrome)
  ? await puppeteer.launch({
      executablePath: chrome,
      headless: 'new',
      args: [
        '--no-sandbox',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
      ],
    })
  : await puppeteer.launch({
      browser: 'firefox',
      executablePath: process.env.FIREFOX ?? '/usr/bin/firefox',
      headless: true,
      extraPrefsFirefox: {
        'media.navigator.streams.fake': true,
        'media.navigator.permission.disabled': true,
      },
    });

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'toran-speech-'));
const stopCore = await startCore(CORE_PORT, {
  TORAN_CORE_DB: path.join(scratch, 'core.sqlite'),
});
const stopSite = await serveExport(OUT, WEB_PORT);

console.log('Step 10: spoken queries\n');

async function room(withCore) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const url = `${WEB}/kiosk/dev-01/?${withCore ? `core=${encodeURIComponent(CORE)}&` : 'core=&'}status`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('[data-testid="reading-query"]:not([disabled])', {
    timeout: 120_000,
  });
  return page;
}

try {
  const status = await (await fetch(`${CORE}/v1/status`)).json();
  const serves = status.services.includes('language');

  // 1
  const alone = await room(false);
  await sleep(1500);
  check(
    '1 with no Core, the Reading Room shows no microphone',
    (await alone.$('[data-testid="reading-speak"]')) === null,
  );
  await alone.close();

  if (!serves) {
    console.log(
      '\nThis Core has no Bhashini credentials, so it serves no speech. Nothing more to check.',
    );
  } else {
    // 2
    const page = await room(true);
    const shown = await page
      .waitForSelector('[data-testid="reading-speak"]', { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    check('2 with a Core that serves speech, the microphone is offered', shown);

    // 3
    const answered = new Promise((resolve) => {
      page.on('response', (r) => {
        if (
          r.url().endsWith('/v1/language/transcribe') &&
          r.request().method() === 'POST'
        ) {
          void r
            .text()
            .catch(() => '')
            .then((body) => {
              if (r.status() !== 200 && r.status() !== 503)
                console.log(`      Core said: ${body}`);
              resolve(r.status());
            });
        }
      });
    });
    await page.click('[data-testid="reading-speak"]');
    const listening = await page
      .waitForFunction(
        () =>
          document
            .querySelector('[data-testid="reading-speech"]')
            ?.textContent?.startsWith('Listening'),
        { timeout: 5000 },
      )
      .then(() => true)
      .catch(() => false);
    await sleep(2000);
    const tapped = Date.now();
    await page.click('[data-testid="reading-speak"]');
    check('3 a tap listens and says so, and a second tap stops', listening);

    // 4
    const code = await Promise.race([answered, sleep(12_000).then(() => 'none')]);
    check(
      '4 the recording reaches Core as the WAV the recogniser accepts',
      code === 200 || code === 503,
      code === 200
        ? '200, recognised'
        : code === 503
          ? '503, the recogniser did not answer'
          : `status ${String(code)}`,
    );

    // 5
    const settled = await page
      .waitForFunction(
        () => {
          const note =
            document.querySelector('[data-testid="reading-speech"]')?.textContent ?? '';
          return note === '' || note.startsWith('That did not come through');
        },
        { timeout: 10_000 },
      )
      .then(() => true)
      .catch(() => false);
    const note = await page
      .$eval('[data-testid="reading-speech"]', (e) => e.textContent)
      .catch(() => '');
    const query = await page.$eval('[data-testid="reading-query"]', (e) => e.value);
    check(
      '5 the kiosk ends in words searched or a plain "did not come through", never a hang',
      settled,
      `${Date.now() - tapped} ms after Done: ${note === '' ? `searched "${query}"` : note}`,
    );
    console.log(
      code === 200
        ? '\nBhashini recognised the recording.'
        : '\nBhashini did not recognise it, so live recognition is unmeasured by this run.',
    );
  }
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
  failures === 0 ? '\nverify:speech passed' : `\nverify:speech: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
