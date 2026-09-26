'use client';

/**
 * The Provenance Graph's links, each with its evidence in full and cited, for
 * a curator to confirm or reject. Links awaiting a decision come first. A
 * decided link can be decided again, and the new decision is a new line in
 * the log: the old one is not edited away.
 */

import { useState } from 'react';
import { readEdgeReviews, type EdgeDecision, type EdgeReview } from '@toran/contracts';
import { Badge, Button, Citation, Field } from '@/design/primitives';
import { useT, type MessageKey } from '@/i18n';
import { FailureNote } from './OperatorGate';
import { useOperator, type OperatorFailure } from './operator';
import { useQueue } from './useQueue';
import styles from './curator.module.css';

const readDecided = (raw: unknown) =>
  readEdgeReviews((raw as { edges?: unknown } | null)?.edges ?? null);

function Link({
  edge,
  onDecided,
}: {
  edge: EdgeReview;
  onDecided: (edges: readonly EdgeReview[]) => void;
}) {
  const t = useT();
  const { call, operator } = useOperator();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{
    failure: OperatorFailure;
    detail: string;
  } | null>(null);
  const c = edge.confirmation;

  const decide = (decision: EdgeDecision) => {
    if (operator === null) return;
    setBusy(true);
    setFailed(null);
    void call(
      'POST',
      '/curation/edges',
      {
        edge: edge.id,
        digest: edge.digest,
        decision,
        by: operator.name,
        note: note.trim() === '' ? null : note.trim(),
      },
      readDecided,
    ).then((result) => {
      setBusy(false);
      if (result.ok) {
        setNote('');
        onDecided(result.value);
      } else setFailed({ failure: result.failure, detail: result.detail });
    });
  };

  return (
    <li className={styles.item} data-decided={c !== null}>
      <div className={styles.itemHead}>
        <h3 className={styles.itemTitle}>
          {edge.from.title} <span className={styles.assertion}>{edge.assertion}</span>{' '}
          {edge.to.title}
        </h3>
        <Badge
          tone={
            c === null
              ? 'unconfirmed'
              : c.decision === 'confirmed'
                ? 'confirmed'
                : 'neutral'
          }
        >
          {c === null
            ? t('curator.links.awaiting')
            : t(`curator.links.${c.decision}` as MessageKey, {
                by: c.by,
                at: c.at.slice(0, 10),
              })}
        </Badge>
      </div>
      <p className={styles.soft}>
        {t(`curator.links.method.${edge.method}` as MessageKey, {
          score: edge.score === null ? '' : edge.score.toFixed(3),
        })}
        {edge.assertedBy !== null && (
          <span className={styles.detail}>{edge.assertedBy}</span>
        )}
      </p>
      <ol className={styles.evidence}>
        {edge.evidence.map((p, i) => (
          <li key={i} lang={p.language}>
            <blockquote className={styles.passage}>{p.text}</blockquote>
            <Citation citation={p.citation} block />
          </li>
        ))}
      </ol>
      {c?.note != null && <p className={styles.soft}>{c.note}</p>}
      <div className={styles.decide}>
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
            disabled={busy}
            onClick={() => decide('confirmed')}
          >
            {t('curator.links.confirm')}
          </Button>
          <Button
            disabled={busy || note.trim() === ''}
            onClick={() => decide('rejected')}
          >
            {t('curator.links.reject')}
          </Button>
        </div>
        {/* A rejection says why. A link someone thought was wrong without
            saying why is a decision the next curator cannot check. */}
        <p className={styles.soft}>{t('curator.links.rejectNeedsNote')}</p>
      </div>
      {failed !== null && <FailureNote failure={failed.failure} detail={failed.detail} />}
    </li>
  );
}

export function LinksPanel() {
  const t = useT();
  const { queue, replace } = useQueue('/curation/edges', readEdgeReviews);

  if (queue.state === 'loading')
    return <p className={styles.soft}>{t('curator.loading')}</p>;
  if (queue.state === 'failed')
    return <FailureNote failure={queue.failure} detail={queue.detail} />;

  const edges = [...queue.value].sort(
    (a, b) => Number(a.confirmation !== null) - Number(b.confirmation !== null),
  );
  const awaiting = edges.filter((e) => e.confirmation === null).length;
  return (
    <section>
      <p className={styles.summary}>
        {t('curator.links.summary', { total: edges.length, awaiting })}
      </p>
      <ul className={styles.list}>
        {edges.map((e) => (
          <Link key={e.id} edge={e} onDecided={replace} />
        ))}
      </ul>
    </section>
  );
}
