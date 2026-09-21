/**
 * The languages the archive is translated and narrated into.
 *
 * Bhashini covers all 22 scheduled languages and the kiosk claims all 22, but
 * a language is only offered once this repository can also render it and
 * localise its interface. This list is that shorter set, and it is what the
 * build commands iterate. Adding a language means adding its font and its
 * catalogue, then adding it here, in that order.
 *
 * Six today. English is the language of the corpus, so it is the source and
 * never a target.
 */
export const SOURCE_LANGUAGE = 'en';

export const TARGET_LANGUAGES = ['hi', 'mr', 'bn', 'ta', 'te'];

/**
 * Which Bhashini TTS family serves a language, recorded from the configuration
 * call on 21 September 2026. Kept so a change in Bhashini's routing shows up as
 * a diff here rather than as a silent change of voice.
 */
export const TTS_FAMILY = {
  en: 'misc',
  hi: 'indo_aryan',
  mr: 'indo_aryan',
  bn: 'indo_aryan',
  ta: 'dravidian',
  te: 'dravidian',
};

/**
 * Narration covers the source language too. A visitor reading the English
 * original still wants it read aloud, and the audio-first path has to work
 * before a single translation is cached.
 */
export const NARRATION_LANGUAGES = [SOURCE_LANGUAGE, ...TARGET_LANGUAGES];

/** Every language the interface offers, source first. */
export const INTERFACE_LANGUAGES = [SOURCE_LANGUAGE, ...TARGET_LANGUAGES];

export const VOICES = ['female', 'male'];
