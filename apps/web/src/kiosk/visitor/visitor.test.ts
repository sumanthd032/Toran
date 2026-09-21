/**
 * The visitor layer at the kiosk: the card store and patina. Run with `npm test`.
 *
 * The dossier itself is a contract and is tested in
 * `packages/contracts/src/dossier.test.ts`, because Toran Core reads and
 * writes the same items with the same functions.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  citation,
  citedPassage,
  DEFAULT_ACCESSIBILITY,
  pageLocator,
  refFor,
  type DossierItem,
} from '@toran/contracts';
import { levelOf, Patina, PATINA_THRESHOLDS } from './patina.ts';
import { SESSION_TTL_MS } from '@toran/contracts';
import { CardStore, type KeyValue } from './store.ts';

function memory(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const page47 = citedPassage({
  text: 'Caste is a notion, it is a state of the mind.',
  citation: citation({
    corpus: 'baws',
    workId: 'baws-v1',
    pageId: 'baws-v1-p0100',
    locator: pageLocator({ volume: 1, page: 68, observed: true }),
  }),
  language: 'en',
});

const item = (passage = page47, block: number | null = 3): DossierItem => ({
  ref: refFor(passage, block),
  passage,
});

test('a card issued in Marathi reads back in Marathi, with its dossier', () => {
  const kv = memory();
  const cards = new CardStore(kv, () => Date.parse('2026-09-19T10:00:00Z'));
  const issued = cards.issue('sim-card-a', 'mr', {
    ...DEFAULT_ACCESSIBILITY,
    typeScale: 'largest',
  });
  cards.write({ ...issued, dossier: [item()] });
  const read = cards.read('sim-card-a');
  assert.equal(read?.session.language, 'mr');
  assert.equal(read?.session.accessibility.typeScale, 'largest');
  assert.equal(read?.dossier[0]?.passage.text, page47.text);
});

test('a card expires with the day, and is gone from storage', () => {
  const kv = memory();
  let now = Date.parse('2026-09-19T10:00:00Z');
  const cards = new CardStore(kv, () => now);
  cards.issue('sim-card-a', 'hi', DEFAULT_ACCESSIBILITY);
  now += SESSION_TTL_MS + 1;
  assert.equal(cards.read('sim-card-a'), null);
  assert.equal(kv.data.size, 0);
});

test('an unreadable record is a blank card, never trusted', () => {
  const kv = memory();
  kv.setItem('toran.card.sim-card-a', '{"session":{"language":7}}');
  const cards = new CardStore(kv);
  assert.equal(cards.read('sim-card-a'), null);
  assert.equal(kv.data.size, 0);
});

test('blocked storage does not break the kiosk', () => {
  const blocked: KeyValue = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  };
  const cards = new CardStore(blocked);
  assert.equal(cards.read('sim-card-a'), null);
  assert.doesNotThrow(() => cards.issue('sim-card-a', 'en', DEFAULT_ACCESSIBILITY));
  assert.doesNotThrow(() => new Patina(blocked).wear('baws-v1-p0100'));
});

test('a page wears once per visitor session, however often it is opened', () => {
  const kv = memory();
  const patina = new Patina(kv);
  for (let i = 0; i < 10; i++) patina.wear('baws-v1-p0100');
  assert.deepEqual(JSON.parse(kv.getItem('toran.patina')!), { 'baws-v1-p0100': 1 });
  patina.endSession();
  patina.wear('baws-v1-p0100');
  assert.deepEqual(JSON.parse(kv.getItem('toran.patina')!), { 'baws-v1-p0100': 2 });
});

test('wear is shown as a level, and the first level needs several visitors', () => {
  assert.equal(levelOf(0), 0);
  assert.equal(levelOf(PATINA_THRESHOLDS[0] - 1), 0);
  assert.equal(levelOf(PATINA_THRESHOLDS[0]), 1);
  assert.equal(levelOf(1000), 4);
  const kv = memory();
  kv.setItem('toran.patina', JSON.stringify({ a: 25, b: 'x', c: -3 }));
  const patina = new Patina(kv);
  assert.equal(patina.level('a'), 3);
  assert.equal(patina.level('b'), 0);
  assert.equal(patina.level('c'), 0);
});
