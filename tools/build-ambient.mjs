/**
 * Curates the passages a kiosk shows in its attract loop.
 *
 * Chosen by hand and checked against the corpus. Each entry names a phrase;
 * the script finds the chunk that contains that phrase verbatim and lifts the
 * sentences around it, keeping the chunk's real locator as the citation. A
 * phrase that is not found, or an excerpt that does not read as whole
 * sentences, fails the run and nothing is written: the list is curated, so a
 * gap in it is for a person to fix. Nothing is paraphrased and nothing is
 * typed in from memory.
 *
 * Random selection was tried first and rejected: volume 1 prints Gandhi's
 * reply beside the address, and the first passage it chose was Gandhi writing
 * about Ambedkar, under a citation any visitor would read as Ambedkar's own.
 * Every passage here is Ambedkar's, the Assembly's own record of what it
 * decided, or the constitutional text itself.
 *
 * Output: apps/web/public/kiosk/ambient.json, read through readChunk like
 * search results, so an ambient passage cannot lack a citation.
 */
import fs from 'node:fs';

const rows = fs
  .readFileSync('data/dip/chunks.jsonl', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const flat = (s) => s.replace(/\s+/g, ' ').trim();

// Each passage states exactly how many sentences to take either side of the
// one holding the phrase. Widening greedily to fill space was tried first; it
// began excerpts on a pronoun whose subject was cut ("It is also a division of
// labourers"), swallowed a section numeral, and stopped mid sentence.
const CURATED = [
  // Annihilation of Caste, 1936, volume 1. Ambedkar's undelivered address.
  { phrase: 'division of labourers', before: 1, after: 0, where: (r) => r.workId === 'baws-v1' },
  { phrase: 'monster that crosses your path', before: 0, after: 1, where: (r) => r.workId === 'baws-v1' },
  { phrase: 'caste is a notion', before: 0, after: 2, where: (r) => r.workId === 'baws-v1' },
  { phrase: 'real remedy for breaking caste', before: 0, after: 1, where: (r) => r.workId === 'baws-v1' },
  { phrase: 'mode of associated living', before: 1, after: 1, where: (r) => r.workId === 'baws-v1' },
  // In the Constituent Assembly, 29 November 1948, on access to public places.
  { phrase: 'the answer is categorically in the affirmative', before: 1, after: 1, where: (r) => r.corpus === 'cad' && /Ambedkar/.test(r.speaker ?? '') },
  { phrase: 'should not be segregated', before: 0, after: 0, where: (r) => r.corpus === 'cad' && /Ambedkar/.test(r.speaker ?? '') },
  // The outcome, and the article.
  { phrase: 'article 11 was added to the constitution', before: 0, after: 0, where: (r) => r.corpus === 'cad' },
  { phrase: 'is abolished and its practice in any form is forbidden', before: 0, after: 1, where: (r) => r.workId === 'coi-art17' },
];

// Section numerals such as "IV" sit on their own in the printed text and must
// not be read as part of a sentence.
const NUMERAL = /^(?:[IVXLC]+)\s+(?=[A-Z])/;

/** Exactly the requested sentences, or null if they do not read as a whole. */
function excerpt(text, phrase, before, after) {
  const sentences = flat(text)
    .split(/(?<=[.!?"”])\s+(?=[A-Z"“‘(])/)
    .map((s) => s.replace(NUMERAL, ''))
    .filter((s) => !/^[IVXLC]+$/.test(s));
  const at = sentences.findIndex((s) => s.toLowerCase().includes(phrase));
  if (at === -1 || at - before < 0 || at + after >= sentences.length) return null;
  const out = sentences.slice(at - before, at + after + 1).join(' ');
  const wholeStart = /^["“‘(]?[A-Z]/.test(out);
  const wholeEnd = /[.!?]["”’)]?$/.test(out);
  return wholeStart && wholeEnd ? out : null;
}

const out = [];
console.log('ambient passages, curated and checked against the corpus');
for (const { phrase, before, after, where } of CURATED) {
  const hit = rows.find((r) => where(r) && flat(r.text).toLowerCase().includes(phrase));
  const text = hit ? excerpt(hit.text, phrase, before, after) : null;
  if (!hit) {
    console.log(`  absent  "${phrase}"`);
    continue;
  }
  if (!text) {
    console.log(`  REJECT  "${phrase}": the requested sentences do not read as a whole`);
    continue;
  }
  out.push({ ...hit, text });
  const l = hit.locator;
  const where_ = l.kind === 'page' ? `vol ${l.volume} p${l.page}` : l.kind === 'paragraph' ? `${l.volume}.${l.sitting}.${l.paragraph}${l.procedural ? '+' : ''}` : `art ${l.article}`;
  console.log(`  found   ${where_.padEnd(12)} "${phrase}"  (${text.length} chars)`);
}

if (out.length !== CURATED.length) {
  console.error(`  ${CURATED.length - out.length} of ${CURATED.length} passages failed; nothing written`);
  process.exit(1);
}

fs.mkdirSync('apps/web/public/kiosk', { recursive: true });
fs.writeFileSync('apps/web/public/kiosk/ambient.json', JSON.stringify(out));
console.log(`  ${out.length} of ${CURATED.length} passages, ${(fs.statSync('apps/web/public/kiosk/ambient.json').size / 1024).toFixed(1)} KB`);
