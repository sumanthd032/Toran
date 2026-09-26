/**
 * Step 10 verification: the Curator Console and the fleet push. R14, R15.
 *
 * Boots a real Toran Core against a scratch copy of the archive, serves the
 * built static export, and does in a browser what a curator does: signs in,
 * confirms a provenance link, corrects an OCR line, changes a title, checks a
 * package's fixity and its rights, and pushes a new channel to a device. Each
 * decision is then read back from the files it should have reached, because a
 * console that says "saved" is only as good as the log behind it.
 *
 * The push is checked the whole way: Core stores it, a standalone kiosk takes
 * it on its next beat and reports running it, and the console says "applied"
 * only then. ARCHITECTURE.md section 10.
 *
 * The scratch archive links the repository's sources, manifests and tools and
 * copies everything a decision writes, so nothing here reaches data/curation.
 *
 *   npm run build:quiet && npm run verify:curator
 *
 * Uses Chrome when there is one, and Firefox otherwise.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = process.cwd();
const CORE_PORT = Number(process.env.CORE_PORT ?? 8791);
const WEB_PORT = Number(process.env.WEB_PORT ?? 4191);
const CORE = `http://127.0.0.1:${CORE_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const KEY = 'verify-curator-key-0000';
const NAME = 'Verify Curator';
const OUT = path.join(ROOT, 'apps/web/out');
const SHOTS = process.env.SHOTS ?? null;

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${detail === '' ? '' : `  (${detail})`}`);
};

if (!fs.existsSync(path.join(OUT, 'curator/index.html'))) {
  console.error('No export with /curator in it. Run npm run build:quiet first.');
  process.exit(1);
}

// ---- the scratch archive ----------------------------------------------------

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'toran-curator-'));
const link = (rel) => {
  fs.mkdirSync(path.dirname(path.join(scratch, rel)), { recursive: true });
  fs.symlinkSync(path.join(ROOT, rel), path.join(scratch, rel));
};
const copy = (rel) => {
  fs.mkdirSync(path.dirname(path.join(scratch, rel)), { recursive: true });
  fs.cpSync(path.join(ROOT, rel), path.join(scratch, rel), { recursive: true });
};
for (const rel of ['tools', 'pipeline', 'data/dip', 'data/sip']) link(rel);
for (const rel of ['data/fixity.json', 'data/curation', 'apps/web/public/archive'])
  copy(rel);
fs.mkdirSync(path.join(scratch, 'data/aip'), { recursive: true });
for (const entry of fs.readdirSync(path.join(ROOT, 'data/aip'))) {
  if (entry === 'premis.jsonl') copy('data/aip/premis.jsonl');
  else link(`data/aip/${entry}`);
}
const scratchFile = (rel) => path.join(scratch, rel);
const lines = (rel) =>
  fs.existsSync(scratchFile(rel))
    ? fs
        .readFileSync(scratchFile(rel), 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l))
    : [];
const before = {
  edges: lines('data/curation/edges.jsonl').length,
  premis: lines('data/aip/premis.jsonl').length,
};

// ---- Core and the static site -----------------------------------------------

const core = spawn(
  process.execPath,
  ['--no-warnings=ExperimentalWarning', 'apps/core/src/main.ts'],
  {
    env: {
      ...process.env,
      TORAN_CORE_PORT: String(CORE_PORT),
      TORAN_CORE_DB: path.join(scratch, 'core.sqlite'),
      TORAN_CURATOR_KEY: KEY,
      TORAN_ARCHIVE_ROOT: scratch,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  },
);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.opus': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
};
const site = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', WEB);
  let file = path.join(OUT, decodeURIComponent(url.pathname));
  if (!file.startsWith(OUT)) {
    res.writeHead(403).end();
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory())
    file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
  });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => site.listen(WEB_PORT, '127.0.0.1', resolve));

async function waitForCore() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${CORE}/v1/status`)).ok) return true;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const chrome = process.env.CHROME ?? '/usr/bin/google-chrome';
const browser = fs.existsSync(chrome)
  ? await puppeteer.launch({
      executablePath: chrome,
      headless: 'new',
      args: ['--no-sandbox'],
    })
  : await puppeteer.launch({
      browser: 'firefox',
      executablePath: process.env.FIREFOX ?? '/usr/bin/firefox',
      headless: true,
    });
const engine = fs.existsSync(chrome) ? 'chrome' : 'firefox';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Waits for text anywhere on the page. */
async function sees(page, text, timeout = 8000) {
  try {
    await page.waitForFunction(
      (t) => document.body.innerText.includes(t),
      { timeout },
      text,
    );
    return true;
  } catch {
    return false;
  }
}

