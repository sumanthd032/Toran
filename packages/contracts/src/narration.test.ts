/**
 * A clip cannot exist without the citation of the passage it reads.
 * This is the same rule as reading.test.ts, applied to sound.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CitationError } from './citation.ts';
import {
  readNarration,
  readNarrationClip,
  readUiClip,
  readUiNarration,
  spokenLabel,
} from './narration.ts';

const citation = {
  corpus: 'baws',
  workId: 'baws-v1',
  pageId: 'baws-v1-p0079',
  locator: { kind: 'page', volume: 1, part: null, page: 47, observed: true },
  language: 'en',
  speaker: null,
};

const clip = {
  id: 'baws-v1-p0079-c02',
  language: 'en',
  voice: 'female',
  file: 'en/baws-v1-p0079-c02.female.wav',
  source: 'Bhashini, ai4bharat/indic-tts-coqui-misc-gpu--t4',
  text: 'Caste System is not merely division of labour.',
  because: 'ambient',
  citation,
};

test('a clip carries the citation of the page it reads', () => {
  const read = readNarrationClip(clip);
  assert.equal(read.passage.citation.pageId, 'baws-v1-p0079');
  assert.equal(read.passage.citation.locator.kind, 'page');
  assert.equal(read.passage.translatedFrom, null);
  assert.equal(read.engine, 'Bhashini, ai4bharat/indic-tts-coqui-misc-gpu--t4');
});

test('a clip of a translation is marked as one, and cannot claim to be the source', () => {
  const read = readNarrationClip({
    ...clip,
    language: 'mr',
    text: 'जातिव्यवस्था ही केवळ श्रमविभागणी नाही.',
    file: 'mr/baws-v1-p0079-c02.female.wav',
  });
  assert.equal(read.language, 'mr');
  assert.equal(read.passage.translatedFrom, 'en');
  assert.equal(read.passage.citation.pageId, 'baws-v1-p0079');
});

test('a clip without a citation is refused', () => {
  const { citation: _dropped, ...naked } = clip;
  assert.throws(() => readNarrationClip(naked), CitationError);
});

test('a clip whose citation has no locator is refused', () => {
  assert.throws(
    () => readNarrationClip({ ...clip, citation: { ...citation, locator: undefined } }),
    CitationError,
  );
});

test('a clip with no words is refused, because there would be nothing to attribute', () => {
  assert.throws(() => readNarrationClip({ ...clip, text: '   ' }), CitationError);
});

test('a clip with a voice nobody recorded is refused', () => {
  assert.throws(() => readNarrationClip({ ...clip, voice: 'robot' }), CitationError);
});

test('a clip that does not say what produced it is refused', () => {
  const { source: _dropped, ...anonymous } = clip;
  assert.throws(() => readNarrationClip(anonymous), CitationError);
});

test('an empty archive reads as no clips rather than failing', () => {
  assert.deepEqual(readNarration([]), []);
  assert.deepEqual(readNarration(undefined), []);
});

test('one bad clip fails the read rather than being dropped quietly', () => {
  assert.throws(() => readNarration([clip, { ...clip, text: '' }]), CitationError);
});

test('a spoken interface label is not an archival clip and needs no citation', () => {
  const label = readUiClip({
    key: 'action.listen',
    language: 'mr',
    voice: 'female',
    file: 'ui/mr/action.listen.female.wav',
    source: 'Bhashini, ai4bharat/indic-tts-coqui-indo_aryan-gpu--t4',
    text: 'ऐका',
  });
  assert.equal(label.key, 'action.listen');
  assert.equal(label.text, 'ऐका');
  assert.equal('passage' in label, false, 'a label carries no cited passage');
});

test('a spoken label still has to say what produced it', () => {
  assert.throws(
    () => readUiClip({ key: 'a', language: 'mr', voice: 'female', file: 'f', text: 'x' }),
    CitationError,
  );
});

test('the spoken label for a key falls back across voices but never across languages', () => {
  const clips = readUiNarration([
    { key: 'a', language: 'mr', voice: 'male', file: 'f', source: 's', text: 'x' },
  ]);
  assert.equal(spokenLabel(clips, 'a', 'mr', 'female')?.voice, 'male');
  assert.equal(spokenLabel(clips, 'a', 'ta', 'female'), null);
  assert.equal(spokenLabel(clips, 'b', 'mr', 'female'), null);
});
