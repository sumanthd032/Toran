/**
 * Reciprocal rank fusion.
 *
 * Combines the dense and lexical result lists without a weight to tune. A
 * weighted linear combination would need a labelled relevance set to fit, and
 * we do not have one. RRF only uses the position of a document in each list,
 * so the two scores never have to be made commensurable.
 *
 * Cormack, Clarke and Buettcher (2009). k = 60 is their reported default and
 * is not tuned here; tuning it without a relevance set would be guessing.
 */

export const RRF_K = 60;

export interface Ranked {
  readonly id: number;
  readonly score: number;
}

export interface Fused {
  readonly id: number;
  readonly score: number;
  readonly dense: number | null;
  readonly lexical: number | null;
}

export function reciprocalRankFusion(
  dense: readonly Ranked[],
  lexical: readonly Ranked[],
  k: number = RRF_K,
): Fused[] {
  const combined = new Map<
    number,
    { score: number; dense: number | null; lexical: number | null }
  >();

  const add = (list: readonly Ranked[], field: 'dense' | 'lexical') => {
    list.forEach((entry, position) => {
      const current = combined.get(entry.id) ?? { score: 0, dense: null, lexical: null };
      current.score += 1 / (k + position + 1);
      current[field] = entry.score;
      combined.set(entry.id, current);
    });
  };

  add(dense, 'dense');
  add(lexical, 'lexical');

  return [...combined.entries()]
    .map(([id, v]) => ({ id, score: v.score, dense: v.dense, lexical: v.lexical }))
    .sort((a, b) => b.score - a.score);
}
