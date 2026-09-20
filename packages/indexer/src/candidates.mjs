/**
 * Proposes candidate provenance edges by meaning, for a curator to judge.
 *
 * Each draft article the Assembly adopted is embedded as a query, and every
 * passage of the writings is ranked against it using the search index's own
 * vectors, so the model and the space are the ones search uses. The closest
 * passage of each section is kept, and the few best sections become candidate
 * edges: this writing may make the case for this draft. That is all a
 * candidate says. It is drawn dashed until a named curator confirms it, and
 * many will be rejected, which is why they are asked.
 *
 * Run: npm run build:candidates  (after build:index and build:archive)
 * Output: data/dip/graph-candidates.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from '@huggingface/transformers';
import { DIMS, DTYPE, MODEL, QUERY_PREFIX } from './model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const INDEX = path.join(ROOT, 'apps/web/public/index');
const OUT = path.join(ROOT, 'data/dip/graph-candidates.json');

/** Sections per draft, and the similarity below which nothing is proposed. */
export const PER_DRAFT = 4;
export const FLOOR = 0.8;

function sectionOfPage() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/web/public/archive/manifest.json'), 'utf8'));
  const of = new Map();
  for (const w of manifest.works) {
    for (const s of w.sections) {
      const i0 = w.pages.indexOf(s.first);
      const i1 = w.pages.indexOf(s.last);
      for (const pageId of w.pages.slice(i0, i1 + 1)) of.set(pageId, { id: s.id, head: s.head });
    }
  }
  return of;
}

async function main() {
  const meta = JSON.parse(fs.readFileSync(path.join(INDEX, 'meta.json'), 'utf8'));
  const text = JSON.parse(fs.readFileSync(path.join(INDEX, 'text.json'), 'utf8'));
  const raw = fs.readFileSync(path.join(INDEX, 'vectors.bin'));
  const vectors = new Int8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  const sections = sectionOfPage();

  const drafts = fs
    .readFileSync(path.join(ROOT, 'data/dip/articles.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .flatMap((a) =>
      a.versions.filter((v) => v.draft).map((v) => ({ article: a.article, draft: v.article, text: v.text })),
    );

  const extract = await pipeline('feature-extraction', MODEL, { dtype: DTYPE });
  const candidates = [];
  for (const d of drafts) {
    const out = await extract([QUERY_PREFIX + d.text], { pooling: 'mean', normalize: true });
    const q = out.data;
    const best = new Map();
    meta.forEach((m, i) => {
      if (m.corpus !== 'baws') return;
      let dot = 0;
      for (let k = 0; k < DIMS; k++) dot += q[k] * (vectors[i * DIMS + k] / 127);
      const section = sections.get(m.pageId);
      if (section === undefined) return;
      const seen = best.get(section.id);
      if (seen === undefined || dot > seen.score) best.set(section.id, { score: dot, i, section });
    });
    const ranked = [...best.values()].sort((a, b) => b.score - a.score);
    console.log(`draft article ${d.draft} (now ${d.article}): best ${ranked.slice(0, 6).map((r) => `${r.section.head ?? r.section.id} ${r.score.toFixed(3)}`).join(' | ')}`);
    for (const r of ranked.slice(0, PER_DRAFT)) {
      if (r.score < FLOOR) continue;
      const m = meta[r.i];
      candidates.push({
        draft: d.draft,
        article: d.article,
        section: r.section.id,
        head: r.section.head,
        score: Number(r.score.toFixed(4)),
        chunk: { ...m, text: text[r.i] },
      });
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(candidates, null, 1));
  console.log(`candidates    ${candidates.length} written to ${path.relative(ROOT, OUT)}`);
}

await main();
