/**
 * Numbers and dates in an archival passage, held out of machine translation.
 *
 * IndicTrans2 keeps a digit and rewrites the word beside it. "About 20
 * millions" came back as 20 lakh in Hindi and Bengali and 20 crore in Marathi,
 * one reading ten times too small and the other ten times too large, under a
 * citation that says Ambedkar wrote it. It also drops figures: "March 3,1930"
 * lost the 3 in Hindi, Bengali and Tamil, and "over 8,000" lost the whole
 * clause. Measured on 26 September 2026, before this module, 2 to 7 pages per
 * language lost a number of two or more digits.
 *
 * So every figure is masked as [0], [1] and so on before the engine sees it,
 * and put back afterwards. A number with a magnitude word is written back as
 * the full figure in Indian grouping, 2,00,00,000. A date is written back by
 * Intl.DateTimeFormat in the target language, so the month name comes from
 * CLDR and not from us. Anything the engine loses or invents fails the block,
 * and a page with a failed block is not written. An English page is better
 * than a wrong one.
 */

const MONTHS = [
  ['january', 'jan'],
  ['february', 'feb'],
  ['march', 'mar'],
  ['april', 'apr'],
  ['may'],
  ['june', 'jun'],
  ['july', 'jul'],
  ['august', 'aug'],
  ['september', 'sept', 'sep'],
  ['october', 'oct'],
  ['november', 'nov'],
  ['december', 'dec'],
];
const MONTH_NAME =
  '(January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.|Feb\\.|Mar\\.|Apr\\.|Jun\\.|Jul\\.|Aug\\.|Sept?\\.|Oct\\.|Nov\\.|Dec\\.)';
const ORDINAL = '(?:st|nd|rd|th)?';

// The engine drops a year it reads as the tail of a date, so a whole date is
// one token. Three printed shapes, tried in this order. "1st of April 1936"
// is the first.
const DAY_MONTH_YEAR = new RegExp(`\\b(\\d{1,2})${ORDINAL}\\s+(?:of\\s+)?${MONTH_NAME},?\\s*(\\d{4})\\b`, 'g');
const MONTH_DAY_YEAR = new RegExp(`\\b${MONTH_NAME}\\s+(\\d{1,2})${ORDINAL},\\s*(\\d{4})\\b`, 'g');
const MONTH_YEAR = new RegExp(`\\b${MONTH_NAME},?\\s+(\\d{4})\\b`, 'g');

// An ordinal ("19th") is left in the text, because "[0]th" confuses the engine
// and a bare figure reads wrongly. The figure check below still covers it.
const NUMBER =
  /(\d{1,3}(?:,\d{2,3})+(?!\d)|\d+(?:\.\d+)?)(?:\s*(millions?|lakhs?|lacs?|crores?|billions?)\b)?(?![\d\p{L}])/giu;

// A list marker such as (1) is structure, not a fact. The engine rewrites it as
// (i) or drops the token, so it is neither masked nor checked.
const ENUMERATOR = /\(\d{1,2}\)/g;

