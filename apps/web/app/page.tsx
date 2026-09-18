'use client';

/**
 * The Twin. The default entry to Toran: the camera pushes through the Toran
 * gateway into the hall, where every device is a live application.
 */

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { Button, ReachZone } from '@/design/primitives';
import { useI18n } from '@/i18n';
import { DeviceSheet } from '@/twin/DeviceSheet';
import { DEVICES } from '@/fleet/devices';
import { PerfOverlay } from '@/twin/PerfOverlay';
import { pinnedTier, type Tier } from '@/twin/quality';
import { TwinStateProvider, useTwinState } from '@/twin/state';
import styles from './twin.module.css';

// WebGL has no server render, and the static export must not try to give it one.
const TwinCanvas = dynamic(() => import('@/twin/TwinCanvas'), { ssr: false });

function Hall() {
  const { t } = useI18n();
  const { entered } = useTwinState();
  const [pinned] = useState(() => pinnedTier());
  const [tier, setTier] = useState<Tier>(pinned ?? 'high');
  const [sheet, setSheet] = useState(false);
  const [replay, setReplay] = useState(0);
  const [perf, setPerf] = useState(false);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    setPerf(new URLSearchParams(window.location.search).has('perf'));
    const id = window.setInterval(() => {
      if (window.__toranTwin?.entryStart != null) {
        setDrawn(true);
        window.clearInterval(id);
      }
    }, 50);
    return () => {
      window.clearInterval(id);
      document.documentElement.removeAttribute('data-theme');
    };
  }, []);

  return (
    <main className={styles.root}>
      <div className={styles.canvas} role="img" aria-label={t('twin.canvas.label')}>
        <TwinCanvas
          tier={tier}
          pinned={pinned !== null}
          onTier={setTier}
          replayToken={replay}
        />
      </div>

      <div
        className={styles.loading}
        style={{ opacity: drawn ? 0 : 1 }}
        aria-live="polite"
      >
        {drawn ? '' : t('twin.loading')}
      </div>

      <div className={styles.wordmark} data-shown={entered}>
        <span className={styles.name}>{t('twin.institution')}</span>
        <span className={styles.place}>{t('twin.address')}</span>
      </div>

      <div className={styles.controls} data-shown={entered}>
        <ReachZone align="between">
          <Button variant="quiet" onClick={() => setReplay((n) => n + 1)}>
            {t('twin.replay')}
          </Button>
          <Button variant="primary" onClick={() => setSheet(true)}>
            {t('twin.devices.count', { count: DEVICES.length })}
          </Button>
        </ReachZone>
      </div>

      <DeviceSheet open={sheet} onClose={() => setSheet(false)} />
      {perf && <PerfOverlay />}
    </main>
  );
}

export default function Home() {
  return (
    <TwinStateProvider>
      <Hall />
    </TwinStateProvider>
  );
}
