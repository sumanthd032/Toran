import test from 'node:test';
import assert from 'node:assert/strict';
import { readNarrationClip } from '@toran/contracts';
import {
  chooseClip,
  clock,
  languagesOf,
  nextSpeed,
  SPEEDS,
  tracksOf,
  voicesOf,
  type Chosen,
} from './model.ts';

/** Narrows away the "nothing to play" case, which these tests never expect. */
function played(chosen: Chosen) {
  assert.notEqual(chosen.kind, 'none', 'expected a clip to play');
  return (chosen as Exclude<Chosen, { kind: 'none' }>).clip;
}

const base = {
  id: 'p1',
  file: 'x.wav',
  source: 'Bhashini, ai4bharat/indic-tts-coqui-misc-gpu--t4',
  because: 'ambient',
  citation: {
    corpus: 'baws',
    workId: 'baws-v1',
    pageId: 'baws-v1-p0079',
    locator: { kind: 'page', volume: 1, part: null, page: 47, observed: true },
    language: 'en',
    speaker: null,
  },
};

const clip = (over: Record<string, unknown>) =>
  readNarrationClip({
    ...base,
    language: 'en',
    voice: 'female',
    text: 'Caste is a monster.',
    ...over,
  });

test('a track needs the reading its citation belongs to', () => {
  const orphan = clip({ id: 'p2', language: 'mr', text: 'जात एक राक्षस आहे.' });
  const tracks = tracksOf([clip({}), orphan]);
  assert.equal(tracks.length, 1, 'the translation with no original behind it is dropped');
  assert.equal(tracks[0]!.id, 'p1');
});

test('a visitor gets their own language when it has been narrated', () => {
  const track = tracksOf([
    clip({}),
    clip({ language: 'mr', text: 'जात एक राक्षस आहे.' }),
  ])[0]!;
  const chosen = chooseClip(track, 'mr', 'female');
  assert.equal(chosen.kind, 'exact');
  assert.equal(chosen.clip.language, 'mr');
});

test('a language nobody narrated falls back to the printed reading, and says which', () => {
  const track = tracksOf([clip({})])[0]!;
  const chosen = chooseClip(track, 'ta', 'female');
  assert.equal(chosen.kind, 'printed');
  assert.equal(chosen.clip.language, 'en');
  assert.equal(chosen.kind === 'printed' && chosen.wanted, 'ta');
});

test('the preferred voice is used when it exists, and never invented', () => {
  const track = tracksOf([clip({}), clip({ voice: 'male' })])[0]!;
  assert.equal(played(chooseClip(track, 'en', 'male')).voice, 'male');
  assert.deepEqual(voicesOf(track, 'en'), ['female', 'male']);
  assert.deepEqual(voicesOf(track, 'mr'), []);
});

test('asking for a voice that was not recorded gives the one that was', () => {
  const track = tracksOf([clip({})])[0]!;
  assert.equal(played(chooseClip(track, 'en', 'male')).voice, 'female');
});

test('every clip offered still carries its citation', () => {
  const track = tracksOf([
    clip({}),
    clip({ language: 'mr', text: 'जात एक राक्षस आहे.' }),
  ])[0]!;
  for (const language of languagesOf(track)) {
    assert.equal(
      played(chooseClip(track, language, 'female')).passage.citation.pageId,
      'baws-v1-p0079',
    );
  }
});

test('a translated clip is marked as a translation wherever it is played', () => {
  const track = tracksOf([
    clip({}),
    clip({ language: 'mr', text: 'जात एक राक्षस आहे.' }),
  ])[0]!;
  assert.equal(played(chooseClip(track, 'mr', 'female')).passage.translatedFrom, 'en');
});

test('speeds cycle and never reach a slur', () => {
  assert.equal(nextSpeed(1), 1.25);
  assert.equal(nextSpeed(1.5), 0.75);
  assert.ok(SPEEDS.every((s) => s >= 0.75 && s <= 1.5));
});

test("the clock reads what a visitor at arm's length can read", () => {
  assert.equal(clock(0), '0:00');
  assert.equal(clock(9), '0:09');
  assert.equal(clock(75), '1:15');
  assert.equal(clock(Number.NaN), '0:00');
});

test('an empty archive yields no tracks rather than an error', () => {
  assert.deepEqual(tracksOf([]), []);
});
