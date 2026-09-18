export declare const MODEL: string;
export declare const DTYPE: string;
export declare const DIMS: number;
export declare const PASSAGE_PREFIX: string;
export declare const QUERY_PREFIX: string;

/**
 * The text that gets indexed, which is not always the text that gets shown.
 * A debate record's speaker is prepended so attribution is searchable.
 */
export declare function indexableText(row: {
  speaker?: string | null;
  text: string;
}): string;