// A footnote reference printed at the end of a block: `the day." 1`.
const FOOTNOTE = /(?<=[.!?”"’'])\s*(\d{1,2})\s*$/;

const MAGNITUDE = { million: 1e6, lakh: 1e5, lac: 1e5, crore: 1e7, billion: 1e9 };

const TOKEN = (i) => new RegExp(`\\[\\s*${i}\\s*\\]`, 'g');

const monthIndex = (name) => {
  const key = name.toLowerCase().replace(/\.$/, '');
  return MONTHS.findIndex((forms) => forms.includes(key));
};

/** The written figure for "20 millions": 2,00,00,000. */
function expand(figure, word) {
  const unit = MAGNITUDE[word.toLowerCase().replace(/s$/, '')];
  const value = Number(figure.replace(/,/g, '')) * unit;
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value);
}

/** A printed date in the target language, with Latin digits like the rest of the text. */
function localDate(language, year, month, day) {
  const at = new Date(Date.UTC(Number(year), month, day === null ? 1 : Number(day)));
  const parts = day === null ? { month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long', year: 'numeric' };
  return new Intl.DateTimeFormat(`${language}-u-nu-latn`, { ...parts, timeZone: 'UTC' }).format(at);
}

/**
 * Replaces each figure and date with a token. Returns the text to send and
 * what each token stands for in `language`.
 */
export function maskNumbers(text, language) {
  const note = text.match(FOOTNOTE);
  const body = note === null ? text : text.slice(0, note.index);
  const values = [];
  const hold = (value) => {
    values.push(value);
    return `[${values.length - 1}]`;
  };
  const masked = body
    .replace(DAY_MONTH_YEAR, (_, day, month, year) => hold(localDate(language, year, monthIndex(month), day)))
    .replace(MONTH_DAY_YEAR, (_, month, day, year) => hold(localDate(language, year, monthIndex(month), day)))
    .replace(MONTH_YEAR, (_, month, year) => hold(localDate(language, year, monthIndex(month), null)))
    .replace(NUMBER, (whole, figure, word, offset, all) => {
      const around = `${all[offset - 1] ?? ''}${all[offset + whole.length] ?? ''}`;
      // A date token already placed, or a list marker, stays as it is.
      if (around === '[]' || (around === '()' && figure.length <= 2)) return whole;
      return hold(word === undefined ? figure : expand(figure, word));
    });
  return { masked, values, footnote: note === null ? null : note[1] };
}

/** A translated block with its footnote reference put back, if it had one. */
export function withFootnote(translated, { footnote }) {
  return footnote === null ? translated : `${translated.trimEnd()} ${footnote}`;
}

/**
 * The masked text with each figure written in, already in the target
 * language. Sent when the engine dropped a token: it copies a date written in
 * Devanagari through a Hindi translation where it drops "[0]".
 */
export function inlineNumbers({ masked, values }) {
  return values.reduce((text, value, i) => text.replace(TOKEN(i), value), masked);
}

/**
 * Puts each figure back. Null when a token did not come back. A token the
 * engine repeated is filled both times, since a repeated figure is still the
 * right figure.
 */
export function restoreNumbers(translated, { values, footnote }) {
  let out = translated;
  for (let i = 0; i < values.length; i++) {
    if (!TOKEN(i).test(out)) return null;
    out = out.replace(TOKEN(i), values[i]);
  }
  return withFootnote(out, { footnote });
}

// A figure followed by a word that states its magnitude. Every magnitude in the
// source is expanded before sending, so one in the output was put there by
// the engine. The word alone is not a fault: "लाखों" means "a great many", and Telugu "లక్ష్యం" (a goal)
// begins with the letters of lakh.
const STATED_MAGNITUDE =
  /\d[\d,.]*\s*(लाख|कोटी|करोड़|करोड|मिलियन|बिलियन|अब्ज|দশলক্ষ|লক্ষ|লাখ|কোটি|মিলিয়ন|বিলিয়ন|லட்சம்|கோடி|மில்லியன்|பில்லியன்|లక్ష|కోటి|కోట్ల|మిలియన్|బిలియన్)/u;

const NATIVE_ZEROS = [0x966, 0x9e6, 0xbe6, 0xc66];

/** Native digits read as Latin, so a figure written either way compares equal. */
function latinDigits(text) {
  return text.replace(/[०-९০-৯௦-௯౦-౯]/g, (c) => {
    const code = c.charCodeAt(0);
    return String(code - NATIVE_ZEROS.find((z) => code >= z && code <= z + 9));
  });
}

const figures = (text) =>
  (latinDigits(text).match(/\d+(?:[.,]\d+)*/g) ?? []).map((d) => d.replace(/,/g, ''));

/**
 * Why a translated block cannot be shown, or null when it can.
 *
 * `source` is the English as printed and `restored` the translation with its
 * figures put back.
 */
export function numberFault(source, language, restored) {
  if (restored === null) return 'a masked figure did not come back';
  const mask = maskNumbers(source, language);
  if (STATED_MAGNITUDE.test(restored)) {
    return 'the translation gives a figure a magnitude the source does not';
  }
  const expected = [...mask.values, ...(mask.footnote === null ? [] : [mask.footnote])].flatMap(figures);
  const unmasked = figures(mask.masked.replace(/\[\s*\d+\s*\]/g, '').replace(ENUMERATOR, ''));
  const have = figures(restored);
  const missing = [...expected, ...unmasked].filter((n) => !have.includes(n));
  return missing.length === 0 ? null : `the translation lost ${missing.join(', ')}`;
}
