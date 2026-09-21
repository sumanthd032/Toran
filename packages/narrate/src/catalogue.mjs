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

/** Replaces {name} with a token a translation engine will carry through unchanged. */
function protect(text) {
  const names = [];
  const masked = text.replace(PLACEHOLDER, (_, name) => {
    names.push(name);
    return `__${names.length - 1}__`;
  });
  return { masked, names };
}

function restore(translated, names) {
  let out = translated;
  for (let i = 0; i < names.length; i++) {
    // Engines sometimes space or case the token differently; accept that.
    const token = new RegExp(`_\\s*_\\s*${i}\\s*_\\s*_`, 'g');
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

async function main() {
  const opts = argv();
  const languages = opts.only === null ? TARGET_LANGUAGES : [opts.only];
  const en = JSON.parse(fs.readFileSync(path.join(MESSAGES, `${SOURCE_LANGUAGE}.json`), 'utf8'));
  const keys = Object.keys(en);
  console.log(`catalogue: ${keys.length} strings into ${languages.join(', ')}`);

  const todo = languages.filter(
    (l) => opts.force || !fs.existsSync(path.join(MESSAGES, `${l}.json`)),
  );
  if (todo.length === 0) {
    console.log('catalogue: every requested catalogue already exists; pass --force to redo one');
    return;
  }
  if (opts.dryRun) {
    console.log(`catalogue: would write ${todo.join(', ')}`);
    return;
  }
  if (!haveCredentials()) {
    console.log(
      'catalogue: no Bhashini credentials, so nothing was written.\n' +
        `           ${todo.join(', ')} stay unlisted, and the interface offers the\n` +
        '           languages whose catalogues exist. See DECISIONS.md D-122.',
    );
    return;
  }

  for (const language of todo) {
    const task = translationTask(SOURCE_LANGUAGE, language);
    const { services, endpoint } = await configure([task]);
    const service = services.get('translation');
    const out = {};
    let kept = 0;
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
          out[key] = en[key];
          fellBack += 1;
          return;
        }
        out[key] = restored;
        kept += 1;
      });
      process.stdout.write(`  ${language}: ${Math.min(i + BATCH, keys.length)}/${keys.length}\n`);
    }

    out['_provenance'] = `Bhashini, ${service.serviceId}, ${new Date().toISOString().slice(0, 10)}. Machine translated, not yet reviewed by a speaker.`;
    fs.writeFileSync(
      path.join(MESSAGES, `${language}.json`),
      `${JSON.stringify(out, null, 2)}\n`,
    );
    console.log(
      `catalogue: ${language} written, ${kept} translated, ` +
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
