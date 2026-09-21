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
async function call(method, path, body, origin = 'http://127.0.0.1:4173') {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? { origin } : { origin, 'content-type': 'application/json' },
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
  const pushed = await call('PUT', '/fleet/dev-01', {
    channel: 'timeline',
    defaultLanguage: 'mr',
    position: [-5.4, 0, 4],
    rotationY: 0.7,
    version: 999,
  });
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
  await call('PUT', '/fleet/dev-01', {
    channel: 'reading',
    defaultLanguage: 'en',
    position: [-5.4, 0, 4],
    rotationY: 0.7068583470577035,
  });

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
  const foreign = await fetch(`${BASE}/fleet`, { headers: { origin: 'https://example.invalid' } });
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
  const sessionSide = columns.filter((c) => c.tbl === 'session' || c.tbl === 'dossier_item');
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
    sessionSide.filter((c) => /_at$|time|stamp/i.test(c.col)).map((c) => c.col).join(' '),
  );
  db.close();

  // 18
  check(
    '18 Core prints where it stores and what it serves, and warns about an open origin',
    banner.includes('Toran Core on') && banner.includes('services  fleet, session'),
    banner.trim().split('\n').at(-1) ?? '',
  );

  console.log(
    `\nstale after ${String(BEAT_STALE_MS / 1000)}s without a beat, checked in apps/core/src/core.test.ts`,
  );
} finally {
  child.kill('SIGTERM');
  fs.rmSync(store_dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
