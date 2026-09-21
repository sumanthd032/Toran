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
import { openIndex, RRF_K, searchIndex } from '../packages/indexer/src/query.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'apps/web/public/index');

// The engine is the one in packages/indexer, which is the one the kiosk's
// worker mirrors. A benchmark with its own copy of the fusion would prove the
// copy rather than the ranking that ships.
const { manifest, meta, texts } = await openIndex(INDEX);
const search = searchIndex;

// Each case: a query, and what must be true of the results.
const CASES = [
  {
    q: 'annihilation of caste',
    why: 'the best known work in volume 1',
    expect: (h) => h.some((x) => meta[x.id].workId === 'baws-v1'),
  },
  {
    q: 'Mahad',
    why: 'a rare place name, the 1927 satyagraha in volume 17. Pure vector search loses these, which is why BM25 is here. Whole word: "Mahadev" does not count',
    expect: (h) => h.slice(0, 5).some((x) => /\bMahad\b/.test(texts[x.id])),
  },
  {
    q: 'What does Article 17 of the Constitution do?',
    why: 'an identifier query. The text of Article 17 does not contain the number 17, so only BM25 can find it, and only if the locator is indexed. This case is why lexicalText exists and why RRF_K is 5',
    expect: (h) => h.slice(0, 5).some((x) => meta[x.id].pageId === 'coi-art17-a17'),
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