/** Clicks the first button whose text is exactly this, inside `scope` when given. */
async function press(page, label, scope = 'body') {
  const clicked = await page.evaluate(
    (l, s) => {
      const root = document.querySelector(s);
      const button = [...(root?.querySelectorAll('button') ?? [])].find(
        (b) => b.textContent?.trim() === l && !b.disabled,
      );
      button?.click();
      return button !== undefined;
    },
    label,
    scope,
  );
  if (!clicked) throw new Error(`no enabled button "${label}"`);
}

/** Types into the input whose label is this text. React listens for input events. */
async function type(page, label, value, scope = 'body') {
  const id = await page.evaluate(
    (l, s) => {
      const root = document.querySelector(s);
      const found = [...(root?.querySelectorAll('label') ?? [])].find(
        (x) => x.textContent?.trim() === l,
      );
      return found?.htmlFor ?? null;
    },
    label,
    scope,
  );
  if (id === null) throw new Error(`no field labelled "${label}"`);
  await page.type(`[id="${id}"]`, value);
}

const shot = async (page, name) => {
  if (SHOTS !== null) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
  }
};

console.log(`Step 10: the Curator Console, in ${engine}\n`);

let page = null;
try {
  if (!(await waitForCore())) throw new Error('Core did not start');
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  // 1
  await page.goto(`${WEB}/curator/`, { waitUntil: 'load' });
  check(
    '1 with no Core named, the console says so and asks for nothing',
    await sees(page, 'not pointed at a Toran Core'),
  );

  // 2
  await page.goto(`${WEB}/curator/?core=${encodeURIComponent(CORE)}`, {
    waitUntil: 'load',
  });
  await sees(page, 'Sign in to change the archive');
  await type(page, 'Your name, as it goes in the record', NAME);
  await type(page, 'Curator key', 'not-the-key-at-all');
  await press(page, 'Sign in');
  check(
    '2 a wrong key is refused before anything can be written',
    await sees(page, 'did not accept that key'),
  );

  // 3
  await page.reload({ waitUntil: 'load' });
  await sees(page, 'Sign in to change the archive');
  await type(page, 'Your name, as it goes in the record', NAME);
  await type(page, 'Curator key', KEY);
  await press(page, 'Sign in');
  const queued = await sees(page, 'objects need a curator');
  const summary = await page.evaluate(
    () =>
      [...document.querySelectorAll('p')].find((p) =>
        p.textContent?.includes('objects need a curator'),
      )?.textContent ?? '',
  );
  check(
    '3 the right key opens the ingest queue',
    queued && (await sees(page, `Signed in as ${NAME}`)),
    summary,
  );
  await shot(page, 'curator-ingest');

  // 4. Fixity and rights on the first package in the queue.
  const firstItem = await page.evaluate(
    () => document.querySelector('li h3')?.textContent ?? '',
  );
  await press(page, 'Check fixity now', 'li');
  const intact = await sees(page, 'Intact');
  await type(
    page,
    'Where you checked it, and what it says',
    'Read the publisher page, 26 September 2026',
    'li',
  );
  await press(page, 'I checked these rights', 'li');
  const moved = await sees(page, `${String(Number(summary.split(' ')[0]) - 1)} of`);
  const rights = lines('data/curation/rights.jsonl');
  check(
    '4 a fixity check and a rights check are made, and the package leaves the queue',
    intact && moved && rights.at(-1)?.by === NAME,
    `${firstItem}, ${rights.length} rights decision`,
  );

  // 5. A provenance link.
  await press(page, 'Provenance links');
  await sees(page, 'awaiting a curator');
  await type(
    page,
    'A note for the record',
    'The later text cites the earlier by number.',
    'li',
  );
  await press(page, 'Confirm', 'li');
  await sees(page, `Confirmed by ${NAME}`);
  const decided = lines('data/curation/edges.jsonl');
  const graph = JSON.parse(
    fs.readFileSync(scratchFile('apps/web/public/archive/graph.json'), 'utf8'),
  );
  const drawn = graph.edges.find((e) => e.id === decided.at(-1)?.edge);
  check(
    '5 a confirmed link is in the log and the rebuilt graph draws it as confirmed by that curator',
    decided.length === before.edges + 1 && drawn?.confirmation?.by === NAME,
    `${decided.at(-1)?.edge}`,
  );
  await shot(page, 'curator-links');

  // 6. An OCR line.
  await press(page, 'OCR review');
  await sees(page, 'lines corrected');
  await type(
    page,
    'What the page actually says',
    'A LINE AS A CURATOR READ IT',
    'li[data-decided]',
  );
  await press(page, 'Save the correction', 'li[data-decided]');
  await sees(page, `Corrected by ${NAME}`);
  const corrections = JSON.parse(
    fs.readFileSync(scratchFile('apps/web/public/archive/corrections.json'), 'utf8'),
  );
  check(
    '6 an OCR correction is republished for the Manuscript Station, with the machine reading kept',
    corrections.at(-1)?.text === 'A LINE AS A CURATOR READ IT' &&
      typeof corrections.at(-1)?.was === 'string',
    `${corrections.at(-1)?.pageId} ${corrections.at(-1)?.regionId}`,
  );
  await shot(page, 'curator-ocr');

  // 7. A title.
  await press(page, 'Records');
  await sees(page, 'republishes the Reading Room');
  const titleId = await page.evaluate(
    () =>
      [...document.querySelectorAll('label')].find(
        (l) => l.textContent?.trim() === 'Title',
      )?.htmlFor ?? null,
  );
  // Select all by keyboard: a triple click selects one word in Firefox.
  await page.focus(`[id="${titleId}"]`);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type(
    `[id="${titleId}"]`,
    'Writings and Speeches, Volume 1 (edited by verify:curator)',
  );
  await press(page, 'Save to the record');
  await sees(page, `Changed by ${NAME}`);
  const manifest = JSON.parse(
    fs.readFileSync(scratchFile('apps/web/public/archive/manifest.json'), 'utf8'),
  );
  const graphAfter = fs.existsSync(scratchFile('apps/web/public/archive/graph.json'));
  const dc = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'data/aip/baws-v1/dublin-core.json'), 'utf8'),
  );
  check(
    '7 a title edit reaches the Reading Room manifest, leaves the submitted record alone, and deletes nothing',
    manifest.works.some(
      (w) => w.title === 'Writings and Speeches, Volume 1 (edited by verify:curator)',
    ) &&
      !dc.title.includes('verify:curator') &&
      graphAfter,
    `logged ${JSON.stringify(lines('data/curation/metadata.jsonl').at(-1)?.value)}, published ${JSON.stringify(manifest.works.find((w) => w.id === 'baws-v1')?.title)}`,
  );

  // 8. Every decision above is a PREMIS event with the curator as its agent.
  const events = lines('data/aip/premis.jsonl').slice(before.premis);
  check(
    '8 every decision is a PREMIS event naming the curator',
    events.length >= 5 && events.every((e) => e.linkingAgentIdentifier === NAME),
    [...new Set(events.map((e) => e.eventType))].join(', '),
  );

  // 9. The fleet: push a channel to a device, and watch it land.
  await press(page, 'Fleet');
  await sees(page, 'As Toran Core reported it');
  const device = 'dev-02';
  await page.evaluate((id) => {
    const row = [...document.querySelectorAll('li')].find((li) =>
      li.textContent?.includes(id),
    );
    [...(row?.querySelectorAll('button') ?? [])]
      .find((b) => b.textContent?.trim() === 'Change')
      ?.click();
  }, device);
  await sees(page, 'What it shows');
  await press(page, 'Timeline');
  await press(page, 'Send to the device');
  const stored = await sees(page, 'Stored as version 2');
  const kiosk = await browser.newPage();
  await kiosk.setViewport({ width: 1280, height: 800 });
  const pushedAt = Date.now();
  await kiosk.goto(`${WEB}/kiosk/${device}/?core=${encodeURIComponent(CORE)}`, {
    waitUntil: 'load',
  });
  let switched = false;
  try {
    await kiosk.waitForSelector('[data-testid="timeline"]', { timeout: 15000 });
    switched = true;
  } catch {
    switched = false;
  }
  check(
    '9 a pushed channel reaches a standalone kiosk, which switches to it',
    stored && switched,
    `${Date.now() - pushedAt} ms after load`,
  );

  // 10. Acknowledged: the kiosk's next beat reports version 2, and the console says so.
  const applied = await sees(page, 'The device is running version 2', 50_000);
  const fleet = await (await fetch(`${CORE}/v1/fleet`)).json();
  const health = fleet.health.find((h) => h.deviceId === device);
  check(
    '10 the device reports running the new version, and only then does the console say applied',
    applied && health?.configVersion === 2,
    `v${String(health?.configVersion)}, ${String(health?.state)}`,
  );
  await shot(page, 'curator-fleet');
  await kiosk.close();

  // 10a. The same push from the Twin, which is where ARCHITECTURE.md section
  // 10 draws it: the device sheet, a curator key, a channel.
  const twin = await browser.newPage();
  await twin.setViewport({ width: 1440, height: 900 });
  await twin.goto(`${WEB}/?core=${encodeURIComponent(CORE)}`, { waitUntil: 'load' });
  let twinPushed = false;
  let twinDetail = '';
  try {
    await twin.waitForFunction(
      () =>
        [...document.querySelectorAll('button')].some((b) =>
          /^\d+ devices$/.test(b.textContent?.trim() ?? ''),
        ),
      { timeout: 60_000 },
    );
    await twin.evaluate(() =>
      [...document.querySelectorAll('button')]
        .find((b) => /^\d+ devices$/.test(b.textContent?.trim() ?? ''))
        ?.click(),
    );
    await sees(twin, 'As Toran Core reported it', 15_000);
    await twin.evaluate(() => {
      const row = [...document.querySelectorAll('dialog li')].find((li) =>
        li.textContent?.includes('dev-03'),
      );
      [...(row?.querySelectorAll('button') ?? [])]
        .find((b) => b.textContent?.trim() === 'Change')
        ?.click();
    });
    await sees(twin, 'Sign in to change the archive');
    await type(twin, 'Your name, as it goes in the record', NAME, 'dialog');
    await type(twin, 'Curator key', KEY, 'dialog');
    await press(twin, 'Sign in', 'dialog');
    await sees(twin, 'What it shows');
    await press(twin, 'Audio Booth', 'dialog');
    await press(twin, 'Send to the device', 'dialog');
    twinPushed = await sees(twin, 'Stored as version 2');
    const after = await (await fetch(`${CORE}/v1/fleet/dev-03`)).json();
    twinDetail = `${after.channel} v${String(after.version)}`;
    twinPushed = twinPushed && after.channel === 'audio' && after.version === 2;
  } catch (error) {
    twinDetail = error instanceof Error ? error.message : String(error);
    await shot(twin, 'twin-failure');
  }
  check(
    "10a a curator pushes a channel from the Twin's device sheet, and Core stores it",
    twinPushed,
    twinDetail,
  );
  await shot(twin, 'twin-fleet');
  await twin.close();

  // 11. Signing out forgets the key.
  await press(page, 'Sign out');
  await page.reload({ waitUntil: 'load' });
  check(
    '11 signing out forgets the key for this tab',
    await sees(page, 'Sign in to change the archive'),
  );

  // 12. The real curation log was never touched.
  check(
    "12 nothing in this check reached the repository's own curation log",
    fs
      .readFileSync(path.join(ROOT, 'data/curation/edges.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean).length === before.edges &&
      !fs.existsSync(path.join(ROOT, 'data/curation/rights.jsonl')),
  );
} catch (error) {
  failures++;
  console.log(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  if (page !== null) await shot(page, 'failure');
} finally {
  await browser.close();
  core.kill('SIGTERM');
  site.close();
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log(
  failures === 0 ? '\nverify:curator passed' : `\nverify:curator: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
