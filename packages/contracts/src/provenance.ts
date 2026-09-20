/**
 * The Constitutional Provenance Graph. ARCHITECTURE.md section 4, D-006.
 *
 * A node is a document at a point in time: a writing, a draft article, an
 * article of the Constitution, a later Act. An edge asserts how one led to
 * another, and it cannot exist without evidence: cited passages read through
 * readChunk like every passage in Toran. An edge is a candidate until a named
 * person confirms it, and a confirmation only counts against the evidence it
 * was given for: if the evidence changes, the edge is a candidate again.
 *
 * Nothing here decides how an edge looks. `edgeStatus` is the only way to ask
 * whether an edge is established, and it reads the confirmation and nothing
 * else, so no view can hold an edge's standing as state of its own.
 */

import { CitationError, type CitedPassage } from './citation.ts';
import { readChunk, type RawChunk } from './ingest.ts';
import { compareDates, readDate, type HistoricalDate } from './timeline.ts';

export const NODE_KINDS = ['writing', 'draft', 'article', 'act'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/**
 * What an edge claims. `argues`: a writing makes the case for what the target
 * provides. `proposes`: a text proposes the provision's substance or wording.
 * `becomes`: a draft article is adopted as an article. `enforces`: a later
 * instrument gives effect to an article, and says so.
 */
export const ASSERTIONS = ['argues', 'proposes', 'becomes', 'enforces'] as const;
export type Assertion = (typeof ASSERTIONS)[number];

/**
 * How an edge was proposed. `record`: the drafting history or the Assembly's
 * own record states it. `citation`: the later text cites the earlier one.
 * `reading`: proposed by the builder from reading the two texts. `semantic`:
 * proposed because the passages are close in meaning, and nothing more.
 */
export const METHODS = ['record', 'citation', 'reading', 'semantic'] as const;
export type Method = (typeof METHODS)[number];

export interface ProvenanceNode {
  readonly id: string;
  readonly kind: NodeKind;
  /** The document's own name: "Annihilation of Caste", "Article 17". */
  readonly title: string;
  readonly date: HistoricalDate;
  /** What the node is, in its own words, cited. */
  readonly anchor: readonly [CitedPassage, ...CitedPassage[]];
}

export interface Confirmation {
  readonly decision: 'confirmed' | 'rejected';
  /** The curator's name as they gave it. */
  readonly by: string;
  /** ISO timestamp. */
  readonly at: string;
  readonly note: string | null;
}

export interface ProvenanceEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly assertion: Assertion;
  readonly method: Method;
  /** Cosine similarity for a semantic candidate, null otherwise. */
  readonly score: number | null;
  /** The page that asserts it, for a link taken from a source's own record. */
  readonly assertedBy: string | null;
  readonly evidence: readonly [CitedPassage, ...CitedPassage[]];
  /** SHA-256 of the evidence as confirmed; a confirmation counts only against it. */
  readonly digest: string;
  readonly confirmation: Confirmation | null;
}

export interface ProvenanceGraph {
  readonly nodes: readonly ProvenanceNode[];
  readonly edges: readonly ProvenanceEdge[];
}

export type EdgeStatus = 'confirmed' | 'candidate';

/** Whether a curator has confirmed this edge against its evidence. Nothing else decides it. */
export function edgeStatus(edge: ProvenanceEdge): EdgeStatus {
  return edge.confirmation?.decision === 'confirmed' ? 'confirmed' : 'candidate';
}

type Json = Record<string, unknown>;

function record(value: unknown, what: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CitationError(`${what} must be an object`);
  }
  return value as Json;
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CitationError(`${what} must be a non-empty string`);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], what: string): T {
  if (!(options as readonly unknown[]).includes(value)) {
    throw new CitationError(
      `${what} ${String(value)} is not one of ${options.join(', ')}`,
    );
  }
  return value as T;
}

