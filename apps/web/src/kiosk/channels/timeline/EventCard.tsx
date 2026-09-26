'use client';

/**
 * One event on the wall: its date, its name, what the archive says about it,
 * and a photograph where there is one.
 *
 * The same card tells the idle story (`story`), opens under a visitor's hand
 * with the threads that branch from it (`card`), and fills the attract loop
 * readable from across the hall (`ambient`). In every form the passage keeps
 * its citation and the photograph keeps its provenance, because a memorial
 * that shows a photograph without saying where it came from teaches visitors
 * that sources do not matter.
 */

import type { ThreadId, Timeline, TimelineEvent, TimelinePhoto } from '@toran/contracts';
import { archiveUrl } from '@/archive/client';
import { useTouchFeedback } from '@/design/feedback/useTouchFeedback';
import { Button, Citation } from '@/design/primitives';
import { useI18n, type MessageKey } from '@/i18n';
import { ICON, Icon } from '../../icons';
import { formatDate, formatYear, nextInThread } from './model';
import styles from './timeline.module.css';

export type CardMode = 'story' | 'card' | 'ambient';

export interface EventCardProps {
  readonly event: TimelineEvent;
  readonly timeline: Timeline;
  readonly mode: CardMode;
  /** Story: open this event as a card. */
  readonly onOpen?: () => void;
  /** Card: follow a thread to its next event. */
  readonly onStep?: (eventId: string) => void;
  readonly onClose?: () => void;
  /** Card: any touch keeps it open. */
  readonly onTouch?: () => void;
  /** Ambient: the story drifted here because this is being read nearby. */
  readonly nearby?: boolean;
}

function iso(event: TimelineEvent): string {
  const { year, month, day } = event.date;
  const pad = (n: number) => String(n).padStart(2, '0');
  return month === null
    ? String(year)
    : day === null
      ? `${year}-${pad(month)}`
      : `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * A passage that has to scroll can be reached from a keyboard or a switch,
 * so it can be scrolled without a finger; one that fits is not a tab stop.
 */
function focusableWhileScrolling(el: HTMLElement | null) {
  if (el === null) return;
  const update = () => {
    if (el.scrollHeight > el.clientHeight + 1) el.tabIndex = 0;
    else el.removeAttribute('tabindex');
  };
  update();
  const observer = new ResizeObserver(update);
  observer.observe(el);
  return () => observer.disconnect();
}

function Credit({ photo }: { photo: TimelinePhoto }) {
  const { t } = useI18n();
  if (photo.kind === 'plate') {
    return (
      <figcaption className={styles.credit}>
        {t('timeline.photo.plate')} <Citation citation={photo.citation} />
      </figcaption>
    );
  }
  return (
    <figcaption className={styles.credit}>
      {photo.recorded === null
        ? t('timeline.photo.commonsUndated')
        : t('timeline.photo.commons', { date: photo.recorded })}
    </figcaption>
  );
}

export function EventCard({
  event,
  timeline,
  mode,
  onOpen,
  onStep,
  onClose,
  onTouch,
  nearby = false,
}: EventCardProps) {
  const { t, lang } = useI18n();
  const feedback = useTouchFeedback('light');
  const title = t(`timeline.event.${event.id}` as MessageKey);
  const photo = event.photo;
  const steps =
    mode === 'card'
      ? event.threads
          .map((thread) => ({ thread, next: nextInThread(timeline, event, thread) }))
          .filter((s): s is { thread: ThreadId; next: TimelineEvent } => s.next !== null)
      : [];

  return (
    <article
      className={styles.card}
      data-mode={mode}
      data-event={event.id}
      data-photo={photo === null ? 'none' : photo.width >= photo.height ? 'wide' : 'tall'}
      data-testid={`timeline-${mode}`}
      onPointerDown={onTouch}
    >
      <div className={styles.inner}>
        {photo !== null && (
          <figure className={styles.photo}>
            {/* A static export on a kiosk: the photograph is a file beside the page,
              already sized by the pipeline, and next/image optimises on a server. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={archiveUrl(photo.file)}
              width={photo.width}
              height={photo.height}
              alt={t('timeline.photo.alt', { title })}
              decoding="async"
              draggable={false}
            />
            <Credit photo={photo} />
          </figure>
        )}
        <div className={styles.text}>
          {nearby && (
            <p className={styles.nearby} data-testid="timeline-nearby">
              {t('kiosk.nearby')}
            </p>
          )}
          <p className={styles.date}>
            <time dateTime={iso(event)}>{formatDate(event.date, lang)}</time>
          </p>
          <h3 className={styles.title}>{title}</h3>
          <div className={styles.passages} ref={focusableWhileScrolling}>
            {event.passages.map((p, i) => (
              <blockquote key={i} className={styles.excerpt} lang={p.language}>
                <p ref={focusableWhileScrolling}>{p.text}</p>
                {p.speaker !== null && (
                  <span className={styles.speaker}>{p.speaker}</span>
                )}
                <Citation citation={p.citation} block />
              </blockquote>
            ))}
          </div>
        </div>
        {mode === 'card' && (
          <div className={styles.actions}>
            {steps.map(({ thread, next }) => {
              const threadName = t(`timeline.thread.${thread}` as MessageKey);
              const nextTitle = t(`timeline.event.${next.id}` as MessageKey);
              return (
                <Button
                  key={thread}
                  variant="secondary"
                  className={styles.step}
                  icon={<Icon d={ICON.forward} />}
                  aria-label={`${t('timeline.next', { thread: threadName })}: ${formatYear(next.date.year, lang)}, ${nextTitle}`}
                  onClick={() => onStep?.(next.id)}
                  data-testid="timeline-step"
                >
                  <span className={styles.stepText}>
                    <span className={styles.stepThread}>{threadName}</span>
                    <span className={styles.stepTo}>
                      {formatYear(next.date.year, lang)}
                      <span className={styles.stepTitle}> · {nextTitle}</span>
                    </span>
                  </span>
                </Button>
              );
            })}
            <Button
              variant="secondary"
              className={styles.close}
              icon={<Icon d={ICON.close} />}
              aria-label={t('timeline.close')}
              onClick={onClose}
              data-testid="timeline-close"
            />
          </div>
        )}
      </div>
      {mode === 'story' && (
        <button
          type="button"
          className={styles.cover}
          aria-label={t('timeline.open', { title })}
          onPointerDown={feedback}
          onClick={onOpen}
          data-testid="timeline-story-open"
        />
      )}
    </article>
  );
}
