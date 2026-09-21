/**
 * The Research Assistant's answer, and the gate every answer passes.
 *
 * CLAUDE.md section 12: the assistant refuses when the corpus does not support
 * an answer, and that refusal is validated on the response before display
 * rather than merely asked for in the prompt. This file is where that
 * validation lives, and it lives in the contract because Toran Core runs it on
 * the model's output and the kiosk runs it again on what arrives. A gate that
 * only the server enforced would be a gate a compromised server could open.
 *
 * What the gate can check, it checks:
 *
 *   Every segment cites. A sentence with no marker is not a sentence with a
 *   weak source, it is a sentence with no source, and it fails the answer.
 *
 *   Every marker resolves. A marker pointing past the end of the retrieved
 *   passages is a model inventing a reference, which is the most convincing
 *   kind of fabrication because it looks exactly like a citation.
 *
 *   Every quotation is real. Text the model put in quotation marks must appear
 *   in a passage it cited. A fabricated quotation attributed to Dr. Ambedkar,
 *   printed under a volume and page number, is the single worst thing this
 *   software could do, and it is the one form of fabrication that can be caught
 *   mechanically.
 *
 * What the gate cannot check is whether a correctly cited sentence is a fair
 * reading of the passage it cites. Nothing can, short of a human. The passage
 * is therefore shown beside the sentence, at its volume and page, so a visitor
 * can do what the gate cannot.
 */

import { citationKey, CitationError, type CitedPassage } from './citation.ts';
import { readChunk, type RawChunk } from './ingest.ts';

/** The sentinel a provider returns when the passages do not support an answer. */
export const INSUFFICIENT = 'INSUFFICIENT';

export const REFUSALS = [
  /** Search found nothing to reason over. */
  'nothing-retrieved',
  /** The model read the passages and said they do not answer the question. */
  'not-in-corpus',
  /** The model answered, but the answer did not pass the gate. */
  'ungrounded',
  /** No provider was reachable and no cached answer matched. */
  'unavailable',
  /** The hall has spent its quota for now. */
  'rate-limited',
] as const;
export type RefusalReason = (typeof REFUSALS)[number];

export interface AnswerSegment {
  /** One unit of the answer. Short, because a standing visitor reads in units. */
  readonly text: string;
  /** The passages this rests on, in the order the model cited them. Never empty. */
  readonly support: readonly CitedPassage[];
}

export interface Answer {
  readonly kind: 'answer';
  readonly question: string;
  /** The language the answer is written in, which is the corpus language. */
  readonly language: string;
  readonly segments: readonly AnswerSegment[];
  /** What produced it. Shown on screen, the same as narration. D-127. */
  readonly engine: string;
  /** True when this came off the device rather than from a live provider. */
  readonly cached: boolean;
}

export interface Refusal {
  readonly kind: 'refusal';
  readonly question: string;
  readonly because: RefusalReason;
  /** The passages search did find, so a visitor gets somewhere to read anyway. */
  readonly nearest: readonly CitedPassage[];
  readonly engine: string;
}

export type AssistantReply = Answer | Refusal;

export class GateError extends Error {
  public override readonly name = 'GateError';
  public readonly because: RefusalReason;
  constructor(because: RefusalReason, message: string) {
    super(message);
    this.because = because;
  }
}

/**
 * Markers the model writes: [1], [2][4], [1, 3].
 *
 * Numbered rather than named because a model asked to reproduce
 * "baws-v17-1-p0041" will eventually reproduce it slightly wrong, and a
 * citation that is slightly wrong is worse than one that is absent. A number
 * it cannot misspell is resolved to a real passage on this side.
 */
const MARKER = /\[\s*(\d+(?:\s*,\s*\d+)*)\s*\]/g;

/**
 * Quotation marks a model actually emits: straight, curly, and the Devanagari
 * corpus's own. A quotation inside any of them is checked against the source.
 */
const QUOTED = /[“"]([^”"]{12,})[”"]/g;

/** Punctuation and spacing differ between a model's prose and a printed page. */
const loose = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[‘’']/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim();

/**
 * The sentence-ending punctuation left behind when the text is split on its
 * markers. "abolished [1]. The enforcement" leaves ". The enforcement", and a
 * segment must not be rendered starting with a full stop.
 */
const TRIM_LEAD = /^[\s.;,:।॥!?)\]]+/;

/**
 * Words too common to count as evidence that a claim came from a passage.
 * Short words are excluded by length, so this only has to name the long ones.
 */
const COMMON = new Set([
  'about',
  'after',
  'against',
  'because',
  'been',
  'before',
  'being',
  'between',
  'could',
  'during',
  'every',
  'from',
  'have',
  'other',
  'shall',
  'should',
  'such',
  'than',
  'that',
  'their',
  'them',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'under',
  'were',
  'when',
  'where',
  'which',
  'while',
  'with',
  'would',
]);

