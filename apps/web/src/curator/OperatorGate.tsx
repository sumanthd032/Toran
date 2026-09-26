'use client';

/**
 * What stands between a curator and the archive: a name and a key.
 *
 * The name is asked for because every decision is recorded against it. The
 * key is checked against Core before it is kept, so a curator finds out it is
 * wrong now rather than after writing a correction they cannot save.
 */

import { useState, type ReactNode } from 'react';
import { Button, Field } from '@/design/primitives';
import { useT, type MessageKey } from '@/i18n';
import { useOperator, type OperatorFailure } from './operator';
import styles from './curator.module.css';

export function FailureNote({
  failure,
  detail,
}: {
  failure: OperatorFailure;
  detail: string;
}) {
  const t = useT();
  return (
    <p className={styles.failure} role="alert">
      {t(`curator.failure.${failure}` as MessageKey)}
      {detail !== '' && <span className={styles.detail}>{detail}</span>}
    </p>
  );
}

export function OperatorGate({ children }: { children: ReactNode }) {
  const t = useT();
  const { base, operator, unlock, lock } = useOperator();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{
    failure: OperatorFailure;
    detail: string;
  } | null>(null);

  if (base === null) {
    return <FailureNote failure="no-core" detail="" />;
  }

  if (operator !== null) {
    return (
      <>
        <div className={styles.signedIn}>
          <span>{t('curator.signedInAs', { name: operator.name })}</span>
          <Button variant="quiet" onClick={lock}>
            {t('curator.lock')}
          </Button>
        </div>
        {children}
      </>
    );
  }

  return (
    <form
      className={styles.gate}
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() === '' || key.trim() === '') return;
        setBusy(true);
        setFailed(null);
        void unlock(name, key).then((result) => {
          setBusy(false);
          if (!result.ok) setFailed({ failure: result.failure, detail: result.detail });
          else setKey('');
        });
      }}
    >
      <h2 className={styles.heading}>{t('curator.unlock.title')}</h2>
      <p className={styles.soft}>{t('curator.unlock.why')}</p>
      <Field
        label={t('curator.unlock.name')}
        value={name}
        autoComplete="name"
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
      />
      <Field
        label={t('curator.unlock.key')}
        type="password"
        value={key}
        autoComplete="current-password"
        onChange={(e) => setKey(e.target.value)}
      />
      {failed !== null && <FailureNote failure={failed.failure} detail={failed.detail} />}
      <div>
        <Button
          type="submit"
          variant="primary"
          disabled={busy || name.trim() === '' || key.trim() === ''}
        >
          {t('curator.unlock.submit')}
        </Button>
      </div>
    </form>
  );
}
