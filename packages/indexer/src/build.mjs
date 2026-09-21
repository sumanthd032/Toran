/**
 * Build the static search index.
 *
 * Reads data/dip/chunks.jsonl and writes a vector index, a BM25 index and a
 * metadata file into the web app's public directory. The result ships to the
 * device: there is no search server, so the index has to be small enough to
 * carry and complete enough to answer with.
 *
 * The same package and model run here and in the browser worker. If the two
 * diverged, build-time vectors and query-time vectors would land in different
 * spaces and search would silently return noise rather than fail.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipeline, env } from '@huggingface/transformers';
import { buildLexical } from './bm25.mjs';
import { DIMS, DTYPE, MODEL, PASSAGE_PREFIX, QUERY_PREFIX } from './model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CHUNKS = path.join(ROOT, 'data/dip/chunks.jsonl');
// Transcript cues, written by tools/build-media.mjs. They are a separate file
// because a different pipeline produces them, and the same chunks because a
// cue is just another cited passage: one query therefore reaches a printed
// page, a sitting of the Assembly and a minute of film. PROJECT.md 7.6.
const MEDIA_CHUNKS = path.join(ROOT, 'data/dip/media-chunks.jsonl');
const OUT = path.join(ROOT, 'apps/web/public/index');

export { MODEL, DTYPE, DIMS, PASSAGE_PREFIX, QUERY_PREFIX } from './model.mjs';

const BATCH = 32;

/**
 * The text that gets indexed is not always the text that gets displayed.
 *
 * A debate record's speaker is metadata, so "what did Ambedkar say about the
 * Shudras" cannot match on the prose alone. Prepending the speaker makes the
 * attribution searchable while the displayed passage stays the words actually
 * spoken, with the speaker shown separately by the result view.
 */
export function indexableText(row) {
  return row.speaker ? `${row.speaker}. ${row.text}` : row.text;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * What a citation asserts, as words somebody would type.
 *
 * The text of Article 17 does not contain the number 17. Neither does section
 * 3 of an Act contain its own section number, nor a sitting of the Assembly
 * the date it was held. Those facts live in the locator, so a visitor asking
 * "what does Article 17 do" matched nothing in the article and the assistant
 * cited the 1955 Act instead, which mentions Article 17 in its own text. The
 * citation was defensible and the retrieval was wrong.
 *
 * Written as words rather than as the short citation key, because "art. 17"
 * tokenises to "art" and nobody types that. This is the lexical index's job
 * specifically: D-027 put BM25 in the hybrid for exactly the rare literal
 * token a vector loses.
 */
export function locatorWords(locator) {
  if (locator === null || typeof locator !== 'object') return '';
  switch (locator.kind) {
    case 'article': {
      const now = `article ${locator.article}`;
      if (locator.version == null) return now;
      return `${now} draft article ${locator.version.article} ${locator.version.year}`;
    }
    case 'section':
      return `${locator.act} ${locator.year} section ${locator.section}`;
    case 'paragraph': {
      // The date, and the name of the body. Not the volume, sitting and
      // paragraph numbers: nobody searches "sitting 62", and emitting them
      // would put the token 62 in every paragraph of that sitting.
      const [year, month, day] = String(locator.date).split('-');
      const name = MONTHS[Number(month) - 1] ?? '';
      return `Constituent Assembly Debates ${Number(day)} ${name} ${year}`;
    }
    case 'folio':
      return `manuscript ${locator.manuscript} ${locator.folio ?? ''}`;
    case 'plate':
      return String(locator.plate);
    // A page locator contributes nothing. Nobody searches "volume 17 page 9",
    // and emitting the volume took the token 17 from rare to 1,296 documents,
    // which is every page of volume 17. That buried Article 17 at rank 37 in
    // the lexical list: the change meant to find it was what lost it.
    case 'page':
    default:
      return '';
  }
}

/**
 * What BM25 indexes: the passage, its speaker, and its citation's own facts.
 *
 * Deliberately not what the embedding sees. Adding these words to the embedded
 * text would change every vector, and the graph's candidate edges are built
 * from that same vector space, so it would move a part of the archive a curator
 * has already confirmed. The dense side already finds Article 17 by meaning;
 * what it could not do was find it by number, and that is a lexical problem.
 */
export function lexicalText(row) {
  const words = locatorWords(row.locator);
  return words === '' ? indexableText(row) : `${indexableText(row)} ${words}`;
}

function quantise(float32) {
  // Vectors are L2 normalised, so every component is within [-1, 1] and a
  // single scale of 127 is exact enough. Recorded so the worker dequantises
  // with the same constant.
  const out = new Int8Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    out[i] = Math.max(-127, Math.min(127, Math.round(float32[i] * 127)));
  }
  return out;
}

