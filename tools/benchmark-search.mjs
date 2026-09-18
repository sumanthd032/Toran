/**
 * Search benchmark.
 *
 * Runs the same index, the same model and the same fusion the worker uses,
 * in Node, so ranking can be checked without a browser. Latency measured here
 * is not the tablet number; that is measured separately in the browser and
 * reported as its own figure.
 *
 * Each case states what a reasonable person expects to see. A case that fails
 * is a ranking bug, not a reason to weaken the case.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, env } from '@huggingface/transformers';
import { scoreBm25, tokenise } from '../packages/indexer/src/bm25.mjs';
import { indexableText } from '../packages/indexer/src/build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'apps/web/public/index');
const RRF_K = 60;

const read = (f) => JSON.parse(fs.readFileSync(path.join(INDEX, f), 'utf8'));

const manifest = read('manifest.json');
const meta = read('meta.json');
const texts = read('text.json');
const lexical = read('lexical.json');
const raw = fs.readFileSync(path.join(INDEX, 'vectors.bin'));
const vectors = new Int8Array(raw.buffer, raw.byteOffset, raw.byteLength);

env.allowLocalModels = false;
const extract = await pipeline('feature-extraction', manifest.model, {
  dtype: manifest.dtype,
});

function dense(query, limit) {
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

function fuse(a, b, k = RRF_K) {
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

async function search(query, limit = 10) {
  const t0 = performance.now();
  const out = await extract([manifest.queryPrefix + query], {
    pooling: 'mean',
    normalize: true,
  });
  const embedMs = performance.now() - t0;
  const v = Float32Array.from(out.data);
  const d = dense(v, 60);
  const terms = tokenise(query);
  const lex = [...scoreBm25(lexical, terms).entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 60);
  const hits = fuse(d, lex).slice(0, limit);
  return {
    hits,
    tookMs: performance.now() - t0,
    embedMs,
    denseOnly: d,
    lexicalOnly: lex,
  };
}

// Each case: a query, and what must be true of the results.
const CASES = [
  {
    q: 'annihilation of caste',
    why: 'the best known work in volume 1',
    expect: (h) => h.some((x) => meta[x.id].workId === 'baws-v1'),
  },
  {
    q: 'Mahad',
    why: 'a rare place name. Pure vector search loses these, which is why BM25 is here',
    expect: (h) => h.slice(0, 5).some((x) => /mahad/i.test(texts[x.id])),
  },
  {
    q: 'untouchability is abolished and its practice in any form is forbidden',
    why: 'the text of Article 17 itself',
    expect: (h) => h.slice(0, 5).some((x) => meta[x.id].corpus === 'constitution'),
  },
  {
    q: 'who were the shudras',
    why: 'the title of a work in volume 7',
    expect: (h) => h.some((x) => meta[x.id].workId === 'baws-v7'),
  },
  {
    q: 'draft article 11 untouchability debate',
    why: 'should reach the Constituent Assembly sitting',
    expect: (h) => h.slice(0, 8).some((x) => meta[x.id].corpus === 'cad'),
  },
  {
    q: 'जातिभेद निर्मूलन',
    why: 'Marathi query, English corpus. Cross lingual retrieval with no translation step',
    expect: (h) => h.slice(0, 10).some((x) => /caste/i.test(texts[x.id])),
  },
  {
    q: 'the Rig Veda',
    why: 'appears in volume 7 appendices',
    expect: (h) => h.slice(0, 8).some((x) => /rig\s*veda/i.test(texts[x.id])),
  },
  {
    q: 'the fourfold division of society',
    why: 'paraphrase. Chaturvarnya is never named in the query, so this is semantic not literal',
    expect: (h) =>
      h.slice(0, 10).some((x) => /chaturvarnya|four\s*varna|fourfold/i.test(texts[x.id])),
  },
  {
    q: 'B. R. Ambedkar on the abolition of untouchability',
    why: 'attribution is metadata, so the speaker has to be indexed for this to work at all',
    expect: (h) =>
      h
        .slice(0, 10)
        .some((x) => meta[x.id].speaker && /ambedkar/i.test(meta[x.id].speaker)),
  },
  {
    q: 'endogamy and the origin of caste',
    why: 'the argument of Castes in India, volume 1',
    expect: (h) => h.slice(0, 10).some((x) => /endogam/i.test(texts[x.id])),
  },
];

console.log(
  `index: ${manifest.count} chunks, ${manifest.dims} dims, model ${manifest.model}\n`,
);

let failed = 0;
const timings = [];
for (const c of CASES) {
  const r = await search(c.q, 10);
  timings.push(r.tookMs);
  const ok = c.expect(r.hits);
  if (!ok) failed++;
  const top = r.hits[0];
  const loc = top ? JSON.stringify(meta[top.id].locator).slice(0, 62) : '';
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(c.q)}`);
  console.log(`        ${c.why}`);
  console.log(`        top: ${meta[top.id].workId}  ${loc}`);
  console.log(`        ${texts[top.id].slice(0, 96).replace(/\s+/g, ' ')}`);
  console.log(`        ${r.tookMs.toFixed(0)}ms  (embed ${r.embedMs.toFixed(0)}ms)`);
  console.log();
}

timings.sort((a, b) => a - b);
const p50 = timings[Math.floor(timings.length * 0.5)];
const p95 = timings[Math.floor(timings.length * 0.95)];
console.log(
  `latency on this machine, not the tablet: p50 ${p50.toFixed(0)}ms  p95 ${p95.toFixed(0)}ms`,
);
console.log(
  failed === 0
    ? `\nAll ${CASES.length} cases passed.`
    : `\n${failed} of ${CASES.length} FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
