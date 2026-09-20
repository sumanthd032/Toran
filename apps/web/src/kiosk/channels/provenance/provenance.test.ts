/**
 * The Provenance Graph's model, and the provenance contract under it. Run with `npm test`.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { readProvenance, type ProvenanceGraph } from '@toran/contracts';
import { edgeLook, layout, walkBack } from './model.ts';

const chunk = (pageId: string, text: string, locator: object) => ({
  corpus: 'baws',
  workId: 'baws-v1',
  pageId,
  locator,
  language: 'en',
  speaker: null,
  text,
});
const page = (n: number) => ({
  kind: 'page',
  volume: 1,
  part: null,
  page: n,
  observed: true,
});
const DIGEST = 'a'.repeat(64);

const node = (id: string, kind: string, title: string, date: string) => ({
  id,
  kind,
  title,
  date,
  anchor: [chunk(`baws-v1-p0${id.length}0`, `${title}, ${date.slice(0, 4)}.`, page(10))],
});
const edge = (
  from: string,
  to: string,
  assertion: string,
  method = 'reading',
  confirmation: object | null = null,
) => ({
  id: `${from}--${assertion}--${to}`,
  from,
  to,
  assertion,
  method,
  score: method === 'semantic' ? 0.86 : null,
  assertedBy: null,
  evidence: [chunk('baws-v1-p0073', 'Are you fit for political power?', page(41))],
  digest: DIGEST,
  confirmation,
});

const RAW = {
  nodes: [
    node('rtc-1930', 'writing', 'A Scheme', '1930'),
    node('aoc-1936', 'writing', 'Annihilation of Caste', '1936-05'),
    node('sam-1947', 'writing', 'States and Minorities', '1947'),
    node('draft-11', 'draft', 'Draft Article 11', '1948-11-29'),
    node('art-17', 'article', 'Article 17', '1950'),
    node('draft-9', 'draft', 'Draft Article 9', '1948-11-29'),
    node('art-15', 'article', 'Article 15', '1950'),
  ],
  edges: [
    edge('draft-11', 'art-17', 'becomes', 'record', {
      decision: 'confirmed',
      by: 'A Curator',
      at: '2026-09-20T10:00:00Z',
      note: null,
      digest: DIGEST,
    }),
    edge('draft-9', 'art-15', 'becomes', 'record'),
    edge('aoc-1936', 'draft-11', 'argues'),
    edge('rtc-1930', 'draft-11', 'proposes'),
    edge('sam-1947', 'draft-11', 'argues', 'semantic'),
    edge('sam-1947', 'draft-9', 'proposes'),
  ],
};

const graph: ProvenanceGraph = readProvenance(RAW);

test('Article 17 walks back to 1948, then to 1936, then to 1930', () => {
  const hops = walkBack(graph, 'art-17');
  assert.deepEqual(
    hops.map((h) => h.node.id),
    ['draft-11', 'aoc-1936', 'rtc-1930'],
  );
  assert.deepEqual(
    hops.map((h) => h.node.date.year),
    [1948, 1936, 1930],
  );
});

test('a walk does not follow a link proposed only by closeness of meaning', () => {
  assert.ok(!walkBack(graph, 'art-17').some((h) => h.node.id === 'sam-1947'));
  assert.deepEqual(
    walkBack(graph, 'art-15').map((h) => h.node.id),
    ['draft-9', 'sam-1947'],
  );
});

test('a link nobody has confirmed is dashed, and only a confirmation makes it solid', () => {
  for (const e of graph.edges) {
    const look = edgeLook(e);
    if (e.confirmation?.decision === 'confirmed') {
      assert.equal(look.status, 'confirmed');
      assert.equal(look.dash, null);
    } else {
      assert.equal(look.status, 'candidate');
      assert.notEqual(look.dash, null);
    }
  }
  // edgeLook takes the link and nothing else.
  assert.equal(edgeLook.length, 1);
});

test("the layout runs left to right in time, and a draft sits on its article's row", () => {
  const l = layout(graph);
  const col = (id: string) => l.placed.get(id)!.column;
  const row = (id: string) => l.placed.get(id)!.row;
  assert.deepEqual(l.years, [1930, 1936, 1947, 1948, 1950]);
  assert.ok(
    col('rtc-1930') < col('aoc-1936') &&
      col('aoc-1936') < col('draft-11') &&
      col('draft-11') < col('art-17'),
  );
  assert.equal(row('draft-11'), row('art-17'));
  assert.equal(row('draft-9'), row('art-15'));
  // Nothing overlaps in its column.
  for (const a of l.placed.values()) {
    for (const b of l.placed.values()) {
      if (a.id !== b.id && a.column === b.column)
        assert.ok(Math.abs(a.row - b.row) >= 0.99, `${a.id} and ${b.id}`);
    }
  }
  assert.deepEqual(layout(graph), l);
});

test('the contract refuses a link without evidence, backwards in time, or confirmed against other evidence', () => {
  const broken = (patch: (r: typeof RAW) => void) => () => {
    const r = structuredClone(RAW);
    patch(r);
    return readProvenance(r);
  };
  assert.throws(broken((r) => void (r.edges[2]!.evidence = [])));
  assert.throws(broken((r) => void r.edges.push(edge('art-17', 'aoc-1936', 'argues'))));
  assert.throws(
    broken(
      (r) =>
        void ((r.edges[0]!.confirmation as { digest: string }).digest = 'b'.repeat(64)),
    ),
  );
  assert.throws(broken((r) => void (r.edges[2]!.assertion = 'inspires')));
  assert.throws(
    broken((r) => void (r.edges[2]!.evidence[0]!.locator = undefined as never)),
  );
  assert.throws(broken((r) => void (r.nodes[0]!.anchor = [])));
});

test('a rejected link is not part of the graph a visitor sees', () => {
  const r = structuredClone(RAW);
  r.edges[2]!.confirmation = {
    decision: 'rejected',
    by: 'A Curator',
    at: '2026-09-20T10:00:00Z',
    note: 'not this',
    digest: DIGEST,
  } as never;
  assert.ok(!readProvenance(r).edges.some((e) => e.id === 'aoc-1936--argues--draft-11'));
});

const BUILT = new URL('../../../../public/archive/graph.json', import.meta.url);

test('the built graph reads, and Article 17 walks back to 1948 and then 1936', (t) => {
  if (!existsSync(BUILT)) {
    t.skip('archive not built; run npm run build:data');
    return;
  }
  const built = readProvenance(JSON.parse(readFileSync(BUILT, 'utf8')));
  const years = walkBack(built, 'art-17').map((h) => h.node.date.year);
  assert.equal(years[0], 1948);
  assert.equal(years[1], 1936);
  for (const e of built.edges) assert.ok(e.evidence.length > 0);
});
