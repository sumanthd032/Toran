/**
 * The Honeypot Fleet's three rules. Run with `npm test`.
 *
 * Core decides which neighbour a device drifts toward and the kiosk decides
 * what that shows, and both call these functions, so the rules are tested
 * here once rather than inferred from a hall.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { citation, citedPassage, pageLocator } from './citation.ts';
import {
  DEEP_ENGAGEMENT_MS,
  driftFor,
  driftPassages,
  engagement,
  readTopic,
  relatedWorks,
} from './honeypot.ts';

const at = (x: number, z: number) => [x, 0, z] as const;

const passage = (workId: string, page: number) =>
  citedPassage({
    text: `A sentence from ${workId}, page ${String(page)}.`,
    citation: citation({
      corpus: 'baws',
      workId,
      pageId: `${workId}-p${String(page)}`,
      locator: pageLocator({ volume: 1, page, observed: true }),
    }),
    language: 'en',
  });

test('engagement is deep only once one work has held for the whole threshold', () => {
  let e = engagement({ topic: null, since: 0 }, 'baws-v1', 1_000);
  assert.equal(e.deep, null);
  e = engagement(e, 'baws-v1', 1_000 + DEEP_ENGAGEMENT_MS - 1);
  assert.equal(e.deep, null);
  e = engagement(e, 'baws-v1', 1_000 + DEEP_ENGAGEMENT_MS);
  assert.equal(e.deep, 'baws-v1');
  // Turning to another work starts the clock again.
  e = engagement(e, 'cad-v7', 1_000 + DEEP_ENGAGEMENT_MS + 10);
  assert.equal(e.deep, null);
  // And leaving the page ends it at once.
  assert.equal(engagement(e, null, 99_999_999).deep, null);
});

test('a device drifts toward its nearest engaged neighbour, never toward itself or past the radius', () => {
  const me = { deviceId: 'dev-04', position: at(0, 0) };
  const engaged = [
    { deviceId: 'dev-04', position: at(0, 0), topic: 'own-work' },
    { deviceId: 'dev-01', position: at(6, 0), topic: 'baws-v1' },
    { deviceId: 'dev-03', position: at(2, 1), topic: 'coi-art17' },
    { deviceId: 'dev-09', position: at(30, 0), topic: 'far-away' },
  ];
  assert.equal(driftFor(me, engaged), 'coi-art17');
  assert.equal(
    driftFor(
      me,
      engaged.filter((e) => e.deviceId !== 'dev-03'),
    ),
    'baws-v1',
  );
  assert.equal(driftFor(me, [engaged[0]!, engaged[3]!]), null);
  // Height does not count: a wall panel above a kiosk is not further away.
  assert.equal(
    driftFor(me, [{ deviceId: 'dev-10', position: [1, 3, 0], topic: 'up' }]),
    'up',
  );
});

test('related works follow the Provenance Graph, nearest link first', () => {
  const links = [
    { from: 'coi-art17', to: 'pcr-1955' },
    { from: 'cad-v7', to: 'coi-art17' },
    { from: 'baws-v1', to: 'cad-v7' },
  ];
  assert.deepEqual(relatedWorks('pcr-1955', links), ['pcr-1955', 'coi-art17', 'cad-v7']);
  assert.deepEqual(relatedWorks('pcr-1955', links, 3), [
    'pcr-1955',
    'coi-art17',
    'cad-v7',
    'baws-v1',
  ]);
  assert.deepEqual(relatedWorks('alone', links), ['alone']);
});

test('a drifting device shows only related passages, and nothing when none are', () => {
  const pool = [passage('baws-v1', 47), passage('coi-art17', 1), passage('baws-v1', 68)];
  const shown = driftPassages(pool, ['pcr-1955', 'coi-art17', 'baws-v1']);
  assert.deepEqual(
    shown.map((p) => p.citation.pageId),
    ['coi-art17-p1', 'baws-v1-p47', 'baws-v1-p68'],
  );
  assert.deepEqual(driftPassages(pool, ['pcr-1955']), []);
});

test('a topic is a work id and nothing else', () => {
  assert.equal(readTopic('baws-v17-1'), 'baws-v17-1');
  assert.equal(readTopic('sim-card-a token'), null);
  assert.equal(readTopic('<b>x</b>'), null);
  assert.equal(readTopic(42), null);
  assert.equal(readTopic('x'.repeat(80)), null);
});
