'use client';

/**
 * OCR review. One scanned page at a time, its lines least confident first,
 * each beside the part of the scan it was read from.
 *
 * What a curator types is a correction, never a replacement: the machine's
 * reading stays on screen above it, and the Manuscript Station shows both.
 * A confidence number means different things for different models, so the
 * model's own account of it is printed with every reading.
 */

import { useState } from 'react';
import {
  readOcrPages,
  type OcrPage,
  type OcrReading,
  type OcrRegion,
} from '@toran/contracts';
import { Badge, Button, Citation, Field } from '@/design/primitives';
import { useT } from '@/i18n';
import { FailureNote } from './OperatorGate';
import { useOperator, type OperatorFailure } from './operator';
import { useQueue } from './useQueue';
import styles from './curator.module.css';

const readCorrected = (raw: unknown) =>
  readOcrPages((raw as { pages?: unknown } | null)?.pages ?? null);

/** The line's own patch of the scan, cut from the published full image. */
function Crop({ page, region }: { page: OcrPage; region: OcrRegion }) {
  const [missing, setMissing] = useState(false);
  if (region.box === null || missing) return null;
  const [x, y, w, h] = region.box;
  return (
    <svg
      className={styles.crop}
      viewBox={`${String(x)} ${String(y)} ${String(Math.max(w, 1))} ${String(Math.max(h, 1))}`}
      preserveAspectRatio="xMinYMid meet"
      aria-hidden="true"
    >
      <image
        href={`/iiif/${page.pageId}/full/max/0/default.jpg`}
        width={page.width}
        height={page.height}
        onError={() => setMissing(true)}
      />
    </svg>
  );
}

function Region({
  page,
  reading,
  region,
  onCorrected,
}: {
  page: OcrPage;
  reading: OcrReading;
  region: OcrRegion;
  onCorrected: (pages: readonly OcrPage[]) => void;
}) {
  const t = useT();
  const { call, operator } = useOperator();
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{
    failure: OperatorFailure;
    detail: string;
  } | null>(null);

  const save = () => {
    if (operator === null || text.trim() === '') return;
    setBusy(true);
    setFailed(null);
    void call(
      'POST',
      '/curation/ocr',
      {
        pageId: page.pageId,
        regionId: region.id,
        pipeline: reading.pipeline,
        text: text.trim(),
        by: operator.name,
        note: note.trim() === '' ? null : note.trim(),
      },
      readCorrected,
    ).then((result) => {
      setBusy(false);
      if (result.ok) {
        setText('');
        setNote('');
        onCorrected(result.value);
      } else setFailed({ failure: result.failure, detail: result.detail });
    });
  };

  return (
    <li className={styles.item} data-decided={region.correction !== null}>
      <div className={styles.itemHead}>
        <span className={styles.meta}>
          {region.id} ·{' '}
          {t('curator.ocr.confidence', { value: region.confidence.toFixed(3) })}
        </span>
        {region.correction !== null && (
          <Badge tone="confirmed">
            {t('curator.ocr.corrected', {
              by: region.correction.by,
              at: region.correction.at.slice(0, 10),
            })}
          </Badge>
        )}
      </div>
      <Crop page={page} region={region} />
      <p className={styles.machine}>
        <span className={styles.label}>{t('curator.ocr.machine')}</span>
        <span lang={page.language}>{region.text}</span>
      </p>
      {region.correction !== null && (
        <p className={styles.corrected}>
          <span className={styles.label}>{t('curator.ocr.now')}</span>
          <span lang={page.language}>{region.correction.text}</span>
        </p>
      )}
      <div className={styles.decide}>
        <Field
          label={t('curator.ocr.actually')}
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
        />
        <Field
          label={t('curator.note')}
          value={note}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className={styles.actions}>
          <Button
            variant="primary"
            weight="firm"
            disabled={busy || text.trim() === ''}
            onClick={save}
          >
            {t('curator.ocr.save')}
          </Button>
        </div>
      </div>
      {failed !== null && <FailureNote failure={failed.failure} detail={failed.detail} />}
    </li>
  );
}

export function OcrPanel() {
  const t = useT();
  const { queue, replace } = useQueue('/curation/ocr', readOcrPages);
  const [chosen, setChosen] = useState<string | null>(null);

  if (queue.state === 'loading')
    return <p className={styles.soft}>{t('curator.loading')}</p>;
  if (queue.state === 'failed')
    return <FailureNote failure={queue.failure} detail={queue.detail} />;

  const pages = queue.value;
  const page = pages.find((p) => p.pageId === chosen) ?? pages[0];
  if (page === undefined) return <p className={styles.soft}>{t('curator.ocr.none')}</p>;

  return (
    <section className={styles.split}>
      <ul className={styles.picker} aria-label={t('curator.ocr.pages')}>
        {pages.map((p) => {
          const regions = p.readings.flatMap((r) => r.regions);
          const done = regions.filter((r) => r.correction !== null).length;
          return (
            <li key={p.pageId}>
              <Button
                fullWidth
                variant={p.pageId === page.pageId ? 'primary' : 'secondary'}
                aria-pressed={p.pageId === page.pageId}
                onClick={() => setChosen(p.pageId)}
              >
                <span className={styles.pickTitle} lang={p.language}>
                  {p.heading || p.pageId}
                </span>
                <span className={styles.pickMeta}>
                  {t('curator.ocr.progress', { done, total: regions.length })}
                </span>
              </Button>
            </li>
          );
        })}
      </ul>
      <div>
        <h3 className={styles.itemTitle} lang={page.language}>
          {page.heading || page.pageId}
        </h3>
        <Citation citation={page.citation} block />
        {page.readings.map((reading) => (
          <section key={reading.pipeline} className={styles.reading}>
            <p className={styles.soft}>
              {t('curator.ocr.model', { model: reading.model })}
              <span className={styles.detail}>
                {t('curator.ocr.confidenceIs', { meaning: reading.confidenceIs })}
              </span>
            </p>
            <ul className={styles.list}>
              {reading.regions.map((region) => (
                <Region
                  key={region.id}
                  page={page}
                  reading={reading}
                  region={region}
                  onCorrected={replace}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
