/**
 * One passage translated with its figures intact, or refused.
 *
 * Shared by the page translations the Reading Room shows and the passage
 * translations the Audio Booth reads, so a figure is held to the same test
 * wherever a translation of it appears. See numbers.mjs for why.
 */
import { BhashiniError } from './bhashini.mjs';
import { inlineNumbers, maskNumbers, numberFault, restoreNumbers, withFootnote } from './numbers.mjs';

// ICU's sentence breaker splits after every "Dr." and every initial, which
// would send "B." to the engine as a sentence. A segment ending in one is
// joined to the next.
const ABBREVIATION = /(?:\b(?:Dr|Mr|Mrs|Messrs|Sir|St|No|Nos|Vol|Rs|Hon|Ltd)|\b[A-Z]|\b(?:[A-Za-z]\.){2,})\.\s*$/;
const SEGMENTER = new Intl.Segmenter('en', { granularity: 'sentence' });

export function sentences(text) {
  const out = [];
  for (const { segment } of SEGMENTER.segment(text)) {
    if (out.length > 0 && ABBREVIATION.test(out[out.length - 1])) out[out.length - 1] += segment;
    else out.push(segment);
  }
  return out.map((s) => s.trim()).filter((s) => s !== '');
}

/**
 * Translates `text` into `language` and returns the translation with every
 * figure put back, or throws when no attempt keeps them all.
 *
 * `run` sends a list of strings and resolves to their translations. `first`
 * is an answer already fetched for the masked text, when the caller sent a
 * whole page in one request. `tally.retries` counts the extra requests.
 */
export async function faithfulTranslation(run, text, language, { first, tally } = {}) {
  const mask = maskNumbers(text, language);
  const raw = first ?? (await run([mask.masked]))[0];
  let restored = restoreNumbers(raw, mask);
  let fault = numberFault(text, language, restored);
  // A passage the engine got wrong is tried again in the shapes that kept a
  // dropped figure when tested: a sentence at a time, then with each figure
  // written inline already in the target language, which the engine copies
  // through where it drops an opaque token.
  const inline = inlineNumbers(mask);
  const retries = [
    () => run(sentences(mask.masked)).then((t) => restoreNumbers(t.join(' '), mask)),
    () => run([inline]).then(([t]) => withFootnote(t, mask)),
    () => run(sentences(inline)).then((t) => withFootnote(t.join(' '), mask)),
  ];
  for (const retry of retries) {
    if (fault === null) break;
    if (tally !== undefined) tally.retries += 1;
    restored = await retry();
    fault = numberFault(text, language, restored);
  }
  if (fault !== null) throw new BhashiniError(fault);
  return restored;
}
