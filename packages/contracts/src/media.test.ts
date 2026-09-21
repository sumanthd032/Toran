/**
 * The media contract: what a recording must carry, and what a cue must resolve
 * to. Run with `npm test`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { CitationError, timecode, timecodeLocator } from './citation.ts';
import { cueAt, readRecording, startOf, type Recording } from './media.ts';

const RECORDING = {
  id: 'bek-04-caste-formation',
  title: 'Bharat Ek Khoj, Episode 4: Caste Formation',
  series: 'Bharat Ek Khoj (The Discovery of India)',
  episode: 4,
  language: 'hi',
  kind: 'documentary',
  durationSeconds: 2754.12,
  file: 'bek-04-caste-formation.mp4',
  creator: 'Benegal, Shyam',
  publisher: 'Doordarshan, Government of India',
  year: 1988,
  licence: 'https://creativecommons.org/licenses/by/3.0/',
  licenceName: 'CC BY 3.0',
  attribution:
    'A production of Doordarshan, mirrored by Public.Resource.Org under CC BY 3.0.',
  source: 'https://archive.org/details/youtube-lKv7d0vi_sA',
  whyHere: 'Nehru on how the four-fold division hardened into caste.',
  transcribedBy: 'groq whisper-large-v3',
  cues: [
    { from: 10, to: 14, text: 'आर्यों के आगमन ने नई समस्याएँ खड़ी कीं।' },
    { from: 14.5, to: 19, text: 'जाति व्यवस्था धीरे-धीरे इसी संघर्ष से उपजी।' },
    { from: 40, to: 46, text: 'ब्राह्मण, क्षत्रिय, वैश्य और शूद्र।' },
  ],
};

const read = (patch: Record<string, unknown> = {}): Recording =>
  readRecording({ ...RECORDING, ...patch });

test('a recording carries its licence, its attribution and why it is here', () => {
  const r = read();
  assert.equal(r.licenceName, 'CC BY 3.0');
  assert.match(r.attribution, /Doordarshan/);
  assert.equal(r.cues.length, 3);
  assert.equal(r.transcribedBy, 'groq whisper-large-v3');
});

test('a recording without a licence or an attribution is refused outright', () => {
  // The kiosk could not lawfully show either one, so neither reaches it.
  assert.throws(() => read({ licence: '' }), CitationError);
  assert.throws(() => read({ attribution: '  ' }), CitationError);
});

test('every cue resolves to a moment somebody can go to', () => {
  const r = read();
  const first = r.cues[0]!;
  assert.equal(first.passage.citation.locator.kind, 'timecode');
  assert.equal(first.passage.citation.corpus, 'media');
  assert.equal(first.passage.language, 'hi');
  assert.equal(first.id, 'bek-04-caste-formation#0');
});

test('a cue that ends before it starts is not a moment, and is refused', () => {
  assert.throws(() => read({ cues: [{ from: 40, to: 12, text: 'x' }] }), CitationError);
  assert.throws(() => read({ cues: [{ from: 5, to: 5, text: 'x' }] }), CitationError);
  assert.throws(
    () => timecodeLocator({ recording: 'r', from: -1, to: 4 }),
    /time in seconds/,
  );
});

test('a cue with no words is refused, the same as an empty passage', () => {
  assert.throws(() => read({ cues: [{ from: 1, to: 4, text: '   ' }] }), CitationError);
});

test('the cue playing is the last one that started, and silence is silence', () => {
  const cues = read().cues;
  assert.equal(cueAt(cues, 0), null, 'before the first word');
  assert.equal(cueAt(cues, 12)?.id, 'bek-04-caste-formation#0');
  assert.equal(cueAt(cues, 14.2), null, 'the gap between two cues is not a line');
  assert.equal(cueAt(cues, 18.9)?.id, 'bek-04-caste-formation#1');
  assert.equal(cueAt(cues, 30), null, 'a long pause does not keep a line lit');
  assert.equal(cueAt(cues, 46)?.id, 'bek-04-caste-formation#2');
  assert.equal(cueAt(cues, 2700), null, 'past the last word');
  assert.equal(cueAt([], 5), null);
});

test('playing a cue starts just before it, and never before the film', () => {
  const cues = read().cues;
  assert.ok(startOf(cues[1]!) < cues[1]!.from);
  assert.equal(startOf({ ...cues[0]!, from: 0.1 }), 0);
});

test('a timecode reads as a viewer reads a position in a film', () => {
  assert.equal(timecode(0), '0:00');
  assert.equal(timecode(9.7), '0:09');
  assert.equal(timecode(75), '1:15');
  assert.equal(timecode(2754), '45:54');
  assert.equal(timecode(3725), '1:02:05');
  assert.equal(timecode(-1), '0:00');
});
