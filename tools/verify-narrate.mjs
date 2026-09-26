/**
 * Step 9 verification, for the part that does not need a Bhashini key.
 *
 * The language layer has two halves and only one of them can be checked
 * without credentials. This tool checks that half honestly, and states the
 * other half as outstanding rather than passing it quietly: whether a
 * translation and a narration actually come back in six languages is a
 * measurement nobody here has made, and it cannot be made until the key
 * request is granted. See D-121.
 *
 * Nothing in this file reaches the network. The service list it asserts on was
 * recorded from the live configuration endpoint and is committed as fixtures.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readConfig } from '../packages/narrate/src/bhashini.mjs';
import { haveCredentials } from '../packages/narrate/src/credentials.mjs';
import { LANGUAGES } from '@toran/contracts';
import {
  INTERFACE_LANGUAGES, NARRATION_LANGUAGES, SOURCE_LANGUAGE, TARGET_LANGUAGES,
} from '../packages/narrate/src/languages.mjs';
import { selectedPages, selectedPassages } from '../packages/narrate/src/selection.mjs';
import { numberFault } from '../packages/narrate/src/numbers.mjs';

const FIXTURES = 'packages/narrate/src/fixtures';
const ARCHIVE = 'apps/web/public/archive';
const MESSAGES = 'apps/web/src/i18n/messages';

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${detail === '' ? '' : `  (${detail})`}`);
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

console.log('Step 9: the language layer\n');

// 1. Bhashini covers every language the interface offers.
for (const language of TARGET_LANGUAGES) {
  const { services } = readConfig(readJson(`${FIXTURES}/config-translation-en-${language}.json`));
  check(`en to ${language} has a translation model`, services.has('translation'),
    services.get('translation')?.serviceId ?? 'none');
}
for (const language of NARRATION_LANGUAGES) {
  const { services } = readConfig(readJson(`${FIXTURES}/config-tts-${language}.json`));
  check(`${language} has a narration voice`, services.has('tts'),
    services.get('tts')?.serviceId ?? 'none');
}
check('spoken queries have a recogniser in English and Hindi',
  ['en', 'hi'].every((l) => readConfig(readJson(`${FIXTURES}/config-asr-${l}.json`)).services.has('asr')));

// 2. Every language the interface OFFERS has a complete catalogue and a face.
// A language with a vendored face but no catalogue is not a failure; it is
// waiting on a Bhashini key, and it is counted as outstanding further down.
const en = readJson(`${MESSAGES}/en.json`);
const offered = INTERFACE_LANGUAGES.filter((l) => fs.existsSync(`${MESSAGES}/${l}.json`));
const waiting = INTERFACE_LANGUAGES.filter((l) => !offered.includes(l));
for (const language of offered) {
  const catalogue = readJson(`${MESSAGES}/${language}.json`);
  const missing = Object.keys(en).filter((k) => catalogue[k] === undefined);
  const untranslated = language === SOURCE_LANGUAGE
    ? []
    : Object.keys(en).filter((k) => catalogue[k] === en[k] && en[k].length > 3);
  check(`${language} catalogue is complete`, missing.length === 0,
    missing.length === 0 ? `${Object.keys(catalogue).length} keys` : `${missing.length} missing`);
  // A string identical to English is untranslated. Whether that is a failure
  // depends on whether it could have been translated: with no Bhashini key
  // there is no way to translate the strings a step just added, and failing on
  // that would fail every run until a credential arrives. With a key, there is
  // no excuse and the count must be at most the four proper nouns.
  //
  // The tolerance is not a number that gets raised when a run goes red. It is
  // tied to the credential, and `npm run catalogue` is what clears it.
  const excused = !haveCredentials();
  check(`${language} catalogue is actually translated`,
    untranslated.length <= 4 || excused,
    untranslated.length <= 4
      ? `${untranslated.length} strings identical to English`
      : `${untranslated.length} strings identical to English, awaiting a Bhashini key: ` +
        `${[...new Set(untranslated.map((k) => k.split('.')[0]))].join(', ')}`);
}
check('every offered language has a self-hosted reading face',
  offered.every((l) => LANGUAGES.find((x) => x.code === l)?.fontCoverage === true),
  offered.join(', '));
check('every language we intend to offer already has its face vendored',
  INTERFACE_LANGUAGES.every((l) => LANGUAGES.find((x) => x.code === l)?.fontCoverage === true),
  INTERFACE_LANGUAGES.join(', '));

// 3. The selection is derived from surfaces that already cite their sources.
const pages = selectedPages();
const passages = selectedPassages();
check('pages to translate are selected from cited surfaces', pages.length > 0,
  `${pages.length} pages`);
check('every selected passage carries a citation',
  passages.every((p) => typeof p.citation?.pageId === 'string' && p.citation.locator !== undefined),
  `${passages.length} passages`);

// 4. The archive states what it holds, including when it holds nothing.
const manifest = readJson(`${ARCHIVE}/manifest.json`);
check('the manifest has a translation index', manifest.translations !== undefined);
check('the manifest has a narration index', Array.isArray(manifest.narration));
const cached = Object.values(manifest.translations ?? {}).flat().length;
const clips = (manifest.narration ?? []).length;
// A cached translation is read against its printed page again, because a file
// written before the number gate existed, or edited by hand, would otherwise
// be trusted for having been written once.
const DIP = 'data/dip';
const printed = new Map(
  fs.readFileSync(`${DIP}/pages.jsonl`, 'utf8').split('\n').filter(Boolean)
    .map((line) => JSON.parse(line)).map((p) => [p.pageId, p]),
);
const numberFaults = [];
for (const language of TARGET_LANGUAGES) {
  const dir = `${DIP}/translations/${language}`;
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    const pageId = name.replace(/\.json$/, '');
    const blocks = readJson(`${dir}/${name}`).blocks;
    printed.get(pageId)?.blocks.forEach((b, i) => {
      const fault = numberFault(b.text, language, blocks[i]?.text ?? null);
      if (fault !== null) numberFaults.push(`${language}/${pageId} block ${i}: ${fault}`);
    });
  }
}
check('every cached translation keeps the figures its page prints', numberFaults.length === 0,
  numberFaults.length === 0 ? '' : numberFaults.slice(0, 5).join('; '));
check('every cached narration clip names its citation and its engine',
  (manifest.narration ?? []).every((c) => c.citation?.pageId && typeof c.source === 'string'),
  `${clips} clips`);

// 5. What is not measured, said plainly.
console.log('');
const live = haveCredentials();
console.log(`credentials present: ${live ? 'yes' : 'no'}`);
console.log(`languages offered:   ${offered.join(', ')} (${offered.length} of ${INTERFACE_LANGUAGES.length})`);
console.log(`faces vendored:      ${LANGUAGES.filter((l) => l.fontCoverage).length} of ${LANGUAGES.length} scheduled languages`);
console.log(`translations cached: ${cached} pages across ${Object.keys(manifest.translations ?? {}).length} languages`);
console.log(`narration cached:    ${clips} clips`);
if (cached === 0 || clips === 0 || waiting.length > 0) {
  console.log('\nOUTSTANDING, and reported as outstanding rather than passed:');
  if (waiting.length > 0) {
    console.log(
      `  ${waiting.join(', ')} have a vendored face but no catalogue, so the\n` +
        '  interface does not offer them yet. Run: npm run catalogue',
    );
  }
  if (cached === 0) console.log('  No page is translated. Run: npm run translate');
  if (clips === 0) console.log('  No passage is narrated. Run: npm run narrate');
  console.log(
    '  All three need a Bhashini key. The request was submitted on\n' +
      '  21 September 2026 and has not been granted. Afterwards, run the\n' +
      '  commands above, then npm run build:archive, and this tool measures it.\n' +
      '  See DECISIONS.md D-121 and D-122.',
  );
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
