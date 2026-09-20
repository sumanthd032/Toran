/**
 * Reading ingested records into the citation contract.
 *
 * The pipeline writes JSON. JSON is untyped, so this is the boundary where
 * ingested data becomes something the application is allowed to display. A
 * record that cannot produce a locator does not become a passage; it is
 * rejected here rather than rendered without a source.
 */

import {
  articleLocator,
  citation,
  CitationError,
  citedPassage,
  isCorpus,
  pageLocator,
  paragraphLocator,
  plateLocator,
  sectionLocator,
  type CitedPassage,
  type Locator,
} from './citation.ts';

/** The shape the pipeline writes to data/dip/chunks.jsonl. */
export interface RawChunk {
  chunkId?: unknown;
  pageId?: unknown;
  workId?: unknown;
  corpus?: unknown;
  locator?: unknown;
  language?: unknown;
  speaker?: unknown;
  text?: unknown;
}

function str(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CitationError(`${field} must be a non-empty string`);
  }
  return value;
}

function int(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new CitationError(`${field} must be an integer`);
  }
  return value;
}

export function readLocator(raw: unknown): Locator {
  if (typeof raw !== 'object' || raw === null) {
    throw new CitationError('locator missing');
  }
  const l = raw as Record<string, unknown>;
  switch (l['kind']) {
    case 'page':
      return pageLocator({
        page: int(l['page'], 'page'),
        volume: l['volume'] === null ? null : int(l['volume'], 'volume'),
        part: typeof l['part'] === 'string' ? l['part'] : null,
        observed: l['observed'] === true,
      });
    case 'paragraph':
      return paragraphLocator({
        volume: int(l['volume'], 'volume'),
        sitting: int(l['sitting'], 'sitting'),
        paragraph: int(l['paragraph'], 'paragraph'),
        date: str(l['date'], 'date'),
        procedural: l['procedural'] === true,
      });
    case 'article': {
      const v = l['version'];
      if (v === undefined || v === null)
        return articleLocator(str(l['article'], 'article'));
      if (typeof v !== 'object')
        throw new CitationError('article version must be an object');
      const version = v as Record<string, unknown>;
      return articleLocator(str(l['article'], 'article'), {
        ordinal: int(version['ordinal'], 'version ordinal'),
        article: str(version['article'], 'version article'),
        year: int(version['year'], 'version year'),
        draft: version['draft'] === true,
      });
    }
    case 'section':
      return sectionLocator({
        act: str(l['act'], 'act'),
        year: int(l['year'], 'act year'),
        section: str(l['section'], 'section'),
      });
    case 'plate':
      return plateLocator({
        plate: str(l['plate'], 'plate'),
        volume: l['volume'] === null ? null : int(l['volume'], 'volume'),
        part: typeof l['part'] === 'string' ? l['part'] : null,
      });
    default:
      throw new CitationError(`unknown locator kind: ${String(l['kind'])}`);
  }
}

/**
 * Turn one ingested record into a displayable passage, or throw.
 * There is no variant of this that returns text without a citation.
 */
export function readChunk(raw: RawChunk): CitedPassage {
  const corpus = raw.corpus;
  if (!isCorpus(corpus)) {
    throw new CitationError(`unknown corpus: ${String(corpus)}`);
  }
  return citedPassage({
    text: str(raw.text, 'text'),
    citation: citation({
      corpus,
      workId: str(raw.workId, 'workId'),
      pageId: str(raw.pageId, 'pageId'),
      locator: readLocator(raw.locator),
    }),
    language: str(raw.language, 'language'),
    speaker: typeof raw.speaker === 'string' ? raw.speaker : null,
  });
}

export interface ReadReport {
  readonly passages: readonly CitedPassage[];
  readonly rejected: readonly { index: number; reason: string }[];
}

/** Read a whole file. Rejections are reported, never silently dropped. */
export function readChunks(rows: readonly RawChunk[]): ReadReport {
  const passages: CitedPassage[] = [];
  const rejected: { index: number; reason: string }[] = [];
  rows.forEach((row, index) => {
    try {
      passages.push(readChunk(row));
    } catch (error) {
      rejected.push({
        index,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });
  return { passages, rejected };
}
