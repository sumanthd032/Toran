'use client';

/**
 * The AV Archive, devices 9 and 10. PROJECT.md 7.6, R8.
 *
 * The transcript is the primary surface and the picture is secondary, which
 * inverts the usual player. In a hall you cannot hear a film over the room, and
 * a visitor standing for ninety seconds gets more from reading what was said
 * than from watching it silently. So the words are large and on the left, the
 * picture is small and on the right, and tapping a line plays from that second.
 *
 * Searching happens inside the media rather than across it. A phrase lands on
 * the moment it is spoken, and because every cue is in the same index as the
 * books, a question typed in English finds a sentence spoken in Hindi.
 *
 * Every line carries the recording and the timecode it came from, and the
 * attribution sits under the player rather than in a credits screen, because
 * CC BY requires it to travel with the work and because a visitor should know
 * who made what they are watching.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cueAt,
  startOf,
  timecode,
  type Recording,
  type TranscriptCue,
} from '@toran/contracts';
import { mediaUrl, recordings as loadRecordings } from '@/archive/client';
import { sharedSearch } from '@/search/shared';
import { Button, Citation, Rule } from '@/design/primitives';
import { useI18n } from '@/i18n';
import { useAnnounce } from '../../announce';
import { ICON, Icon } from '../../icons';
import { useChannelNav } from '../../nav';
import { ReachTools } from '../../reach';
import { cuesAmong, findLiteral, merge, OVERFETCH, type Match } from './model';
import styles from './av.module.css';

export function AvArchive() {
  const { t, lang } = useI18n();
  const announce = useAnnounce();
  const [all, setAll] = useState<readonly Recording[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState(0);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<readonly Match[] | null>(null);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);
  const transcript = useRef<HTMLOListElement | null>(null);
  // Recordings this device does not carry. A kiosk carries all of them; a
  // public web deployment carries none, because Cloudflare Pages refuses a
  // file over 25 MiB and these are 100 MB and 115 MB. The player finds out by
  // failing to load one and falls back to where the archive got it from.
  const [remote, setRemote] = useState<ReadonlySet<string>>(new Set());
  // A cue waiting for a recording to load. Setting currentTime on a video
  // whose source has just changed does nothing, because there is no timeline
  // to seek in yet, so the seek is held until the browser says there is one.
  const pending = useRef<TranscriptCue | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const found = await loadRecordings();
        if (live) setAll(found);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const recording = all?.[chosen] ?? null;
  const current = useMemo(
    () => (recording === null ? null : cueAt(recording.cues, at)),
    [recording, at],
  );

  const seek = useCallback((cue: TranscriptCue) => {
    const element = video.current;
    if (element === null) return;
    element.currentTime = startOf(cue);
    void element.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    );
  }, []);

  const open = useCallback(
    (match: Match) => {
      const index = all?.indexOf(match.recording) ?? -1;
      if (index === -1) return;
      // Always held, never seeked here. The results list replaces the player,
      // so leaving them unmounts the video element and mounts a new one: even
      // for the recording already chosen there is no timeline to seek in until
      // the new element has its metadata.
      pending.current = match.cue;
      setMatches(null);
      setQuery('');
      setChosen(index);
    },
    [all],
  );

  // Literal first, so a visitor quoting what they just heard gets an answer in
  // the same breath. The index joins in when it has finished loading.
  const search = useCallback(
    async (text: string) => {
      if (all === null) return;
      const trimmed = text.trim();
      if (trimmed.length < 2) {
        setMatches(null);
        return;
      }
      const literal = findLiteral(all, trimmed);
      setMatches(literal);
      try {
        const client = sharedSearch();
        await client.ready;
        const response = await client.search(trimmed, OVERFETCH);
        setMatches(
          merge(
            literal,
            cuesAmong(
              all,
              response.hits.map((h) => h.passage),
            ),
          ),
        );
      } catch {
        // No engine, or it failed. The literal matches stand, and they are
        // still real: a visitor quoting what they heard gets their moment.
      }
    },
    [all],
  );

  // The transcript follows the film without the visitor scrolling it.
  useEffect(() => {
    if (current === null || transcript.current === null) return;
    const line = transcript.current.querySelector(`[data-cue="${current.id}"]`);
    line?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [current]);

  useChannelNav({
    back: () => {
      if (matches !== null) {
        setMatches(null);
        setQuery('');
        return true;
      }
      return false;
    },
    home: () => {
      setMatches(null);
      setQuery('');
      setChosen(0);
    },
    forward: () => false,
    canForward: false,
  });

  const spoken = current?.passage.text;
  useEffect(() => {
    if (spoken !== undefined) announce(spoken);
  }, [announce, spoken]);

  if (failed) return <p className={styles.plain}>{t('av.failed')}</p>;
  if (all === null) return <p className={styles.plain}>{t('kiosk.loading')}</p>;

  if (all.length === 0 || recording === null) {
    // The honest empty state, as the Audio Booth has. What is missing, and why.
    return (
      <div className={styles.empty} data-testid="av-empty">
        <p className={styles.emptyLead}>{t('av.empty.lead')}</p>
        <Rule />
        <p className={styles.emptyNote}>{t('av.empty.why')}</p>
      </div>
    );
  }

  return (
    <div className={styles.root} data-testid="av">
      {matches === null ? (
        <Player
          recording={recording}
          all={all}
          at={at}
          onChoose={(index) => {
            setMatches(null);
            setChosen(index);
            setPlaying(false);
            setAt(0);
          }}
          current={current}
          videoRef={video}
          transcriptRef={transcript}
          onTime={setAt}
          onEnded={() => setPlaying(false)}
          onSeek={seek}
          src={remote.has(recording.id) ? recording.stream : mediaUrl(recording.file)}
          onMissing={() =>
            setRemote((had) => {
              if (had.has(recording.id)) return had;
              const next = new Set(had);
              next.add(recording.id);
              return next;
            })
          }
          onReady={() => {
            const waiting = pending.current;
            if (waiting === null) return;
            pending.current = null;
            seek(waiting);
          }}
        />
      ) : (
        <Results matches={matches} query={query} onOpen={open} />
      )}

      {/* Two controls, because that is what fits at a kiosk and what a
          standing hand needs. Choosing a recording and reading the clock are
          done beside the picture, where the picture already is. */}
      <ReachTools>
        <form
          className={styles.form}
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            void search(query);
          }}
        >
          <input
            className={styles.query}
            value={query}
            lang={lang}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            aria-label={t('av.search')}
            /* Short, because the box is 156 px between three navigation
               affordances and the language control. The aria-label carries
               the full description for anyone who needs it read out. */
            placeholder={t('av.find')}
            data-testid="av-query"
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button
            type="submit"
            variant="primary"
            icon={<Icon d={ICON.search} />}
            aria-label={t('av.search')}
            disabled={query.trim().length < 2}
            data-testid="av-submit"
          />
        </form>
        <Button
          variant="secondary"
          icon={<Icon d={playing ? ICON.pause : ICON.play} />}
          aria-label={playing ? t('av.pause') : t('av.play')}
          data-testid="av-play"
          onClick={() => {
            const element = video.current;
            if (element === null) return;
            if (element.paused) {
              void element.play().then(
                () => setPlaying(true),
                () => setPlaying(false),
              );
            } else {
              element.pause();
              setPlaying(false);
            }
          }}
        >
          <span className={styles.label}>{playing ? t('av.pause') : t('av.play')}</span>
        </Button>
      </ReachTools>
    </div>
  );
}

