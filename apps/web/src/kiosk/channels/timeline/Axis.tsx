'use client';

/**
 * The time axis, dragged sideways at waist height (PROJECT.md 7.3).
 *
 * A rail of years from 1891 to 1956, longer than the wall, with a marker on
 * every year that holds an event. Every finger is followed on its own: the
 * first to move drags the rail, and any other can open a year at the same
 * moment, so four people can each open one without waiting for the others.
 * Opening happens on lift, and only if the finger did not travel, so a drag
 * that starts on a marker does not open it.
 *
 * Browsers turn a single tap into a click but not four taps at once, which is
 * why this reads pointer events rather than clicks. A click with no pointer
 * behind it, from a keyboard or a switch, still opens a year.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import { useTouchFeedback } from '@/design/feedback/useTouchFeedback';
import { useI18n } from '@/i18n';
import { centreOn, clampOffset, DRAG_SLOP, formatYear, YEARS_IN_VIEW } from './model';
import styles from './timeline.module.css';

export interface AxisProps {
  readonly first: number;
  readonly last: number;
  /** Years that hold events, with how many. */
  readonly years: ReadonlyMap<number, number>;
  /** Years with a card open on the wall. */
  readonly open: ReadonlySet<number>;
  /** The year the story is telling, when nobody has a card open. */
  readonly featured: number | null;
  /** Wear on a year, 0 to 4, from the patina count. */
  readonly wear: (year: number) => number;
  readonly onOpen: (year: number) => void;
  /** Any touch on the axis holds the story back. */
  readonly onTouch: () => void;
}

interface Finger {
  readonly x0: number;
  readonly year: number | null;
  moved: boolean;
}

export function Axis({
  first,
  last,
  years,
  open,
  featured,
  wear,
  onOpen,
  onTouch,
}: AxisProps) {
  const { t, lang } = useI18n();
  const feedback = useTouchFeedback('light');
  const viewport = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const [view, setView] = useState({ width: 0, year: 0 });
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fingers = useRef(new Map<number, Finger>());
  const pan = useRef<{ id: number; x0: number; offset0: number } | null>(null);
  const offsetNow = useRef(0);
  useEffect(() => {
    offsetNow.current = offset;
  }, [offset]);

  const count = last - first + 1;
  const trackWidth = count * view.year;

  // A year is at least a fifth wider than its marker, measured as drawn, so
  // neighbouring years never overlap: the marker is 30 mm on a tablet, and on
  // a calibrated wall, where 30 mm is about 20 pixels, as wide as its text.
  // On a panel wide enough, the rail shows about 24 years.
  useEffect(() => {
    const el = viewport.current;
    const marker = probe.current;
    if (el === null || marker === null) return;
    const measure = () => {
      const width = el.clientWidth;
      const min = marker.getBoundingClientRect().width * 1.2;
      setView({ width, year: Math.max(width / YEARS_IN_VIEW, min) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(marker);
    return () => observer.disconnect();
  }, []);

  // The story walks the rail to the year it is telling, unless a hand is on it.
  useEffect(() => {
    if (featured === null || view.year === 0 || pan.current !== null) return;
    setOffset(centreOn(featured, first, view.year, trackWidth, view.width));
  }, [featured, first, view, trackWidth]);

  useEffect(() => {
    setOffset((o) => clampOffset(o, trackWidth, view.width));
  }, [trackWidth, view.width]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    onTouch();
    feedback();
    const marker = (e.target as HTMLElement).closest<HTMLElement>('[data-year]');
    fingers.current.set(e.pointerId, {
      x0: e.clientX,
      year: marker === null ? null : Number(marker.dataset['year']),
      moved: false,
    });
    if (pan.current === null) {
      pan.current = { id: e.pointerId, x0: e.clientX, offset0: offsetNow.current };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const finger = fingers.current.get(e.pointerId);
    if (finger === undefined) return;
    if (!finger.moved && Math.abs(e.clientX - finger.x0) > DRAG_SLOP) {
      finger.moved = true;
      if (pan.current?.id === e.pointerId) setDragging(true);
    }
    if (finger.moved && pan.current?.id === e.pointerId) {
      const next = pan.current.offset0 - (e.clientX - pan.current.x0);
      setOffset(clampOffset(next, trackWidth, view.width));
    }
  };

  const release = (e: PointerEvent<HTMLDivElement>, lifted: boolean) => {
    const finger = fingers.current.get(e.pointerId);
    fingers.current.delete(e.pointerId);
    if (pan.current?.id === e.pointerId) {
      pan.current = null;
      setDragging(false);
    }
    if (lifted && finger !== undefined && !finger.moved && finger.year !== null) {
      if (years.has(finger.year)) onOpen(finger.year);
    }
  };

  // A year reached with the keyboard is brought into view.
  const reveal = useCallback(
    (year: number) => {
      const left = (year - first) * view.year;
      const o = offsetNow.current;
      if (left < o || left + view.year > o + view.width) {
        setOffset(centreOn(year, first, view.year, trackWidth, view.width));
      }
    },
    [first, view, trackWidth],
  );

  const cells = [];
  for (let year = first; year <= last; year++) {
    const events = years.get(year) ?? 0;
    const decade = year % 10 === 0;
    cells.push(
      <li
        key={year}
        className={styles.year}
        data-decade={decade || undefined}
        data-patina={events > 0 ? wear(year) || undefined : undefined}
      >
        <span className={styles.tick} aria-hidden="true" />
        {events > 0 ? (
          <button
            type="button"
            className={styles.marker}
            data-year={year}
            data-open={open.has(year) || undefined}
            data-featured={featured === year || undefined}
            aria-pressed={open.has(year)}
            aria-label={t('timeline.year', {
              year: formatYear(year, lang),
              count: events,
            })}
            onFocus={() => reveal(year)}
            onClick={(e) => {
              // Touch and mouse open on lift, above. This is the keyboard.
              if (e.detail === 0) onOpen(year);
            }}
          >
            <span className={styles.markerYear}>{formatYear(year, lang)}</span>
            {events > 1 && (
              <span className={styles.markerCount} aria-hidden="true">
                {Array.from({ length: events }, (_, i) => (
                  <span key={i} />
                ))}
              </span>
            )}
          </button>
        ) : (
          (decade || year === first || year === last) && (
            <span className={styles.yearLabel} aria-hidden="true">
              {formatYear(year, lang)}
            </span>
          )
        )}
      </li>,
    );
  }

  return (
    <div
      ref={viewport}
      className={styles.axis}
      data-dragging={dragging || undefined}
      data-testid="timeline-axis"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => release(e, true)}
      onPointerCancel={(e) => release(e, false)}
    >
      <span ref={probe} className={`${styles.marker} ${styles.probe}`} aria-hidden="true">
        {formatYear(last, lang)}
      </span>
      <ol
        className={styles.track}
        aria-label={t('timeline.axis')}
        style={
          {
            width: trackWidth,
            transform: `translate3d(${-offset}px, 0, 0)`,
            '--year': `${view.year}px`,
          } as CSSProperties
        }
      >
        {cells}
      </ol>
    </div>
  );
}
