export declare const K1: number;
export declare const B: number;

export interface LexicalIndex {
  vocabulary: string[];
  postings: number[][];
  docLengths: number[];
  docCount: number;
  averageLength: number;
  /** Lazily built lookup, cached on the object by scoreBm25. */
  _termIndex?: Map<string, number>;
}

export declare function tokenise(text: string): string[];
export declare function buildLexical(docs: readonly string[]): LexicalIndex;
export declare function scoreBm25(
  index: LexicalIndex,
  queryTerms: readonly string[],
): Map<number, number>;
