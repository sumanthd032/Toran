'use client';

/**
 * Dublin Core for the text works. Each field shows what it reads now, what
 * arrived with the submission when the two differ, and every edit in order
 * with its curator. An edit republishes the Reading Room's manifest, so the
 * title a visitor sees is the one the curator set. D-152.
 */

import { useState } from 'react';
import {
  EDITABLE_FIELDS,
  readWorkRecords,
  type EditableField,
  type WorkRecord,
} from '@toran/contracts';
import { Button, Field } from '@/design/primitives';
import { useT, type MessageKey } from '@/i18n';
import { FailureNote } from './OperatorGate';
import { useOperator, type OperatorFailure } from './operator';
import { useQueue } from './useQueue';
import styles from './curator.module.css';

const readEdited = (raw: unknown) =>
  readWorkRecords((raw as { works?: unknown } | null)?.works ?? null);

function FieldEditor({
  work,
  field,
  onSaved,
}: {
  work: WorkRecord;
  field: EditableField;
  onSaved: (works: readonly WorkRecord[]) => void;
}) {
  const t = useT();
  const { call, operator } = useOperator();
  const [value, setValue] = useState(work.fields[field]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{
    failure: OperatorFailure;
    detail: string;
  } | null>(null);
  const changed = value.trim() !== work.fields[field] && value.trim() !== '';
  const history = work.edits.filter((e) => e.field === field);

  const save = () => {
    if (operator === null || !changed) return;
    setBusy(true);
    setFailed(null);
    void call(
      'POST',
      '/curation/metadata',
      {
        workId: work.id,
        field,
        value: value.trim(),
        by: operator.name,
        note: note.trim() === '' ? null : note.trim(),
      },
      readEdited,
    ).then((result) => {
      setBusy(false);
      if (result.ok) {
        setNote('');
        onSaved(result.value);
      } else setFailed({ failure: result.failure, detail: result.detail });
    });
  };

  return (
    <div className={styles.field}>
      <Field
        label={t(`curator.records.field.${field}` as MessageKey)}
        value={value}
        maxLength={600}
        onChange={(e) => setValue(e.target.value)}
      />
      {work.submitted[field] !== work.fields[field] && (
        <p className={styles.soft}>
          <span className={styles.label}>{t('curator.records.submitted')}</span>
          {work.submitted[field] || t('curator.records.empty')}
        </p>
      )}
      {history.length > 0 && (
        <ol className={styles.history}>
          {history.map((e, i) => (
            <li key={i} className={styles.meta}>
              {t('curator.records.edit', { by: e.by, at: e.at.slice(0, 10) })}
              {e.note !== null && `: ${e.note}`}
            </li>
          ))}
        </ol>
      )}
      {changed && (
        <div className={styles.decide}>
          <Field
            label={t('curator.note')}
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className={styles.actions}>
            <Button variant="primary" weight="firm" disabled={busy} onClick={save}>
              {t('curator.records.save')}
            </Button>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => setValue(work.fields[field])}
            >
              {t('curator.records.undo')}
            </Button>
          </div>
        </div>
      )}
      {failed !== null && <FailureNote failure={failed.failure} detail={failed.detail} />}
    </div>
  );
}

export function RecordsPanel() {
  const t = useT();
  const { queue, replace } = useQueue('/curation/metadata', readWorkRecords);
  const [chosen, setChosen] = useState<string | null>(null);

  if (queue.state === 'loading')
    return <p className={styles.soft}>{t('curator.loading')}</p>;
  if (queue.state === 'failed')
    return <FailureNote failure={queue.failure} detail={queue.detail} />;
  const work = queue.value.find((w) => w.id === chosen) ?? queue.value[0];
  if (work === undefined)
    return <p className={styles.soft}>{t('curator.records.none')}</p>;

  return (
    <section className={styles.split}>
      <ul className={styles.picker} aria-label={t('curator.records.works')}>
        {queue.value.map((w) => (
          <li key={w.id}>
            <Button
              fullWidth
              variant={w.id === work.id ? 'primary' : 'secondary'}
              aria-pressed={w.id === work.id}
              onClick={() => setChosen(w.id)}
            >
              <span className={styles.pickTitle}>{w.fields.title}</span>
              <span className={styles.pickMeta}>{w.id}</span>
            </Button>
          </li>
        ))}
      </ul>
      <div>
        <h3 className={styles.itemTitle}>{work.fields.title}</h3>
        <p className={styles.soft}>{t('curator.records.republish')}</p>
        {EDITABLE_FIELDS.map((field) => (
          // Keyed on the value, so a saved edit resets the editor to what Core now holds.
          <FieldEditor
            key={`${work.id}-${field}-${work.fields[field]}`}
            work={work}
            field={field}
            onSaved={replace}
          />
        ))}
      </div>
    </section>
  );
}
