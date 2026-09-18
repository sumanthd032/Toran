/**
 * Builds the abstract that sits above each section's full text.
 *
 * The abstract is extractive: a handful of the section's own sentences,
 * chosen by machine and shown in printed order, each with its page. It never
 * paraphrases. A generated summary of Dr. Ambedkar's argument would put words
 * in his mouth under a citation, which is the thing this archive exists to
 * prevent (DECISIONS.md D-017). A chosen sentence is his, or the source's,
 * word for word, and a reader can check it on the page it cites.
 *
 * Selection: every candidate sentence is embedded with the model the index
 * uses. A sentence scores for how close it is to the section as a whole (the
 * centroid), to the section's own title asked as a question, and for how much
 * of the section's distinctive vocabulary it carries. Sentences are picked by
 * maximal marginal relevance, high scoring and unlike each other.
 *
 * Appendices are left out. Volume 1 prints Gandhi's "A Vindication of Caste"
 * as an appendix to Annihilation of Caste, and an abstract of that section
 * must not offer his sentences as the section's argument.
 *
 * Where the machine's choice does not carry a section's argument, an editor
 * chooses instead, from the same text and on the same terms: whole sentences,
 * verbatim, each with its page. Every abstract records who chose it, and the
 * kiosk says so.
 *
 * Run: npm run build:abstracts  (after npm run build:archive)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, pipeline } from '@huggingface/transformers';
import { tokenise } from './bm25.mjs';
import { DIMS, DTYPE, MODEL, PASSAGE_PREFIX, QUERY_PREFIX } from './model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ARCHIVE = path.join(ROOT, 'apps/web/public/archive');
const OUT = path.join(ARCHIVE, 'abstracts.json');

const LAMBDA = 0.7;
const WEIGHT = { centroid: 0.45, title: 0.35, keyness: 0.2 };

/**
 * Sections an editor chose for. Each entry is a sentence found verbatim in the
 * section, plus the sentences after it that it leans on. A sentence that is
 * not found fails the build rather than quietly shortening the abstract.
 */
const EDITED = {
  'baws-v1': {
    'ANNIHILATION OF CASTE': [
      { sentence: 'Democracy is not merely a form of Government.', following: 1 },
      {
        sentence: 'If you ask me, my ideal would be a society based on Liberty, Equality and Fraternity.',
        following: 0,
      },
      { sentence: 'The real remedy for breaking Caste is inter-marriage.', following: 1 },
      { sentence: 'Caste is a notion, it is a state of the mind.', following: 2 },
    ],
  },
};
const MAX_CANDIDATES = 320;
const BATCH = 32;

const ABBREVIATION =
  /(?:\b(?:Mr|Mrs|Dr|Sir|St|No|Nos|Vol|Vols|pp?|ed|eds|viz|cf|etc|Rs|Esq|Prof|Hon|Rev|Col|Gen|Capt|Lt|Messrs|Jr|Sr|Ltd|Co|vs?)|\b[A-Z]|\b(?:e\.g|i\.e|U\.S\.A|U\.P|C\.P|B\.A|M\.A|Ph\.D|LL\.D|D\.Sc))\.$/;
// Sentences that lean on the one before them read as nonsense on their own.
const DANGLING =
  /^(?:This|That|These|Those|He|She|They|His|Her|Their|Its|Such|But|And|Or|Nor|So|Hence|Thus|Therefore|However|Also|Here|Now|Then|Again|Further|Moreover|Besides|Yet|Still|For|Because|Similarly|Likewise|Accordingly|Consequently|Secondly|Thirdly|Lastly|Finally|Firstly|Next|In this|On the other hand)\b/;
const FOOTNOTE_MARK = /[A-Za-z)][.,;:!?]?\d{1,2}(?:\s|$)/;