async function main() {
  env.allowLocalModels = false;

  const readChunks = (file) =>
    fs.existsSync(file)
      ? fs
          .readFileSync(file, 'utf8')
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => JSON.parse(l))
      : [];
  const text = readChunks(CHUNKS);
  const media = readChunks(MEDIA_CHUNKS);
  const rows = [...text, ...media];
  console.log(
    `chunks        ${rows.length}` +
      (media.length > 0 ? `  (${text.length} text, ${media.length} transcript cues)` : ''),
  );

  // The lexical index is cheap to rebuild and the vectors are not. More to the
  // point, re-embedding would move the space the provenance graph's candidate
  // edges were drawn in, so a change to what BM25 indexes should not force one.
  if (process.argv.includes('--lexical')) {
    const lexical = buildLexical(rows.map(lexicalText));
    fs.writeFileSync(path.join(OUT, 'lexical.json'), JSON.stringify(lexical));
    const size = fs.statSync(path.join(OUT, 'lexical.json')).size;
    console.log(`lexical       ${lexical.vocabulary.length} terms, ${(size / 1e6).toFixed(2)} MB`);
    console.log('vectors       left alone, as --lexical asks');
    return;
  }

  const t0 = Date.now();
  const extract = await pipeline('feature-extraction', MODEL, { dtype: DTYPE });
  console.log(`model         ${MODEL} (${DTYPE}) loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const vectors = new Int8Array(rows.length * DIMS);
  let maxError = 0;
  const tEmbed = Date.now();
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((r) => PASSAGE_PREFIX + indexableText(r));
    const out = await extract(batch, { pooling: 'mean', normalize: true });
    const data = out.data;
    for (let j = 0; j < batch.length; j++) {
      const slice = data.subarray(j * DIMS, (j + 1) * DIMS);
      const q = quantise(slice);
      vectors.set(q, (i + j) * DIMS);
      for (let d = 0; d < DIMS; d++) {
        maxError = Math.max(maxError, Math.abs(slice[d] - q[d] / 127));
      }
    }
    if (i % 512 === 0 || i + BATCH >= rows.length) {
      const done = Math.min(i + BATCH, rows.length);
      process.stdout.write(`\rembedding     ${done}/${rows.length}`);
    }
  }
  const embedSeconds = (Date.now() - tEmbed) / 1000;
  console.log(`\nembedded      ${rows.length} in ${embedSeconds.toFixed(1)}s`);
  console.log(`quantisation  max component error ${maxError.toFixed(5)}`);

  const lexical = buildLexical(rows.map(lexicalText));
  console.log(`lexical       ${lexical.vocabulary.length} terms`);

  // Metadata the result list needs. Text is separate so a result can render
  // without loading every passage in the corpus.
  const meta = rows.map((r) => ({
    chunkId: r.chunkId,
    pageId: r.pageId,
    workId: r.workId,
    corpus: r.corpus,
    locator: r.locator,
    language: r.language,
    speaker: r.speaker,
  }));

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'vectors.bin'), Buffer.from(vectors.buffer));
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta));
  fs.writeFileSync(path.join(OUT, 'text.json'), JSON.stringify(rows.map((r) => r.text)));
  fs.writeFileSync(path.join(OUT, 'lexical.json'), JSON.stringify(lexical));
  fs.writeFileSync(
    path.join(OUT, 'manifest.json'),
    JSON.stringify(
      {
        model: MODEL,
        dtype: DTYPE,
        dims: DIMS,
        count: rows.length,
        quantisation: { type: 'int8', scale: 127, maxComponentError: Number(maxError.toFixed(6)) },
        passagePrefix: PASSAGE_PREFIX,
        queryPrefix: QUERY_PREFIX,
        built: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );

  console.log('\nindex files:');
  let total = 0;
  for (const f of ['vectors.bin', 'meta.json', 'text.json', 'lexical.json', 'manifest.json']) {
    const size = fs.statSync(path.join(OUT, f)).size;
    total += size;
    console.log(`  ${f.padEnd(16)} ${(size / 1e6).toFixed(2)} MB`);
  }
  console.log(`  ${'total'.padEnd(16)} ${(total / 1e6).toFixed(2)} MB`);
}

// Only when run, never when imported. This module exports the definition of
// what gets indexed, and `tools/benchmark-search.mjs` used to import that and
// rebuild the whole index as a side effect of asking what a chunk's text is.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
