'use client';

/**
 * One kiosk. The same component runs standalone at /kiosk/<device>/, which is
 * what a Raspberry Pi opens in Chromium kiosk mode, and inside the Twin's
 * bezel. There is no second version for the Twin. That is what makes "the
 * twin and the kiosk run the same build" a literal statement. D-015.
 */

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CuratorDesk } from '@/curator/CuratorDesk';
import { setFeedbackLevel } from '@/design/feedback/sound';
import { DEVICES, type HallDevice } from '@/fleet/devices';
import { I18nProvider, useI18n } from '@/i18n';
import { AmbientSlot } from './ambient';
import { AnnounceProvider } from './announce';
import { createEngagementTracker, EngagementProvider } from './engagement';
import { KioskShell } from './KioskShell';
import { ResearchDesk } from './channels/assistant/ResearchDesk';
import { AudioBooth } from './channels/audio/AudioBooth';
import { AvArchive } from './channels/av/AvArchive';
import { Entrance } from './channels/entrance/Entrance';
import { ManuscriptStation } from './channels/manuscript/ManuscriptStation';
import { ProvenanceRoom } from './channels/provenance/ProvenanceRoom';
import { ReadingRoom } from './channels/reading/ReadingRoom';
import { TimelineWall } from './channels/timeline/TimelineWall';
import { NavProvider, useNavSlot } from './nav';
import { ReachSlot } from './reach';
import {
  nullDriver,
  selectDriver,
  type DriverKind,
  type DriverStatus,
} from './sensor/drivers';
import type { Proximity } from './machine';
import { useAmbient } from './useAmbient';
import { useFleetConfig } from './useFleetConfig';
import { useProximity } from './useProximity';
import { useQuery } from './useQuery';
import { selectReader } from './visitor/card';
import { useVisitor, VisitorProvider } from './visitor/VisitorProvider';
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
  /**
   * The device as the fleet now has it. The Twin passes Core's view, so a
   * device a curator switched to another channel opens as that channel.
   * Standalone, the device finds out for itself by reporting in.
   */
  device?: HallDevice | undefined;
  /**
   * In the Twin, the work Core says this device is drifting toward. A kiosk
   * in the Twin does not report in, so it is told rather than asking.
   */
  drift?: string | null | undefined;
  /** The operator status strip. The Twin sets it from its Hall panel; standalone, ?status does. */
  showStatus?: boolean | undefined;
}

function channelFor(device: HallDevice, live: boolean): ReactNode {
  switch (device.channel) {
    case 'reading':
      return <ReadingRoom live={live} />;
    case 'entrance':
      return <Entrance />;
    case 'timeline':
      return <TimelineWall />;
    case 'provenance':
      return <ProvenanceRoom />;
    case 'manuscript':
      return <ManuscriptStation />;
    case 'audio':
      return <AudioBooth />;
    case 'assistant':
      return <ResearchDesk />;
    case 'av':
      return <AvArchive />;
    case 'curator':
      return <CuratorDesk />;
  }
}

function Kiosk({
  deviceId,
  context,
  onExit,
  live = true,
  device: current,
  drift: told = null,
  showStatus: statusShown,
}: KioskAppProps) {
  const { t } = useI18n();
  const shipped = current ?? DEVICES.find((d) => d.deviceId === deviceId);
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
  const reader = useMemo(
    () => selectReader(query === null ? '' : `?${query.toString()}`, context),
    [context, query],
  );
  const { proximity, driverStatus, touch } = useProximity(driver, {
    startEngaged: context === 'twin',
  });
  // What this device is now, which is what it shipped with until a curator
  // pushes something else. Only a standalone kiosk reports in: one opened in
  // the Twin is a view of a device, not the device.
  const engagement = useMemo(() => createEngagementTracker(), []);
  const { device, drift: reported } = useFleetConfig(
    shipped,
    proximity.state,
    context === 'standalone',
    engagement,
  );
  const drift = context === 'twin' ? told : reported;

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
    // The 2.8 m Timeline Wall at 1920 pixels is 0.18: a wall's pixels are
    // large, so its calibration is small.
    if (Number.isFinite(scale) && scale > 0.05 && scale < 5) {
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

  return (
    <VisitorProvider
      reader={reader}
      session={proximity.session}
      touch={touch}
      defaultLanguage={device.defaultLanguage}
    >
      <EngagementProvider tracker={engagement} drift={drift}>
        <KioskRoot
          device={device}
          drift={drift}
          proximity={proximity}
          touch={touch}
          driverKind={driver.kind}
          driverStatus={driverStatus}
          showStatus={statusShown ?? query?.has('status') ?? false}
          onExit={onExit}
        >
          {channelFor(device, live)}
        </KioskRoot>
      </EngagementProvider>
    </VisitorProvider>
  );
}

function KioskRoot({
  device,
  drift,
  proximity,
  touch,
  driverKind,
  driverStatus,
  showStatus,
  onExit,
  children,
}: {
  device: HallDevice;
  drift: string | null;
  proximity: Proximity;
  touch: () => void;
  driverKind: DriverKind;
  driverStatus: DriverStatus;
  showStatus: boolean;
  onExit: (() => void) | undefined;
  children: ReactNode;
}) {
  const { lang, dir } = useI18n();
  const { profile, visit } = useVisitor();
  const { passages, nearby } = useAmbient(drift);
  const nav = useNavSlot();
  const [tools, setTools] = useState<HTMLDivElement | null>(null);
  const [ambient, setAmbient] = useState<HTMLDivElement | null>(null);
  const [bootedAt, setBootedAt] = useState(0);
  useEffect(() => setBootedAt(performance.now()), []);
  useEffect(() => setFeedbackLevel(profile.audioFirst), [profile.audioFirst]);

  return (
    <div
      className={styles.root}
      data-theme="light"
      data-state={proximity.state}
      data-type-scale={profile.typeScale}
      data-contrast={profile.highContrast ? 'high' : undefined}
      data-motion={profile.reducedMotion ? 'reduced' : undefined}
      data-audio={profile.audioFirst ? 'first' : undefined}
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
      <AnnounceProvider audioFirst={profile.audioFirst}>
        <NavProvider registry={nav.provider}>
          <ReachSlot value={tools}>
            <AmbientSlot value={ambient}>
              <KioskShell
                device={device}
                proximity={proximity}
                driverKind={driverKind}
                driverStatus={driverStatus}
                passages={passages}
                nearby={nearby}
                showStatus={showStatus}
                bootedAt={bootedAt}
                onBack={() => {
                  // Back within the room first; from the room's own start, Back
                  // leaves it, which in the Twin flies out to the hall.
                  if (!nav.back()) {
                    if (onExit !== undefined) onExit();
                    else nav.home();
                  }
                }}
                onHome={nav.home}
                onForward={nav.canForward ? nav.forward : undefined}
                toolsRef={setTools}
                ambientRef={setAmbient}
              >
                {/* A new visitor finds the room at its start, not where the last one left it. */}
                <Fragment key={visit}>{children}</Fragment>
              </KioskShell>
            </AmbientSlot>
          </ReachSlot>
        </NavProvider>
      </AnnounceProvider>
    </div>
  );
}

export function KioskApp(props: KioskAppProps) {
  const device = props.device ?? DEVICES.find((d) => d.deviceId === props.deviceId);
  return (
    <I18nProvider
      initial={device?.defaultLanguage ?? 'en'}
      applyToDocument={props.context === 'standalone'}
    >
      <Kiosk {...props} />
    </I18nProvider>
  );
}
