/**
 * Fills the archive's narration cache through Bhashini text to speech.
 *
 * Narration is audio and audio is large, so this is deliberately narrower than
 * translation: the passages a visitor meets without searching, in every
 * interface language, in both voices Bhashini offers. Each clip is written
 * beside an index entry that carries the citation of the passage it reads, so
 * the Audio Booth cannot play a clip without being able to say what it is
 * reading and where that text is printed.
 *
 * A translated passage is narrated from its translation, not from the English.
 * Narrating English text with a Marathi voice produces something that sounds
 * like Marathi and says nothing, which is worse than silence.
 *
 * --ui narrates the interface instead of the archive: the button labels and
 * screen names an audio-first visitor needs in order to use the kiosk without
 * reading it. Those are written as spoken labels, a separate type from an
 * archival clip, because a label cites nothing and must never be handed to a
 * surface that expects a cited reading.
 *
 * Run: npm run narrate [-- --language mr] [-- --voice male] [-- --ui]
 *
 * npm takes --dry-run for itself, so that one flag needs node directly:
 * node packages/narrate/src/narrate.mjs --dry-run
 */
import fs from 'node:fs';
import path from 'node:path';
import { readPage, readTranslation } from '@toran/contracts';
import { BhashiniError, configure, compute } from './bhashini.mjs';
import { haveCredentials, MissingCredentials, ROOT } from './credentials.mjs';
import { NARRATION_LANGUAGES, SOURCE_LANGUAGE, VOICES } from './languages.mjs';
import { readAudio, ttsTask, withService } from './tasks.mjs';
import { selectedPassages } from './selection.mjs';

const DIP = path.join(ROOT, 'data/dip');
const OUT = path.join(DIP, 'narration');
const INDEX = path.join(OUT, 'index.json');
const UI_INDEX = path.join(OUT, 'ui.json');
const MESSAGES = path.join(ROOT, 'apps/web/src/i18n/messages');

/**
 * The interface an audio-first visitor has to hear to get anywhere: the three
 * navigation affordances, the primary actions, the room names and the
 * settings. Not all 258 strings. A label nobody can act on is a label nobody
 * needs read aloud, and every clip is bytes on the device.
 */
const SPOKEN_KEYS = [
  'nav.back', 'nav.home', 'nav.forward',
  'action.search', 'action.listen', 'action.save', 'action.close',
  'action.confirm', 'action.cancel',
  'field.search.label', 'language.choose', 'visitor.settings',
  'audio.play', 'audio.pause', 'audio.restart',
  'device.channel.entrance', 'device.channel.reading', 'device.channel.provenance',
  'device.channel.timeline', 'device.channel.manuscript', 'device.channel.audio',
  'device.channel.av', 'device.channel.assistant', 'device.channel.curator',
];

function argv() {
  const args = process.argv.slice(2);
  const value = (name) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? null : args[i + 1] ?? null;
  };
  return {
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    ui: args.includes('--ui'),
    only: value('language'),
    voice: value('voice'),
  };
}

const pageCache = new Map();
function pagesById() {
  if (pageCache.size > 0) return pageCache;
  const file = path.join(DIP, 'pages.jsonl');
  if (!fs.existsSync(file)) throw new Error(`${file} is missing. Run npm run ingest first.`);
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const page = JSON.parse(line);
    pageCache.set(page.pageId, page);
  }
  return pageCache;
}

/**
 * The words to read aloud, in one language.
 *
 * English is the corpus, so it is read as printed. Any other language reads
 * the cached translation of the block this passage came from, and returns null
 * when no translation has been fetched yet, which is why `translate` runs first.
 */
function wordsIn(passage, language) {
  if (language === SOURCE_LANGUAGE) return passage.text;
  const file = path.join(DIP, 'translations', language, `${passage.citation.pageId}.json`);
  if (!fs.existsSync(file)) return null;
  const page = pagesById().get(passage.citation.pageId);
  if (page === undefined) return null;
  const translation = readTranslation(readPage(page), JSON.parse(fs.readFileSync(file, 'utf8')));
  // Match on the printed text, so a re-ordered page cannot shift a clip onto
  // the wrong block.
  const index = page.blocks.findIndex((b) => b.text.trim() === passage.text.trim());
  return index === -1 ? null : translation.blocks[index].text;
}