const contentWords = (text: string): string[] =>
  loose(text)
    .split(' ')
    .filter((w) => w.length >= 5 && !COMMON.has(w));

const digits = (text: string): string[] => text.match(/\d+/g) ?? [];

/**
 * Everything a citation asserts, as text a claim can be checked against.
 *
 * `citationKey` is the short form used for keys and logs and carries the
 * volume, page, article and section numbers. What it leaves out is the date of
 * a sitting, and the date is exactly what a claim about when the Assembly
 * debated something rests on. A sitting of 1948-11-29 makes "November 1948"
 * checkable; without it the year would read as a number nobody sourced.
 */
function checkable(passage: CitedPassage): string {
  const l = passage.citation.locator;
  const extra: string[] = [];
  if (l.kind === 'paragraph') {
    extra.push(l.date, monthOf(l.date));
  }
  if (l.kind === 'article' && l.version !== null) {
    extra.push(String(l.version.year), l.version.article);
  }
  return loose(
    [passage.text, citationKey(passage.citation), passage.speaker ?? '', ...extra].join(
      ' ',
    ),
  );
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** The month a sitting fell in, by name, because that is how a claim writes it. */
function monthOf(isoDate: string): string {
  const month = Number.parseInt(isoDate.slice(5, 7), 10);
  return MONTHS[month - 1] ?? '';
}

/**
 * Turns a provider's text into an answer, or throws.
 *
 * `retrieved` is what search put in front of the model, in the order it was
 * numbered in the prompt. Marker n means `retrieved[n - 1]`.
 */
export function gate(
  raw: string,
  retrieved: readonly CitedPassage[],
  question: string,
  engine: string,
  cached = false,
): Answer {
  const text = raw.trim();
  if (text === '') throw new GateError('ungrounded', 'the provider returned nothing');
  if (text.toUpperCase().includes(INSUFFICIENT)) {
    throw new GateError('not-in-corpus', 'the provider found no support in the passages');
  }
  if (retrieved.length === 0) {
    throw new GateError('nothing-retrieved', 'there were no passages to cite');
  }

  const segments: AnswerSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  MARKER.lastIndex = 0;
  while ((match = MARKER.exec(text)) !== null) {
    const body = text.slice(cursor, match.index).replace(TRIM_LEAD, '').trim();
    const numbers = match[1]!.split(',').map((n) => Number.parseInt(n.trim(), 10));
    cursor = MARKER.lastIndex;

    // Consecutive markers, "[1][4]", belong to the segment before them rather
    // than opening an empty one.
    if (body === '' && segments.length > 0) {
      const last = segments[segments.length - 1]!;
      const added = resolve(numbers, retrieved).filter((p) => !last.support.includes(p));
      segments[segments.length - 1] = {
        text: last.text,
        support: [...last.support, ...added],
      };
      continue;
    }
    if (body === '') {
      throw new GateError('ungrounded', 'the answer opens with a citation and no claim');
    }
    segments.push({ text: body, support: resolve(numbers, retrieved) });
  }

  const trailing = text.slice(cursor).replace(TRIM_LEAD, '').trim();
  // Anything after the last marker is a claim nobody sourced. This is the
  // common failure: a model cites its way through an answer and then adds a
  // closing sentence of its own.
  if (/\p{L}/u.test(trailing)) {
    throw new GateError(
      'ungrounded',
      `the answer ends with an uncited claim: ${trailing.slice(0, 60)}`,
    );
  }
  if (segments.length === 0) {
    throw new GateError('ungrounded', 'the answer cites nothing');
  }

  for (const segment of segments) {
    // A passage plus the way it is cited. The article number a claim names is
    // in the locator, not in the article's own words, so "Article 17" has to
    // be checkable against "art. 17" as well as against the text.
    const sources = segment.support.map(checkable);
    const inSource = (needle: string) => sources.some((s) => s.includes(needle));

    QUOTED.lastIndex = 0;
    let quote: RegExpExecArray | null;
    while ((quote = QUOTED.exec(segment.text)) !== null) {
      if (!inSource(loose(quote[1]!))) {
        throw new GateError(
          'ungrounded',
          `quoted words are not in the passage cited: ${quote[1]!.slice(0, 60)}`,
        );
      }
    }

    // Every number in a claim must be in the passage it cites. Dates, article
    // numbers, section numbers and the length of a sentence in prison are the
    // facts a visitor is most likely to repeat and least able to check, and
    // they are the ones a model most readily moves from one passage to
    // another. This is the check that catches the punishment set by an Act
    // being attributed to an Article that sets none.
    for (const number of digits(segment.text)) {
      if (!sources.some((s) => s.includes(number))) {
        throw new GateError(
          'ungrounded',
          `the claim gives the number ${number}, which is not in the passage it cites`,
        );
      }
    }

    // And a claim must share some vocabulary with what it rests on. A faithful
    // reading of a passage almost always repeats one of its longer words; a
    // sentence that shares none of them is about something else.
    const words = contentWords(segment.text);
    if (words.length > 0 && !words.some(inSource)) {
      throw new GateError(
        'ungrounded',
        `no word of the claim appears in the passage it cites: ${segment.text.slice(0, 60)}`,
      );
    }
  }

  return {
    kind: 'answer',
    question,
    language: segments[0]!.support[0]!.language,
    segments,
    engine,
    cached,
  };
}

function resolve(
  numbers: readonly number[],
  retrieved: readonly CitedPassage[],
): readonly CitedPassage[] {
  const support: CitedPassage[] = [];
  for (const n of numbers) {
    const passage = retrieved[n - 1];
    if (passage === undefined) {
      throw new GateError(
        'ungrounded',
        `the answer cites passage ${String(n)}, which was not given to it`,
      );
    }
    if (!support.includes(passage)) support.push(passage);
  }
  if (support.length === 0) {
    throw new GateError('ungrounded', 'a claim was marked with no passage');
  }
  return support;
}

export function refusal(input: {
  question: string;
  because: RefusalReason;
  nearest?: readonly CitedPassage[];
  engine: string;
}): Refusal {
  return {
    kind: 'refusal',
    question: input.question,
    because: input.because,
    nearest: input.nearest ?? [],
    engine: input.engine,
  };
}

/** The wire and cache form: raw chunks, so nothing is trusted on the way back in. */
export interface RawReply {
  kind?: unknown;
  question?: unknown;
  language?: unknown;
  engine?: unknown;
  cached?: unknown;
  because?: unknown;
  segments?: unknown;
  nearest?: unknown;
}

function str(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CitationError(`assistant: ${what} must be a non-empty string`);
  }
  return value;
}