function Player({
  recording,
  all,
  at,
  onChoose,
  current,
  videoRef,
  transcriptRef,
  onTime,
  onEnded,
  onSeek,
  onReady,
  src,
  onMissing,
}: {
  recording: Recording;
  all: readonly Recording[];
  at: number;
  onChoose: (index: number) => void;
  current: TranscriptCue | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  transcriptRef: React.RefObject<HTMLOListElement | null>;
  onTime: (seconds: number) => void;
  onEnded: () => void;
  onSeek: (cue: TranscriptCue) => void;
  /** The new recording has a timeline, so a seek held across the change can run. */
  onReady: () => void;
  /** Null when the film is neither on this device nor served anywhere else. */
  src: string | null;
  /** This device does not carry the file. Try where the archive got it from. */
  onMissing: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.stage}>
      <ol
        className={styles.transcript}
        ref={transcriptRef}
        aria-label={t('av.transcript')}
        data-testid="av-transcript"
      >
        {recording.cues.map((cue) => (
          <li key={cue.id} data-cue={cue.id}>
            <button
              type="button"
              className={styles.cue}
              data-current={cue.id === current?.id}
              aria-current={cue.id === current?.id}
              onClick={() => onSeek(cue)}
              data-testid="av-cue"
            >
              <span className={styles.cueTime} aria-hidden="true">
                {timecode(cue.from)}
              </span>
              <span className={styles.cueText} lang={cue.passage.language}>
                {cue.passage.text}
              </span>
            </button>
          </li>
        ))}
        {recording.cues.length === 0 ? (
          <li className={styles.noTranscript} data-testid="av-no-transcript">
            {t('av.noTranscript')}
          </li>
        ) : null}
      </ol>

      <aside className={styles.side}>
        {src === null ? (
          <p className={styles.plain} data-testid="av-unplayable">
            {t('av.notHere')}
          </p>
        ) : (
          <video
            ref={videoRef}
            className={styles.video}
            src={src}
            preload="metadata"
            playsInline
            controls={false}
            onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
            onLoadedMetadata={onReady}
            onError={onMissing}
            onEnded={onEnded}
            data-testid="av-video"
          />
        )}
        <p className={styles.clock} aria-hidden="true">
          {timecode(at)} / {timecode(recording.durationSeconds)}
        </p>
        <h2 className={styles.title}>{recording.title}</h2>
        {/* What else is in this room. The one playing is the heading above,
            so listing it again would be a control that does nothing. */}
        {all.length > 1 ? (
          <ul className={styles.chooser} aria-label={t('av.recordings')}>
            {all.map((item, i) =>
              item.id === recording.id ? null : (
                <li key={item.id}>
                  <button
                    type="button"
                    className={styles.choose}
                    data-testid="av-choose"
                    onClick={() => onChoose(i)}
                  >
                    {t('av.alsoHere', { title: item.title })}
                  </button>
                </li>
              ),
            )}
          </ul>
        ) : null}
        {current === null ? null : <Citation citation={current.passage.citation} block />}
        <p className={styles.why}>{recording.whyHere}</p>
        <Rule />
        {/* CC BY requires the attribution to travel with the work, and a
            visitor should know who made what they are watching. Not a credits
            screen, not a tooltip: under the picture, always. */}
        <p className={styles.attribution} data-testid="av-attribution">
          {recording.attribution}
        </p>
        <p className={styles.licence} data-testid="av-licence">
          {t('av.licence', { licence: recording.licenceName })}
        </p>
        {recording.transcribedBy === null ? null : (
          <p className={styles.engine} data-testid="av-engine">
            {t('av.transcribedBy', { engine: recording.transcribedBy })}
          </p>
        )}
      </aside>
    </div>
  );
}

function Results({
  matches,
  query,
  onOpen,
}: {
  matches: readonly Match[];
  query: string;
  onOpen: (match: Match) => void;
}) {
  const { t } = useI18n();
  if (matches.length === 0) {
    return (
      <div className={styles.stage}>
        <p className={styles.plain} data-testid="av-nothing">
          {t('av.nothing', { query })}
        </p>
      </div>
    );
  }
  return (
    <ol className={styles.results} aria-label={t('av.results')} data-testid="av-results">
      {matches.map((match) => (
        <li key={match.cue.id}>
          <button
            type="button"
            className={styles.result}
            onClick={() => onOpen(match)}
            data-testid="av-result"
            data-how={match.how}
          >
            <span className={styles.resultText} lang={match.cue.passage.language}>
              {match.cue.passage.text}
            </span>
            <span className={styles.resultMeta}>
              {match.recording.title} · {timecode(match.cue.from)} ·{' '}
              {t(match.how === 'literal' ? 'av.foundWords' : 'av.foundMeaning')}
            </span>
          </button>
          <Citation citation={match.cue.passage.citation} block />
        </li>
      ))}
    </ol>
  );
}
