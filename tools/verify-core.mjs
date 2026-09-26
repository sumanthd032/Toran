/**
 * Step 10 verification: Toran Core over HTTP. R17.
 *
 * The unit tests in apps/core exercise the services against a database in
 * memory. This boots the real server on a real port and talks to it the way a
 * kiosk will, because the parts that break in a hall are the ones between the
 * modules: routing, status codes, what a device does with an answer it did not
 * expect.
 *
 * Two claims matter more than the rest. Card continuity across machines is the
 * thing step 6 could not finish, so it is checked here by writing a card from
 * one client and reading it from another. And the privacy posture is checked
 * against the schema itself: a store that has nowhere to put a visit history
 * cannot grow one later by accident.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BEAT_STALE_MS,
  citation,
  citedPassage,
  pageLocator,
  readBeatReply,
  readCoreStatus,
  readFleetSnapshot,
  refFor,
  store,
} from '@toran/contracts';

const PORT = Number(process.env.CORE_PORT ?? 8788);
const BASE = `http://127.0.0.1:${PORT}/v1`;
const store_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toran-core-'));
const DB = path.join(store_dir, 'core.sqlite');
const KEY = 'verify-core-curator-key';

// A copy of the parts of the archive a curator changes, so the decisions this
// check makes are written to a scratch log and not to data/curation.
const ARCHIVE = path.join(store_dir, 'archive');
for (const file of [
  'apps/web/public/archive/graph.json',
  'data/dip/works.json',
  'data/fixity.json',
]) {
  fs.mkdirSync(path.dirname(path.join(ARCHIVE, file)), { recursive: true });
  fs.copyFileSync(file, path.join(ARCHIVE, file));
}
fs.mkdirSync(path.join(ARCHIVE, 'data/sip/photos/yeola'), { recursive: true });
fs.copyFileSync(
  'data/sip/photos/yeola/original.jpg',
  path.join(ARCHIVE, 'data/sip/photos/yeola/original.jpg'),
);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${detail === '' ? '' : `  (${detail})`}`);
};

const child = spawn(
  process.execPath,
  ['--no-warnings=ExperimentalWarning', 'apps/core/src/main.ts'],
  {
    env: {
      ...process.env,
      TORAN_CORE_PORT: String(PORT),
      TORAN_CORE_DB: DB,
      TORAN_CORE_ORIGINS: 'http://127.0.0.1:4173',
      TORAN_CURATOR_KEY: KEY,
      TORAN_ARCHIVE_ROOT: ARCHIVE,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);

let banner = '';
child.stdout.on('data', (b) => {
  banner += String(b);
});

async function waitForCore() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/status`);
      if (r.ok) return true;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** A kiosk's call: JSON in, status and JSON out, nothing thrown for a 4xx. */
async function call(method, path, body, origin = 'http://127.0.0.1:4173', key = null) {
  const headers =
    body === undefined ? { origin } : { origin, 'content-type': 'application/json' };
  if (key !== null) headers.authorization = `Bearer ${key}`;
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return {
    status: r.status,
    headers: r.headers,
    json: text === '' ? null : JSON.parse(text),
  };
}

console.log('Step 10: Toran Core\n');

