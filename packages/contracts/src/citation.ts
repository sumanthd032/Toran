/**
 * The citation contract.
 *
 * CLAUDE.md section 12: it must not be possible to construct a displayable
 * passage without a citation that a reader can follow back to the source.
 * That rule is enforced here, at the type level, rather than by convention in
 * each feature.
 *
 * A locator is a union rather than a page number because the three corpora do
 * not share a citable unit. A printed volume cites by page. The Constituent
 * Assembly Debates have no stable pagination online and are cited by volume,
 * sitting and paragraph, which is the form the published archives use. The
 * Constitution is cited by article. Flattening these into a page number would
 * mean inventing page numbers that do not exist, which is the one thing an
 * archive must not do.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** An identifier that has been checked. Cannot be conjured from a string. */
export type PageId = Brand<string, 'PageId'>;
export type WorkId = Brand<string, 'WorkId'>;

export const CORPORA = ['baws', 'cad', 'constitution', 'media', 'photograph'] as const;
export type Corpus = (typeof CORPORA)[number];

/** Cites a page in a printed volume. */
export interface PageLocator {
  readonly kind: 'page';
  /** Volume number as printed. Null for a work published without one. */
  readonly volume: number | null;
  /** Some volumes are split, for example "I". */
  readonly part: string | null;
  /** The page number as printed in the source, never an array offset. */
  readonly page: number;
  /**
   * False when the page number was inferred from the surrounding sequence
   * rather than read off the page. A citation to an inferred page is weaker
   * than one to an observed page and the archive keeps the difference.
   */
  readonly observed: boolean;
}

/** Cites a paragraph of a sitting of the Constituent Assembly. */
export interface ParagraphLocator {
  readonly kind: 'paragraph';
  readonly volume: number;
  readonly sitting: number;
  readonly paragraph: number;
  /** ISO date of the sitting, which is how a reader actually finds it. */
  readonly date: string;
  /**
   * True for the procedural record that follows this paragraph rather than
   * the paragraph itself: "The amendment was adopted", "Article 11 was added
   * to the Constitution". The transcription does not number these, but they
   * carry the outcome of a debate and are the most consequential sentences in
   * the corpus, so they are kept and located by the paragraph they follow.
   */
  readonly procedural: boolean;
}

/** Cites an article of the Constitution. */
export interface ArticleLocator {
  readonly kind: 'article';
  /** "17", "15", "21A". Articles are not always plain integers. */
  readonly article: string;
}

export type Locator = PageLocator | ParagraphLocator | ArticleLocator;

export interface Citation {
  readonly corpus: Corpus;
  readonly workId: WorkId;
  readonly pageId: PageId;
  readonly locator: Locator;
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
  /** Who is speaking, for debate records. Null for printed prose. */
  readonly speaker: string | null;
}

export class CitationError extends Error {
  public override readonly name = 'CitationError';
}

const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

function positiveInt(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new CitationError(`${field} must be a positive integer, got ${String(value)}`);
  }
  return value;
}

export function pageLocator(input: {
  page: number;
  volume?: number | null;
  part?: string | null;
  observed: boolean;
}): PageLocator {
  const volume = input.volume ?? null;
  if (volume !== null) positiveInt(volume, 'volume');
  return {
    kind: 'page',
    volume,
    part: input.part ?? null,
    page: positiveInt(input.page, 'page'),
    observed: input.observed,
  };
}

export function paragraphLocator(input: {
  volume: number;
  sitting: number;
  paragraph: number;
  date: string;
  procedural?: boolean;
}): ParagraphLocator {
  if (!ISO_DATE.test(input.date)) {
    throw new CitationError(`sitting date must be ISO yyyy-mm-dd, got ${input.date}`);
  }
  return {
    kind: 'paragraph',
    volume: positiveInt(input.volume, 'volume'),
    sitting: positiveInt(input.sitting, 'sitting'),
    paragraph: positiveInt(input.paragraph, 'paragraph'),
    date: input.date,
    procedural: input.procedural ?? false,
  };
}

export function articleLocator(article: string): ArticleLocator {
  if (!/^\d{1,3}[A-Z]?$/.test(article)) {
    throw new CitationError(`article must look like "17" or "21A", got ${article}`);
  }
  return { kind: 'article', article };
}

/** The only way to make a Citation. */
export function citation(input: {
  corpus: Corpus;
  workId: string;
  pageId: string;
  locator: Locator;
}): Citation {
  if (!isCorpus(input.corpus)) {
    throw new CitationError(`unknown corpus: ${String(input.corpus)}`);
  }
  return {
    corpus: input.corpus,
    workId: workId(input.workId),
    pageId: pageId(input.pageId),
    locator: input.locator,
  };
}

/** The only way to make displayable text. */
export function citedPassage(input: {
  text: string;
  citation: Citation;
  language: string;
  translatedFrom?: string | null;
  speaker?: string | null;
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
    speaker: input.speaker ?? null,
  };
}

/**
 * Stable short form, for example "baws 1:23", "cad 7.62.186", "art. 17".
 * Corpus and field labels are translated in the i18n layer; this is the
 * structural part and is used for keys and logs.
 */
export function citationKey(c: Citation): string {
  const l = c.locator;
  switch (l.kind) {
    case 'page': {
      const vol = l.volume === null ? '' : String(l.volume);
      const part = l.part === null ? '' : `.${l.part}`;
      return vol === '' ? `${c.corpus}:${l.page}` : `${c.corpus} ${vol}${part}:${l.page}`;
    }
    case 'paragraph':
      return l.procedural
        ? `${c.corpus} ${l.volume}.${l.sitting}.${l.paragraph}+`
        : `${c.corpus} ${l.volume}.${l.sitting}.${l.paragraph}`;
    case 'article':
      return `art. ${l.article}`;
  }
}
