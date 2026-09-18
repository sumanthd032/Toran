/**
 * The citation contract.
 *
 * CLAUDE.md section 12: it must not be possible to construct a displayable
 * passage without a citation that resolves to a volume and page. That rule is
 * enforced here, at the type level, rather than by convention in each feature.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** A page identifier that has been checked. Cannot be conjured from a string. */
export type PageId = Brand<string, 'PageId'>;
/** A work identifier that has been checked. */
export type WorkId = Brand<string, 'WorkId'>;

export const CORPORA = ['baws', 'cad', 'constitution', 'media', 'photograph'] as const;
export type Corpus = (typeof CORPORA)[number];

/** Human labels live in the i18n layer, never here. */
export interface Citation {
  readonly corpus: Corpus;
  readonly workId: WorkId;
  readonly pageId: PageId;
  /** Volume number as printed. Constitution has none. */
  readonly volume: number | null;
  /** Some BAWS volumes are split, for example "Part I". */
  readonly part: string | null;
  /** Page number as printed in the source, not an array offset. */
  readonly page: number;
}

/**
 * Text that is safe to display, because it carries its source.
 * Every render path in Toran takes one of these, never a bare string.
 */
export interface CitedPassage {
  readonly text: string;
  readonly citation: Citation;
  /** BCP-47. The language this text is actually in. */
  readonly language: string;
  /** Present when this is a translation rather than the source text. */
  readonly translatedFrom: string | null;
}

export class CitationError extends Error {
  public override readonly name = 'CitationError';
}

const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

export function pageId(raw: string): PageId {
  if (!ID.test(raw)) throw new CitationError(`invalid page id: ${JSON.stringify(raw)}`);
  return raw as PageId;
}

export function workId(raw: string): WorkId {
  if (!ID.test(raw)) throw new CitationError(`invalid work id: ${JSON.stringify(raw)}`);
  return raw as WorkId;
}

export function isCorpus(value: unknown): value is Corpus {
  return typeof value === 'string' && (CORPORA as readonly string[]).includes(value);
}

/**
 * The only way to make a Citation. Rejects anything that would render as a
 * citation a reader could not follow back to a physical page.
 */
export function citation(input: {
  corpus: Corpus;
  workId: string;
  pageId: string;
  page: number;
  volume?: number | null;
  part?: string | null;
}): Citation {
  if (!isCorpus(input.corpus)) {
    throw new CitationError(`unknown corpus: ${String(input.corpus)}`);
  }
  if (!Number.isInteger(input.page) || input.page < 1) {
    throw new CitationError(`page must be a positive integer, got ${String(input.page)}`);
  }
  const volume = input.volume ?? null;
  if (volume !== null && (!Number.isInteger(volume) || volume < 1)) {
    throw new CitationError(`volume must be a positive integer or null`);
  }
  return {
    corpus: input.corpus,
    workId: workId(input.workId),
    pageId: pageId(input.pageId),
    volume,
    part: input.part ?? null,
    page: input.page,
  };
}

/** The only way to make displayable text. */
export function citedPassage(input: {
  text: string;
  citation: Citation;
  language: string;
  translatedFrom?: string | null;
}): CitedPassage {
  const text = input.text.trim();
  if (text.length === 0) {
    throw new CitationError('a cited passage cannot be empty');
  }
  if (input.language.trim().length === 0) {
    throw new CitationError('a cited passage must declare its language');
  }
  return {
    text,
    citation: input.citation,
    language: input.language,
    translatedFrom: input.translatedFrom ?? null,
  };
}

/**
 * Stable short form for display, for example "BAWS 1:23" or "CAD 7:412".
 * Corpus labels are translated in the i18n layer; this is the structural part.
 */
export function citationKey(c: Citation): string {
  const vol = c.volume === null ? '' : String(c.volume);
  const part = c.part === null ? '' : `.${c.part}`;
  return vol === '' ? `${c.corpus}:${c.page}` : `${c.corpus} ${vol}${part}:${c.page}`;
}
