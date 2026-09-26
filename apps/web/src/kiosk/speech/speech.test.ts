/**
 * The recording that leaves the kiosk. Run with `npm test`.
 *
 * What the browser encodes has to be what Core accepts, and Core reads it
 * through the contract, so the two are tested against each other here.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readTranscribeRequest,
  SPEECH_MAX_SECONDS,
  SPEECH_SAMPLE_RATE,
} from '@toran/contracts';
import { base64, downsample, encodeWav } from './wav.ts';

const tone = (seconds: number, rate: number) =>
  Float32Array.from(
    { length: Math.round(seconds * rate) },
    (_, i) => Math.sin((2 * Math.PI * 220 * i) / rate) * 0.5,
  );

test('two seconds at 48 kHz become 32,000 samples at 16 kHz', () => {
  assert.equal(downsample(tone(2, 48_000), 48_000).length, 32_000);
});

test('what the kiosk encodes, Core accepts', () => {
  const audio = base64(encodeWav(downsample(tone(2, 48_000), 48_000)));
  const read = readTranscribeRequest({ language: 'hi', audio });
  assert.equal(read.language, 'hi');
});

test('too long, too short, or not a WAV is refused before it costs a call', () => {
  const long = base64(encodeWav(tone(SPEECH_MAX_SECONDS + 1, SPEECH_SAMPLE_RATE)));
  assert.throws(() => readTranscribeRequest({ language: 'hi', audio: long }), /at most/);
  const short = base64(encodeWav(tone(0.05, SPEECH_SAMPLE_RATE)));
  assert.throws(
    () => readTranscribeRequest({ language: 'hi', audio: short }),
    /at least/,
  );
  const wrongRate = base64(encodeWav(tone(1, 44_100), 44_100));
  assert.throws(
    () => readTranscribeRequest({ language: 'hi', audio: wrongRate }),
    /16000 Hz/,
  );
  assert.throws(
    () => readTranscribeRequest({ language: 'hi', audio: btoa('x'.repeat(40_000)) }),
    /not a WAV/,
  );
});
