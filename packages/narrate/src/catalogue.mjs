/**
 * Generates an interface catalogue through Bhashini.
 *
 * The 243 strings in `apps/web/src/i18n/messages/en.json` are the interface:
 * button labels, field names, the sentence a kiosk shows when a room is not
 * built yet. None of them carries a citation, so unlike an archival passage a
 * machine may translate them outright. What a machine may not do is pretend a
 * human checked them, so every generated catalogue carries the engine that
 * produced it and the date, and `verify:narrate` reports a language as
 * machine-translated until somebody who reads it says otherwise.
 *
 * Placeholders are the reason this is not a plain loop. A string like
 * "Volume {volume}" must come back with {volume} intact, so each placeholder
 * is lifted out before translation and put back after. A string whose
 * placeholders do not survive is left in English rather than shipped broken.
 *
 * Run: npm run catalogue -- --language bn
 *
 * npm takes --dry-run for itself, so that one flag needs node directly:
 * node packages/narrate/src/catalogue.mjs --dry-run
 */
import fs from 'node:fs';
import path from 'node:path';
import { configure, compute } from './bhashini.mjs';
import { haveCredentials, MissingCredentials, ROOT } from './credentials.mjs';
import { SOURCE_LANGUAGE, TARGET_LANGUAGES } from './languages.mjs';
import { readTranslations, translationTask, withService } from './tasks.mjs';

const MESSAGES = path.join(ROOT, 'apps/web/src/i18n/messages');
const BATCH = 25;

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Replaces {name} with a token a translation engine will carry through unchanged.
 *
 * The token is [0], [1] and so on. IndicTrans2 splits __0__ into "_ 0 _",
 * which lost a placeholder in 62 of 298 strings on 26 September 2026. Square brackets came back intact in Hindi and Tamil, and
 * no English string uses them, so a bracket in the output is always ours.
 */
function protect(text) {
  const names = [];
  const masked = text.replace(PLACEHOLDER, (_, name) => {
    names.push(name);
    return `[${names.length - 1}]`;
  });
  return { masked, names };
}

function restore(translated, names) {
  let out = translated;
  for (let i = 0; i < names.length; i++) {
    // Engines sometimes space or case the token differently; accept that.
    const token = new RegExp(`\\[\\s*${i}\\s*\\]`, 'g');
    if (!token.test(out)) return null;
    out = out.replace(token, `{${names[i]}}`);
  }
  return out;
}

function argv() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--language');
  return {
    only: i === -1 ? null : args[i + 1] ?? null,
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
  };
}

/**
 * The keys a run must send, and what it starts from.
 *
 * A catalogue that already exists may hold strings a speaker wrote by hand,
 * as hi and mr do. Those are better than anything a machine returns, so only
 * the keys that are absent or still read exactly as the English are sent.
 * --force discards the file and sends everything.
 */
function plan(language, en, force) {
  const file = path.join(MESSAGES, `${language}.json`);
  if (force || !fs.existsSync(file)) {
    return { base: {}, machine: [], keys: Object.keys(en) };
  }
  const base = JSON.parse(fs.readFileSync(file, 'utf8'));
  const keys = Object.keys(en).filter((k) => base[k] === undefined || base[k] === en[k]);
  return { base, machine: Array.isArray(base['_machine']) ? base['_machine'] : [], keys };
}

async function main() {
  const opts = argv();
  const languages = opts.only === null ? TARGET_LANGUAGES : [opts.only];
  const en = JSON.parse(fs.readFileSync(path.join(MESSAGES, `${SOURCE_LANGUAGE}.json`), 'utf8'));
  console.log(`catalogue: ${Object.keys(en).length} strings into ${languages.join(', ')}`);

  const todo = languages
    .map((language) => ({ language, ...plan(language, en, opts.force) }))
    .filter((p) => p.keys.length > 0);
  if (todo.length === 0) {
    console.log('catalogue: every requested catalogue is already translated; pass --force to redo one');
    return;
  }
  if (opts.dryRun) {
    for (const p of todo) console.log(`catalogue: would send ${p.keys.length} strings for ${p.language}`);
    return;
  }
  if (!haveCredentials()) {
    console.log(
      'catalogue: no Bhashini credentials, so nothing was written.\n' +
        `           ${todo.map((p) => p.language).join(', ')} stay as they are, and the interface\n` +
        '           offers the languages whose catalogues exist. See DECISIONS.md D-122.',
    );
    return;
  }

  for (const { language, base, machine, keys } of todo) {
    const task = translationTask(SOURCE_LANGUAGE, language);
    const { services, endpoint } = await configure([task]);
    const service = services.get('translation');
    const filled = {};
    let fellBack = 0;

    for (let i = 0; i < keys.length; i += BATCH) {
      const slice = keys.slice(i, i + BATCH);
      const prepared = slice.map((k) => protect(en[k]));
      const response = await compute(endpoint, [withService(task, services)], {
        input: prepared.map((p) => ({ source: p.masked })),
      });
      const translated = readTranslations(response, slice.length);
      slice.forEach((key, j) => {
        const restored = restore(translated[j], prepared[j].names);
        if (restored === null) {
          // A placeholder did not survive. English is wrong but legible; a
          // label reading "Volume __0__" is neither.
          fellBack += 1;
          return;
        }
        filled[key] = restored;
      });
      process.stdout.write(`  ${language}: ${Math.min(i + BATCH, keys.length)}/${keys.length}\n`);
    }

    // Written in the English key order, so a diff against en.json lines up.
    const out = {};
    for (const key of Object.keys(en)) out[key] = filled[key] ?? base[key] ?? en[key];
    const machineKeys = [...new Set([...machine, ...Object.keys(filled)])].filter((k) => k in en);
    const whole = machineKeys.length === Object.keys(en).length;
    out['_provenance'] =
      `Bhashini, ${service.serviceId}, ${new Date().toISOString().slice(0, 10)}. ` +
      (whole
        ? 'Machine translated, not yet reviewed by a speaker.'
        : `Written by hand except the ${machineKeys.length} keys in _machine, which are machine translated and not yet reviewed by a speaker.`);
    if (!whole) out['_machine'] = machineKeys;
    fs.writeFileSync(path.join(MESSAGES, `${language}.json`), `${JSON.stringify(out, null, 2)}\n`);
    console.log(
      `catalogue: ${language} written, ${Object.keys(filled).length} translated, ` +
        `${fellBack} left in English because a placeholder did not survive`,
    );
  }
  console.log(
    '\ncatalogue: add each new language to CATALOGUES in apps/web/src/i18n/index.tsx\n' +
      '           to offer it, then run npm run verify:narrate.',
  );
}

main().catch((error) => {
  if (error instanceof MissingCredentials) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  console.error(error);
  process.exitCode = 1;
});
