'use client';

/**
 * One kiosk. The same component runs standalone at /kiosk/<device>/, which is
 * what a Raspberry Pi opens in Chromium kiosk mode, and inside the Twin's
 * bezel. There is no second version for the Twin. That is what makes "the
 * twin and the kiosk run the same build" a literal statement. D-015.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEVICES } from '@/fleet/devices';
import { I18nProvider, useI18n } from '@/i18n';
import { KioskShell } from './KioskShell';
import { PendingChannel } from './channels/PendingChannel';
import { ReadingChannel, type ReadingControls } from './channels/ReadingChannel';
import { nullDriver, selectDriver } from './sensor/drivers';
import { useAmbient } from './useAmbient';
import { useProximity } from './useProximity';
import { useQuery } from './useQuery';
import styles from './kiosk.module.css';

export type KioskContext = 'standalone' | 'twin';

export interface KioskAppProps {
  deviceId: string;
  context: KioskContext;
  /** Leave the kiosk. In the Twin this flies back out to the hall. */
  onExit?: () => void;
  /**
   * False while the kiosk is arriving in the Twin. Heavy work waits for it.
   * A standalone kiosk is always live.
   */
  live?: boolean;
}

function Kiosk({ deviceId, context, onExit, live = true }: KioskAppProps) {
  const { lang, dir, t } = useI18n();
  const device = DEVICES.find((d) => d.deviceId === deviceId);
  const query = useQuery();
  // A visitor in the Twin has no sensor in front of them, and opening a device
  // is a deliberate act, so it starts engaged. Standalone, the URL decides.
  const driver = useMemo(
    () =>
      context === 'twin' || query === null
        ? nullDriver
        : selectDriver(`?${query.toString()}`),
    [context, query],
  );
  const { proximity, driverStatus, touch } = useProximity(driver, {
    startEngaged: context === 'twin',
  });
  const passages = useAmbient();
  const [bootedAt, setBootedAt] = useState(0);
  useEffect(() => setBootedAt(performance.now()), []);
  const reading = useRef<ReadingControls | null>(null);
  const onReady = useCallback((c: ReadingControls) => {
    reading.current = c;
  }, []);

  const showStatus = context === 'twin' || (query?.has('status') ?? false);

  // Physical calibration. The ambient headline is sized in real millimetres,
  // which only holds if CSS millimetres are real on this panel. A kiosk is
  // configured by its URL, ?scale=1.471 for the 15.6 inch panel in the bill
  // of materials, falling back to a calibration saved from the /system ruler.
  useEffect(() => {
    if (context !== 'standalone' || query === null) return;
    let scale = Number.parseFloat(query.get('scale') ?? '');
    if (!Number.isFinite(scale)) {
      try {
        scale = Number.parseFloat(
          window.localStorage.getItem('toran.device-scale') ?? '',
        );
      } catch {
        scale = Number.NaN;
      }
    }
    if (Number.isFinite(scale) && scale > 0.2 && scale < 5) {
      document.documentElement.style.setProperty('--device-scale', String(scale));
    }
  }, [context, query]);

  if (device === undefined) {
    return (
      <p style={{ padding: 'var(--s-6)' }}>
        {t('kiosk.unknownDevice', { id: deviceId })}
      </p>
    );
  }

  const home = () => reading.current?.home();

  return (
    <div
      className={styles.root}
      data-theme="light"
      data-state={proximity.state}
      data-testid="kiosk"
      data-device={device.deviceId}
      tabIndex={-1}
      lang={lang}
      dir={dir}
      onPointerDownCapture={touch}
      onKeyDownCapture={(e) => {
        // Keyboard use is presence too, for assistive hardware. The simulator's
        // own keys are not, or simulating a visitor at 3 m would wake the kiosk.
        if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ') touch();
      }}
    >
      <KioskShell
        device={device}
        proximity={proximity}
        driverKind={driver.kind}
        driverStatus={driverStatus}
        passages={passages}
        showStatus={showStatus}
        bootedAt={bootedAt}
        onBack={onExit ?? home}
        onHome={home}
      >
        {device.channel === 'reading' ? (
          <ReadingChannel onReady={onReady} live={live} />
        ) : (
          <PendingChannel channel={device.channel} />
        )}
      </KioskShell>
    </div>
  );
}

export function KioskApp(props: KioskAppProps) {
  const device = DEVICES.find((d) => d.deviceId === props.deviceId);
  return (
    <I18nProvider
      initial={device?.defaultLanguage ?? 'en'}
      applyToDocument={props.context === 'standalone'}
    >
      <Kiosk {...props} />
    </I18nProvider>
  );
}
