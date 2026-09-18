/**
 * The script carousel. PROJECT.md section 6.3, innovation 1.
 *
 * The same welcome, cycling through the scripts of the scheduled languages,
 * shown before a visitor has touched anything, so they see their own script
 * and know the machine is for them.
 *
 * Each script's font here is a subset containing only the glyphs of its
 * phrase, vendored by tools/fetch-carousel-fonts.mjs. The families are named
 * "Toran Carousel ..." on purpose: they cannot render arbitrary text in that
 * script, and naming them after the full face would imply they could. Full
 * script faces arrive in step 9.
 *
 * Manipuri in Meitei Mayek and Santali in Ol Chiki are not in the carousel.
 * Nobody on the project could verify a welcome phrase in either script, and a
 * wrong greeting in a visitor's own script is worse than none.
 *
 * This file has no imports so the font script can read it directly.
 */

export interface CarouselPhrase {
  readonly lang: string;
  readonly script: string;
  readonly text: string;
  readonly direction: 'ltr' | 'rtl';
  /** Google Fonts family the subset is cut from. Null for faces already self-hosted. */
  readonly source: string | null;
  /** CSS family to render with. */
  readonly family: string;
}

export const CAROUSEL: readonly CarouselPhrase[] = [
  {
    lang: 'en',
    script: 'latin',
    text: 'Welcome',
    direction: 'ltr',
    source: null,
    family: 'Spectral',
  },
  {
    lang: 'hi',
    script: 'devanagari',
    text: 'स्वागत है',
    direction: 'ltr',
    source: null,
    family: 'Noto Serif Devanagari',
  },
  {
    lang: 'mr',
    script: 'devanagari',
    text: 'स्वागत आहे',
    direction: 'ltr',
    source: null,
    family: 'Noto Serif Devanagari',
  },
  {
    lang: 'bn',
    script: 'bengali',
    text: 'স্বাগতম',
    direction: 'ltr',
    source: 'Noto Serif Bengali',
    family: 'Toran Carousel Bengali',
  },
  {
    lang: 'ta',
    script: 'tamil',
    text: 'வரவேற்கிறோம்',
    direction: 'ltr',
    source: 'Noto Serif Tamil',
    family: 'Toran Carousel Tamil',
  },
  {
    lang: 'te',
    script: 'telugu',
    text: 'స్వాగతం',
    direction: 'ltr',
    source: 'Noto Serif Telugu',
    family: 'Toran Carousel Telugu',
  },
  {
    lang: 'gu',
    script: 'gujarati',
    text: 'સ્વાગત છે',
    direction: 'ltr',
    source: 'Noto Serif Gujarati',
    family: 'Toran Carousel Gujarati',
  },
  {
    lang: 'pa',
    script: 'gurmukhi',
    text: 'ਜੀ ਆਇਆਂ ਨੂੰ',
    direction: 'ltr',
    source: 'Noto Serif Gurmukhi',
    family: 'Toran Carousel Gurmukhi',
  },
  {
    lang: 'kn',
    script: 'kannada',
    text: 'ಸ್ವಾಗತ',
    direction: 'ltr',
    source: 'Noto Serif Kannada',
    family: 'Toran Carousel Kannada',
  },
  {
    lang: 'ml',
    script: 'malayalam',
    text: 'സ്വാഗതം',
    direction: 'ltr',
    source: 'Noto Serif Malayalam',
    family: 'Toran Carousel Malayalam',
  },
  {
    lang: 'or',
    script: 'odia',
    text: 'ସ୍ୱାଗତ',
    direction: 'ltr',
    source: 'Noto Serif Oriya',
    family: 'Toran Carousel Odia',
  },
  {
    lang: 'ur',
    script: 'arabic',
    text: 'خوش آمدید',
    direction: 'rtl',
    source: 'Noto Nastaliq Urdu',
    family: 'Toran Carousel Urdu',
  },
];

/** How long each phrase holds, including its crossfade. */
export const CAROUSEL_HOLD_MS = 2400;