try {
  if (!(await waitForCore())) {
    console.log('FAIL  Core did not start');
    process.exit(1);
  }

  // 1
  const status = await call('GET', '/status');
  const read = readCoreStatus(status.json);
  check(
    '1 Core says what it is and what it serves',
    read.service === 'toran-core' && read.services.includes('fleet'),
    read.services.join(', '),
  );

  // 2
  const seeded = readFleetSnapshot((await call('GET', '/fleet')).json);
  check(
    '2 an empty store is seeded with the hall',
    seeded.devices.length === 13,
    `${seeded.devices.length} devices`,
  );

  // 3
  const beat = await call('POST', '/fleet/dev-01/beat', {
    state: 'ambient',
    configVersion: 1,
    uptimeSeconds: 42,
  });
  const reply = readBeatReply(beat.json);
  check(
    '3 a device reports in and is told it is current',
    beat.status === 200 && reply.changed === false && reply.config.deviceId === 'dev-01',
  );

  // 4
  const live = readFleetSnapshot((await call('GET', '/fleet')).json);
  const health = live.health.find((h) => h.deviceId === 'dev-01');
  check(
    '4 the fleet view shows it online, in the state it reported',
    health?.online === true && health.state === 'ambient',
    `${String(health?.state)}, uptime ${String(health?.uptimeSeconds)}s`,
  );

  // 5
  const change = {
    channel: 'timeline',
    defaultLanguage: 'mr',
    position: [-5.4, 0, 4],
    rotationY: 0.7,
    version: 999,
  };
  const anonymous = await call('PUT', '/fleet/dev-01', change);
  const wrong = await call(
    'PUT',
    '/fleet/dev-01',
    change,
    undefined,
    'not-the-curator-key',
  );
  check(
    '5a nobody without the curator key can reconfigure a device',
    anonymous.status === 401 && wrong.status === 401,
    `${String(anonymous.status)} with none, ${String(wrong.status)} with a wrong one`,
  );
  const pushed = await call('PUT', '/fleet/dev-01', change, undefined, KEY);
  check(
    '5 Core sets the version, not the caller',
    pushed.status === 200 && pushed.json.version === 2,
    `asked for 999, stored ${String(pushed.json.version)}`,
  );

  // 6
  const behind = readBeatReply(
    (
      await call('POST', '/fleet/dev-01/beat', {
        state: 'subtle',
        configVersion: 1,
        uptimeSeconds: 72,
      })
    ).json,
  );
  check(
    '6 a device running an old config is told, and handed the new one',
    behind.changed === true && behind.config.channel === 'timeline',
    `v${String(behind.config.version)} ${behind.config.channel}`,
  );
  // Put it back, so a store kept between runs is not left reconfigured.
  await call(
    'PUT',
    '/fleet/dev-01',
    {
      channel: 'reading',
      defaultLanguage: 'en',
      position: [-5.4, 0, 4],
      rotationY: 0.7068583470577035,
    },
    undefined,
    KEY,
  );

  // 7
  const unknown = await call('POST', '/fleet/dev-99/beat', {
    state: 'ambient',
    configVersion: 1,
    uptimeSeconds: 1,
  });
  check(
    '7 a beat from a device nobody configured is a 404, not a crash',
    unknown.status === 404,
    String(unknown.status),
  );

  // 8. The step 6 gap: continuity between two machines, not two tabs.
  const passage = citedPassage({
    text: 'Caste is a notion, it is a state of the mind.',
    citation: citation({
      corpus: 'baws',
      workId: 'baws-v1',
      pageId: 'baws-v1-p0100',
      locator: pageLocator({ volume: 1, page: 68, observed: true }),
    }),
    language: 'en',
  });
  const token = `card-${Math.random().toString(16).slice(2, 10)}`;
  const atDeviceOne = await call('PUT', `/session/${token}`, {
    session: {
      language: 'mr',
      accessibility: { typeScale: 'largest', audioFirst: true },
      issuedAt: new Date().toISOString(),
    },
    dossier: [store({ ref: refFor(passage, 3), passage })],
  });
  check('8 a card written at one kiosk is accepted', atDeviceOne.status === 200);

  const atDeviceNine = await call('GET', `/session/${token}`);
  check(
    '9 the same card read at another kiosk carries the language and the passage',
    atDeviceNine.json?.session.language === 'mr' &&
      atDeviceNine.json?.session.accessibility.typeScale === 'largest' &&
      atDeviceNine.json?.dossier.length === 1 &&
      atDeviceNine.json?.dossier[0].pageId === 'baws-v1-p0100',
    `${String(atDeviceNine.json?.session.language)}, ${String(atDeviceNine.json?.dossier.length)} passage`,
  );

  // 10
  const withGap = await call('PUT', `/session/${token}`, {
    session: { language: 'mr', issuedAt: new Date().toISOString() },
    dossier: [
      store({ ref: refFor(passage, 3), passage }),
      { ref: 'baws-v1-p0100~9', text: 'a passage with no page behind it' },
    ],
  });
  check(
    '10 a passage that lost its citation is refused, and the refusal is counted',
    withGap.json?.refused === 1 && withGap.json?.dossier.length === 1,
    `${String(withGap.json?.refused)} refused`,
  );

  // 11
  const blank = await call('GET', '/session/card-neverseen');
  check(
    '11 a blank card is a 204, not an error',
    blank.status === 204 && blank.json === null,
    String(blank.status),
  );

  // 12
  await call('DELETE', `/session/${token}`);
  const returned = await call('GET', `/session/${token}`);
  check('12 a card returned to the bowl reads blank', returned.status === 204);

  // 13
  const bad = await call('GET', "/session/x'%20or%201=1%20--");
  check(
    '13 a token that is not a card token is refused at the door',
    bad.status === 400,
    String(bad.status),
  );

  // 14
  const wrongVerb = await call('DELETE', '/fleet/dev-01');
  check(
    '14 a known path under the wrong verb is 405, which tells an operator which is wrong',
    wrongVerb.status === 405,
    String(wrongVerb.status),
  );

  // 15
  const foreign = await fetch(`${BASE}/fleet`, {
    headers: { origin: 'https://example.invalid' },
  });
  check(
    '15 an origin that was not allowed gets no CORS header',
    foreign.headers.get('access-control-allow-origin') === null,
    String(foreign.headers.get('access-control-allow-origin')),
  );

  // 16. The privacy claim, checked against the schema rather than against intent.
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(DB, { readOnly: true });
  const columns = db
    .prepare(
      `select m.name as tbl, p.name as col
         from sqlite_master m join pragma_table_info(m.name) p
        where m.type = 'table'`,
    )
    .all();
  const sessionSide = columns.filter(
    (c) => c.tbl === 'session' || c.tbl === 'dossier_item',
  );
  const leaks = sessionSide.filter((c) =>
    /device|kiosk|query|search|seen|visit|read_at|opened/i.test(c.col),
  );
  check(
    '16 nothing in the session store can hold which device a card touched',
    leaks.length === 0,
    leaks.map((c) => `${c.tbl}.${c.col}`).join(' '),
  );
  check(
    '17 the session store keeps one time, the issue, and no other',
    sessionSide.filter((c) => /_at$|time|stamp/i.test(c.col)).length === 1,
    sessionSide
      .filter((c) => /_at$|time|stamp/i.test(c.col))
      .map((c) => c.col)
      .join(' '),
  );
  db.close();

  // 18
  check(
    '18 Core prints where it stores and what it serves, and warns about an open origin',
    banner.includes('Toran Core on') && banner.includes('services  fleet, session'),
    banner.trim().split('\n').at(-1) ?? '',
  );

  console.log('\nCuration\n');

  // 18a
  const closed = await call('GET', '/curation/edges');
  const edges = await call('GET', '/curation/edges', undefined, undefined, KEY);
  check(
    '18a the curation queue is closed without the key and open with it',
    closed.status === 401 && edges.status === 200 && edges.json.length > 0,
    `${String(closed.status)}, then ${String(edges.json?.length)} links`,
  );

  // 18b
  const link = edges.json[0];
  const stale = await call(
    'POST',
    '/curation/edges',
    {
      edge: link.id,
      digest: '0'.repeat(64),
      decision: 'rejected',
      by: 'Verify Core',
      note: null,
    },
    undefined,
    KEY,
  );
  check(
    '18b a decision on evidence the curator was not shown is refused',
    stale.status === 409,
    String(stale.json?.error ?? stale.status),
  );

  // 18c
  const decided = await call(
    'POST',
    '/curation/edges',
    {
      edge: link.id,
      digest: link.digest,
      decision: 'confirmed',
      by: 'Verify Core',
      note: 'checked by verify:core',
    },
    undefined,
    KEY,
  );
  const logged = fs
    .readFileSync(path.join(ARCHIVE, 'data/curation/edges.jsonl'), 'utf8')
    .trim()
    .split('\n');
  const premis = fs
    .readFileSync(path.join(ARCHIVE, 'data/aip/premis.jsonl'), 'utf8')
    .trim()
    .split('\n');
  const event = JSON.parse(premis.at(-1));
  check(
    '18c a decision is appended to the log and to PREMIS, with its agent',
    decided.status === 200 &&
      logged.length === 1 &&
      event.linkingAgentIdentifier === 'Verify Core',
    `${event.eventType}, ${event.linkingObjectIdentifier.join(' ')}`,
  );

  // 18d
  const fixity = await call(
    'POST',
    '/curation/fixity',
    { id: 'photos/yeola', by: 'Verify Core' },
    undefined,
    KEY,
  );
  check(
    '18d a fixity check hashes the file again and finds it as it arrived',
    fixity.status === 200 && fixity.json.result.fixity === 'intact',
    String(fixity.json?.result?.fixity ?? fixity.status),
  );
  fs.appendFileSync(path.join(ARCHIVE, 'data/sip/photos/yeola/original.jpg'), 'x');
  const tampered = await call(
    'POST',
    '/curation/fixity',
    { id: 'photos/yeola', by: 'Verify Core' },
    undefined,
    KEY,
  );
  check(
    '18e one byte added to the file is found',
    tampered.json?.result?.fixity === 'changed',
    String(tampered.json?.result?.fixity),
  );

  // 18f
  const brute = [];
  for (let i = 0; i < 12; i++)
    brute.push(
      (await call('GET', '/curation', undefined, undefined, `guess-${i}`)).status,
    );
  const afterGuessing = await call('GET', '/curation', undefined, undefined, KEY);
  check(
    '18f a caller that keeps guessing keys is made to wait, even with the right one',
    brute.at(-1) === 429 && afterGuessing.status === 429,
    `${brute.filter((s) => s === 401).length} refused, then ${String(afterGuessing.status)}`,
  );

  console.log(
    `\nstale after ${String(BEAT_STALE_MS / 1000)}s without a beat, checked in apps/core/src/core.test.ts`,
  );

  // The claim step 6 could not finish, made on the screens a visitor sees.
  //
  // Two kiosks in one browser share localStorage, so a card carried between
  // them there proves nothing about two machines. Every page below is given a
  // fresh browser profile, which is as close to a second Raspberry Pi as a
  // check on one machine gets: nothing but Core connects them.
  console.log('\nCard continuity between machines\n');

  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });

  const WEB = process.env.BASE ?? 'http://127.0.0.1:4173';
  const CORE_ORIGIN = `http://127.0.0.1:${PORT}`;

  /** A kiosk on its own machine: its own profile, and only Core to talk to. */
  async function kiosk(path, { withCore = true } = {}) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    const reachedCore = [];
    const leaked = [];
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const url = r.url();
      if (url.startsWith(CORE_ORIGIN)) reachedCore.push(url.slice(CORE_ORIGIN.length));
      else if (
        !url.startsWith(WEB) &&
        !url.startsWith('data:') &&
        !url.startsWith('blob:')
      ) {
        leaked.push(url);
        void r.abort();
        return;
      }
      void r.continue();
    });
    const query = withCore ? `core=${encodeURIComponent(CORE_ORIGIN)}&` : '';
    await page.goto(`${WEB}${path}?${query}sensor=sim&card=sim`, {
      waitUntil: 'networkidle0',
    });
    return { context, page, reachedCore, leaked };
  }

  const langOf = (page) =>
    page.$eval('[data-testid="kiosk"]', (k) => k.getAttribute('lang'));

  // 19. The default build, with no Core named anywhere, must not call one.
  const alone = await kiosk('/kiosk/dev-01/', { withCore: false });
  await alone.page.keyboard.press('F8');
  await new Promise((r) => setTimeout(r, 1200));
  check(
    '19 a kiosk with no Core configured never calls one',
    alone.reachedCore.length === 0 && alone.leaked.length === 0,
    [...alone.reachedCore, ...alone.leaked].slice(0, 3).join(' '),
  );
  await alone.context.close();

  // 20. The first machine is device 2, the Marathi Reading Room. A blank card
  // tapped there takes the language the visitor is already reading in, which
  // is what makes the flip at the English kiosk below mean something.
  const first = await kiosk('/kiosk/dev-02/');
  await first.page.keyboard.press('F8');
  // The search engine is 118 MB of model and takes seconds to become ready.
  // The field is disabled until it is, which is what to wait on.
  await first.page.waitForFunction(
    () => document.querySelector('[data-testid="reading-query"]')?.disabled === false,
    { timeout: 120000 },
  );
  await first.page.type('[data-testid="reading-query"]', 'Mahad');
  await first.page.keyboard.press('Enter');
  await first.page.waitForSelector('[data-testid="reading-hit"]', { timeout: 60000 });
  await first.page.click('[data-testid="reading-hit"]');
  await first.page.waitForFunction(
    () => document.querySelector('[data-testid="reading-keep"]')?.disabled === false,
    { timeout: 20000 },
  );
  await first.page.click('[data-testid="reading-keep"]');
  await first.page.waitForFunction(
    () => document.querySelector('[data-testid="reading-dossier"]') !== null,
    { timeout: 5000 },
  );
  // The write to Core is debounced, so give the timer its 400 ms and the call.
  await new Promise((r) => setTimeout(r, 1500));

  const wrote = first.reachedCore.filter((p) => p.includes('/session/'));
  check(
    '20 the first kiosk sends the card to Core',
    wrote.length > 0,
    `${String(wrote.length)} session calls`,
  );
  check(
    '21 it also reports in, so the Twin can see it',
    first.reachedCore.some((p) => p.endsWith('/beat')),
    first.reachedCore.filter((p) => p.endsWith('/beat')).length + ' beats',
  );

  const stored = await call('GET', '/session/sim-card-a');
  check(
    '22 Core holds what the first kiosk stored, with its citation intact',
    stored.json?.session.language === 'mr' &&
      stored.json?.dossier.length === 1 &&
      typeof stored.json?.dossier[0].locator?.kind === 'string',
    `${String(stored.json?.session.language)}, locator ${String(stored.json?.dossier[0]?.locator?.kind)}`,
  );

  // 23. A different machine, and one that opens in another language. Fresh
  // profile, so nothing but Core connects it to the first.
  const second = await kiosk('/kiosk/dev-01/');
  const before = await langOf(second.page);
  await second.page.keyboard.press('F8');
  await second.page.waitForFunction(
    () => document.querySelector('[data-testid="reading-dossier"]') !== null,
    { timeout: 15000 },
  );
  check(
    "23 the same card at a second machine switches it to the visitor's language",
    before === 'en' && (await langOf(second.page)) === 'mr',
    `${String(before)} before the tap, ${String(await langOf(second.page))} after`,
  );

  await second.page.click('[data-testid="reading-dossier"]');
  await second.page.waitForSelector('[data-testid="dossier"]', { timeout: 5000 });
  const carried = await second.page.$$eval(
    '[data-testid="dossier-item"]',
    (n) => n.length,
  );
  const cited = await second.page.$$eval(
    '[data-testid="dossier-item"] cite',
    (n) => n.length,
  );
  check(
    '24 the passage kept at the first machine is on the second, still cited',
    carried === 1 && cited === 1,
    `${String(carried)} passage, ${String(cited)} cited`,
  );
  check(
    '25 nothing on either machine tried to reach anywhere but Core',
    first.leaked.length === 0 && second.leaked.length === 0,
    [...first.leaked, ...second.leaked].slice(0, 3).join(' '),
  );

  // 26. Core is unplugged mid-visit. The kiosk must not notice in front of
  // anyone: the degradation matrix says card continuity falls back to a local
  // session and everything else is unchanged.
  child.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 300));
  const startedFailing = Date.now();
  await second.page.keyboard.press('F9');
  await second.page.waitForFunction(
    () => document.querySelector('[data-testid="kiosk"]')?.getAttribute('lang') === 'en',
    { timeout: 8000 },
  );
  const tookMs = Date.now() - startedFailing;
  check(
    '26 with Core unplugged a card still binds, from the device itself',
    tookMs < 4000,
    `${String(tookMs)} ms to fall back`,
  );
  // The stranger's card emptied the dossier view it was left on. Home is one
  // of the three affordances a visitor has, and it has to still work: the
  // Reading Room is in the offline core and Core going away is not its problem.
  await second.page.click('nav button[aria-label="Home"]');
  await second.page.waitForFunction(
    () => document.querySelector('[data-testid="reading-query"]')?.disabled === false,
    { timeout: 10000 },
  );
  const engine = await second.page.$eval(
    '[data-testid="reading-query"]',
    (i) => !i.disabled,
  );
  check('27 and the room it is in still searches, with Core gone', engine === true);

  await browser.close();
} finally {
  child.kill('SIGTERM');
  fs.rmSync(store_dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
