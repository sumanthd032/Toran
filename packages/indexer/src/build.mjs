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
import { fileURLToPath } from 'node:url';
import { pipeline, env } from '@huggingface/transformers';
import { buildLexical } from './bm25.mjs';
import { DIMS, DTYPE, MODEL, PASSAGE_PREFIX, QUERY_PREFIX } from './model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CHUNKS = path.join(ROOT, 'data/dip/chunks.jsonl');
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

  const rows = fs
    .readFileSync(CHUNKS, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  console.log(`chunks        ${rows.length}`);

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

  const lexical = buildLexical(rows.map(indexableText));
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

await main();