/**
 * Reads a reply that arrived from Core or off the device's cache.
 *
 * This runs the same rule as the gate, from the other direction: a segment
 * without support is refused here rather than rendered. The kiosk therefore
 * cannot display an uncited claim even if something upstream would let it.
 */
export function readReply(raw: unknown): AssistantReply {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CitationError('assistant: a reply must be an object');
  }
  const r = raw as RawReply;
  const question = str(r.question, 'question');
  const engine = str(r.engine, 'engine');

  if (r.kind === 'refusal') {
    const because = r.because;
    if (!(REFUSALS as readonly unknown[]).includes(because)) {
      throw new CitationError(`assistant: unknown refusal ${String(because)}`);
    }
    return {
      kind: 'refusal',
      question,
      because: because as RefusalReason,
      nearest: passages(r.nearest),
      engine,
    };
  }

  if (!Array.isArray(r.segments) || r.segments.length === 0) {
    throw new CitationError('assistant: an answer must have segments');
  }
  const segments = r.segments.map((rawSegment, i): AnswerSegment => {
    if (typeof rawSegment !== 'object' || rawSegment === null) {
      throw new CitationError(`assistant: segment ${String(i)} is not an object`);
    }
    const s = rawSegment as { text?: unknown; support?: unknown };
    const support = passages(s.support);
    if (support.length === 0) {
      throw new CitationError(`assistant: segment ${String(i)} cites nothing`);
    }
    return { text: str(s.text, `segment ${String(i)}`), support };
  });

  return {
    kind: 'answer',
    question,
    language: str(r.language, 'language'),
    segments,
    engine,
    cached: r.cached === true,
  };
}

function passages(raw: unknown): readonly CitedPassage[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => readChunk(row as RawChunk));
}

/** The form that goes on the wire and into the cache file. */
export function writeReply(reply: AssistantReply): Record<string, unknown> {
  const chunk = (p: CitedPassage) => ({
    corpus: p.citation.corpus,
    workId: p.citation.workId,
    pageId: p.citation.pageId,
    locator: p.citation.locator,
    language: p.language,
    speaker: p.speaker,
    text: p.text,
  });
  if (reply.kind === 'refusal') {
    return {
      kind: 'refusal',
      question: reply.question,
      because: reply.because,
      nearest: reply.nearest.map(chunk),
      engine: reply.engine,
    };
  }
  return {
    kind: 'answer',
    question: reply.question,
    language: reply.language,
    engine: reply.engine,
    cached: reply.cached,
    segments: reply.segments.map((s) => ({
      text: s.text,
      support: s.support.map(chunk),
    })),
  };
}

/**
 * The key a cached answer is stored under.
 *
 * Normalised hard, because a visitor typing the demo question will not type it
 * the way the build script did. It is a lookup for a small set of prepared
 * questions, not a similarity search: a near miss must miss, so the kiosk says
 * it cannot answer rather than answering a different question.
 */
export function questionKey(question: string): string {
  return loose(question).replace(/\s+/g, ' ');
}
