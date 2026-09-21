/**
 * The 22 languages of the Eighth Schedule to the Constitution, plus English
 * as an interface language. These are the languages Bhashini covers and the
 * ones the Sutra card can select. See DECISIONS.md D-008.
 */

export type Script =
  | 'latin'
  | 'devanagari'
  | 'bengali'
  | 'gujarati'
  | 'gurmukhi'
  | 'kannada'
  | 'malayalam'
  | 'odia'
  | 'tamil'
  | 'telugu'
  | 'arabic'
  | 'meitei'
  | 'olchiki';

export interface LanguageInfo {
  /** BCP-47 / ISO 639 code, as Bhashini expects it. */
  readonly code: string;
  /** English name, for logs and developer surfaces only. */
  readonly english: string;
  /** Endonym. This is what a visitor actually sees. */
  readonly native: string;
  readonly script: Script;
  readonly direction: 'ltr' | 'rtl';
  /** In the Eighth Schedule. English is not. */
  readonly scheduled: boolean;
  /**
   * Whether a self-hosted font in this repository can render it today.
   * Step 1 shipped Latin and Devanagari. Step 9 added Bengali, Tamil and
   * Telugu, which covers Assamese too, since it shares the Bengali script.
   * The remaining scripts still have only a carousel subset, which can set
   * one vendored phrase and not arbitrary text.
   * The script carousel must only cycle languages where this is true.
   */
  readonly fontCoverage: boolean;
}

export const LANGUAGES: readonly LanguageInfo[] = [
  {
    code: 'en',
    english: 'English',
    native: 'English',
    script: 'latin',
    direction: 'ltr',
    scheduled: false,
    fontCoverage: true,
  },
  {
    code: 'hi',
    english: 'Hindi',
    native: 'हिन्दी',
    script: 'devanagari',
    direction: 'ltr',
    scheduled: true,
    fontCoverage: true,
  },
  {
    code: 'mr',
    english: 'Marathi',
    native: 'मराठी',
    script: 'devanagari',
    direction: 'ltr',
    scheduled: true,
    fontCoverage: true,
  },
  {
    code: 'sa',
    english: 'Sanskrit',
    native: 'संस्कृतम्',
    script: 'devanagari',
    direction: 'ltr',
    scheduled: true,
    fontCoverage: true,
  },
  {
    code: 'ne',
    english: 'Nepali',
    native: 'नेपाली',
    script: 'devanagari',
    direction: 'ltr',
    scheduled: true,
    fontCoverage: true,
  },
  {
    code: 'kok',
    english: 'Konkani',
    native: 'कोंकणी',
    script: 'devanagari',
    direction: 'ltr',
    scheduled: true,
    fontCoverage: true,
  },
  {
    code: 'mai',
    english: 'Maithili',
    native: 'मैथिली',
    script: 'devanagari',
    direction: 'ltr',
    scheduled: true,
    fontCoverage: true,
  },
  {
    code: 'doi',
    english: 'Dogri',
    native: 'डोगरी',
    script: 'devanagari',
    direction: 'ltr',
    scheduled: true,
    fontCoverage: true,
  },
  {
    code: 'brx',
    english: 'Bodo',
    native: 'बड़ो',
    script: 'devanagari',
    direction: 'ltr',
    scheduled: true,
    fontCoverage: true,
  },
  {
    code: 'bn',
    english: 'Bengali',
    native: 'বাংলা',
    script: 'bengali',
    direction: 'ltr',
    scheduled: true,
    fontCoverage: true,
  },
  {
    code: 'as',
    english: 'Assamese',
    native: 'অসমীয়া',
    script: 'bengali',
    direction: 'ltr',
    scheduled: true,
    fontCoverage: true,
  },
  {
    code: 'gu',
    english: 'Gujarati',
    native: 'ગુજરાતી',
    script: 'gujarati',
    direction: 'ltr',
    scheduled: true,
    fontCoverage: false,
  },
  {
    code: 'pa',
    english: 'Punjabi',
    native: 'ਪੰਜਾਬੀ',
    script: 'gurmukhi',
    direction: 'ltr',
    scheduled: true,
    fontCoverage: false,
  },
  {
    code: 'kn',
    english: 'Kannada',
    native: 'ಕನ್ನಡ',
    script: 'kannada',
    direction: 'ltr',
    scheduled: true,
    fontCoverage: false,
  },
  {
    code: 'ml',
    english: 'Malayalam',
    native: 'മലയാളം',
    script: 'malayalam',
    direction: 'ltr',
    scheduled: true,
    fontCoverage: false,
  },
  {
    code: 'or',
    english: 'Odia',
    native: 'ଓଡ଼ିଆ',
    script: 'odia',
    direction: 'ltr',
    scheduled: true,
    fontCoverage: false,
  },
  {
    code: 'ta',
    english: 'Tamil',
    native: 'தமிழ்',
    script: 'tamil',
    direction: 'ltr',
    scheduled: true,
    fontCoverage: true,
  },
  {
    code: 'te',
    english: 'Telugu',
    native: 'తెలుగు',
    script: 'telugu',
    direction: 'ltr',
    scheduled: true,
    fontCoverage: true,
  },
  {
    code: 'ur',
    english: 'Urdu',
    native: 'اردو',
    script: 'arabic',
    direction: 'rtl',
    scheduled: true,
    fontCoverage: false,
  },
  {
    code: 'ks',
    english: 'Kashmiri',
    native: 'کٲشُر',
    script: 'arabic',
    direction: 'rtl',
    scheduled: true,
    fontCoverage: false,
  },
  {
    code: 'sd',
    english: 'Sindhi',
    native: 'سنڌي',
    script: 'arabic',
    direction: 'rtl',
    scheduled: true,
    fontCoverage: false,
  },
  {
    code: 'mni',
    english: 'Manipuri',
    native: 'ꯃꯤꯇꯩꯂꯣꯟ',
    script: 'meitei',
    direction: 'ltr',
    scheduled: true,
    fontCoverage: false,
  },
  {
    code: 'sat',
    english: 'Santali',
    native: 'ᱥᱟᱱᱛᱟᱲᱤ',
    script: 'olchiki',
    direction: 'ltr',
    scheduled: true,
    fontCoverage: false,
  },
] as const;

export const DEFAULT_LANGUAGE = 'en';

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export function language(code: string): LanguageInfo | undefined {
  return BY_CODE.get(code);
}

export function isSupportedLanguage(code: string): boolean {
  return BY_CODE.has(code);
}

/** Languages the script carousel may cycle today. See LanguageInfo.fontCoverage. */
export function renderableLanguages(): readonly LanguageInfo[] {
  return LANGUAGES.filter((l) => l.fontCoverage);
}

/** One representative language per script, for the ambient carousel. */
export function carouselLanguages(): readonly LanguageInfo[] {
  const seen = new Set<Script>();
  const out: LanguageInfo[] = [];
  for (const l of LANGUAGES) {
    if (!l.fontCoverage || seen.has(l.script)) continue;
    seen.add(l.script);
    out.push(l);
  }
  return out;
}

export function scheduledLanguages(): readonly LanguageInfo[] {
  return LANGUAGES.filter((l) => l.scheduled);
}
