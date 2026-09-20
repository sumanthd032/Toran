/**
 * Builds the Constitutional Provenance Graph. ARCHITECTURE.md section 4, D-006.
 *
 * Nodes are documents at a date: writings, the draft articles the Assembly
 * adopted, the articles they became, a later Act. Edges say how one led to
 * another, and every edge carries evidence: passages lifted verbatim from the
 * reading copy with their own locators. Four kinds of edge come from here.
 *
 *   record     the drafting history records that draft Article 11 became
 *              Article 17.
 *   citation   the later text cites the earlier: the Act names Article 17.
 *   reading    proposed from reading both texts side by side.
 *   semantic   proposed by build:candidates, because the passages are close in
 *              meaning, and for no other reason.
 *
 * Every edge is a candidate until a named curator confirms it with
 * tools/confirm-edges.mjs, which appends to data/curation/edges.jsonl. A
 * confirmation holds only for the evidence it was given for: each edge
 * carries a digest of its evidence, and a confirmation recorded against a
 * different digest is ignored, so changing the evidence unconfirms the edge.
 *
 * The run fails, and writes nothing, if a passage is not found, does not read
 * whole, or if a node's date is not stated in its own anchor. The written
 * graph is read back through readProvenance before it is kept.
 *
 * Output: apps/web/public/archive/graph.json. Run after build:archive and
 * build:candidates.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readProvenance } from '../packages/contracts/src/index.ts';
import { pages, problems, resolve } from './lib/excerpt.mjs';

const OUT = 'apps/web/public/archive/graph.json';
const CONFIRMATIONS = 'data/curation/edges.jsonl';
const CANDIDATES = 'data/dip/graph-candidates.json';
const CLPR = (slug) => `https://www.constitutionofindia.net/articles/${slug}/`;

// ---- nodes ----

const art = (n, version) => ({ article: `coi-art${n}-a${n}`, version });

/**
 * Where a node's pages are, so a semantic candidate from the same text lands
 * on the same node: whole sections, or printed page ranges of one work.
 */
const NODES = [
  {
    id: 'mahad-1927',
    kind: 'writing',
    title: 'Mahad Satyagraha',
    date: '1927',
    covers: { sections: ['baws-v17-1-s01'] },
    anchor: [{ work: 'baws-v17-1', page: 9, from: 'A Conference of the Depressed Classes', to: 'Bar-at-Law.' }],
  },
  {
    id: 'rtc-1930',
    kind: 'writing',
    title: 'A Scheme of Political Safeguards for the Depressed Classes',
    date: '1930',
    covers: { work: 'baws-v17-1', pages: [79, 92] },
    anchor: [
      { work: 'baws-v17-1', page: 79, from: 'On the 12th November 1930', to: 'inaugurated the Indian Round Table Conference.' },
      { work: 'baws-v17-1', page: 80, from: 'A Scheme of Political Safeguards', to: 'submitted to the Indian Round Table Conference.' },
    ],
  },
  {
    id: 'aoc-1936',
    kind: 'writing',
    title: 'Annihilation of Caste',
    date: '1936-05',
    covers: { sections: ['baws-v1-s02'] },
    anchor: [{ work: 'baws-v1', page: 28, from: 'The Conference was to meet in Easter', to: 'has now cancelled the Conference.' }],
  },
  {
    id: 'deadlock-1945',
    kind: 'writing',
    title: 'Communal Deadlock and a Way to Solve It',
    date: '1945-05-06',
    covers: { sections: ['baws-v1-s10'] },
    // A title page, set as lines.
    anchor: [{ work: 'baws-v1', page: 355, from: 'Address delivered at the Session', to: 'held in Bombay on May 6,1945', lines: true }],
    // Only drawn if a candidate reaches it.
    optional: true,
  },
  {
    id: 'sam-1947',
    kind: 'writing',
    title: 'States and Minorities',
    date: '1947',
    covers: { sections: ['baws-v1-s11', 'baws-v1-s12'], work: 'baws-v1', pages: [381, 386] },
    anchor: [{ work: 'baws-v1', page: 381, from: 'Memorandum on the Safeguards for the Scheduled Castes', to: 'Published: 1947', lines: true }],
  },
  // The Assembly's own record of each adoption, a procedural line after the vote.
  ...[
    { n: 13, draft: 8, record: 'cad-v7-62-24-plus-98519', adopted: 'Article 8, as amended, was added to the Constitution.' },
    { n: 15, draft: 9, record: 'cad-v7-62-156-plus-98675', adopted: 'Article 9, as amended, was added to the Constitution.' },
    { n: 17, draft: 11, record: 'cad-v7-62-185-plus-98712', adopted: 'Article 11 was added to the Constitution.' },
  ].flatMap(({ n, draft, record, adopted }) => [
    {
      id: `draft-${draft}`,
      kind: 'draft',
      title: `Draft Article ${draft}`,
      // Adopted by the Assembly on this day; the sitting's record dates it.
      date: '1948-11-29',
      anchor: [
        { ...art(n, 1), whole: true },
        { paragraph: record, from: adopted, to: adopted },
      ],
    },
    {
      id: `art-${n}`,
      kind: 'article',
      title: `Article ${n}`,
      date: '1950',
      anchor: [{ ...art(n, 2), whole: true }],
    },
  ]),
  {
    id: 'pcr-1955',
    kind: 'act',
    title: 'Protection of Civil Rights Act',
    date: '1955',
    anchor: [{ act: 'pcr-1955', section: 'title', from: 'An Act to prescribe punishment', to: 'matters connected therewith.' }],
  },
];

