/**
 * ULCA task descriptors and the readers for what comes back.
 *
 * Kept apart from the transport so both halves can be tested without a key:
 * the descriptors are plain objects, and the readers take a recorded response.
 */
import { BhashiniError } from './bhashini.mjs';

/** Ask for a translation. The pair decides which model answers. */
export const translationTask = (sourceLanguage, targetLanguage) => ({
  taskType: 'translation',
  config: { language: { sourceLanguage, targetLanguage } },
});

/**
 * Ask for narration. Bhashini's Indic TTS offers a male and a female voice per
 * language family; the kiosk lets a visitor choose, so the voice is a parameter
 * rather than a constant.
 */
export const ttsTask = (sourceLanguage, { gender = 'female', samplingRate = 22050 } = {}) => ({
  taskType: 'tts',
  config: { language: { sourceLanguage }, gender, samplingRate },
});

export const asrTask = (sourceLanguage, { audioFormat = 'wav', samplingRate = 16000 } = {}) => ({
  taskType: 'asr',
  config: { language: { sourceLanguage }, audioFormat, samplingRate },
});

/** The same descriptor with the serviceId the configuration call named. */
export function withService(task, services) {
  const chosen = services.get(task.taskType);
  if (chosen === undefined) {
    throw new BhashiniError(`configuration named no service for ${task.taskType}`, {
      task: task.taskType,
    });
  }
  return { ...task, config: { ...task.config, serviceId: chosen.serviceId } };
}

const taskOf = (response, taskType) => {
  const found = response.find((r) => r.taskType === taskType);
  if (found === undefined) {
    throw new BhashiniError(`the response carried no ${taskType} result`, { task: taskType });
  }
  return found;
};

/**
 * Translated strings, in the order they were sent.
 *
 * The count is checked because a silently short list is the failure that would
 * put one page's translation under another page's citation, and that is the
 * one mistake this archive cannot make.
 */
export function readTranslations(response, expected) {
  const out = taskOf(response, 'translation').output;
  if (!Array.isArray(out)) throw new BhashiniError('translation output was not a list');
  if (out.length !== expected) {
    throw new BhashiniError(
      `sent ${expected} passages and got ${out.length} translations back`,
    );
  }
  return out.map((o, i) => {
    const target = o?.target;
    if (typeof target !== 'string' || target.trim() === '') {
      throw new BhashiniError(`translation ${i} came back empty`);
    }
    return typeof o.source === 'string' ? repunctuate(o.source, target) : target;
  });
}

// Visarga in the scripts IndicTrans2 writes: Devanagari, Bengali, Gurmukhi,
// Gujarati, Oriya, Telugu, Kannada, Malayalam. Tamil's aytham is a letter in
// ordinary words and is left out on purpose.
const WORD_FINAL_VISARGA = /[\u0903\u0983\u0A03\u0A83\u0B03\u0C03\u0C83\u0D03](?=[\s\-\u2013\u2014"'\u201c\u201d\u2018\u2019]|$)/gu;

/**
 * Puts back the colons IndicTrans2 writes as visarga.
 *
 * "Also here: {title}" came back as "यहाँ भीः" in Hindi and the same in Bengali
 * and Telugu, 26 of 298 interface strings on 26 September 2026. Visarga is also
 * a real sign ("पुनः", Bengali "ডঃ" for Dr.), so it is replaced only when the
 * source has colons, the translation has none, and the count of word-final
 * visargas equals the count of colons. Anything less certain is left as the
 * engine wrote it.
 */
export function repunctuate(source, target) {
  const colons = (source.match(/:/g) ?? []).length;
  if (colons === 0 || target.includes(':')) return target;
  const visargas = (target.match(WORD_FINAL_VISARGA) ?? []).length;
  return visargas === colons ? target.replace(WORD_FINAL_VISARGA, ':') : target;
}

/** Narration audio, base64, as the API returns it. */
export function readAudio(response) {
  const audio = taskOf(response, 'tts').audio;
  const content = Array.isArray(audio) ? audio[0]?.audioContent : undefined;
  if (typeof content !== 'string' || content === '') {
    throw new BhashiniError('narration came back with no audio');
  }
  return content;
}

/** What the speech recogniser heard. */
export function readTranscript(response) {
  const out = taskOf(response, 'asr').output;
  const source = Array.isArray(out) ? out[0]?.source : undefined;
  if (typeof source !== 'string') throw new BhashiniError('recognition came back empty');
  return source;
}