function passages(value: unknown, what: string): [CitedPassage, ...CitedPassage[]] {
  const list = Array.isArray(value) ? value : [];
  if (list.length === 0) throw new CitationError(`${what} has no evidence`);
  return list.map((p) => readChunk(p as RawChunk)) as [CitedPassage, ...CitedPassage[]];
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DIGEST = /^[0-9a-f]{64}$/;

function readConfirmation(
  raw: unknown,
  digest: string,
  edge: string,
): Confirmation | null {
  if (raw === null || raw === undefined) return null;
  const c = record(raw, `confirmation of ${edge}`);
  if (c['digest'] !== digest) {
    throw new CitationError(`${edge}: confirmed against different evidence`);
  }
  const at = text(c['at'], 'confirmed at');
  if (Number.isNaN(Date.parse(at)))
    throw new CitationError(`${edge}: confirmation time is not a time`);
  return {
    decision: oneOf(c['decision'], ['confirmed', 'rejected'] as const, 'decision'),
    by: text(c['by'], 'confirmed by'),
    at,
    note: typeof c['note'] === 'string' && c['note'].trim() !== '' ? c['note'] : null,
  };
}

export function readProvenance(raw: unknown): ProvenanceGraph {
  const g = record(raw, 'graph');
  if (!Array.isArray(g['nodes']) || !Array.isArray(g['edges'])) {
    throw new CitationError('a graph has nodes and edges');
  }
  const nodes = new Map<string, ProvenanceNode>();
  for (const [i, rawNode] of g['nodes'].entries()) {
    const n = record(rawNode, `node ${i}`);
    const id = text(n['id'], `node ${i} id`);
    if (!ID.test(id) || nodes.has(id))
      throw new CitationError(`node id ${id} is malformed or repeated`);
    nodes.set(id, {
      id,
      kind: oneOf(n['kind'], NODE_KINDS, `node ${id} kind`),
      title: text(n['title'], `node ${id} title`),
      date: readDate(n['date']),
      anchor: passages(n['anchor'], `node ${id}`),
    });
  }
  const edges: ProvenanceEdge[] = [];
  const seen = new Set<string>();
  for (const [i, rawEdge] of g['edges'].entries()) {
    const e = record(rawEdge, `edge ${i}`);
    const id = text(e['id'], `edge ${i} id`);
    if (!ID.test(id) || seen.has(id))
      throw new CitationError(`edge id ${id} is malformed or repeated`);
    seen.add(id);
    const from = nodes.get(text(e['from'], `edge ${id} from`));
    const to = nodes.get(text(e['to'], `edge ${id} to`));
    if (from === undefined || to === undefined)
      throw new CitationError(`edge ${id} joins a missing node`);
    if (from === to) throw new CitationError(`edge ${id} joins a node to itself`);
    // Provenance runs forward in time: a text cannot shape one written before it.
    if (compareDates(from.date, to.date) > 0) {
      throw new CitationError(`edge ${id} runs backwards in time`);
    }
    const digest = text(e['digest'], `edge ${id} digest`);
    if (!DIGEST.test(digest)) throw new CitationError(`edge ${id} digest is not SHA-256`);
    const score = e['score'];
    if (score !== null && (typeof score !== 'number' || score < -1 || score > 1)) {
      throw new CitationError(`edge ${id} score must be a cosine or null`);
    }
    const confirmation = readConfirmation(e['confirmation'], digest, id);
    // A rejected edge is not part of the graph a visitor sees.
    if (confirmation?.decision === 'rejected') continue;
    edges.push({
      id,
      from: from.id,
      to: to.id,
      assertion: oneOf(e['assertion'], ASSERTIONS, `edge ${id} assertion`),
      method: oneOf(e['method'], METHODS, `edge ${id} method`),
      score: score as number | null,
      assertedBy: typeof e['assertedBy'] === 'string' ? e['assertedBy'] : null,
      evidence: passages(e['evidence'], `edge ${id}`),
      digest,
      confirmation,
    });
  }
  return { nodes: [...nodes.values()], edges };
}