// ---- edges ----

const draftText = (n) => ({ ...art(n, 1), whole: true });

const EDGES = [
  // What the drafting history records, and what the Act says of itself.
  ...[
    [13, 8, 'article-13-laws-inconsistent-with-or-in-derogation-of-the-fundamental-rights'],
    [15, 9, 'article-15-prohibition-of-discrimination-on-grounds-of-religion-race-caste-sex-or-place-of-birth'],
    [17, 11, 'article-17-abolition-of-untouchability'],
  ].map(([n, draft, slug]) => ({
    from: `draft-${draft}`,
    to: `art-${n}`,
    assertion: 'becomes',
    method: 'record',
    assertedBy: CLPR(slug),
    evidence: [draftText(n), { ...art(n, 2), whole: true }],
  })),
  {
    from: 'art-17',
    to: 'pcr-1955',
    assertion: 'enforces',
    method: 'citation',
    evidence: [
      { ...art(17, 2), whole: true },
      { act: 'pcr-1955', section: '2', from: '"civil rights" means', to: 'article 17 of the Constitution', lines: true },
    ],
  },
  // Proposed from reading the texts side by side.
  {
    from: 'rtc-1930',
    to: 'draft-11',
    assertion: 'proposes',
    method: 'reading',
    evidence: [
      { work: 'baws-v17-1', page: 81, from: '(A) To secure the abolition of Untouchability', to: 'part of the Constitution of India.' },
      draftText(17),
    ],
  },
  {
    from: 'aoc-1936',
    to: 'draft-11',
    assertion: 'argues',
    method: 'reading',
    evidence: [
      { work: 'baws-v1', page: 41, from: 'Are you fit for political power even though you do not allow a large class', to: 'the use of public streets ?' },
      draftText(17),
    ],
  },
  {
    from: 'sam-1947',
    to: 'draft-8',
    assertion: 'proposes',
    method: 'reading',
    evidence: [
      { work: 'baws-v1', page: 392, from: '3. All citizens are equal before the law', to: 'cease to have any effect.' },
      draftText(13),
    ],
  },
  {
    from: 'sam-1947',
    to: 'draft-9',
    assertion: 'proposes',
    method: 'reading',
    evidence: [
      { work: 'baws-v1', page: 392, from: '4. Whoever denies to any person', to: 'shall be guilty of an offence.' },
      draftText(15),
    ],
  },
  {
    from: 'mahad-1927',
    to: 'draft-9',
    assertion: 'argues',
    method: 'reading',
    evidence: [
      { work: 'baws-v17-1', page: 21, from: 'Had the caste-Hindus admitted the right', to: 'other non-Hindus.' },
      { paragraph: 'cad-v7-62-131-para-98638', from: 'Then my Friend asked me whether ponds', to: 'must include a pond.' },
    ],
  },
];

// ---- resolution ----

const failures = [];

/** An excerpt, or with `whole` the entire text of an article's version. */
function lifted(spec) {
  if (spec.whole) {
    // Empty bounds lift nothing and leave the whole text after the start.
    const probe = resolve({ ...spec, from: '', to: '' });
    return probe && { ...probe, found: { text: probe.found.after, before: '', after: '' } };
  }
  return resolve(spec);
}

function chunkOf(spec, label) {
  const hit = lifted(spec);
  if (hit === null) {
    failures.push(`${label}: "${spec.from ?? spec.article}" not found`);
    return null;
  }
  const bad = spec.whole ? [] : problems(hit.found, spec.lines === true);
  if (bad.length > 0) failures.push(`${label}: ${hit.where} ${bad.join(', ')}`);
  return { chunk: { ...hit.record, text: hit.found.text }, context: hit.context, where: hit.where };
}

// Which node a printed page belongs to, for semantic candidates.
const manifest = JSON.parse(fs.readFileSync('apps/web/public/archive/manifest.json', 'utf8'));
const sectionOf = new Map();
for (const w of manifest.works) {
  for (const s of w.sections) {
    const i0 = w.pages.indexOf(s.first);
    const i1 = w.pages.indexOf(s.last);
    for (const pageId of w.pages.slice(i0, i1 + 1)) sectionOf.set(pageId, s.id);
  }
}
const pageById = new Map(pages.map((p) => [p.pageId, p]));
function nodeForPage(pageId) {
  const page = pageById.get(pageId);
  for (const n of NODES) {
    const c = n.covers;
    if (c === undefined) continue;
    if (c.sections?.includes(sectionOf.get(pageId))) return n;
    if (
      c.pages !== undefined &&
      page?.workId === c.work &&
      page.locator.kind === 'page' &&
      page.locator.page >= c.pages[0] &&
      page.locator.page <= c.pages[1]
    ) {
      return n;
    }
  }
  return null;
}

