'use client';

/**
 * The frame every kiosk application runs in.
 *
 * The proxemic state decides what the screen is. Far away it is a wall label:
 * the room's name, large enough to read from 3 m, a page of the archive
 * turning, and the welcome cycling through scripts. Come closer and the page
 * leans in. Closer still and the interface rises into the bottom third. Walk
 * away mid session and it settles rather than asking whether anyone is there.
 */

import { useEffect, useState, type ReactNode } from 'react';
import type { CitedPassage } from '@toran/contracts';
import { Button, Citation } from '@/design/primitives';
import type { HallDevice } from '@/fleet/devices';
import { useI18n, type MessageKey } from '@/i18n';
import { useAnnounce } from './announce';
import { ICON, Icon } from './icons';
import type { Proximity } from './machine';
import { ScriptCarousel } from './ScriptCarousel';
import type { DriverKind, DriverStatus } from './sensor/drivers';
import { CardMark, VisitorButton } from './VisitorControls';
import styles from './kiosk.module.css';

const PASSAGE_HOLD_MS = 9000;

function formatUptime(ms: number): string {
  // The clock and the boot time are both set after mount; for the first tick
  // the difference can be negative, and an operator should never see that.
  const s = Math.floor(Math.max(0, ms) / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export interface KioskShellProps {
  device: HallDevice;
  proximity: Proximity;
  driverKind: DriverKind;
  driverStatus: DriverStatus;
  passages: readonly CitedPassage[];
  /** The passages are what is being read nearby, and the loop says so. */
  nearby: boolean;
  showStatus: boolean;
  bootedAt: number;
  onBack: () => void;
  onHome: () => void;
  onForward?: (() => void) | undefined;
  /** Where a channel's own controls are set, in the reach zone. */
  toolsRef: (element: HTMLDivElement | null) => void;
  /** Where a channel's own attract loop is set, in the ambient layer. */
  ambientRef: (element: HTMLDivElement | null) => void;
  children: ReactNode;
}

export function KioskShell({
  device,
  proximity,
  driverKind,
  driverStatus,
  passages,
  nearby,
  showStatus,
  bootedAt,
  onBack,
  onHome,
  onForward,
  toolsRef,
  ambientRef,
  children,
}: KioskShellProps) {
  const { t, lang } = useI18n();
  const state = proximity.state;
  const attracting = state === 'ambient' || state === 'implicit';

  // Neighbouring kiosks start at different pages so the hall is not in unison.
  const offset = Number.parseInt(device.deviceId.slice(-2), 10) || 0;
  const [turn, setTurn] = useState(0);
  // A drift starts at its first passage, so the hall sees it arrive.
  useEffect(() => setTurn(0), [nearby]);
  useEffect(() => {
    if (!attracting || passages.length < 2) return;
    const id = window.setInterval(() => setTurn((n) => n + 1), PASSAGE_HOLD_MS);
    return () => window.clearInterval(id);
  }, [attracting, passages.length]);
  const current =
    passages.length > 0 ? ((nearby ? 0 : offset) + turn) % passages.length : -1;

  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!showStatus) return;
    setNow(performance.now());
    const id = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(id);
  }, [showStatus]);

  const title = t(`device.channel.${device.channel}` as MessageKey);

  /*
    A visitor who has arrived hears which room they are standing in. Announced
    on arrival rather than on mount, because a kiosk that has been sitting in
    its ambient state for an hour has nobody to tell.
  */
  const announce = useAnnounce();
  const arrived = state === 'subtle' || state === 'personal';
  useEffect(() => {
    if (arrived)
      announce(title, { key: `device.channel.${device.channel}` as MessageKey });
  }, [announce, arrived, device.channel, title]);

  return (
    <>
      {showStatus && (
        <div className={styles.status} data-testid="kiosk-status">
          <span>
            {t('kiosk.status.device')} <b>{device.deviceId}</b>
          </span>
          <span>
            {t('kiosk.status.state')} <b data-testid="kiosk-state">{state}</b>
          </span>
          <span>
            {t('kiosk.status.session')}{' '}
            <b>{proximity.session ? t('kiosk.status.yes') : t('kiosk.status.no')}</b>
          </span>
          <span>
            {t('kiosk.status.language')} <b>{lang}</b>
          </span>
          <span>
            {t('kiosk.status.uptime')} <b>{formatUptime(now - bootedAt)}</b>
          </span>
          <span>
            {t('kiosk.status.sensor')}{' '}
            <b>
              {driverKind === 'null'
                ? t('kiosk.status.no')
                : `${driverKind} ${driverStatus}`}
            </b>
          </span>
        </div>
      )}

      <div className={styles.stage}>
        <div className={`${styles.layer} ${styles.app}`} inert={attracting}>
          <div className={styles.appHead}>
            <h2 className={styles.appTitle}>{title}</h2>
          </div>
          <div className={styles.appBody}>{children}</div>
        </div>
      </div>

      <div
        className={styles.ambient}
        aria-hidden={!attracting}
        data-testid="kiosk-ambient"
      >
        <h1 className={styles.headline}>{title}</h1>
        <div className={styles.carouselRow}>
          <span className={styles.invite}>{t('kiosk.invite')}</span>
          <ScriptCarousel running={attracting} />
        </div>
        <div className={styles.ambientSlot} ref={ambientRef} />
        <figure className={styles.passage}>
          {passages.map((p, i) => (
            <blockquote
              key={`${p.citation.pageId}-${i}`}
              className={styles.passageText}
              data-shown={i === current}
              lang={p.language}
            >
              {/* Over each passage rather than over the figure, which is as tall
                  as the longest passage and would leave the line stranded. */}
              {nearby && (
                <span className={styles.nearby} lang={lang} data-testid="kiosk-nearby">
                  {t('kiosk.nearby')}
                </span>
              )}
              <p style={{ margin: 0 }}>{p.text}</p>
              {p.speaker !== null && (
                <span className={styles.passageSpeaker}>{p.speaker}</span>
              )}
              <Citation citation={p.citation} block />
            </blockquote>
          ))}
        </figure>
      </div>

      <nav className={styles.reach} inert={attracting} aria-label={title}>
        <div className={styles.nav}>
          <Button
            variant="secondary"
            onClick={onBack}
            icon={<Icon d={ICON.back} />}
            aria-label={t('nav.back')}
          >
            <span className={styles.label}>{t('nav.back')}</span>
          </Button>
          <Button
            variant="secondary"
            onClick={onHome}
            icon={<Icon d={ICON.home} />}
            aria-label={t('nav.home')}
          >
            <span className={styles.label}>{t('nav.home')}</span>
          </Button>
          <Button
            variant="secondary"
            onClick={onForward}
            disabled={onForward === undefined}
            icon={<Icon d={ICON.forward} />}
            aria-label={t('nav.forward')}
          >
            <span className={styles.label}>{t('nav.forward')}</span>
          </Button>
        </div>
        <div className={styles.tools} ref={toolsRef} data-testid="kiosk-tools" />
        <div className={styles.visitor}>
          <CardMark />
          <VisitorButton />
        </div>
      </nav>
    </>
  );
}
