import type { CitedPassage } from '@toran/contracts';

/** The raw shape the indexer writes to meta.json. Untyped until validated. */
export interface RawChunkMeta {
  readonly chunkId: string;
  readonly pageId: string;
  readonly workId: string;
  readonly corpus: string;
  readonly locator: unknown;
  readonly language: string;
  readonly speaker: string | null;
}

export interface IndexManifest {
  readonly model: string;
  readonly dtype: string;
  readonly dims: number;
  readonly count: number;
  readonly quantisation: { type: string; scale: number; maxComponentError: number };
  readonly passagePrefix: string;
  readonly queryPrefix: string;
  readonly built: string;
}

export interface SearchHit {
  readonly chunkId: string;
  /**
   * The result is a CitedPassage, built through the contract factory when the
   * index loads. A hit therefore cannot exist without a citation that resolves,
   * which is the same invariant the archive enforces. See CLAUDE.md section 12.
   */
  readonly passage: CitedPassage;
  /** Fused rank score. Comparable within one result set, not across queries. */
  readonly score: number;
  /** Where the hit came from, for the result view and for debugging ranking. */
  readonly dense: number | null;
  readonly lexical: number | null;
  /** Character offsets of query terms in `text`, for highlighting. */
  readonly spans: readonly [start: number, end: number][];
}

export interface SearchResponse {
  readonly query: string;
  readonly hits: readonly SearchHit[];
  readonly tookMs: number;
  readonly embedMs: number;
}

export type WorkerRequest =
  { type: 'init' } | { type: 'search'; id: number; query: string; limit?: number };

export type WorkerResponse =
  | { type: 'ready'; manifest: IndexManifest; loadMs: number }
  | { type: 'progress'; stage: string; loaded?: number; total?: number }
  | { type: 'result'; id: number; response: SearchResponse }
  | { type: 'error'; id?: number; message: string };
