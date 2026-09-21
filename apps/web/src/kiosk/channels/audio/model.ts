/**
 * What the Audio Booth can play, and in which voice.
 *
 * Pure, so it is tested in Node without a browser or an audio device. The
 * component owns the element; this owns the choosing.
 */

import type { NarrationClip } from '@toran/contracts';

export type Voice = 'female' | 'male';

/** Playback speeds. Slow enough for a visitor who needs it, never so fast it slurs. */
export const SPEEDS = [0.75, 1, 1.25, 1.5] as const;
export type Speed = (typeof SPEEDS)[number];

export const DEFAULT_SPEED: Speed = 1;

export interface Track {
  /** The passage id. One track, many clips: a language and a voice each. */
  readonly id: string;
  /** The passage as printed, in the language of the corpus. Always present. */
  readonly printed: NarrationClip;
  readonly clips: readonly NarrationClip[];
}

/**
 * Groups clips into tracks, keeping only passages the archive can attribute.
 *
 * A track needs a clip in the language its page was printed in, because that
 * is the reading a citation belongs to. A translation with no original behind
 * it would be a recording nobody could check, so it is dropped rather than
 * offered.
 */
export function tracksOf(clips: readonly NarrationClip[]): readonly Track[] {
  const byId = new Map<string, NarrationClip[]>();
  for (const clip of clips) {
    const list = byId.get(clip.id);
    if (list === undefined) byId.set(clip.id, [clip]);
    else list.push(clip);
  }
  const tracks: Track[] = [];
  for (const [id, list] of byId) {
    const printed = list.find((c) => c.passage.translatedFrom === null);
    if (printed === undefined) continue;
    tracks.push({ id, printed, clips: list });
  }
  return tracks.sort((a, b) => a.id.localeCompare(b.id));
}

export type Chosen =
  | { readonly kind: 'exact'; readonly clip: NarrationClip }
  /** No clip in the visitor's language; this is the printed one, and the screen says so. */
  | { readonly kind: 'printed'; readonly clip: NarrationClip; readonly wanted: string }
  | { readonly kind: 'none'; readonly wanted: string };

/**
 * The clip to play for a visitor reading `language`, preferring `voice`.
 *
 * Falling back to the printed language is deliberate and is announced. Silence
 * would leave an audio-first visitor with nothing, and playing a Marathi voice
 * over English words would be worse than either.
 */
export function chooseClip(track: Track, language: string, voice: Voice): Chosen {
  const wanted = track.clips.filter((c) => c.language === language);
  if (wanted.length > 0) {
    return { kind: 'exact', clip: wanted.find((c) => c.voice === voice) ?? wanted[0]! };
  }
  if (track.printed.language === language) {
    return { kind: 'exact', clip: track.printed };
  }
  const printed = track.clips.filter((c) => c.language === track.printed.language);
  if (printed.length > 0) {
    return {
      kind: 'printed',
      clip: printed.find((c) => c.voice === voice) ?? printed[0]!,
      wanted: language,
    };
  }
  return { kind: 'none', wanted: language };
}

/** Which languages this track has been narrated into. */
export const languagesOf = (track: Track): readonly string[] =>
  [...new Set(track.clips.map((c) => c.language))].sort();

/** Which voices exist for a track in a language, so a control is not offered uselessly. */
export function voicesOf(track: Track, language: string): readonly Voice[] {
  const voices = track.clips.filter((c) => c.language === language).map((c) => c.voice);
  return [...new Set(voices)].sort();
}

export const nextSpeed = (speed: Speed): Speed =>
  SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;

/** mm:ss, for a transport a visitor reads at arm's length. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
