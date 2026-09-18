/**
 * The embedding model, shared by everything that makes vectors at build time.
 *
 * The index and the abstracts must embed with the same model, the same
 * quantisation and the same prefixes as the browser worker, or build-time
 * vectors and query-time vectors land in different spaces and results turn to
 * noise without failing.
 */

export const MODEL = 'Xenova/multilingual-e5-small';
export const DTYPE = 'q8';
export const DIMS = 384;
/**
 * e5 models are trained with asymmetric prefixes. Documents are embedded as
 * "passage: ", queries as "query: ". Omitting them, or using the same prefix
 * for both, measurably degrades retrieval and is a silent failure.
 */
export const PASSAGE_PREFIX = 'passage: ';
export const QUERY_PREFIX = 'query: ';
