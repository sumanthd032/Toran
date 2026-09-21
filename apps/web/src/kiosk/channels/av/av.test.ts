/**
 * Finding a moment inside a recording. Run with `npm test`.
 *
 * The literal find is what this covers, because it is the one that runs with
 * no engine loaded and is therefore the one a visitor meets first. The
 * semantic path is the device's own search index and is measured where that is
 * measured, in tools/benchmark-search.mjs.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readRecording, type Recording } from '@toran/contracts';
import { context, cuesAmong, findLiteral, MATCH_LIMIT, merge } from './model.ts';

const base = {
  language: 'hi',
  kind: 'documentary',
  durationSeconds: 2754,
  creator: 'Benegal, Shyam',
  publisher: 'Doordarshan, Government of India',
  year: 1988,
  licence: 'https://creativecommons.org/licenses/by/3.0/',
  licenceName: 'CC BY 3.0',
  attribution: 'A production of Doordarshan, under CC BY 3.0.',
  source: 'https://archive.org/details/youtube-lKv7d0vi_sA',
  whyHere: 'Nehru on caste.',
  transcribedBy: 'groq whisper-large-v3',
};

const caste: Recording = readRecording({
  ...base,
  id: 'bek-04',
  title: 'Caste Formation',
  series: 'Bharat Ek Khoj',
  episode: 4,
  file: 'bek-04.mp4',
  cues: [
    { from: 10, to: 14, text: 'The advent of the Aryans raised new problems.' },
    { from: 20, to: 25, text: 'Out of that conflict arose the caste system.' },
    { from: 30, to: 36, text: 'ब्राह्मण, क्षत्रिय, वैश्य और शूद्र।' },
    { from: 40, to: 45, text: 'The caste system affected Indian life profoundly.' },
  ],
});

const phule: Recording = readRecording({
  ...base,
  id: 'bek-45',
  title: 'Mahatma Phule',
  series: 'Bharat Ek Khoj',
  episode: 45,
  file: 'bek-45.mp4',
  cues: [{ from: 5, to: 11, text: 'Phule opened a school for girls.' }],
});

const all = [caste, phule];

test('a phrase lands on the cue it is spoken in', () => {
  const found = findLiteral(all, 'caste system');
  assert.equal(found.length, 2);
  assert.equal(found[0]?.cue.from, 20);
  assert.equal(found[0]?.recording.id, 'bek-04');
  assert.equal(found[0]?.how, 'literal');
});

test('a find ignores case and reaches across recordings', () => {
  assert.equal(findLiteral(all, 'PHULE')[0]?.recording.id, 'bek-45');
});

test('the span marks where the words are, so the line can be highlighted', () => {
  const [match] = findLiteral(all, 'Aryans');
  const [span] = match?.spans ?? [];
  assert.ok(span !== undefined);
  assert.equal(match!.cue.passage.text.slice(span![0], span![1]), 'Aryans');
});

test('a find works in the script the film was spoken in', () => {
  const found = findLiteral(all, 'शूद्र');
  assert.equal(found.length, 1);
  assert.equal(found[0]?.cue.from, 30);
});

test('a query of one character finds nothing, rather than everything', () => {
  assert.equal(findLiteral(all, 'a').length, 0);
  assert.equal(findLiteral(all, '   ').length, 0);
});

test('the result list stops, because a kiosk is not a scrolling app', () => {
  const many = readRecording({
    ...base,
    id: 'long',
    title: 'Long',
    series: null,
    episode: null,
    file: 'long.mp4',
    cues: Array.from({ length: 40 }, (_, i) => ({
      from: i * 10,
      to: i * 10 + 5,
      text: `the caste system, line ${String(i)}`,
    })),
  });
  assert.equal(findLiteral([many], 'caste').length, MATCH_LIMIT);
});

test('meaning fills in behind the words, and never repeats one', () => {
  const literal = findLiteral(all, 'caste system');
  // What the index would hand back: a cue the literal find already has, and
  // one only meaning could reach, sharing no words with the query.
  const meaning = cuesAmong(all, [caste.cues[1]!.passage, caste.cues[2]!.passage]);
  assert.equal(meaning.length, 2);
  const merged = merge(literal, meaning);
  assert.equal(merged.length, 3);
  assert.equal(merged.filter((m) => m.cue.id === caste.cues[1]!.id).length, 1);
  assert.equal(merged[2]?.how, 'meaning');
});

test('a hit that is not a cue is not a film result', () => {
  // The same search returns printed pages. This room shows the film half.
  const page = readRecording({
    ...base,
    id: 'other',
    title: 'Not in this room',
    series: null,
    episode: null,
    file: 'other.mp4',
    cues: [{ from: 1, to: 4, text: 'a cue from a recording nobody loaded' }],
  });
  assert.equal(cuesAmong(all, [page.cues[0]!.passage]).length, 0);
});

test('a result shows the lines either side, because one line is a fragment', () => {
  const around = context(caste, caste.cues[1]!);
  assert.deepEqual(
    around.map((c) => c.from),
    [10, 20, 30, 40],
  );
  // At the start there is nothing before it, and that is not an error.
  assert.deepEqual(
    context(caste, caste.cues[0]!).map((c) => c.from),
    [10, 20, 30],
  );
});
