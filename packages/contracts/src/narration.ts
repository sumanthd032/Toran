/**
 * Narration: a passage of the archive, read aloud.
 *
 * The rule from CLAUDE.md section 12 applies to sound exactly as it applies to
 * text. A clip cannot be constructed without the citation of the passage it
 * reads, so the Audio Booth cannot play anything it is unable to attribute, and
 * a visitor listening with the screen ignored still hears where the words came
 * from. A clip in a language other than the one printed is marked
 * `translatedFrom`, so narration of a translation can never be presented as
 * narration of the source.
 *
 * `engine` names what produced the sound. Every clip in the archive today is
 * synthetic, from Bhashini, and says so. An archival recording of a human voice
 * would carry its own provenance here instead, and D-126 records why the
 * archive holds none yet.
 */

import { citedPassage, CitationError, type CitedPassage } from './citation.ts';
import { readChunk } from './ingest.ts';

export type Voice = 'female' | 'male';

export interface NarrationClip {
  readonly id: string;
  /** BCP-47 code of the words actually spoken. */
  readonly language: string;
  readonly voice: Voice;
  /** Path under the archive's narration directory. */
  readonly file: string;
  /** Who or what produced the sound. Shown on screen, never hidden. */
  readonly engine: string;
  /** The words spoken, carrying the citation of the page they come from. */
  readonly passage: CitedPassage;
  /** Which surface asked for this clip: ambient, timeline. */
  readonly because: string;
}

function str(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CitationError(`narration: ${what} must be a non-empty string`);
  }
  return value;
}

export function readNarrationClip(raw: unknown): NarrationClip {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CitationError('narration: a clip must be an object');
  }
  const c = raw as Record<string, unknown>;
  const voice = c['voice'];
  if (voice !== 'female' && voice !== 'male') {
    throw new CitationError(`narration: unknown voice ${String(voice)}`);
  }
  const cite = c['citation'];
  if (typeof cite !== 'object' || cite === null) {
    throw new CitationError('narration: a clip must carry the citation it reads');
  }
  const source = cite as Record<string, unknown>;
  const spoken = str(c['text'], 'text');
  const language = str(c['language'], 'language');
  const printed = str(source['language'], 'citation.language');

  // Validate against the printed passage first, which is what proves the
  // citation resolves, then re-language it if the clip is a translation.
  const original = readChunk({ ...source, text: spoken });
  const passage =
    language === printed
      ? original
      : citedPassage({
          text: spoken,
          citation: original.citation,
          language,
          translatedFrom: printed,
          speaker: original.speaker,
        });

  return {
    id: str(c['id'], 'id'),
    language,
    voice,
    file: str(c['file'], 'file'),
    engine: str(c['source'], 'source'),
    passage,
    because: typeof c['because'] === 'string' ? c['because'] : 'archive',
  };
}

export function readNarration(raw: unknown): readonly NarrationClip[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(readNarrationClip);
}

/** Clips for one passage, keyed by language then voice. */
export function clipsFor(
  clips: readonly NarrationClip[],
  id: string,
): readonly NarrationClip[] {
  return clips.filter((c) => c.id === id);
}

/**
 * A spoken interface label.
 *
 * Deliberately not a NarrationClip. An archival clip cannot exist without the
 * citation of the passage it reads; an interface label cites nothing, because
 * it is not from the archive. Keeping them as separate types means a spoken
 * button can never be handed to a surface that expects a cited reading, and a
 * reading can never be played as though it were chrome.
 */
export interface UiClip {
  /** The i18n message key this speaks. */
  readonly key: string;
  readonly language: string;
  readonly voice: Voice;
  readonly file: string;
  readonly engine: string;
  /** The words spoken, for the live region that accompanies them. */
  readonly text: string;
}

export function readUiClip(raw: unknown): UiClip {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CitationError('narration: a spoken label must be an object');
  }
  const c = raw as Record<string, unknown>;
  const voice = c['voice'];
  if (voice !== 'female' && voice !== 'male') {
    throw new CitationError(`narration: unknown voice ${String(voice)}`);
  }
  return {
    key: str(c['key'], 'key'),
    language: str(c['language'], 'language'),
    voice,
    file: str(c['file'], 'file'),
    engine: str(c['source'], 'source'),
    text: str(c['text'], 'text'),
  };
}

export function readUiNarration(raw: unknown): readonly UiClip[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(readUiClip);
}

/** The spoken label for a key in a language, preferring a voice. */
export function spokenLabel(
  clips: readonly UiClip[],
  key: string,
  language: string,
  voice: Voice,
): UiClip | null {
  const matching = clips.filter((c) => c.key === key && c.language === language);
  if (matching.length === 0) return null;
  return matching.find((c) => c.voice === voice) ?? matching[0] ?? null;
}
