/**
 * Toran Core against a database in memory. Run with `npm test`.
 *
 * Three things are worth testing here and the rest is plumbing. Core must
 * decide config versions itself, or two curators drift. It must refuse a
 * dossier item that has lost its citation, because the whole reason the
 * contract is a shared package is that this rule holds on the server as well as
 * in the browser. And it must forget: an expired card and a returned card leave
 * nothing behind.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  citation,
  citedPassage,
  pageLocator,
  refFor,
  SESSION_TTL_MS,
  store,
  type DeviceConfig,
} from '@toran/contracts';
import { one, openDb, rows } from './db.ts';
import { Fleet } from './fleet.ts';
import { RateLimit } from './http.ts';
import { Sessions } from './session.ts';

const HALL: readonly DeviceConfig[] = [
  {
    deviceId: 'dev-01',
    channel: 'reading',
    defaultLanguage: 'en',
    position: [-5.4, 0, 4],
    rotationY: 0.7,
    version: 1,
  },
  {
    deviceId: 'dev-09',
    channel: 'av',
    defaultLanguage: 'en',
    position: [-5.7, 0, -13.2],
    rotationY: 0.5,
    version: 1,
  },
];

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

const kept = store({ ref: refFor(passage, 3), passage });

function core(at = Date.parse('2026-09-21T10:00:00Z')) {
  const db = openDb(':memory:');
  let clock = at;
  const now = () => clock;
  const fleet = new Fleet(db, now);
  fleet.seed(HALL);
  return {
    db,
    fleet,
    sessions: new Sessions(db, now),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

test('the hall is seeded once, and never again over a curator', () => {
  const { fleet } = core();
  assert.equal(fleet.configs().length, 2);
  fleet.put('dev-01', { ...HALL[0], defaultLanguage: 'mr' });
  assert.equal(fleet.seed(HALL), 0);
  assert.equal(fleet.config('dev-01')?.defaultLanguage, 'mr');
});

test('Core sets the version, not the caller', () => {
  const { fleet } = core();
  // A caller claiming version 99 gets 2, because the stored one was 1.
  const first = fleet.put('dev-01', { ...HALL[0], defaultLanguage: 'hi', version: 99 });
  assert.equal(first.version, 2);
  const second = fleet.put('dev-01', { ...HALL[0], defaultLanguage: 'hi', version: 99 });
  assert.equal(second.version, 3);
});

test('a device running an old config is told it changed', () => {
  const { fleet } = core();
  const behind = fleet.beat('dev-01', {
    state: 'ambient',
    configVersion: 1,
    uptimeSeconds: 60,
  });
  assert.equal(behind.changed, false);

  fleet.put('dev-01', { ...HALL[0], channel: 'timeline' });
  const now = fleet.beat('dev-01', {
    state: 'ambient',
    configVersion: 1,
    uptimeSeconds: 90,
  });
  assert.equal(now.changed, true);
  assert.equal(now.config.channel, 'timeline');
  assert.equal(now.config.version, 2);
});

test('a device that stops reporting goes offline on its own', () => {
  const { fleet, advance } = core();
  fleet.beat('dev-09', { state: 'subtle', configVersion: 1, uptimeSeconds: 10 });
  assert.equal(fleet.health()[0]?.online, true);
  // Two missed beats and a margin. Nothing that crashes sends a goodbye.
  advance(91_000);
  assert.equal(fleet.health()[0]?.online, false);
});

test('a beat from a device nobody configured is refused by name', () => {
  const { fleet } = core();
  assert.throws(
    () => fleet.beat('dev-99', { state: 'ambient', configVersion: 1, uptimeSeconds: 1 }),
    /no device dev-99/,
  );
});

test('a card carries its language and its passages to the next kiosk', () => {
  const { sessions } = core();
  sessions.write('card-0f3a91', {
    session: {
      language: 'mr',
      accessibility: { typeScale: 'largest', audioFirst: true },
      issuedAt: '2026-09-21T09:58:00Z',
    },
    dossier: [kept],
  });
  const read = sessions.read('card-0f3a91');
  assert.equal(read?.session.language, 'mr');
  assert.equal(read?.session.accessibility.typeScale, 'largest');
  assert.equal(read?.session.accessibility.audioFirst, true);
  assert.equal(read?.dossier.length, 1);
  assert.equal(read?.dossier[0]?.pageId, 'baws-v1-p0100');
});

test('a passage that lost its citation is dropped, and counted', () => {
  const { sessions } = core();
  const { refused } = sessions.write('card-0f3a91', {
    session: { language: 'en', issuedAt: '2026-09-21T09:58:00Z' },
    dossier: [kept, { ...kept, ref: 'other~1', locator: undefined }],
  });
  assert.equal(refused, 1);
  assert.equal(sessions.read('card-0f3a91')?.dossier.length, 1);
});

test('the dossier replaces, so removing a passage works', () => {
  const { sessions } = core();
  const session = { language: 'en', issuedAt: '2026-09-21T09:58:00Z' };
  sessions.write('card-0f3a91', { session, dossier: [kept] });
  sessions.write('card-0f3a91', { session, dossier: [] });
  assert.equal(sessions.read('card-0f3a91')?.dossier.length, 0);
});

test('a card returned to the bowl leaves nothing behind', () => {
  const { db, sessions } = core();
  sessions.write('card-0f3a91', {
    session: { language: 'en', issuedAt: '2026-09-21T09:58:00Z' },
    dossier: [kept],
  });
  sessions.forget('card-0f3a91');
  assert.equal(sessions.read('card-0f3a91'), null);
  assert.equal(rows(db, 'select * from dossier_item').length, 0);
  assert.equal(one<{ n: number }>(db, 'select count(*) as n from session')?.n, 0);
});

test('a card expires with the day, and reading it is what collects it', () => {
  const { db, sessions, advance } = core();
  sessions.write('card-0f3a91', {
    session: { language: 'en', issuedAt: '2026-09-21T10:00:00Z' },
    dossier: [kept],
  });
  advance(SESSION_TTL_MS + 1000);
  assert.equal(sessions.read('card-0f3a91'), null);
  assert.equal(rows(db, 'select * from dossier_item').length, 0);
});

test('a token that is not a card token never reaches the database', () => {
  const { sessions } = core();
  assert.throws(() => sessions.read("x' or 1=1 --"), /not a card token/);
  assert.throws(() => sessions.write('ab', { session: {} }), /not a card token/);
});

test('the rate limiter holds a window and then opens', () => {
  let clock = 0;
  const limit = new RateLimit(2, 60_000, () => clock);
  assert.equal(limit.take('a'), true);
  assert.equal(limit.take('a'), true);
  assert.equal(limit.take('a'), false);
  // One caller's ceiling is not another's.
  assert.equal(limit.take('b'), true);
  assert.equal(limit.retryAfter('a'), 60);
  clock += 60_000;
  assert.equal(limit.take('a'), true);
});
