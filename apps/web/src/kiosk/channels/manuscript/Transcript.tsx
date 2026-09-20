'use client';

/**
 * The transcription beside the scan, with the machine's confidence rendered
 * as heat on the words.
 *
 * Every competing entry will present OCR output as fact. This shows where
 * the machine was unsure, because a reader who cannot see that cannot judge
 * anything else on the screen. The heat comes from heatOf and nowhere else,
 * so no view can quietly present a doubtful reading as a confident one.
 *
 * A curator's correction is shown as a change: what the machine read is
 * still there, struck through, with who corrected it and when. The machine
 * output is never overwritten, in the archive or on the screen.
 */

import {
  heatOf,
  type CorrectedRegion,
  type Pipeline,
  type Transcription,
} from '@toran/contracts';
import { Badge, Citation } from '@/design/primitives';
import { useI18n } from '@/i18n';
import styles from './manuscript.module.css';

export interface TranscriptProps {
  readonly transcription: Transcription;
  readonly regions: readonly CorrectedRegion[];
  readonly selected: string | null;
  readonly onSelect: (id: string) => void;
}

/** A line, word by word, where the pipeline said how sure it was of each. */
function Words({ region, pipeline }: { region: CorrectedRegion; pipeline: Pipeline }) {
  if (region.correction !== null || region.words.length === 0) {
    return <span data-heat={heatOf(region, pipeline)}>{region.text}</span>;
  }
  return (
    <>
      {region.words.map((word, i) => (
        <span
          key={i}
          className={styles.word}
          data-heat={heatOf({ ...region, confidence: word.confidence }, pipeline)}
        >
          {word.text}{' '}
        </span>
      ))}
    </>
  );
}

export function Transcript({
  transcription,
  regions,
  selected,
  onSelect,
}: TranscriptProps) {
  const { t } = useI18n();
  const doubted = regions.filter(
    (r) => r.correction === null && heatOf(r, transcription.pipeline) === 'low',
  ).length;

  return (
    <section className={styles.transcript} data-testid="manuscript-transcript">
      <header className={styles.reading}>
        <h3 className={styles.readBy}>
          {t(`manuscript.pipeline.${transcription.pipeline}`)}
        </h3>
        <p className={styles.model}>{transcription.model}</p>
        {/* What the number means, in words, because it means something
            different for each pipeline and a bare percentage would not say so. */}
        <p className={styles.means}>
          {t('manuscript.confidenceIs', { what: transcription.confidenceIs })}
        </p>
        <p className={styles.counts}>
          {t('manuscript.counts', { regions: regions.length, doubted })}
        </p>
      </header>

      <ol className={styles.lines}>
        {regions.map((region) => (
          <li key={region.id}>
            <button
              type="button"
              className={styles.line}
              data-testid="manuscript-line"
              data-region={region.id}
              data-heat={heatOf(region, transcription.pipeline)}
              data-corrected={region.correction !== null || undefined}
              aria-pressed={selected === region.id}
              onClick={() => onSelect(region.id)}
            >
              <span className={styles.lineText} lang={transcription.language}>
                <Words region={region} pipeline={transcription.pipeline} />
              </span>
              {region.correction !== null && (
                <span className={styles.wasRead}>
                  <s>{region.correction.was}</s>
                  <Badge tone="confirmed">
                    {t('manuscript.corrected', {
                      by: region.correction.by,
                      date: region.correction.at.slice(0, 10),
                    })}
                  </Badge>
                </span>
              )}
            </button>
          </li>
        ))}
      </ol>

      {/* The page's citation, on the transcription, because the words above
          are a claim about a page and a claim needs its source. */}
      <Citation citation={transcription.citation} block />

      <ul className={styles.key} aria-label={t('manuscript.key')}>
        {(['certain', 'high', 'middling', 'low'] as const).map((heat) => (
          <li key={heat}>
            <span className={styles.swatch} data-heat={heat} aria-hidden="true" />
            {t(`manuscript.heat.${heat}`)}
          </li>
        ))}
      </ul>
    </section>
  );
}
