'use client';

/**
 * The Audio Booth, device 8. PROJECT.md 7.5, D-008.
 *
 * Any passage of the archive, read aloud, in the visitor's language. The
 * transport is in the reach zone where a standing hand already is, the words
 * being spoken are set large enough to follow from a step back, and the
 * citation stays on screen for the whole clip, so a visitor who is listening
 * rather than reading still knows which volume and page they are hearing.
 *
 * Two things this screen refuses to do. It never presents narration as
 * anybody's voice: every clip says which engine produced it, and a clip of a
 * translation says what it was translated from. And it never pretends to hold
 * a recording it does not have; with an empty cache it says so plainly rather
 * than showing a dead transport.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NarrationClip } from '@toran/contracts';
import { narration as loadNarration, narrationUrl } from '@/archive/client';
import { Button, Citation, Rule } from '@/design/primitives';
import { useI18n } from '@/i18n';
import { ICON, Icon } from '../../icons';
import { useChannelNav } from '../../nav';
import { ReachTools } from '../../reach';
import {
  chooseClip,
  clock,
  DEFAULT_SPEED,
  languagesOf,
  nextSpeed,
  tracksOf,
  voicesOf,
  type Speed,
  type Track,
  type Voice,
} from './model';
import styles from './audio.module.css';

export function AudioBooth() {
  const { t, lang } = useI18n();
  const [clips, setClips] = useState<readonly NarrationClip[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [index, setIndex] = useState(0);
  const [voice, setVoice] = useState<Voice>('female');
  const [speed, setSpeed] = useState<Speed>(DEFAULT_SPEED);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const found = await loadNarration();
        if (live) setClips(found);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const tracks = useMemo(() => tracksOf(clips ?? []), [clips]);
  const track: Track | null = tracks[index] ?? null;
  const chosen = track === null ? null : chooseClip(track, lang, voice);
  const clip = chosen?.kind === 'none' ? null : (chosen?.clip ?? null);

  // Back leaves the booth from the first passage and steps back through the
  // list from any other, which is what Back means in every other room.
  useChannelNav({
    back: () => {
      if (index === 0) return false;
      setIndex((i) => i - 1);
      return true;
    },
    home: () => setIndex(0),
    forward: () => {
      if (index >= tracks.length - 1) return false;
      setIndex((i) => i + 1);
      return true;
    },
    canForward: index < tracks.length - 1,
  });

  // A new clip starts from its beginning, stopped. Nothing plays because a
  // visitor walked past and the list moved under them.
  useEffect(() => {
    setPlaying(false);
    setAt(0);
    const element = audio.current;
    if (element !== null) element.pause();
  }, [clip?.file]);

  useEffect(() => {
    const element = audio.current;
    if (element !== null) element.playbackRate = speed;
  }, [speed, clip?.file]);

  const toggle = useCallback(() => {
    const element = audio.current;
    if (element === null) return;
    if (element.paused) {
      element.playbackRate = speed;
      void element
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
    } else {
      element.pause();
      setPlaying(false);
    }
  }, [speed]);

  const restart = useCallback(() => {
    const element = audio.current;
    if (element === null) return;
    element.currentTime = 0;
    setAt(0);
  }, []);

  if (failed) {
    return <p className={styles.plain}>{t('audio.failed')}</p>;
  }
  if (clips === null) {
    return <p className={styles.plain}>{t('kiosk.loading')}</p>;
  }

  if (tracks.length === 0) {
    // The honest empty state. Everything needed to understand it is here:
    // what is missing, why, and what the archive does not claim to hold.
    return (
      <div className={styles.empty} data-testid="audio-empty">
        <p className={styles.emptyLead}>{t('audio.empty.lead')}</p>
        <Rule />
        <p className={styles.emptyNote}>{t('audio.empty.why')}</p>
        <p className={styles.emptyNote}>{t('audio.recordings.none')}</p>
      </div>
    );
  }

  const spoken = clip?.passage;

  return (
    <div className={styles.root} data-testid="audio">
      <ol className={styles.list} aria-label={t('audio.passages')}>
        {tracks.map((item, i) => (
          <li key={item.id}>
            <button
              type="button"
              className={styles.item}
              aria-current={i === index}
              data-selected={i === index}
              onClick={() => setIndex(i)}
            >
              <span className={styles.itemText}>{item.printed.passage.text}</span>
              <span className={styles.itemMeta}>
                {languagesOf(item).length} {t('audio.languages')}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className={styles.stage}>
        {spoken === undefined ? (
          <p className={styles.plain}>{t('audio.none', { language: lang })}</p>
        ) : (
          <>
            <p className={styles.spoken} lang={spoken.language} data-testid="audio-text">
              {spoken.text}
            </p>
            <Citation
              citation={spoken.citation}
              block
              translatedFrom={spoken.translatedFrom}
            />
            <p className={styles.engine} data-testid="audio-engine">
              {t('audio.engine', { engine: clip!.engine })}
            </p>
            {chosen?.kind === 'printed' ? (
              <p className={styles.fallback} data-testid="audio-fallback">
                {t('audio.notInYourLanguage', { language: chosen.wanted })}
              </p>
            ) : null}
            {/* Not hidden behind a play button: a visitor should know what they
                are about to hear is a machine reading before they hear it. */}
            <audio
              ref={audio}
              src={narrationUrl(clip!.file)}
              preload="metadata"
              onLoadedMetadata={(e) => setLength(e.currentTarget.duration)}
              onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
              onEnded={() => setPlaying(false)}
            />
          </>
        )}
      </div>

      <ReachTools>
        <Button
          variant="primary"
          icon={<Icon d={playing ? ICON.pause : ICON.play} />}
          aria-label={playing ? t('audio.pause') : t('audio.play')}
          disabled={clip === null}
          onClick={toggle}
          data-testid="audio-play"
        >
          {playing ? t('audio.pause') : t('audio.play')}
        </Button>
        <Button
          variant="secondary"
          icon={<Icon d={ICON.replay} />}
          aria-label={t('audio.restart')}
          disabled={clip === null}
          onClick={restart}
        />
        <span className={styles.clock} aria-hidden="true">
          {clock(at)} / {clock(length)}
        </span>
        {track !== null && voicesOf(track, clip?.language ?? lang).length > 1 ? (
          <Button
            variant="secondary"
            icon={<Icon d={ICON.voice} />}
            aria-label={t(voice === 'female' ? 'audio.voice.female' : 'audio.voice.male')}
            onClick={() => setVoice((v) => (v === 'female' ? 'male' : 'female'))}
            data-testid="audio-voice"
          >
            {t(voice === 'female' ? 'audio.voice.female' : 'audio.voice.male')}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          icon={<Icon d={ICON.speed} />}
          aria-label={t('audio.speed', { speed: String(speed) })}
          onClick={() => setSpeed(nextSpeed)}
          data-testid="audio-speed"
        >
          {t('audio.speed', { speed: String(speed) })}
        </Button>
      </ReachTools>
    </div>
  );
}
