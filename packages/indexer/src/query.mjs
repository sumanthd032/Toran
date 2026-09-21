/**
 * Searching the built index from Node.
 *
 * The kiosk searches in a Web Worker, against the same files, with the same
 * reciprocal rank fusion. This is that engine outside a browser, for the two
 * build-time jobs that need it: the benchmark that proves the ranking, and the
 * script that prepares the assistant's offline answers.
 *
 * It exists as one module rather than two copies because the fusion constant
 * and the candidate depth decide what comes back, and two implementations of
 * those would eventually rank differently. A benchmark that passes against a
 * ranking the kiosk does not use is a benchmark that proves nothing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, env } from '@huggingface/transformers';
import { scoreBm25, tokenise } from './bm25.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Must match RRF_K in apps/web/src/search/fuse.ts, which says why it is 5. */
export const RRF_K = 5;

/** How deep each list goes before fusion. Also matched in the worker. */
export const CANDIDATES = 60;

let engine = null;

/** Opens the index once. Loading the model is seconds of CPU. */
export async function openIndex(dir = path.join(ROOT, 'apps/web/public/index')) {
  if (engine !== null) return engine;
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const manifest = read('manifest.json');
  const meta = read('meta.json');
  const texts = read('text.json');
  const lexical = read('lexical.json');
  const raw = fs.readFileSync(path.join(dir, 'vectors.bin'));
  const vectors = new Int8Array(raw.buffer, raw.byteOffset, raw.byteLength);

  env.allowLocalModels = false;
  const extract = await pipeline('feature-extraction', manifest.model, {
    dtype: manifest.dtype,
  });

  engine = { manifest, meta, texts, lexical, vectors, extract };
  return engine;
}

function dense({ manifest, vectors }, query, limit) {
  const { dims, count, quantisation } = manifest;
  const out = [];
  for (let doc = 0; doc < count; doc++) {
    const base = doc * dims;
    let dot = 0;
    for (let d = 0; d < dims; d++) dot += vectors[base + d] * query[d];
    out.push({ id: doc, score: dot / quantisation.scale });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

export function fuse(a, b, k = RRF_K) {
  const m = new Map();
  const add = (list, field) =>
    list.forEach((e, i) => {
      const cur = m.get(e.id) ?? { score: 0, dense: null, lexical: null };
      cur.score += 1 / (k + i + 1);
      cur[field] = e.score;
      m.set(e.id, cur);
    });
  add(a, 'dense');
  add(b, 'lexical');
  return [...m.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((x, y) => y.score - x.score);
}

/** Fused hits, with the two lists kept separately for the benchmark to report on. */
export async function searchIndex(query, limit = 10) {
  const index = await openIndex();
  const t0 = performance.now();
  const out = await index.extract([index.manifest.queryPrefix + query], {
    pooling: 'mean',
    normalize: true,
  });
  const embedMs = performance.now() - t0;
  const v = Float32Array.from(out.data);
  const d = dense(index, v, CANDIDATES);
  const lex = [...scoreBm25(index.lexical, tokenise(query)).entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATES);
  return {
    hits: fuse(d, lex).slice(0, limit),
    tookMs: performance.now() - t0,
    embedMs,
    denseOnly: d,
    lexicalOnly: lex,
  };
}

/**
 * The same search, returning raw chunks rather than index ids.
 *
 * This is the shape the citation contract reads and the shape a kiosk sends to
 * Core, so a passage prepared at build time and a passage retrieved in the hall
 * are the same object.
 */
export async function search(query, limit = 10) {
  const index = await openIndex();
  const { hits } = await searchIndex(query, limit);
  return hits.map((hit) => ({ ...index.meta[hit.id], text: index.texts[hit.id] }));
}
