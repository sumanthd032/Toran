'use client';

/**
 * The guided tour: the hall, then one room at a time, for someone who has
 * never seen it. D-169.
 *
 * Each step flies to a device and opens it on its screen, set to the left, so
 * the caption stands beside the kiosk rather than over it, and the kiosk
 * stays in use: a visitor on the tour can search, trace a link, turn the
 * years. The caption says what the room is, one thing to try, and, where it
 * is true, what a browser cannot do that the real kiosk does.
 */

import { useEffect, useState } from 'react';
import { useI18n, type MessageKey } from '@/i18n';
import { useTwinState } from './state';
import { tourFraming } from './transition/store';
import styles from './tour.module.css';

interface Step {
  readonly id: string;
  /** The device this step opens, or null for a step about the hall itself. */
  readonly device: string | null;
  /** Whether a browser does something here differently from the real kiosk, and says so. */
  readonly note: boolean;
}

export const TOUR: readonly Step[] = [
  { id: 'hall', device: null, note: true },
  { id: 'welcome', device: 'dev-13', note: true },
  { id: 'reading', device: 'dev-01', note: false },
  { id: 'provenance', device: 'dev-03', note: false },
  { id: 'timeline', device: 'dev-04', note: true },
  { id: 'manuscript', device: 'dev-07', note: false },
  { id: 'audio', device: 'dev-08', note: true },
  { id: 'av', device: 'dev-09', note: false },
  { id: 'assistant', device: 'dev-11', note: true },
  { id: 'panel', device: null, note: false },
];

export function GuidedTour({
  onClose,
  close,
}: {
  /** Ends the tour. */
  onClose: () => void;
  /** Steps back out of an open device, as the Twin's own control does. */
  close: () => void;
}) {
  const { t } = useI18n();
  const { open, phase, openDevice } = useTwinState();
  const [at, setAt] = useState(0);
  const step = TOUR[at]!;

  useEffect(() => {
    tourFraming.set(true);
    return () => tourFraming.set(false);
  }, []);

  // Bring the hall to where the step is: out of one device, into the next.
  useEffect(() => {
    if (phase === 'in' || phase === 'out') return;
    if (phase === 'open' && open !== step.device) {
      close();
      return;
    }
    if (phase === 'hall' && step.device !== null && open === null) {
      const timer = window.setTimeout(() => openDevice(step.device!), 250);
      return () => window.clearTimeout(timer);
    }
  }, [phase, open, step.device, openDevice, close]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const moving = phase === 'in' || phase === 'out';
  const last = at === TOUR.length - 1;

  return (
    <aside
      className={styles.caption}
      aria-live="polite"
      data-testid="guided-tour"
      data-step={step.id}
    >
      <p className={styles.count}>{t('tour.count', { at: at + 1, of: TOUR.length })}</p>
      <h2 className={styles.title}>{t(`tour.${step.id}.title` as MessageKey)}</h2>
      <p className={styles.body}>{t(`tour.${step.id}.body` as MessageKey)}</p>
      <p className={styles.try}>
        <span className={styles.label}>{t('tour.try')}</span>
        {t(`tour.${step.id}.try` as MessageKey)}
      </p>
      {step.note && (
        <p className={styles.note}>{t(`tour.${step.id}.note` as MessageKey)}</p>
      )}
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.button}
          onClick={() => setAt((n) => Math.max(0, n - 1))}
          disabled={at === 0 || moving}
        >
          {t('tour.back')}
        </button>
        {last ? (
          <button
            type="button"
            className={styles.primary}
            onClick={onClose}
            data-testid="tour-finish"
          >
            {t('tour.finish')}
          </button>
        ) : (
          <button
            type="button"
            className={styles.primary}
            onClick={() => setAt((n) => n + 1)}
            disabled={moving}
            data-testid="tour-next"
          >
            {t('tour.next')}
          </button>
        )}
        <button
          type="button"
          className={styles.quiet}
          onClick={onClose}
          data-testid="tour-end"
        >
          {t('tour.end')}
        </button>
      </div>
    </aside>
  );
}
