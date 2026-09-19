import assert from 'node:assert/strict';
import test from 'node:test';
import { dossierUrl, refsFromHash } from '../../visitor/link.ts';
import { hitMarks } from './highlight.ts';

const p = (text: string) => ({ text, table: false });

test('only the query words inside a hit are marked, not the whole hit', () => {
  const blocks = [
    p('Caste is a notion, it is a state of the mind.'),
    p('The destruction of Caste follows.'),
  ];
  const hit = 'it is a state of the mind. The destruction of Caste';
  // "state" and "Caste" in the hit's own text.
  const r = hitMarks(blocks, hit, [
    [8, 13],
    [46, 51],
  ]);
  assert.deepEqual([...r.blocks], [0, 1]);
  assert.deepEqual(r.marks, [
    { block: 0, start: 27, end: 32 },
    { block: 1, start: 19, end: 24 },
  ]);
});

test('a table the hit runs through is flagged but never marked inside', () => {
  const table = { text: '1881   1891\n12     14', table: true };
  const r = hitMarks([p('Figures:'), table], 'Figures: 1881 1891', [[9, 13]]);
  assert.deepEqual([...r.blocks], [0, 1]);
  assert.deepEqual(r.marks, []);
});

test('a hit that is not on the page marks nothing', () => {
  const r = hitMarks([p('Caste is a notion.')], 'not on this page', [[0, 3]]);
  assert.equal(r.blocks.size, 0);
  assert.deepEqual(r.marks, []);
});

test('the take-home link carries references only, and survives the round trip', () => {
  const url = dossierUrl('https://toran.example/', ['baws-v1-p0100~3', 'coi-art17-a17']);
  assert.equal(url, 'https://toran.example/dossier/#baws-v1-p0100~3,coi-art17-a17');
  assert.deepEqual(refsFromHash(new URL(url).hash), ['baws-v1-p0100~3', 'coi-art17-a17']);
  assert.deepEqual(refsFromHash('#<img src=x>,baws-v1-p0100~3,%E0%A4'), [
    'baws-v1-p0100~3',
  ]);
});

test('the link opens in the visitor language, and refuses anything that is not one', () => {
  assert.equal(
    dossierUrl('https://toran.example', ['coi-art17-a17'], 'mr'),
    'https://toran.example/dossier/?lang=mr#coi-art17-a17',
  );
  assert.equal(
    dossierUrl('https://toran.example', ['coi-art17-a17'], 'x"y'),
    'https://toran.example/dossier/#coi-art17-a17',
  );
});
