/**
 * Reciprocal rank fusion.
 *
 * Combines the dense and lexical result lists without a weight to tune. A
 * weighted linear combination would need a labelled relevance set to fit, and
 * we do not have one. RRF only uses the position of a document in each list,
 * so the two scores never have to be made commensurable.
 *
 * Cormack, Clarke and Buettcher (2009) report k = 60, fusing many TREC runs of
 * broadly similar quality. This index fuses two retrievers with complementary
 * strengths rather than similar ones: the vectors find meaning and cannot find
 * an identifier, because a number like 17 survives embedding badly, and BM25
 * finds the identifier exactly. When the two lists disagree here it is usually
 * because only one of them was able to find the passage at all.
 *
 * k = 60 damps the top of both lists, which is right when both retrievers
 * could have found the answer and wrong when only one could. It buried Article
 * 17 for the query "what does Article 17 of the Constitution do": BM25 ranked
 * it first and the vectors did not return it in sixty candidates, so a single
 * first place at k = 60 scored below two middling places. k = 5 says that a
 * retriever which is confident should be listened to, which is what this
 * particular hybrid is for.
 *
 * Measured over the eleven benchmark cases in tools/benchmark-search.mjs, which
 * is the relevance set this repository does have: k = 5 passes all of them and
 * k = 10, 20, 30 and 60 each fail the identifier case. Raising it again means
 * re-running that benchmark.
 */

export const RRF_K = 5;

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