const clip = (language, voice, id) => path.join(OUT, language, `${id}.${voice}.wav`);

/** Narrates the interface labels an audio-first visitor needs. */
async function narrateInterface(opts) {
  const languages = opts.only === null ? NARRATION_LANGUAGES : [opts.only];
  const voices = opts.voice === null ? VOICES : [opts.voice];
  const clip = (language, voice, key) =>
    path.join(OUT, 'ui', language, `${key}.${voice}.wav`);

  const todo = [];
  const noCatalogue = [];
  for (const language of languages) {
    const file = path.join(MESSAGES, `${language}.json`);
    if (!fs.existsSync(file)) {
      noCatalogue.push(language);
      continue;
    }
    const catalogue = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const key of SPOKEN_KEYS) {
      const text = catalogue[key];
      if (typeof text !== 'string' || text.trim() === '') continue;
      for (const voice of voices) {
        if (!opts.force && fs.existsSync(clip(language, voice, key))) continue;
        todo.push({ language, voice, key, text });
      }
    }
  }

  console.log(
    `narrate --ui: ${SPOKEN_KEYS.length} labels into ${languages.join(', ')}; ` +
      `${todo.length} clips to fetch`,
  );
  if (noCatalogue.length > 0) {
    console.log(
      `narrate --ui: ${noCatalogue.join(', ')} have no catalogue yet. ` +
        `Run npm run catalogue first.`,
    );
  }
  if (opts.dryRun || todo.length === 0) {
    if (todo.length === 0) console.log('narrate --ui: nothing to do');
    return;
  }
  if (!haveCredentials()) {
    console.log(
      'narrate --ui: no Bhashini credentials, so nothing was fetched.\n' +
        '              Audio-first mode still announces every screen to assistive\n' +
        '              technology; it just cannot speak for itself yet.',
    );
    return;
  }

  const index = fs.existsSync(UI_INDEX)
    ? JSON.parse(fs.readFileSync(UI_INDEX, 'utf8'))
    : { clips: [] };
  const keyed = new Map(index.clips.map((c) => [`${c.language}/${c.key}/${c.voice}`, c]));
  let written = 0;
  let failed = 0;

  for (const language of languages) {
    const wanted = todo.filter((t) => t.language === language);
    if (wanted.length === 0) continue;
    const task = ttsTask(language);
    const { services, endpoint } = await configure([task]);
    const service = services.get('tts');
    console.log(`  ${language}: ${service.serviceId}`);
    fs.mkdirSync(path.join(OUT, 'ui', language), { recursive: true });

    for (const item of wanted) {
      const voiced = { ...task, config: { ...task.config, gender: item.voice } };
      try {
        const response = await compute(endpoint, [withService(voiced, services)], {
          input: [{ source: item.text }],
        });
        const bytes = Buffer.from(readAudio(response), 'base64');
        if (bytes.length === 0) throw new BhashiniError('narration audio was empty');
        const file = clip(language, item.voice, item.key);
        fs.writeFileSync(file, bytes);
        keyed.set(`${language}/${item.key}/${item.voice}`, {
          key: item.key,
          language,
          voice: item.voice,
          file: path.relative(OUT, file),
          bytes: bytes.length,
          source: `Bhashini, ${service.serviceId}`,
          text: item.text,
        });
        written += 1;
      } catch (error) {
        failed += 1;
        const why = error instanceof BhashiniError ? error.message : String(error);
        process.stdout.write(`    ${item.key} ${item.voice} FAILED: ${why}\n`);
      }
    }
  }

  const clips = [...keyed.values()].sort((a, b) =>
    `${a.language}${a.key}${a.voice}`.localeCompare(`${b.language}${b.key}${b.voice}`),
  );
  fs.writeFileSync(UI_INDEX, `${JSON.stringify({ clips }, null, 2)}\n`);
  console.log(`narrate --ui: ${written} written, ${failed} failed, ${clips.length} in the index`);
  if (failed > 0) process.exitCode = 1;
}

