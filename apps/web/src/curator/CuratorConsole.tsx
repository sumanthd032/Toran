'use client';

/**
 * The Curator Console. Device 12, and /curator on the operator's own machine.
 * R14.
 *
 * This is the staff surface: a desk, a mouse and a keyboard, and the one
 * application allowed to need a network, because everything it does is a
 * decision written to the archive through Toran Core. PROJECT.md section 7.8.
 * Four queues and the fleet, each a tab, and every one of them empty of
 * anything a curator did not have in front of them when they decided.
 */

import { useState } from 'react';
import { Button } from '@/design/primitives';
import { FleetPanel } from '@/fleet/FleetPanel';
import { useT, type MessageKey } from '@/i18n';
import { IngestPanel } from './IngestPanel';
import { LinksPanel } from './LinksPanel';
import { OcrPanel } from './OcrPanel';
import { OperatorGate } from './OperatorGate';
import { RecordsPanel } from './RecordsPanel';
import styles from './curator.module.css';

const TABS = ['ingest', 'records', 'ocr', 'links', 'fleet'] as const;
type Tab = (typeof TABS)[number];

export function CuratorConsole() {
  const t = useT();
  const [tab, setTab] = useState<Tab>('ingest');

  return (
    <div className={styles.console}>
      <OperatorGate>
        <nav className={styles.tabs} aria-label={t('curator.title')}>
          {TABS.map((name) => (
            <Button
              key={name}
              variant={tab === name ? 'primary' : 'secondary'}
              aria-pressed={tab === name}
              onClick={() => setTab(name)}
            >
              {t(`curator.tab.${name}` as MessageKey)}
            </Button>
          ))}
        </nav>
        <div className={styles.body}>
          {tab === 'ingest' && <IngestPanel />}
          {tab === 'records' && <RecordsPanel />}
          {tab === 'ocr' && <OcrPanel />}
          {tab === 'links' && <LinksPanel />}
          {tab === 'fleet' && <FleetPanel />}
        </div>
        {/* A decision is live in Core's archive at once. A kiosk serving the
            static export sees it after the next web build. */}
        <p className={styles.soft}>{t('curator.publishNote')}</p>
      </OperatorGate>
    </div>
  );
}
