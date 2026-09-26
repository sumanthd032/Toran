'use client';

/**
 * The ingest queue. Everything any manifest names, the ones that still need a
 * person first: not yet archived, a file that no longer matches its digest, or
 * a rights statement nobody has checked against its source.
 *
 * Running an ingest stays at the terminal, and the panel says which command,
 * because it downloads and reads for minutes. D-152.
 */

import { useState } from 'react';
import { needsCurator, readIngestItems, type IngestItem } from '@toran/contracts';
import { Badge, Button, Field } from '@/design/primitives';
import { useT, type MessageKey } from '@/i18n';
import { FailureNote } from './OperatorGate';
import { useOperator, type OperatorFailure } from './operator';
import { useQueue } from './useQueue';
import styles from './curator.module.css';

const readUpdated = (raw: unknown) =>
  readIngestItems((raw as { items?: unknown } | null)?.items ?? null);

function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}

function Item({
  item,
  onUpdated,
}: {
  item: IngestItem;
  onUpdated: (items: readonly IngestItem[]) => void;
}) {
  const t = useT();
  const { call, operator } = useOperator();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{
    failure: OperatorFailure;
    detail: string;
  } | null>(null);

  const send = (
    path: '/curation/fixity' | '/curation/rights',
    body: Record<string, unknown>,
  ) => {
    if (operator === null) return;
    setBusy(true);
    setFailed(null);
    void call(
      'POST',
      path,
      { ...body, id: item.id, by: operator.name },
      readUpdated,
    ).then((result) => {
      setBusy(false);
      if (result.ok) {
        setNote('');
        onUpdated(result.value);
      } else setFailed({ failure: result.failure, detail: result.detail });
    });
  };

  return (
    <li className={styles.item} data-decided={!needsCurator(item)}>
      <div className={styles.itemHead}>
        <h3 className={styles.itemTitle}>{item.title}</h3>
        <Badge tone={item.stage === 'archived' ? 'confirmed' : 'unconfirmed'}>
          {t(`curator.ingest.stage.${item.stage}` as MessageKey)}
        </Badge>
      </div>
      <p className={styles.meta}>
        {item.id}
        {item.format !== '' && ` · ${item.format}`}
        {item.bytes !== null &&
          ` · ${t('curator.ingest.size', { mb: megabytes(item.bytes) })}`}
        {item.retrieved !== null &&
          ` · ${t('curator.ingest.retrieved', { at: item.retrieved.slice(0, 10) })}`}
      </p>
      <dl className={styles.facts}>
        <dt>{t('curator.ingest.fixity')}</dt>
        <dd>
          <Badge
            tone={
              item.fixity === 'intact'
                ? 'confirmed'
                : item.fixity === 'unchecked'
                  ? 'neutral'
                  : 'unconfirmed'
            }
          >
            {t(`curator.ingest.fixity.${item.fixity}` as MessageKey)}
          </Badge>
          {item.fixityCheckedAt !== null && (
            <span className={styles.detail}>
              {t('curator.ingest.checked', { at: item.fixityCheckedAt.slice(0, 10) })}
            </span>
          )}
        </dd>
        <dt>{t('curator.ingest.rights')}</dt>
        <dd>
          {item.rights || t('curator.records.empty')}
          <span className={styles.detail}>
            {item.rightsDecision === null
              ? t('curator.ingest.rightsRecorded', { recorded: item.rightsRecorded })
              : t('curator.ingest.rightsChecked', {
                  by: item.rightsDecision.by,
                  at: item.rightsDecision.at.slice(0, 10),
                })}
          </span>
        </dd>
      </dl>
      {item.stage === 'listed' ? (
        <p className={styles.soft}>{t('curator.ingest.runIngest')}</p>
      ) : (
        <div className={styles.decide}>
          <div className={styles.actions}>
            <Button disabled={busy} onClick={() => send('/curation/fixity', {})}>
              {t('curator.ingest.check')}
            </Button>
          </div>
          {item.rightsDecision === null && (
            <>
              <Field
                label={t('curator.ingest.rightsNote')}
                value={note}
                maxLength={1000}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className={styles.actions}>
                <Button
                  variant="primary"
                  weight="firm"
                  disabled={busy || note.trim() === ''}
                  onClick={() => send('/curation/rights', { note: note.trim() })}
                >
                  {t('curator.ingest.verify')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {failed !== null && <FailureNote failure={failed.failure} detail={failed.detail} />}
    </li>
  );
}

export function IngestPanel() {
  const t = useT();
  const { queue, replace } = useQueue('/curation/ingest', readIngestItems);
  const [all, setAll] = useState(false);

  if (queue.state === 'loading')
    return <p className={styles.soft}>{t('curator.loading')}</p>;
  if (queue.state === 'failed')
    return <FailureNote failure={queue.failure} detail={queue.detail} />;

  const waiting = queue.value.filter(needsCurator);
  const shown = all ? queue.value : waiting;
  return (
    <section>
      <div className={styles.itemHead}>
        <p className={styles.summary}>
          {t('curator.ingest.summary', {
            waiting: waiting.length,
            total: queue.value.length,
          })}
        </p>
        <Button variant="quiet" aria-pressed={all} onClick={() => setAll((v) => !v)}>
          {all ? t('curator.ingest.showWaiting') : t('curator.ingest.showAll')}
        </Button>
      </div>
      {shown.length === 0 && <p className={styles.soft}>{t('curator.ingest.clear')}</p>}
      <ul className={styles.list}>
        {shown.map((item) => (
          <Item key={item.id} item={item} onUpdated={replace} />
        ))}
      </ul>
    </section>
  );
}