const digestOf = (edge, evidence) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        from: edge.from,
        to: edge.to,
        assertion: edge.assertion,
        evidence: evidence.map((e) => [e.pageId, e.locator, e.text]),
      }),
    )
    .digest('hex');

// ---- build ----

console.log('provenance graph, every passage checked against the reading copy');
const nodes = new Map();
for (const n of NODES) {
  const anchor = n.anchor.map((spec, i) => chunkOf(spec, `${n.id} anchor ${i + 1}`)).filter(Boolean);
  const year = n.date.slice(0, 4);
  const dated = anchor.some(
    (a) => a.chunk.text.includes(year) || a.context.includes(year) || a.chunk.locator.date?.startsWith(year),
  );
  if (anchor.length > 0 && !dated) failures.push(`${n.id}: nothing in its anchor states ${year}`);
  nodes.set(n.id, { id: n.id, kind: n.kind, title: n.title, date: n.date, anchor: anchor.map((a) => a.chunk), optional: n.optional === true });
  console.log(`  node  ${n.id.padEnd(14)} ${n.date.padEnd(10)} ${anchor.map((a) => a.where).join(', ')}`);
}

const edges = [];
for (const e of EDGES) {
  const evidence = e.evidence.map((spec, i) => chunkOf(spec, `${e.from} ${e.assertion} ${e.to} evidence ${i + 1}`)).filter(Boolean);
  if (evidence.length !== e.evidence.length) continue;
  edges.push({ ...e, score: null, assertedBy: e.assertedBy ?? null, evidence: evidence.map((x) => x.chunk) });
}

// Candidates proposed by meaning, onto the nodes whose pages they come from.
const dropped = { undated: 0, later: 0, known: 0 };
if (fs.existsSync(CANDIDATES)) {
  for (const c of JSON.parse(fs.readFileSync(CANDIDATES, 'utf8'))) {
    const node = nodeForPage(c.chunk.pageId);
    const target = `draft-${c.draft}`;
    if (node === null) {
      dropped.undated++;
      continue;
    }
    if (node.date.slice(0, 4) > '1948') {
      dropped.later++;
      continue;
    }
    if (edges.some((x) => x.from === node.id && x.to === target)) {
      dropped.known++;
      continue;
    }
    const draftN = { 8: 13, 9: 15, 11: 17 }[c.draft];
    const target_ = chunkOf(draftText(draftN), `candidate ${node.id} to ${target}`);
    if (target_ === null) continue;
    const { chunkId: _, ...chunk } = c.chunk;
    edges.push({
      from: node.id,
      to: target,
      assertion: 'argues',
      method: 'semantic',
      score: c.score,
      assertedBy: null,
      evidence: [chunk, target_.chunk],
    });
  }
}

// Confirmations: the latest decision for an edge counts, if its digest is the edge's.
const decisions = new Map();
if (fs.existsSync(CONFIRMATIONS)) {
  for (const line of fs.readFileSync(CONFIRMATIONS, 'utf8').split('\n').filter((l) => l.trim() !== '')) {
    const d = JSON.parse(line);
    decisions.set(`${d.edge} ${d.digest}`, d);
  }
}

const out = { nodes: [], edges: [] };
const used = new Set(edges.flatMap((e) => [e.from, e.to]));
for (const n of nodes.values()) {
  if (n.optional && !used.has(n.id)) continue;
  const { optional: _, ...node } = n;
  out.nodes.push(node);
}
let confirmed = 0;
for (const e of edges) {
  const id = `${e.from}--${e.assertion}--${e.to}`;
  const digest = digestOf(e, e.evidence);
  const d = decisions.get(`${id} ${digest}`);
  if (d?.decision === 'confirmed') confirmed++;
  out.edges.push({
    id,
    from: e.from,
    to: e.to,
    assertion: e.assertion,
    method: e.method,
    score: e.score,
    assertedBy: e.assertedBy,
    evidence: e.evidence,
    digest,
    confirmation:
      d === undefined ? null : { decision: d.decision, by: d.by, at: d.at, note: d.note ?? null, digest },
  });
  console.log(`  edge  ${id.padEnd(34)} ${e.method.padEnd(8)} ${d?.decision ?? 'candidate'}${e.score === null ? '' : `  ${e.score}`}`);
}

if (failures.length > 0) {
  for (const f of failures) console.error(`  FAIL ${f}`);
  console.error(`  ${failures.length} problems; nothing written`);
  process.exit(1);
}

// The contract is the last word on what may be shown.
const graph = readProvenance(out);
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(
  `  ${graph.nodes.length} nodes, ${graph.edges.length} edges (${confirmed} confirmed), ` +
    `candidates dropped: ${dropped.undated} from undated texts, ${dropped.later} from later ones, ${dropped.known} already drawn`,
);
