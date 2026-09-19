/**
 * The visitor layer: dossier, card store and patina. Run with `npm test`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { citation, citedPassage, pageLocator, paragraphLocator } from '@toran/contracts';
import { DEFAULT_ACCESSIBILITY } from '@toran/contracts';
import {
  add,
  DOSSIER_LIMIT,
  merge,
  parseRef,
  refFor,
  restore,
  store,
  type DossierItem,
} from './dossier.ts';
import { levelOf, Patina, PATINA_THRESHOLDS } from './patina.ts';
import { CardStore, SESSION_TTL_MS, type KeyValue } from './store.ts';

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

const debate = citedPassage({
  text: 'The answer is categorically in the affirmative.',
  citation: citation({
    corpus: 'cad',
    workId: 'cad-v7',
    pageId: 'cad-v7-62-131-para-98638',
    locator: paragraphLocator({
      volume: 7,
      sitting: 62,
      paragraph: 131,
      date: '1948-11-29',
    }),
  }),
  language: 'en',
  speaker: 'B. R. Ambedkar',
});

const item = (passage = page47, block: number | null = 3): DossierItem => ({
  ref: refFor(passage, block),
  passage,
});

test('a ref names a block of a page, or a paragraph on its own', () => {
  assert.equal(refFor(page47, 3), 'baws-v1-p0100~3');
  assert.deepEqual(parseRef('baws-v1-p0100~3'), { pageId: 'baws-v1-p0100', block: 3 });
  assert.equal(refFor(debate, null), 'cad-v7-62-131-para-98638');
  assert.deepEqual(parseRef('cad-v7-62-131-para-98638'), {
    pageId: 'cad-v7-62-131-para-98638',
    block: null,
  });
  assert.equal(parseRef('<script>'), null);
});

test('saving a passage twice keeps one, and the dossier stops at its limit', () => {
  let items = add([], item());
  items = add(items, item());
  assert.equal(items.length, 1);
  for (let i = 0; i < DOSSIER_LIMIT + 5; i++) items = add(items, item(page47, i));
  assert.equal(items.length, DOSSIER_LIMIT);
});

test('a dossier kept without a card goes onto the card when one is tapped', () => {
  const onCard = [item(debate, null)];
  const local = [item(page47, 3), item(debate, null)];
  assert.deepEqual(
    merge(onCard, local).map((i) => i.ref),
    ['cad-v7-62-131-para-98638', 'baws-v1-p0100~3'],
  );
});

test('a stored item comes back through the contract, and an uncited one does not', () => {
  const stored = store(item(debate, null));
  const good = restore([stored]);
  assert.equal(good.items[0]?.passage.speaker, 'B. R. Ambedkar');
  assert.equal(good.items[0]?.passage.citation.locator.kind, 'paragraph');
  const bad = restore([
    { ...stored, locator: undefined },
    { ...stored, ref: 'x y' },
  ]);
  assert.equal(bad.items.length, 0);
  assert.equal(bad.refused, 2);
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
