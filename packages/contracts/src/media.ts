/**
 * Recordings, and the transcripts that make them searchable.
 *
 * CLAUDE.md section 12 names TRANSCRIPT_CUE beside CHUNK and EVIDENCE: a line
 * of a transcript has to resolve to somewhere a viewer can go, exactly as a
 * quoted passage resolves to a page. For a film that place is a second, so a
 * cue is a CitedPassage whose locator is a timecode. A cue cannot be built
 * without one, which means the AV Archive can no more show an unplaceable line
 * of transcript than the Reading Room can show an unplaceable paragraph.
 *
 * The provenance here is heavier than for a printed page, and deliberately so.
 * A book in this archive was published by a ministry; a film was made by
 * somebody, licensed by somebody, and mirrored by somebody else, and CC BY
 * requires the attribution to travel with it. So a recording carries its
 * licence, its attribution line and where it came from, and the player prints
 * them. D-126 is the reason this list is two items long.
 */

import { CitationError, type CitedPassage } from './citation.ts';
import { readChunk } from './ingest.ts';

export type RecordingKind = 'documentary' | 'lecture' | 'interview' | 'newsreel';

const KINDS: readonly RecordingKind[] = [
  'documentary',
  'lecture',
  'interview',
  'newsreel',
];

/** One line of a transcript, at the second it is spoken. */
export interface TranscriptCue {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly passage: CitedPassage;
}

export interface Recording {
  readonly id: string;
  readonly title: string;
  readonly series: string | null;
  readonly episode: number | null;
  /** BCP-47 of what is spoken, which is not always the archive's language. */
  readonly language: string;
  readonly kind: RecordingKind;
  readonly durationSeconds: number;
  /** Path under the archive's media directory. */
  readonly file: string;
  /**
   * Where the film plays from when this device does not carry the file.
   * Null when nothing else serves it, and the room then says so rather than
   * showing a player that cannot start.
   */
  readonly stream: string | null;
  readonly creator: string;
  readonly publisher: string;
  readonly year: number;
  /** The licence URL, so a curator can check it rather than trust a label. */
  readonly licence: string;
  readonly licenceName: string;
  /** Printed under the player. CC BY requires it to travel with the work. */
  readonly attribution: string;
  readonly source: string;
  /** Why the archive holds this. Shown, because a visitor deserves the reason. */
  readonly whyHere: string;
  /** What produced the transcript. Named on screen, as narration is. D-127. */
  readonly transcribedBy: string | null;
  readonly cues: readonly TranscriptCue[];
}

function str(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CitationError(`media: ${what} must be a non-empty string`);
  }
  return value;
}

function num(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CitationError(`media: ${what} must be a number`);
  }
  return value;
}

const optional = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

export function readRecording(raw: unknown): Recording {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CitationError('media: a recording must be an object');
  }
  const r = raw as Record<string, unknown>;
  const id = str(r['id'], 'id');
  const kind = r['kind'];
  if (!KINDS.includes(kind as RecordingKind)) {
    throw new CitationError(`media: unknown kind ${String(kind)}`);
  }
  const language = str(r['language'], 'language');

  // A recording without its licence and its attribution is one the kiosk
  // could not lawfully show, so it is refused here rather than shown bare.
  const licence = str(r['licence'], 'licence');
  const attribution = str(r['attribution'], 'attribution');

  const rawCues = Array.isArray(r['cues']) ? r['cues'] : [];
  const cues = rawCues.map((rawCue, i): TranscriptCue => {
    if (typeof rawCue !== 'object' || rawCue === null) {
      throw new CitationError(`media: cue ${String(i)} is not an object`);
    }
    const c = rawCue as Record<string, unknown>;
    const from = num(c['from'], `cue ${String(i)} from`);
    const to = num(c['to'], `cue ${String(i)} to`);
    return {
      id: `${id}#${String(i)}`,
      from,
      to,
      // Through the citation contract, so a cue with no placeable moment is
      // refused rather than rendered as a line nobody can find.
      passage: readChunk({
        corpus: 'media',
        workId: id,
        pageId: `${id}-c${String(i).padStart(4, '0')}`,
        locator: { kind: 'timecode', recording: id, from, to },
        language: typeof c['language'] === 'string' ? c['language'] : language,
        speaker: c['speaker'] ?? null,
        text: c['text'],
      }),
    };
  });

  return {
    id,
    title: str(r['title'], 'title'),
    series: optional(r['series']),
    episode: typeof r['episode'] === 'number' ? r['episode'] : null,
    language,
    kind: kind as RecordingKind,
    durationSeconds: num(r['durationSeconds'], 'durationSeconds'),
    file: str(r['file'], 'file'),
    stream: optional(r['stream']),
    creator: str(r['creator'], 'creator'),
    publisher: str(r['publisher'], 'publisher'),
    year: num(r['year'], 'year'),
    licence,
    licenceName: str(r['licenceName'], 'licenceName'),
    attribution,
    source: str(r['source'], 'source'),
    whyHere: str(r['whyHere'], 'whyHere'),
    transcribedBy: optional(r['transcribedBy']),
    cues,
  };
}

export function readRecordings(raw: unknown): readonly Recording[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(readRecording);
}

/**
 * The cue playing at a moment.
 *
 * Binary search, because a 46 minute episode is around a thousand cues and
 * this runs on every timeupdate the browser fires, which is four times a
 * second on a device that has frames to spare for a camera and not for this.
 */
export function cueAt(
  cues: readonly TranscriptCue[],
  seconds: number,
): TranscriptCue | null {
  let low = 0;
  let high = cues.length - 1;
  let found: TranscriptCue | null = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const cue = cues[mid]!;
    if (seconds < cue.from) {
      high = mid - 1;
    } else {
      // At or after this cue's start: remember it and look for a later one
      // that also started. The last such cue is the one playing.
      found = cue;
      low = mid + 1;
    }
  }
  // Past the end of a cue and before the next is silence, not the previous
  // line, so a transcript does not keep a line lit through a long pause.
  return found !== null && seconds <= found.to ? found : null;
}

/** Where to start playing to hear a cue, with a moment of lead-in. */
export const LEAD_IN_SECONDS = 0.4;

export const startOf = (cue: TranscriptCue): number =>
  Math.max(0, cue.from - LEAD_IN_SECONDS);
