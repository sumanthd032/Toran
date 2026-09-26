/**
 * Fills the archive's translation cache through Bhashini.
 *
 * Each printed page is sent block for block and comes back block for block, so
 * a translation lines up with the page it translates and the reading view can
 * lock the two columns together. Before anything is written, the result is put
 * through the same `readTranslation` contract the kiosk uses to display it: if
 * a translation would not survive being read back with its citation, it is not
 * written at all. A page with a missing block is a page whose translation would
 * sit under the wrong citation, and that is the one thing this archive cannot do.
 *
 * Numbers never reach the engine. See numbers.mjs for what it did to them, and
 * why a page whose figures do not survive is left untranslated.
 *
 * Every file written here is served offline afterwards. A passage is therefore
 * translated once, ever, which is what keeps the free tier sufficient.
 *
 * Run: npm run translate [-- --all] [-- --language mr] [-- --dry-run]
 *
 * npm takes --dry-run for itself, so that one flag needs node directly:
 * node packages/narrate/src/translate.mjs --dry-run
 */
import fs from 'node:fs';
import path from 'node:path';
import { readPage, readTranslation } from '@toran/contracts';
import { BhashiniError, configure, compute } from './bhashini.mjs';
import { haveCredentials, MissingCredentials, ROOT } from './credentials.mjs';
import { SOURCE_LANGUAGE, TARGET_LANGUAGES } from './languages.mjs';
import { readTranslations, translationTask, withService } from './tasks.mjs';
import {
  blockOf,
  cachedPassageTranslation,
  passageTranslation,
  selectedPages,
  selectedPassages,
} from './selection.mjs';
import { faithfulTranslation } from './faithful.mjs';
import { maskNumbers } from './numbers.mjs';

const DIP = path.join(ROOT, 'data/dip');
const OUT = path.join(DIP, 'translations');

function argv() {
  const args = process.argv.slice(2);
  const value = (name) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? null : args[i + 1] ?? null;
  };
  return {
    all: args.includes('--all'),
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    only: value('language'),
  };
}

function pagesById() {
  const file = path.join(DIP, 'pages.jsonl');
  if (!fs.existsSync(file)) {
    throw new Error(`${file} is missing. Run npm run ingest first.`);
  }
  const map = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const page = JSON.parse(line);
    map.set(page.pageId, page);
  }
  return map;
}

const target = (language, pageId) => path.join(OUT, language, `${pageId}.json`);

async function main() {
  const opts = argv();
  const languages = opts.only === null ? TARGET_LANGUAGES : [opts.only];
  for (const language of languages) {
    if (language === SOURCE_LANGUAGE) throw new Error(`${language} is the source language`);
  }

  const pages = pagesById();
  const selected = selectedPages({ all: opts.all }).filter((s) => pages.has(s.pageId));
  const todo = [];
  for (const language of languages) {
    for (const { pageId, because } of selected) {
      if (!opts.force && fs.existsSync(target(language, pageId))) continue;
      todo.push({ language, pageId, because });
    }
  }

  // Excerpts the page translations cannot supply, for the Audio Booth. A cached
  // one is redone when the excerpt it translated has since changed.
  const excerpts = selectedPassages().filter((p) => blockOf(p, pages.get(p.citation.pageId)) === -1);
  const excerptTodo = [];
  for (const language of languages) {
    for (const passage of excerpts) {
      if (!opts.force && cachedPassageTranslation(language, passage) !== null) continue;
      excerptTodo.push({ language, passage });
    }
  }

  const blocks = selected.reduce((n, s) => n + pages.get(s.pageId).blocks.length, 0);
  console.log(
    `translate: ${selected.length} pages (${blocks} blocks) into ${languages.join(', ')}; ` +
      `${todo.length} page translations to fetch, ` +
      `${selected.length * languages.length - todo.length} already cached`,
  );
  console.log(
    `translate: ${excerpts.length} excerpts for narration; ${excerptTodo.length} to fetch, ` +
      `${excerpts.length * languages.length - excerptTodo.length} already cached`,
  );

  if (opts.dryRun || todo.length + excerptTodo.length === 0) {
    if (todo.length + excerptTodo.length === 0) console.log('translate: nothing to do');
    return;
  }
  if (!haveCredentials()) {
    // Not an error. The archive is designed to be useful with an empty cache,
    // and every other build step must keep working without a Bhashini key.
    console.log(
      'translate: no Bhashini credentials, so nothing was fetched.\n' +
        '           Fill BHASHINI_USER_ID and BHASHINI_ULCA_API_KEY into .env.local\n' +
        '           and run this again. The kiosk builds and runs without them.',
    );
    return;
  }

  let written = 0;
  let failed = 0;
  const tally = { retries: 0 };
  let excerptsWritten = 0;
  for (const language of languages) {
    const wanted = todo.filter((t) => t.language === language);
    const wantedExcerpts = excerptTodo.filter((t) => t.language === language);
    if (wanted.length + wantedExcerpts.length === 0) continue;
    const task = translationTask(SOURCE_LANGUAGE, language);
    const { services, endpoint } = await configure([task]);
    const service = services.get('translation');
    const source = `Bhashini, ${service.serviceId}`;
    console.log(`  ${language}: ${service.serviceId}`);
    fs.mkdirSync(path.join(OUT, language), { recursive: true });
    const run = (inputs) =>
      compute(endpoint, [withService(task, services)], { input: inputs.map((t) => ({ source: t })) }).then(
        (response) => readTranslations(response, inputs.length),
      );

    for (const { passage } of wantedExcerpts) {
      const file = passageTranslation(language, passage.id);
      try {
        const text = await faithfulTranslation(run, passage.text, language, { tally });
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const record = { language, source, english: passage.text, text, citation: passage.citation };
        fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
        excerptsWritten += 1;
      } catch (error) {
        failed += 1;
        fs.rmSync(file, { force: true });
        const why = error instanceof BhashiniError ? error.message : String(error);
        process.stdout.write(`    excerpt ${passage.id} FAILED: ${why}\n`);
      }
    }

    for (const { pageId } of wanted) {
      const raw = pages.get(pageId);
      const texts = raw.blocks.map((b) => b.text);
      const masks = texts.map((text) => maskNumbers(text, language));
      try {
        const first = await run(masks.map((m) => m.masked));
        const translated = [];
        for (let i = 0; i < texts.length; i++) {
          try {
            translated.push(await faithfulTranslation(run, texts[i], language, { first: first[i], tally }));
          } catch (error) {
            throw new BhashiniError(`block ${i}: ${error.message}`);
          }
        }
        const file = { language, source, blocks: translated.map((text) => ({ text })) };
        // The contract, not a convention: this is the same reader the kiosk uses.
        readTranslation(readPage(raw), file);
        fs.writeFileSync(target(language, pageId), `${JSON.stringify(file, null, 2)}\n`);
        written += 1;
        process.stdout.write(`    ${pageId} (${texts.length} blocks)\n`);
      } catch (error) {
        failed += 1;
        // A file from an earlier run would otherwise be served as if it had
        // passed this run's checks. No translation is better than that one.
        fs.rmSync(target(language, pageId), { force: true });
        const why = error instanceof BhashiniError ? error.message : String(error);
        process.stdout.write(`    ${pageId} FAILED: ${why}\n`);
      }
    }
  }
  console.log(
    `translate: ${written} pages and ${excerptsWritten} excerpts written, ` +
      `${failed} failed, ${tally.retries} retries`,
  );
  if (failed > 0) process.exitCode = 1;
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
