'use client';

/**
 * The Timeline Wall, devices 4, 5 and 6. PROJECT.md 7.3.
 *
 * Left alone, the wall tells the story: one event after another in date
 * order, each with what the archive says about it, while the axis walks to
 * its year. A touch on a year opens it where the visitor stands, and up to
 * four people can each have a year open at once. From an open event a
 * visitor can follow a thread, learning, human rights, the Constitution or
 * the Dhamma, to where it goes next; that is the branch. When the last card
 * closes the story resumes from the event the visitor was reading.
 *
 * Years the building's visitors open most wear into the axis (Patina,
 * D-024): a count per year, nothing about who opened it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Timeline } from '@toran/contracts';
import { timeline as loadTimeline } from '@/archive/client';
import { useI18n } from '@/i18n';
import { AmbientContent } from '../../ambient';
import { useChannelNav } from '../../nav';
import { ReachTools } from '../../reach';
import { useVisitor } from '../../visitor/VisitorProvider';
import { Axis } from './Axis';
import { EventCard } from './EventCard';
import {
  cardsThatFit,
  closeIdle,
  keepRecent,
  MAX_CARDS,
  openEvents,
  openYear,
  stepCard,
  STORY_HOLD_MS,
  STORY_RESUME_MS,
  touchCard,
  yearsWithEvents,
  type OpenCard,
} from './model';
import styles from './timeline.module.css';

const wearKey = (year: number) => `year:${year}`;

export function TimelineWall() {
  const { t } = useI18n();
  const { patina } = useVisitor();
  const [data, setData] = useState<Timeline | null>(null);
  const [failed, setFailed] = useState(false);
  const [cards, setCards] = useState<OpenCard[]>([]);
  const [story, setStory] = useState(0);
  const [worn, setWorn] = useState(0);
  const [fit, setFit] = useState(MAX_CARDS);
  const stage = useRef<HTMLElement>(null);
  const cardProbe = useRef<HTMLSpanElement>(null);
  const lastTouch = useRef(0);
  const keys = useRef(0);
  const nextKey = useCallback(() => ++keys.current, []);

  useEffect(() => {
    let current = true;
    loadTimeline().then(
      (loaded) => current && setData(loaded),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, []);

  // How many cards the stage holds at a readable size, which follows the
  // visitor's text size: at 200% type, fewer and wider.
  useEffect(() => {
    const el = stage.current;
    const probe = cardProbe.current;
    if (el === null || probe === null) return;
    const measure = () => {
      const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0;
      const min = probe.getBoundingClientRect();
      const next = cardsThatFit(
        { width: el.clientWidth, height: el.clientHeight },
        { width: min.width, height: min.height },
        gap,
      );
      setFit(next);
      setCards((c) => keepRecent(c, next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(probe);
    return () => observer.disconnect();
  }, [data]);

  const touch = useCallback(() => {
    lastTouch.current = performance.now();
  }, []);

  // The story, while nobody has a card open. A touch holds it for a while.
  const telling = data !== null && cards.length === 0;
  useEffect(() => {
    if (!telling || data === null) return;
    const id = window.setInterval(() => {
      if (performance.now() - lastTouch.current < STORY_RESUME_MS) return;
      setStory((s) => (s + 1) % data.events.length);
    }, STORY_HOLD_MS);
    return () => window.clearInterval(id);
  }, [telling, data]);

  // A card nobody has touched for a while closes itself.
  useEffect(() => {
    if (cards.length === 0) return;
    const id = window.setInterval(
      () => setCards((c) => closeIdle(c, performance.now())),
      5000,
    );
    return () => window.clearInterval(id);
  }, [cards.length]);

  const wear = useCallback(
    (year: number) => {
      patina.wear(wearKey(year));
      setWorn((n) => n + 1);
    },
    [patina],
  );

  const openYearOnWall = useCallback(
    (year: number) => {
      if (data === null) return;
      touch();
      wear(year);
      setCards((c) => openYear(c, data, year, performance.now(), nextKey, fit));
    },
    [data, nextKey, touch, wear, fit],
  );

  const close = (key: number) => {
    touch();
    const card = cards.find((c) => c.key === key);
    const rest = cards.filter((c) => c.key !== key);
    if (rest.length === 0 && card !== undefined && data !== null) {
      setStory(
        Math.max(
          0,
          data.events.findIndex((e) => e.id === card.eventId),
        ),
      );
    }
    setCards(rest);
  };

  useChannelNav({
    back: () => {
      if (cards.length === 0) return false;
      const latest = cards.reduce((a, b) => (b.touched > a.touched ? b : a));
      close(latest.key);
      return true;
    },
    home: () => setCards([]),
    forward: () => false,
    canForward: false,
  });

  const years = useMemo(
    () => (data === null ? new Map<number, number>() : yearsWithEvents(data)),
    [data],
  );
  const levels = useMemo(() => {
    const out = new Map<number, number>();
    for (const year of years.keys()) out.set(year, patina.level(wearKey(year)));
    return out;
    // `worn` changes each time a year is opened, which is when a level can move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [years, patina, worn]);

  if (failed) return <p className={styles.status}>{t('timeline.failed')}</p>;
  if (data === null) {
    return (
      <p className={styles.status} aria-busy="true">
        {t('timeline.loading')}
      </p>
    );
  }

  const byId = new Map(data.events.map((e) => [e.id, e]));
  const featured = data.events[story] ?? data.events[0]!;
  const openYears = new Set(cards.map((c) => byId.get(c.eventId)!.date.year));

  return (
    <div className={styles.wall} data-testid="timeline" data-cards={cards.length}>
      <section className={styles.stage} ref={stage}>
        <span ref={cardProbe} className={styles.cardProbe} aria-hidden="true" />
        {cards.length === 0 ? (
          <EventCard
            key={featured.id}
            event={featured}
            timeline={data}
            mode="story"
            onOpen={() => {
              touch();
              wear(featured.date.year);
              setCards((c) =>
                openEvents(c, data, [featured], performance.now(), nextKey, fit),
              );
            }}
          />
        ) : (
          cards.map((card) => (
            <EventCard
              key={card.key}
              event={byId.get(card.eventId)!}
              timeline={data}
              mode="card"
              onTouch={() => {
                touch();
                setCards((c) => touchCard(c, card.key, performance.now()));
              }}
              onStep={(eventId) => {
                const next = byId.get(eventId);
                if (next !== undefined) wear(next.date.year);
                setCards((c) => stepCard(c, card.key, eventId, performance.now()));
              }}
              onClose={() => close(card.key)}
            />
          ))
        )}
      </section>
      <Axis
        first={data.range[0]}
        last={data.range[1]}
        years={years}
        open={openYears}
        featured={cards.length === 0 ? featured.date.year : null}
        wear={(year) => levels.get(year) ?? 0}
        onOpen={openYearOnWall}
        onTouch={touch}
      />
      {cards.length === 0 && (
        <ReachTools>
          <p className={styles.hint}>{t('timeline.hint')}</p>
        </ReachTools>
      )}
      <AmbientContent>
        <EventCard key={featured.id} event={featured} timeline={data} mode="ambient" />
      </AmbientContent>
    </div>
  );
}
