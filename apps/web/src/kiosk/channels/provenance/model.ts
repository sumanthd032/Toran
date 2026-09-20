/**
 * The Provenance Graph without React: where each document sits, which links
 * a walk back follows, and how a link looks.
 *
 * Layout. Documents are set in columns by the year they carry, oldest on the
 * left, one column per year that has a document, so the drafts of 1948 and the
 * articles of 1950 get a column each instead of crowding into a sliver of a
 * true time scale. Rows come from relaxation: each document moves toward the
 * rows of the documents it links to and away from any it would overlap in its
 * own column, so a writing settles beside the drafts it argued for. Every
 * step is deterministic, so the same graph always draws the same way.
 */

import {
  compareDates,
  edgeStatus,
  type ProvenanceEdge,
  type ProvenanceGraph,
  type ProvenanceNode,
} from '@toran/contracts';

export interface Placed {
  readonly id: string;
  /** Column index, oldest first. */
  readonly column: number;
  /** Row position, 0 at the top, in rows. */
  readonly row: number;
}

export interface Layout {
  readonly years: readonly number[];
  readonly placed: ReadonlyMap<string, Placed>;
  /** The number of rows the layout spans. */
  readonly rows: number;
}

const ROUNDS = 60;
/** Rows between one article and the next: a node, and room for a writing's links between. */
const ARTICLE_ROWS = 1.15;

export function layout(graph: ProvenanceGraph): Layout {
  const years = [...new Set(graph.nodes.map((n) => n.date.year))].sort((a, b) => a - b);
  const column = new Map(graph.nodes.map((n) => [n.id, years.indexOf(n.date.year)]));
  const neighbours = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) {
    neighbours.get(e.from)?.push(e.to);
    neighbours.get(e.to)?.push(e.from);
  }

  // Articles, the documents every chain ends in, fix the rows; each draft
  // shares its article's row. Everything else starts at the middle.
  const row = new Map<string, number>();
  const articles = graph.nodes
    .filter((n) => n.kind === 'article')
    .sort((a, b) => a.title.localeCompare(b.title, 'en', { numeric: true }));
  const fixed = new Set<string>();
  articles.forEach((a, i) => {
    row.set(a.id, i * ARTICLE_ROWS);
    fixed.add(a.id);
    for (const e of graph.edges) {
      if (e.to === a.id && e.assertion === 'becomes') {
        row.set(e.from, i * ARTICLE_ROWS);
        fixed.add(e.from);
      }
    }
  });
  const middle = ((Math.max(articles.length, 1) - 1) * ARTICLE_ROWS) / 2;
  for (const n of graph.nodes) if (!row.has(n.id)) row.set(n.id, middle);

  const order = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));
  for (let round = 0; round < ROUNDS; round++) {
    // Toward the mean row of the linked documents.
    for (const n of order) {
      if (fixed.has(n.id)) continue;
      const linked = neighbours.get(n.id) ?? [];
      if (linked.length === 0) continue;
      const mean =
        linked.reduce((s, id) => s + (row.get(id) ?? middle), 0) / linked.length;
      row.set(n.id, row.get(n.id)! + (mean - row.get(n.id)!) * 0.5);
    }
    // Apart from anything in the same column.
    for (let c = 0; c < years.length; c++) {
      const inColumn = order
        .filter((n) => column.get(n.id) === c)
        .sort((a, b) => row.get(a.id)! - row.get(b.id)! || a.id.localeCompare(b.id));
      for (let i = 1; i < inColumn.length; i++) {
        const above = inColumn[i - 1]!;
        const here = inColumn[i]!;
        const gap = row.get(here.id)! - row.get(above.id)!;
        if (gap < 1) {
          const push = (1 - gap) / 2;
          if (!fixed.has(above.id)) row.set(above.id, row.get(above.id)! - push);
          if (!fixed.has(here.id)) row.set(here.id, row.get(here.id)! + push);
        }
      }
    }
  }
  const top = Math.min(...row.values());
  const placed = new Map<string, Placed>();
  for (const n of graph.nodes) {
    placed.set(n.id, { id: n.id, column: column.get(n.id)!, row: row.get(n.id)! - top });
  }
  const rows = Math.max(...[...placed.values()].map((p) => p.row)) + 1;
  return { years, placed, rows };
}

export interface Hop {
  readonly edge: ProvenanceEdge;
  /** The earlier document the walk arrives at. */
  readonly node: ProvenanceNode;
}

/**
 * Walking back from a document: each earlier document it came from, latest
 * first, then theirs, one hop at a time. Links proposed only by closeness of
 * meaning are drawn on the graph but not walked: a walk tells the story the
 * records and the readings support.
 */
export function walkBack(graph: ProvenanceGraph, start: string): Hop[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const hops: Hop[] = [];
  const seen = new Set([start]);
  let frontier = [start];
  while (frontier.length > 0) {
    const next: Hop[] = [];
    for (const id of frontier) {
      for (const e of graph.edges) {
        if (e.to !== id || e.method === 'semantic' || seen.has(e.from)) continue;
        seen.add(e.from);
        next.push({ edge: e, node: byId.get(e.from)! });
      }
    }
    next.sort(
      (a, b) =>
        compareDates(b.node.date, a.node.date) || a.node.id.localeCompare(b.node.id),
    );
    hops.push(...next);
    frontier = next.map((h) => h.node.id);
  }
  return hops;
}

/**
 * How a link is drawn. The only way to get a link's look, and it reads the
 * link's standing from edgeStatus alone: there is no argument that can make a
 * link nobody has confirmed look like one somebody has.
 */
export interface EdgeLook {
  readonly status: 'confirmed' | 'candidate';
  /** SVG stroke-dasharray; null draws the line solid. */
  readonly dash: string | null;
}

export function edgeLook(edge: ProvenanceEdge): EdgeLook {
  const status = edgeStatus(edge);
  return { status, dash: status === 'confirmed' ? null : '7 6' };
}
