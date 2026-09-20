/**
 * The reading copy, read into the citation contract.
 *
 * The pipeline writes the archive's reading copy as JSON: printed pages with
 * their structure, sittings of the Assembly with their speakers, articles.
 * This is where that JSON becomes something the kiosk may display. Every
 * paragraph, heading, table, speech and abstract sentence becomes a
 * CitedPassage through `readChunk`, so the reading view can no more show
 * uncited text than search can. A record that cannot be cited is refused
 * here, whole, rather than shown with a gap.
 */

import {
  CitationError,
  citedPassage,
  type Citation,
  type CitedPassage,
} from './citation.ts';
import { readChunk } from './ingest.ts';

export type BlockKind = 'paragraph' | 'heading' | 'table';

export interface ReadingBlock {
  readonly kind: BlockKind;
  readonly passage: CitedPassage;
  /** A paragraph carried over from the previous page, set without an indent. */
  readonly continued: boolean;
  /** Headings are centred as printed, or set right, as a signature is. */
  readonly align: 'centre' | 'right';
  /**
   * A table's rows as printed, spacing and all. The passage holds the same
   * characters with its outer whitespace trimmed, which would pull a header
   * row out of line with its columns.
   */
  readonly layout: string | null;
}

export interface ReadingPage {
  readonly kind: 'page';
  readonly pageId: string;
  readonly workId: string;
  readonly citation: Citation;
  /** The section title the recto running head prints, as printed. */
  readonly head: string | null;
  /** Null for a plate, which stands outside the text around it. */
  readonly section: string | null;
  readonly prev: string | null;
  readonly next: string | null;
  readonly blocks: readonly ReadingBlock[];
}

export interface ReadingParagraph {
  readonly pageId: string;
  readonly paragraph: number;
  readonly procedural: boolean;
  readonly passage: CitedPassage;
}

export interface ReadingSitting {
  readonly kind: 'sitting';
  readonly id: string;
  readonly workId: string;
  readonly date: string;
  readonly volume: number;
  readonly sitting: number;
  readonly paragraphs: readonly ReadingParagraph[];
}

/** A text from an article's drafting history, cited as that version. */
export interface ReadingArticleVersion {
  /** As the drafting history labels it: "Article 11, Draft Constitution of India 1948". */
  readonly label: string;
  readonly passage: CitedPassage;
}

export interface ReadingArticle {
  readonly kind: 'article';
  readonly pageId: string;
  readonly workId: string;
  readonly article: string;
  readonly heading: string;
  /** The article as it now stands. */
  readonly passage: CitedPassage;
  /** Earliest first: the draft the Assembly debated, then the text of 1950. */
  readonly versions: readonly ReadingArticleVersion[];
}

/** A section of an Act of Parliament, or its long title. */
export interface ReadingSection {
  readonly kind: 'section';
  readonly pageId: string;
  readonly workId: string;
  readonly act: string;
  readonly year: number;
  readonly section: string;
  readonly heading: string;
  readonly passage: CitedPassage;
}

export type ReadingDocument =
  ReadingPage | ReadingSitting | ReadingArticle | ReadingSection;

export interface Abstract {
  readonly sectionId: string;
  readonly head: string | null;
  /** Who chose these sentences. The kiosk says so. */
  readonly chosenBy: 'machine' | 'editor';
  readonly sentences: readonly CitedPassage[];
}

type Json = Record<string, unknown>;

function record(value: unknown, what: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CitationError(`${what} must be an object`);
  }
  return value as Json;
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new CitationError(`${what} must be a list`);
  return value;
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CitationError(`${what} must be a non-empty string`);
  }
  return value;
}

const optional = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

function whole(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new CitationError(`${what} must be an integer`);
  }
  return value;
}

export function readPage(raw: unknown): ReadingPage {
  const p = record(raw, 'page');
  const blocks = list(p['blocks'], 'blocks').map((rawBlock, i): ReadingBlock => {
    const b = record(rawBlock, `block ${i}`);
    const kind = b['kind'];
    if (kind !== 'paragraph' && kind !== 'heading' && kind !== 'table') {
      throw new CitationError(`block ${i}: unknown kind ${String(kind)}`);
    }
    const passage = readChunk({ ...p, speaker: null, text: b['text'] });
    let layout: string | null = null;
    if (kind === 'table') {
      layout = text(b['text'], 'table');
      if (layout.replace(/\s+/g, ' ').trim() !== passage.text.replace(/\s+/g, ' ')) {
        throw new CitationError(`block ${i}: table layout differs from its passage`);
      }
    }
    return {
      kind,
      passage,
      continued: b['continued'] === true,
      align: b['align'] === 'right' ? 'right' : 'centre',
      layout,
    };
  });
  if (blocks.length === 0) throw new CitationError('a page must have at least one block');
  return {
    kind: 'page',
    pageId: text(p['pageId'], 'pageId'),
    workId: text(p['workId'], 'workId'),
    citation: blocks[0]!.passage.citation,
    head: optional(p['head']),
    section: optional(p['section']),
    prev: optional(p['prev']),
    next: optional(p['next']),
    blocks,
  };
}

