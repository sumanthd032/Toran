'use client';

/**
 * The Twin. The default entry to Toran: the camera pushes through the Toran
 * gateway into the hall, where every device is a live application. Tapping a
 * device flies to it and opens its application.
 *
 * /?device=<id> opens a device directly, skipping the hall, so a demo can
 * restart from a known state. Browser back closes whatever is open.
 */

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { OperatorProvider } from '@/curator/operator';
import { Button, ReachZone } from '@/design/primitives';
import { DEVICES } from '@/fleet/devices';
import { FleetProvider, useFleet } from '@/fleet/FleetProvider';
import { useI18n } from '@/i18n';
import { KioskApp } from '@/kiosk/KioskApp';
import { searchStarted, sharedSearch } from '@/search/shared';
import { DeviceSheet } from '@/twin/DeviceSheet';
import { PerfOverlay } from '@/twin/PerfOverlay';
import { GuidedTour } from '@/twin/GuidedTour';
import { HallPanel } from '@/twin/HallPanel';
import { hasBeenWelcomed, markWelcomed, Welcome } from '@/twin/Welcome';
import hallStyles from '@/twin/hall.module.css';
import { type Tier } from '@/twin/quality';
import { hallSettings, useHallSettings } from '@/twin/settings';
import { TwinStateProvider, useTwinState } from '@/twin/state';
import { BezelLayer } from '@/twin/transition/BezelLayer';
import { FrameChrome } from '@/twin/transition/FrameChrome';
import { modeFor, openMode, type OpenMode } from '@/twin/transition/store';
import styles from './twin.module.css';

// WebGL has no server render, and the static export must not try to give it one.
const TwinCanvas = dynamic(() => import('@/twin/TwinCanvas'), { ssr: false });

/**
 * The camera's damping (smoothTime 0.35 s) leaves under half a percent of a
 * move 1.4 s after the last input, so by this point the hall is at rest.
 */
const WARM_AFTER_QUIET_MS = 1500;

const isDevice = (id: string | null): id is string =>
  id !== null && DEVICES.some((d) => d.deviceId === id);

