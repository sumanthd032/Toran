'use client';

/**
 * The Manuscript Station, device 7. PROJECT.md 7.4, D-012.
 *
 * A scanned page on the left, deep zoomable against static IIIF tiles, and
 * what a machine read from it on the right, with its confidence rendered as
 * heat. Touch a line to find it on the page; press and hold anywhere on the
 * page to ask what is written there.
 *
 * The one thing this screen is for is honesty about machine reading. Every
 * other entry will show OCR as fact. Here a reader can see which words the
 * machine doubted, what a curator changed, and what the pipeline scored on a
 * held-out set, which is the only number that says whether to believe it.
 */

import { useEffect, useMemo, useState } from 'react';
import { heatOf, type Correction, type Scan, type Transcription } from '@toran/contracts';
import {
  corrections as loadCorrections,
  scans as loadScans,
  transcriptions,
} from '@/archive/client';
import { Button } from '@/design/primitives';
import { useI18n } from '@/i18n';
import { ICON, Icon } from '../../icons';
import { useChannelNav } from '../../nav';
import { ReachTools } from '../../reach';
import { DeepZoom } from './DeepZoom';
import { boxOf, preferred, readingOf, regionAt, type Reading } from './model';
import styles from './manuscript.module.css';
import { Transcript } from './Transcript';

type View = 'both' | 'scan' | 'text';

interface Loaded {
  readonly scans: readonly Scan[];
  readonly readings: ReadonlyMap<string, readonly Transcription[]>;
  readonly corrections: readonly Correction[];
}

export function ManuscriptStation() {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [view, setView] = useState<View>('both');
  const [selected, setSelected] = useState<string | null>(null);
  const [asked, setAsked] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [pages, marks] = await Promise.all([loadScans(), loadCorrections()]);
        const readings = new Map<string, readonly Transcription[]>();
        for (const scan of pages) readings.set(scan.id, await transcriptions(scan));
        if (live) setLoaded({ scans: pages, readings, corrections: marks });
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const scan = loaded?.scans[pageIndex] ?? null;
  const readings: readonly Reading[] = useMemo(() => {
    if (loaded === null || scan === null) return [];
    return (loaded.readings.get(scan.id) ?? []).map((tr) =>
      readingOf(tr, loaded.corrections),
    );
  }, [loaded, scan]);

  const pipeline = scan === null ? null : preferred(readings, scan);
  const reading = readings.find((r) => r.transcription.pipeline === pipeline) ?? null;

  useChannelNav({
    back: () => {
      if (asked !== null) {
        setAsked(null);
        return true;
      }
      if (selected !== null) {
        setSelected(null);
        return true;
      }
      if (view !== 'both') {
        setView('both');
        return true;
      }
      if (pageIndex > 0) {
        setPageIndex((i) => i - 1);
        return true;
      }
      return false;
    },
    home: () => {
      setPageIndex(0);
      setView('both');
      setSelected(null);
      setAsked(null);
    },
    forward: () => {
      if (loaded === null || pageIndex >= loaded.scans.length - 1) return false;
      setPageIndex((i) => i + 1);
      setSelected(null);
      setAsked(null);
      return true;
    },
    canForward: loaded !== null && pageIndex < loaded.scans.length - 1,
  });

  if (failed) return <p className={styles.status}>{t('manuscript.failed')}</p>;
  if (loaded === null || scan === null) {
    return (
      <p className={styles.status} aria-busy="true">
        {t('manuscript.loading')}
      </p>
    );
  }

  const boxes =
    reading === null
      ? []
      : reading.regions.flatMap((region) => {
          const box = boxOf(region, scan);
          return box === null
            ? []
            : [
                {
                  id: region.id,
                  box,
                  heat: heatOf(region, reading.transcription.pipeline),
                },
              ];
        });

  /**
   * A press and hold on the page. The point arrives in stage pixels; the
   * page is drawn to fit the stage, so it converts by the same ratio the
   * overlay uses. Where the reading has no boxes, as a hand's has none, the
   * station says it cannot answer rather than guessing a line.
   */
  const askAt = (px: number, py: number) => {
    const stage = document.querySelector('[data-testid="manuscript-canvas"]');
    if (stage === null || reading === null) return;
    const rect = stage.getBoundingClientRect();
    const fit = Math.min(rect.width / scan.width, rect.height / scan.height);
    const x = (px - (rect.width - scan.width * fit) / 2) / fit;
    const y = (py - (rect.height - scan.height * fit) / 2) / fit;
    const region = regionAt(reading.regions, x, y);
    setAsked(region === null ? 'nothing' : region.id);
    if (region !== null) setSelected(region.id);
  };

  return (
    <div
      className={styles.room}
      data-testid="manuscript"
      data-view={view}
      data-page={scan.id}
    >
      <header className={styles.head}>
        <h2 className={styles.title}>{scan.heading}</h2>
        <p className={styles.where}>
          {scan.printedPage === null
            ? t('manuscript.leaf', { title: scan.title })
            : t('manuscript.page', { title: scan.title, page: scan.printedPage })}
        </p>
        <p className={styles.provenance}>
          {t('manuscript.provenance', {
            rendered: scan.provenance.rendered,
            credit: scan.credit ?? '',
          })}
        </p>
      </header>

      {view !== 'text' && (
        <DeepZoom
          scan={scan}
          regions={view === 'both' ? boxes : []}
          selected={selected}
          dim={false}
          onAsk={askAt}
          onSelect={setSelected}
          onReady={(ok) => !ok && setFailed(true)}
        />
      )}

      {view !== 'scan' && (
        <div className={styles.side}>
          {reading === null ? (
            <p className={styles.status} data-testid="manuscript-unread">
              {t('manuscript.unread')}
            </p>
          ) : (
            <Transcript
              transcription={reading.transcription}
              regions={reading.regions}
              selected={selected}
              onSelect={setSelected}
            />
          )}
          {asked !== null && (
            <p className={styles.answer} data-testid="manuscript-answer" role="status">
              {asked === 'nothing'
                ? t('manuscript.ask.nothing')
                : t('manuscript.ask.found', {
                    text: reading?.regions.find((r) => r.id === asked)?.text ?? '',
                  })}
            </p>
          )}
        </div>
      )}

      <ReachTools>
        <Button
          variant={view === 'both' ? 'primary' : 'secondary'}
          icon={<Icon d={ICON.plan} />}
          aria-pressed={view === 'both'}
          onClick={() => setView('both')}
          data-testid="manuscript-view-both"
        >
          <span className={styles.label}>{t('manuscript.view.both')}</span>
        </Button>
        <Button
          variant={view === 'scan' ? 'primary' : 'secondary'}
          icon={<Icon d={ICON.scan} />}
          aria-pressed={view === 'scan'}
          onClick={() => setView('scan')}
          data-testid="manuscript-view-scan"
        >
          <span className={styles.label}>{t('manuscript.view.scan')}</span>
        </Button>
        <Button
          variant={view === 'text' ? 'primary' : 'secondary'}
          icon={<Icon d={ICON.text} />}
          aria-pressed={view === 'text'}
          onClick={() => setView('text')}
          data-testid="manuscript-view-text"
        >
          <span className={styles.label}>{t('manuscript.view.text')}</span>
        </Button>
      </ReachTools>
    </div>
  );
}