export function sentences(text) {
  const out = [];
  let start = 0;
  const boundary = /[.!?]["”’)]?\s+(?=["“‘(]?[A-Z])/g;
  let m;
  while ((m = boundary.exec(text)) !== null) {
    const end = m.index + m[0].trimEnd().length;
    const candidate = text.slice(start, end);
    if (ABBREVIATION.test(candidate.replace(/["”’)]$/, ''))) continue;
    out.push(candidate.trim());
    start = m.index + m[0].length;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function balanced(s) {
  const count = (re) => (s.match(re) ?? []).length;
  return (
    count(/“/g) === count(/”/g) &&
    count(/\(/g) === count(/\)/g) &&
    count(/"/g) % 2 === 0 &&
    count(/‘/g) <= count(/’/g)
  );
}

export function usable(s) {
  if (s.length < 45 || s.length > 330) return false;
  if (!/^["“‘(]?[A-Z]/.test(s) || !/[.!?]["”’)]?$/.test(s)) return false;
  if (DANGLING.test(s.replace(/^["“‘(]/, ''))) return false;
  if (/^It\b/.test(s) && !/^It is\b/.test(s)) return false;
  if (FOOTNOTE_MARK.test(s)) return false;
  if (!balanced(s)) return false;
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length < s.length * 0.6) return false;
  return true;
}

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ARCHIVE, rel), 'utf8'));

function sizeFor(pages) {
  if (pages < 8) return 2;
  if (pages < 25) return 3;
  if (pages < 60) return 4;
  return 5;
}

function spread(items, max) {
  if (items.length <= max) return items;
  const step = items.length / max;
  return Array.from({ length: max }, (_, i) => items[Math.floor(i * step)]);
}

async function embed(extract, texts) {
  const vectors = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const out = await extract(
      texts.slice(i, i + BATCH).map((t) => PASSAGE_PREFIX + t),
      { pooling: 'mean', normalize: true },
    );
    for (let j = 0; j < Math.min(BATCH, texts.length - i); j++) {
      vectors.push(out.data.slice(j * DIMS, (j + 1) * DIMS));
    }
  }
  return vectors;
}

const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/**
 * How much of a section's distinctive vocabulary each sentence carries: the
 * mean tf-idf of its words, with document frequency counted over sections.
 */
function keyness(texts, sectionTerms, sectionFrequency, sectionCount) {
  const tf = new Map();
  for (const t of sectionTerms) tf.set(t, (tf.get(t) ?? 0) + 1);
  const raw = texts.map((text) => {
    const words = tokenise(text);
    if (words.length === 0) return 0;
    let sum = 0;
    for (const w of words) {
      const idf = Math.log(sectionCount / (1 + (sectionFrequency.get(w) ?? 0)));
      sum += Math.log(1 + (tf.get(w) ?? 0)) * Math.max(0, idf);
    }
    return sum / words.length;
  });
  const max = Math.max(...raw) || 1;
  return raw.map((r) => r / max);
}

function choose(vectors, k, title, key) {
  const centroid = new Float32Array(DIMS);
  for (const v of vectors) for (let d = 0; d < DIMS; d++) centroid[d] += v[d];
  const norm = Math.hypot(...centroid) || 1;
  for (let d = 0; d < DIMS; d++) centroid[d] /= norm;
  const relevance = vectors.map(
    (v, i) =>
      WEIGHT.centroid * dot(v, centroid) +
      (title === null ? WEIGHT.title * dot(v, centroid) : WEIGHT.title * dot(v, title)) +
      WEIGHT.keyness * key[i],
  );
  const picked = [];
  while (picked.length < Math.min(k, vectors.length)) {
    let best = -1;
    let bestScore = -Infinity;
    vectors.forEach((v, i) => {
      if (picked.includes(i)) return;
      const redundancy = picked.length ? Math.max(...picked.map((j) => dot(v, vectors[j]))) : 0;
      const score = LAMBDA * relevance[i] - (1 - LAMBDA) * redundancy;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    picked.push(best);
  }
  return picked.sort((a, b) => a - b);
}

async function main() {
  env.allowLocalModels = false;
  const manifest = readJson('manifest.json');
  const extract = await pipeline('feature-extraction', MODEL, { dtype: DTYPE });
  const asQuestion = async (title) => {
    const out = await extract([QUERY_PREFIX + title], { pooling: 'mean', normalize: true });
    return out.data.slice(0, DIMS);
  };

  // First pass: the text of every section, for tf-idf across sections.
  const sections = [];
  for (const work of manifest.works) {
    for (const section of work.sections) {
      if (section.head === null) continue;
      const start = work.pages.indexOf(section.first);
      const ids = work.pages.slice(start, start + section.pages);
      const candidates = [];
      const runs = [];
      const terms = [];
      let inAppendix = false;
      for (const pageId of ids) {
        const page = readJson(`pages/${pageId}.json`);
        for (const block of page.blocks) {
          if (block.kind === 'heading' && /^APPENDIX\b/i.test(block.text)) inAppendix = true;
          if (inAppendix || block.kind !== 'paragraph') continue;
          terms.push(...tokenise(block.text));
          const split = sentences(block.text);
          runs.push({ split, pageId, locator: page.locator });
          for (const s of split) {
            if (usable(s)) candidates.push({ text: s, pageId, locator: page.locator });
          }
        }
      }
      sections.push({ work, section, candidates, runs, terms });
    }
  }
  const frequency = new Map();
  for (const { terms } of sections) for (const t of new Set(terms)) frequency.set(t, (frequency.get(t) ?? 0) + 1);

  const abstracts = {};
  let embedded = 0;
  for (const { work, section, candidates, runs, terms } of sections) {
    const edited = EDITED[work.id]?.[section.head];
    if (edited !== undefined) {
      abstracts[section.id] = {
        workId: work.id,
        head: section.head,
        chosenBy: 'editor',
        sentences: edited
          .map(({ sentence, following }) => {
            for (const [order, run] of runs.entries()) {
              const at = run.split.indexOf(sentence);
              if (at >= 0) {
                const text = run.split.slice(at, at + 1 + following).join(' ');
                return { text, pageId: run.pageId, locator: run.locator, order: order * 1000 + at };
              }
            }
            throw new Error(`${section.id}: editor's sentence not found verbatim: ${sentence}`);
          })
          .sort((a, b) => a.order - b.order)
          .map(({ order: _order, ...rest }) => rest),
      };
      continue;
    }
    const pool = spread(candidates, MAX_CANDIDATES);
    if (pool.length < 2) continue;
    const vectors = await embed(extract, pool.map((c) => c.text));
    embedded += pool.length;
    const title = await asQuestion(section.head.replace(/\s*\.\.\.\s*/g, ' ').toLowerCase());
    const key = keyness(pool.map((c) => c.text), terms, frequency, sections.length);
    abstracts[section.id] = {
      workId: work.id,
      head: section.head,
      chosenBy: 'machine',
      sentences: choose(vectors, sizeFor(section.pages), title, key).map((i) => pool[i]),
    };
    process.stdout.write(`\rabstracts     ${Object.keys(abstracts).length} sections, ${embedded} sentences embedded`);
  }

  fs.writeFileSync(
    OUT,
    JSON.stringify({
      method:
        'Extractive. Whole sentences of the section, in printed order, each with its page. Chosen by machine for closeness to the section and distance from each other, or by an editor where recorded. Nothing is paraphrased.',
      model: MODEL,
      sections: abstracts,
    }),
  );
  console.log(`\nabstracts     ${Object.keys(abstracts).length} written to ${path.relative(ROOT, OUT)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