function Hall() {
  const { t } = useI18n();
  const { entered, open, phase, openDevice, closeDevice } = useTwinState();
  const fleet = useFleet();
  const [mode, setMode] = useState<OpenMode>('hall');
  useEffect(() => {
    openMode.load();
    return openMode.subscribe(setMode);
  }, []);
  const openDeviceForm = fleet.devices.find((d) => d.deviceId === open)?.form ?? 'kiosk';
  const chosenIn = modeFor(openDeviceForm, mode);
  const [boot, setBoot] = useState<{ deepLink: string | null } | null>(null);
  // The tier the performance monitor chose, used while quality is automatic.
  const [tier, setTier] = useState<Tier>('high');
  const settings = useHallSettings();
  const shownTier: Tier = settings.quality === 'auto' ? tier : settings.quality;
  const [sheet, setSheet] = useState(false);
  const [hallPanel, setHallPanel] = useState(false);
  // The guided tour, and the note a first visit opens with. D-169.
  const [guided, setGuided] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [welcomed, setWelcomed] = useState(true);
  useEffect(() => setWelcomed(hasBeenWelcomed()), []);
  // The tour opens every device on its screen, whatever the viewer chose.
  const openedIn = guided ? 'hall' : chosenIn;
  const [replay, setReplay] = useState(0);
  const [drawn, setDrawn] = useState(false);
  const canvasWrap = useRef<HTMLDivElement>(null);
  const kioskHolder = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  // Everything read from the URL is read here, after mount, so the first
  // client render matches the static export.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const deepLink = query.get('device');
    hallSettings.get();
    setBoot({ deepLink: isDevice(deepLink) ? deepLink : null });
    if (isDevice(deepLink)) openDevice(deepLink, { deepLink: true });

    document.documentElement.setAttribute('data-theme', 'dark');
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
  }, [openDevice]);

  // History: opening a device is a navigation, so the browser's back button
  // closes it, and a URL can be shared.
  useEffect(() => {
    if (phase === 'in' && open !== null) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      window.history.pushState({ device: open }, '', `?device=${open}`);
    }
    if (phase === 'hall' && window.location.search.includes('device=')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    if (phase === 'open') {
      kioskHolder.current?.querySelector<HTMLElement>('[data-testid="kiosk"]')?.focus();
    }
    if (phase === 'hall' && opener.current !== null) {
      opener.current.focus();
      opener.current = null;
    }
  }, [phase, open]);

  useEffect(() => {
    const onPop = () => {
      if (!window.location.search.includes('device=')) closeDevice();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [closeDevice]);

  const close = useCallback(() => {
    if (phase !== 'open') return;
    // If our own history entry is on top, stepping back also runs the close.
    if (window.history.state?.device !== undefined) window.history.back();
    else closeDevice();
  }, [phase, closeDevice]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sheet) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, sheet]);

  // Warm the search engine while the visitor stands in the hall, so the first
  // Reading Room answers at once. The load is about three seconds of heavy work
  // and costs the hall up to seventeen slow frames. With the camera still,
  // nobody sees that. During an orbit, everybody does. So it waits for the
  // visitor to stop touching the hall, not only for the entry to end. A
  // standalone kiosk warms at boot, before anyone arrives. DECISIONS.md D-068.
  useEffect(() => {
    if (!entered || phase !== 'hall' || searchStarted()) return;
    let timer = 0;
    const quiet = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void sharedSearch(), WARM_AFTER_QUIET_MS);
    };
    // Hovering moves nothing. Only a drag turns the camera.
    const drag = (e: PointerEvent) => {
      if (e.buttons !== 0) quiet();
    };
    const inputs = ['pointerdown', 'pointerup', 'wheel', 'keydown'] as const;
    quiet();
    for (const name of inputs) window.addEventListener(name, quiet, { passive: true });
    window.addEventListener('pointermove', drag, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const name of inputs) window.removeEventListener(name, quiet);
      window.removeEventListener('pointermove', drag);
    };
  }, [entered, phase]);

  const covered = phase === 'open';
  // The hall's own interface exists only while the visitor stands in the hall.
  // While it fades, it is inert: nothing half transparent can take focus.
  const hallUi = entered && phase === 'hall';

  return (
    <main className={styles.root}>
      <div
        ref={canvasWrap}
        className={styles.canvas}
        role="img"
        aria-label={t('twin.canvas.label')}
        aria-hidden={covered}
      >
        {boot !== null && (
          <TwinCanvas
            tier={shownTier}
            pinned={settings.quality !== 'auto'}
            onTier={setTier}
            replayToken={replay}
            skipEntry={boot.deepLink !== null}
            // A device opened in the hall keeps the hall around it, alive.
            rendering={!covered || openedIn === 'hall'}
          />
        )}
      </div>

      <div
        className={styles.loading}
        style={{ opacity: drawn ? 0 : 1 }}
        aria-live="polite"
      >
        {drawn ? '' : t('twin.loading')}
      </div>

      <div className={styles.wordmark} data-shown={hallUi} aria-hidden={!hallUi}>
        <span className={styles.name}>{t('twin.institution')}</span>
        <span className={styles.place}>{t('twin.address')}</span>
      </div>

      <div className={styles.controls} data-shown={hallUi} inert={!hallUi}>
        <ReachZone align="between">
          <Button variant="quiet" onClick={() => setReplay((n) => n + 1)}>
            {t('twin.replay')}
          </Button>
          <Button variant="primary" onClick={() => setSheet(true)}>
            {t('twin.devices.count', { count: DEVICES.length })}
          </Button>
        </ReachZone>
      </div>

      <div ref={kioskHolder}>
        {open !== null && (
          <BezelLayer canvasWrap={canvasWrap} interactive={covered}>
            <KioskApp
              key={open}
              deviceId={open}
              device={fleet.devices.find((d) => d.deviceId === open)}
              drift={fleet.drift.get(open) ?? null}
              showStatus={settings.status}
              context="twin"
              onExit={close}
              live={covered}
            />
          </BezelLayer>
        )}
      </div>

      {open !== null && openedIn === 'hall' && phase === 'open' && (
        <FrameChrome
          device={fleet.devices.find((d) => d.deviceId === open) ?? DEVICES[0]!}
          onStepBack={close}
          stepBack={!guided}
        />
      )}
      <DeviceSheet open={sheet} onClose={() => setSheet(false)} />
      {settings.perf && <PerfOverlay />}
      {!hallPanel && (
        <button
          type="button"
          className={hallStyles.toggle}
          onClick={() => setHallPanel(true)}
          data-testid="hall-toggle"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6" />
          </svg>
          {t('hall.title')}
        </button>
      )}
      <HallPanel
        open={hallPanel}
        onClose={() => setHallPanel(false)}
        deviceOpen={phase === 'open' && open !== null}
        quality={settings.quality}
        onQuality={(quality) => hallSettings.set({ quality })}
        onReplay={() => setReplay((n) => n + 1)}
        onTour={() => {
          setHallPanel(false);
          setGuided(true);
        }}
        onAbout={() => {
          setHallPanel(false);
          setWelcome(true);
        }}
      />
      {guided && <GuidedTour close={close} onClose={() => setGuided(false)} />}
      {(welcome ||
        (!welcomed && entered && phase === 'hall' && boot?.deepLink === null)) && (
        <Welcome
          onTour={() => {
            markWelcomed();
            setWelcomed(true);
            setWelcome(false);
            setGuided(true);
          }}
          onClose={() => {
            markWelcomed();
            setWelcomed(true);
            setWelcome(false);
          }}
        />
      )}
    </main>
  );
}

export default function Home() {
  return (
    <TwinStateProvider>
      <OperatorProvider>
        <FleetProvider>
          <Hall />
        </FleetProvider>
      </OperatorProvider>
    </TwinStateProvider>
  );
}
