/**
 * The dossier contract: what a visitor keeps, and what it refuses to keep.
 * Run with `npm test`.
 *
 * These live beside the contract rather than beside the Reading Room because
 * Toran Core runs the same functions on the same items. A dossier posted to
 * the session service passes through `restore` there exactly as it does in the
 * browser, so this file is what stops the two from drifting.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { citation, citedPassage, pageLocator, paragraphLocator } from './citation.ts';
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
