'use client';

/**
 * What the kiosk says when a visitor is not reading it.
 *
 * Two mechanisms, because a kiosk has two kinds of listener. A live region
 * carries every announcement to assistive technology, which is what a visitor
 * arriving with their own screen reader uses. Audio-first mode adds the
 * kiosk's own voice: a cached spoken label, fetched once from Bhashini and
 * stored on the device, so a memorial hall with no network still speaks.
 *
 * The live region is always on, for everyone. Audio-first only adds sound. A
 * visitor who has asked for audio and got silence would have no way of knowing
 * whether the kiosk heard them, so the announcement always happens somewhere
 * even when no clip exists.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { spokenLabel, type UiClip } from '@toran/contracts';
import { narrationUrl, spokenInterface } from '@/archive/client';
import { useI18n, type MessageKey } from '@/i18n';
import styles from './kiosk.module.css';

export interface AnnounceOptions {
  /**
   * The message key, when the announcement is an interface label. Audio-first
   * mode can then speak it from the cache. Without a key it stays text only.
   */
  readonly key?: MessageKey;
  /** Interrupt rather than wait. For a state change a visitor must not miss. */
  readonly urgent?: boolean;
}

type Announce = (text: string, options?: AnnounceOptions) => void;

const Context = createContext<Announce | null>(null);

export function AnnounceProvider({
  audioFirst,
  voice = 'female',
  children,
}: {
  audioFirst: boolean;
  voice?: 'female' | 'male';
  children: ReactNode;
}) {
  const { lang } = useI18n();
  const [polite, setPolite] = useState('');
  const [urgent, setUrgent] = useState('');
  const [clips, setClips] = useState<readonly UiClip[]>([]);
  const player = useRef<HTMLAudioElement | null>(null);

  // Only audio-first needs the labels, so a kiosk nobody asked to speak does
  // not fetch them.
  useEffect(() => {
    if (!audioFirst) return;
    let live = true;
    void spokenInterface()
      .then((found) => {
        if (live) setClips(found);
      })
      .catch(() => {
        if (live) setClips([]);
      });
    return () => {
      live = false;
    };
  }, [audioFirst]);

  const announce = useCallback<Announce>(
    (text, options) => {
      // Re-announce the same words by breaking the string, or a live region
      // stays silent when a visitor repeats an action.
      const marked = `${text}​`.repeat(1);
      if (options?.urgent === true) setUrgent((was) => (was === marked ? text : marked));
      else setPolite((was) => (was === marked ? text : marked));

      if (!audioFirst || options?.key === undefined) return;
      const clip = spokenLabel(clips, options.key, lang, voice);
      if (clip === null) return;
      const element = player.current;
      if (element === null) return;
      element.src = narrationUrl(clip.file);
      void element.play().catch(() => {
        // A browser that has not had a gesture yet refuses to play. The live
        // region already carried the words, so this is not worth surfacing.
      });
    },
    [audioFirst, clips, lang, voice],
  );

  const value = useMemo(() => announce, [announce]);

  return (
    <Context.Provider value={value}>
      {children}
      <div className={styles.announce} aria-live="polite" role="status">
        {polite}
      </div>
      <div className={styles.announce} aria-live="assertive" role="alert">
        {urgent}
      </div>
      {audioFirst ? (
        <audio ref={player} preload="none" data-testid="kiosk-speaks" />
      ) : null}
    </Context.Provider>
  );
}

/**
 * Announce something. Safe outside a provider, where it does nothing, so a
 * channel rendered on its own in a test does not have to build one.
 */
export function useAnnounce(): Announce {
  const announce = useContext(Context);
  return useMemo(() => announce ?? (() => undefined), [announce]);
}
