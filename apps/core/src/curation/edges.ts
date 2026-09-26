/**
 * Provenance Graph links, for a curator to confirm or reject. STEPS.md step 7.
 *
 * A decision holds for the evidence it was made on. It carries the digest of
 * that evidence, and `tools/build-graph.mjs` ignores a decision whose digest
 * no longer matches, so a link whose passages were re-ingested differently goes
 * back to awaiting a curator on its own. A decision against a digest that is
 * not the link's current one is refused here for the same reason: it would be
 * a judgement on evidence nobody can see any more.
 */

import {
  readEdgeReview,
  type EdgeConfirmation,
  type EdgeDecisionInput,
  type EdgeReview,
} from '@toran/contracts';
import { CurationRefused, PATHS, type ArchiveFiles } from './files.ts';

interface GraphNode {
  id: string;
  title: string;
  date: string;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  assertion: string;
  method: string;
  score?: number | null;
  assertedBy?: string | null;
  evidence: unknown[];
  digest: string;
  confirmation: EdgeConfirmation | null;
}

interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function graph(files: ArchiveFiles): Graph {
  return files.json<Graph>(PATHS.graph, { nodes: [], edges: [] });
}

export function listEdges(files: ArchiveFiles): EdgeReview[] {
  const g = graph(files);
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  const end = (id: string) => {
    const n = nodes.get(id);
    return { id, title: n?.title ?? id, date: n?.date ?? '' };
  };
  return g.edges.flatMap((e) => {
    try {
      return [
        readEdgeReview({
          ...e,
          from: end(e.from),
          to: end(e.to),
        }),
      ];
    } catch {
      // An edge with no citable evidence is not shown to a curator, and
      // build-graph would not have drawn it either.
      return [];
    }
  });
}

/** Records a decision on a link. Returns the record as written. */
export function decideEdge(
  files: ArchiveFiles,
  input: EdgeDecisionInput,
  now: () => number = Date.now,
): EdgeConfirmation & { edge: string; digest: string } {
  const edge = graph(files).edges.find((e) => e.id === input.edge);
  if (edge === undefined) throw new CurationRefused(`no link ${input.edge} in the graph`);
  if (edge.digest !== input.digest) {
    throw new CurationRefused(
      `the evidence for ${input.edge} has changed since it was shown; reload and decide again`,
    );
  }
  const record = {
    edge: input.edge,
    digest: input.digest,
    decision: input.decision,
    by: input.by,
    at: new Date(now()).toISOString(),
    note: input.note,
  };
  files.append(PATHS.edges, record);
  files.premis({
    eventType: 'metadata modification',
    eventDateTime: record.at,
    eventOutcome: 'success',
    eventOutcomeDetail:
      `provenance link ${edge.id} (${edge.from} ${edge.assertion} ${edge.to}) ` +
      `${record.decision} on evidence ${edge.digest.slice(0, 12)}` +
      (record.note === null ? '' : `: ${record.note}`),
    linkingAgentIdentifier: input.by,
    linkingObjectIdentifier: [`graph/${edge.id}`],
  });
  return record;
}
