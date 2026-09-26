/**
 * What can be verified without a key.
 *
 * The recorded fixtures are real answers from the live configuration endpoint,
 * fetched on 21 September 2026. That call is unauthenticated, so it carries the
 * service list but no inference endpoint, which is exactly the shape this suite
 * asserts on. The compute path cannot be tested here; see D-121.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BhashiniError, readConfig } from './bhashini.mjs';
import {
  asrTask, readAudio, readTranscript, readTranslations, repunctuate, translationTask, ttsTask, withService,
} from './tasks.mjs';
import { TARGET_LANGUAGES, TTS_FAMILY } from './languages.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', `${name}.json`), 'utf8'));

test('every language we offer has a live translation model', () => {
  for (const language of TARGET_LANGUAGES) {
    const { services, endpoint } = readConfig(fixture(`config-translation-en-${language}`));
    assert.equal(endpoint, null, 'an unauthenticated config carries no endpoint');
    const service = services.get('translation');
    assert.match(service.serviceId, /indictrans/, `${language} is served by IndicTrans`);
    assert.equal(service.language.targetLanguage, language);
  }
});

test('every language we offer has a live narration voice, in the family we recorded', () => {
  for (const language of TARGET_LANGUAGES) {
    const { services } = readConfig(fixture(`config-tts-${language}`));
    const service = services.get('tts');
    assert.match(service.serviceId, /indic-tts/);
    assert.ok(
      service.serviceId.includes(TTS_FAMILY[language]),
      `${language} should still be ${TTS_FAMILY[language]}, got ${service.serviceId}`,
    );
  }
});

test('speech recognition resolves to a Hindi conformer', () => {
  const { services } = readConfig(fixture('config-asr-hi'));
  assert.match(services.get('asr').serviceId, /conformer-hi/);
});

test('a configuration with no service for the task is refused, not returned empty', () => {
  assert.throws(
    () => readConfig({ pipelineResponseConfig: [{ taskType: 'translation', config: [] }] }),
    BhashiniError,
  );
  assert.throws(() => readConfig({}), BhashiniError);
});

test('an authenticated configuration yields the endpoint and its key', () => {
  const { endpoint } = readConfig({
    pipelineResponseConfig: [{ taskType: 'tts', config: [{ serviceId: 's', modelId: 'm' }] }],
    pipelineInferenceAPIEndPoint: {
      callbackUrl: 'https://dhruva-api.bhashini.gov.in/services/inference/pipeline',
      inferenceApiKey: { name: 'Authorization', value: 'secret' },
    },
  });
  assert.equal(endpoint.header, 'Authorization');
  assert.equal(endpoint.key, 'secret');
});

test('a task carries the serviceId the configuration named', () => {
  const { services } = readConfig(fixture('config-translation-en-mr'));
  const task = withService(translationTask('en', 'mr'), services);
  assert.equal(task.config.serviceId, 'ai4bharat/indictrans-v2-all-gpu--t4');
  assert.equal(task.config.language.targetLanguage, 'mr');
  assert.throws(() => withService(ttsTask('mr'), services), BhashiniError);
});

test('narration and recognition descriptors carry what the API asks for', () => {
  assert.equal(ttsTask('mr', { gender: 'male' }).config.gender, 'male');
  assert.equal(ttsTask('mr').config.samplingRate, 22050);
  assert.equal(asrTask('hi').config.audioFormat, 'wav');
});

test('a short translation list is refused rather than mismatched to its pages', () => {
  const response = [{ taskType: 'translation', output: [{ source: 'a', target: 'क' }] }];
  assert.deepEqual(readTranslations(response, 1), ['क']);
  assert.throws(() => readTranslations(response, 2), BhashiniError);
});

test('an empty translation is refused', () => {
  const response = [{ taskType: 'translation', output: [{ source: 'a', target: '  ' }] }];
  assert.throws(() => readTranslations(response, 1), BhashiniError);
});

test('audio and transcripts are read from their own keys', () => {
  assert.equal(readAudio([{ taskType: 'tts', audio: [{ audioContent: 'UklGRg==' }] }]), 'UklGRg==');
  assert.throws(() => readAudio([{ taskType: 'tts', audio: [] }]), BhashiniError);
  assert.equal(readTranscript([{ taskType: 'asr', output: [{ source: 'महाड' }] }]), 'महाड');
});

test('a response for a different task is refused', () => {
  assert.throws(() => readAudio([{ taskType: 'translation', output: [] }]), BhashiniError);
});

test('a colon written as visarga is put back, and a real visarga is left alone', () => {
  assert.equal(repunctuate('Also here: [0]', 'यहाँ भीः [0]'), 'यहाँ भी: [0]');
  assert.equal(
    repunctuate('Documents: [0]. Links: [1].', 'নথিঃ [0]। লিঙ্কঃ [1]।'),
    'নথি: [0]। লিঙ্ক: [1]।',
  );
  assert.equal(repunctuate('Reused here', 'यहाँ पुनः उपयोग'), 'यहाँ पुनः उपयोग');
  assert.equal(repunctuate('Dr. Ambedkar: [0]', 'ডঃ আম্বেদকরঃ [0]'), 'ডঃ আম্বেদকরঃ [0]');
  assert.equal(repunctuate('Open: [0]', 'திற: [0]'), 'திற: [0]');
});