async function main() {
  const opts = argv();
  if (opts.ui) return narrateInterface(opts);
  const languages = opts.only === null ? NARRATION_LANGUAGES : [opts.only];
  const voices = opts.voice === null ? VOICES : [opts.voice];
  const passages = selectedPassages();

  const todo = [];
  const untranslated = [];
  for (const language of languages) {
    for (const passage of passages) {
      const words = wordsIn(passage, language);
      if (words === null) {
        untranslated.push({ language, id: passage.id });
        continue;
      }
      for (const voice of voices) {
        if (!opts.force && fs.existsSync(clip(language, voice, passage.id))) continue;
        todo.push({ language, voice, passage, words });
      }
    }
  }

  console.log(
    `narrate: ${passages.length} passages into ${languages.join(', ')} ` +
      `in ${voices.join(' and ')}; ${todo.length} clips to fetch`,
  );
  if (untranslated.length > 0) {
    const byLanguage = {};
    for (const u of untranslated) byLanguage[u.language] = (byLanguage[u.language] ?? 0) + 1;
    console.log(
      `narrate: ${untranslated.length} passages have no translation yet ` +
        `(${Object.entries(byLanguage).map(([l, n]) => `${l}: ${n}`).join(', ')}). ` +
        `Run npm run translate first.`,
    );
  }
  if (opts.dryRun || todo.length === 0) {
    if (todo.length === 0) console.log('narrate: nothing to do');
    return;
  }
  if (!haveCredentials()) {
    console.log(
      'narrate: no Bhashini credentials, so nothing was fetched.\n' +
        '         The Audio Booth falls back to the archival recordings and says\n' +
        '         plainly that narration is not cached for this passage.',
    );
    return;
  }

  const index = fs.existsSync(INDEX) ? JSON.parse(fs.readFileSync(INDEX, 'utf8')) : { clips: [] };
  const keyed = new Map(index.clips.map((c) => [`${c.language}/${c.id}/${c.voice}`, c]));
  let written = 0;
  let failed = 0;

  for (const language of languages) {
    const wanted = todo.filter((t) => t.language === language);
    if (wanted.length === 0) continue;
    const task = ttsTask(language);
    const { services, endpoint } = await configure([task]);
    const service = services.get('tts');
    console.log(`  ${language}: ${service.serviceId}`);
    fs.mkdirSync(path.join(OUT, language), { recursive: true });

    for (const item of wanted) {
      const voiced = { ...task, config: { ...task.config, gender: item.voice } };
      try {
        const response = await compute(endpoint, [withService(voiced, services)], {
          input: [{ source: item.words }],
        });
        const bytes = Buffer.from(readAudio(response), 'base64');
        if (bytes.length === 0) throw new BhashiniError('narration audio was empty');
        const file = clip(language, item.voice, item.passage.id);
        fs.writeFileSync(file, bytes);
        keyed.set(`${language}/${item.passage.id}/${item.voice}`, {
          id: item.passage.id,
          language,
          voice: item.voice,
          file: path.relative(OUT, file),
          bytes: bytes.length,
          source: `Bhashini, ${service.serviceId}`,
          because: item.passage.because,
          text: item.words,
          citation: item.passage.citation,
        });
        written += 1;
        process.stdout.write(`    ${item.passage.id} ${item.voice} (${bytes.length} bytes)\n`);
      } catch (error) {
        failed += 1;
        const why = error instanceof BhashiniError ? error.message : String(error);
        process.stdout.write(`    ${item.passage.id} ${item.voice} FAILED: ${why}\n`);
      }
    }
  }

  const clips = [...keyed.values()].sort((a, b) =>
    `${a.language}${a.id}${a.voice}`.localeCompare(`${b.language}${b.id}${b.voice}`),
  );
  fs.writeFileSync(INDEX, `${JSON.stringify({ clips }, null, 2)}\n`);
  console.log(`narrate: ${written} clips written, ${failed} failed, ${clips.length} in the index`);
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