export function readSitting(raw: unknown): ReadingSitting {
  const s = record(raw, 'sitting');
  const volume = whole(s['volume'], 'volume');
  const sitting = whole(s['sitting'], 'sitting');
  const date = text(s['date'], 'date');
  const paragraphs = list(s['paragraphs'], 'paragraphs').map(
    (rawPara, i): ReadingParagraph => {
      const p = record(rawPara, `paragraph ${i}`);
      const paragraph = whole(p['paragraph'], 'paragraph');
      const procedural = p['procedural'] === true;
      return {
        pageId: text(p['pageId'], 'pageId'),
        paragraph,
        procedural,
        passage: readChunk({
          corpus: s['corpus'],
          workId: s['workId'],
          pageId: p['pageId'],
          locator: { kind: 'paragraph', volume, sitting, paragraph, date, procedural },
          language: s['language'],
          speaker: p['speaker'],
          text: p['text'],
        }),
      };
    },
  );
  return {
    kind: 'sitting',
    id: text(s['id'], 'id'),
    workId: text(s['workId'], 'workId'),
    date,
    volume,
    sitting,
    paragraphs,
  };
}

export function readArticle(raw: unknown): ReadingArticle {
  const a = record(raw, 'article');
  const article = text(a['article'], 'article');
  const versions = Array.isArray(a['versions']) ? a['versions'] : [];
  return {
    kind: 'article',
    pageId: text(a['pageId'], 'pageId'),
    workId: text(a['workId'], 'workId'),
    article,
    heading: text(a['heading'], 'heading'),
    passage: readChunk({ ...a, locator: { kind: 'article', article }, speaker: null }),
    versions: versions.map((rawVersion, i): ReadingArticleVersion => {
      const v = record(rawVersion, `version ${i}`);
      return {
        label: text(v['label'], 'version label'),
        passage: readChunk({
          ...a,
          text: v['text'],
          speaker: null,
          locator: {
            kind: 'article',
            article,
            version: {
              ordinal: v['ordinal'],
              article: v['article'],
              year: v['year'],
              draft: v['draft'] === true,
            },
          },
        }),
      };
    }),
  };
}

export function readSection(raw: unknown): ReadingSection {
  const a = record(raw, 'section');
  const act = text(a['act'], 'act');
  const section = text(a['section'], 'section');
  const year = a['year'];
  if (typeof year !== 'number' || !Number.isInteger(year)) {
    throw new CitationError('an Act must carry its year');
  }
  return {
    kind: 'section',
    pageId: text(a['pageId'], 'pageId'),
    workId: text(a['workId'], 'workId'),
    act,
    year,
    section,
    heading: text(a['heading'], 'heading'),
    passage: readChunk({
      ...a,
      locator: { kind: 'section', act, year, section },
      speaker: null,
    }),
  };
}

export function readAbstract(sectionId: string, raw: unknown): Abstract {
  const a = record(raw, 'abstract');
  const chosenBy = a['chosenBy'];
  if (chosenBy !== 'machine' && chosenBy !== 'editor') {
    throw new CitationError(`abstract ${sectionId}: who chose it is not recorded`);
  }
  const sentences = list(a['sentences'], 'sentences').map((rawSentence) => {
    const s = record(rawSentence, 'sentence');
    return readChunk({
      corpus: a['corpus'],
      workId: a['workId'],
      pageId: s['pageId'],
      locator: s['locator'],
      language: a['language'],
      speaker: s['speaker'] ?? null,
      text: s['text'],
    });
  });
  if (sentences.length === 0) throw new CitationError(`abstract ${sectionId} is empty`);
  return { sectionId, head: optional(a['head']), chosenBy, sentences };
}

export interface Translation {
  readonly pageId: string;
  readonly language: string;
  /** Who translated it: an official text, or a named engine. Shown on screen. */
  readonly source: string;
  readonly blocks: readonly CitedPassage[];
}

/**
 * A translation of a printed page, block for block. Each block is cited to the
 * page it translates and marked `translatedFrom`, so the screen can only ever
 * show it as a translation, never as the source.
 */
export function readTranslation(page: ReadingPage, raw: unknown): Translation {
  const t = record(raw, 'translation');
  const language = text(t['language'], 'language');
  const blocks = list(t['blocks'], 'blocks');
  if (blocks.length !== page.blocks.length) {
    throw new CitationError('a translation must match its page block for block');
  }
  return {
    pageId: page.pageId,
    language,
    source: text(t['source'], 'source'),
    blocks: blocks.map((rawBlock, i) => {
      const original = page.blocks[i]!.passage;
      return citedPassage({
        text: text(record(rawBlock, `block ${i}`)['text'], 'text'),
        citation: original.citation,
        language,
        translatedFrom: original.language,
      });
    }),
  };
}
