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
import {
  INTERFACE_LANGUAGES, NARRATION_LANGUAGES, SOURCE_LANGUAGE, TARGET_LANGUAGES,
} from '../packages/narrate/src/languages.mjs';
import { selectedPages, selectedPassages } from '../packages/narrate/src/selection.mjs';

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

// 2. Six interface languages, each with a complete catalogue and a font.
const en = readJson(`${MESSAGES}/en.json`);
check('the interface offers six languages', INTERFACE_LANGUAGES.length === 6,
  INTERFACE_LANGUAGES.join(', '));
for (const language of INTERFACE_LANGUAGES) {
  const file = `${MESSAGES}/${language}.json`;
  if (!fs.existsSync(file)) {
    check(`${language} has a catalogue`, false, 'missing');
    continue;
  }
  const catalogue = readJson(file);
  const missing = Object.keys(en).filter((k) => catalogue[k] === undefined);
  const untranslated = language === SOURCE_LANGUAGE
    ? []
    : Object.keys(en).filter((k) => catalogue[k] === en[k] && en[k].length > 3);
  check(`${language} catalogue is complete`, missing.length === 0,
    missing.length === 0 ? `${Object.keys(catalogue).length} keys` : `${missing.length} missing`);
  check(`${language} catalogue is actually translated`, untranslated.length <= 4,
    `${untranslated.length} strings identical to English`);
}

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
check('every cached narration clip names its citation and its engine',
  (manifest.narration ?? []).every((c) => c.citation?.pageId && typeof c.source === 'string'),
  `${clips} clips`);

// 5. What is not measured, said plainly.
console.log('');
const live = haveCredentials();
console.log(`credentials present: ${live ? 'yes' : 'no'}`);
console.log(`translations cached: ${cached} pages across ${Object.keys(manifest.translations ?? {}).length} languages`);
console.log(`narration cached:    ${clips} clips`);
if (cached === 0 || clips === 0) {
  console.log(
    '\nOUTSTANDING, and reported as outstanding rather than passed:\n' +
      '  Translation and narration in six languages are UNMEASURED. The Bhashini\n' +
      '  key request was submitted on 21 September 2026 and has not been granted.\n' +
      '  Run: npm run translate && npm run narrate && npm run build:archive\n' +
      '  then this tool measures it. See DECISIONS.md D-121.',
  );
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
