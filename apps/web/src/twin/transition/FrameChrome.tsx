'use client';

/**
 * What stands around a device opened in the hall: a brass plaque under its
 * screen, the way a museum labels an object, and a way to step back out.
 *
 * The plaque follows the screen's projected rectangle through the same store
 * the application's layer reads, so the two cannot drift apart. Stepping back
 * lives out here in the hall, not inside the kiosk, whose Back, Home and
 * Forward stay the kiosk's own three. D-165.
 */

import { useEffect, useRef } from 'react';
import { statusOf, type HallDevice } from '@/fleet/devices';
import { useFleet } from '@/fleet/FleetProvider';
import { useI18n, type MessageKey } from '@/i18n';
import { bezel } from './store';
import styles from './frame.module.css';

export function FrameChrome({
  device,
  onStepBack,
}: {
  device: HallDevice;
  onStepBack: () => void;
}) {
  const { t } = useI18n();
  const { health, drift, titleOf } = useFleet();
  const plaque = useRef<HTMLDivElement>(null);
  const h = health.get(device.deviceId);
  const status = statusOf(h);
  const drifting = drift.get(device.deviceId);

  useEffect(
    () =>
      bezel.subscribe((f) => {
        const el = plaque.current;
        if (el === null) return;
        // Under the screen, as a label sits under an object. A screen too tall
        // for that, like the portrait totem's, has it beside, at its foot.
        const below = f.rect.w >= f.rect.h;
        el.dataset.side = below ? 'below' : 'beside';
        const x = below ? f.rect.x : f.rect.x + f.rect.w + 24;
        const y = below ? f.rect.y + f.rect.h : f.rect.y + f.rect.h - el.offsetHeight;
        el.style.transform = `translate3d(${String(x)}px, ${String(y)}px, 0)`;
        el.style.width = below ? `${String(f.rect.w)}px` : '22em';
        el.style.opacity = String(f.opacity);
      }),
    [],
  );

  return (
    <>
      <div ref={plaque} className={styles.plaque} aria-hidden="true">
        <span className={styles.name}>
          {t(`device.channel.${device.channel}` as MessageKey)}
        </span>
        <span className={styles.meta}>
          {device.deviceId}
          {' · '}
          {h?.simulated === true
            ? t('device.status.simulated', {
                status: t(`device.status.${status}` as MessageKey),
              })
            : t(`device.status.${status}` as MessageKey)}
        </span>
        {drifting !== undefined && (
          <span className={styles.drift}>
            {t('twin.nearby', { title: titleOf(drifting) })}
          </span>
        )}
      </div>
      <div className={styles.stepBack}>
        {/* Twin chrome for a desk and a mouse, not the kiosk's 30 mm controls:
            it has to fit the margin above the screen without covering it. */}
        <button
          type="button"
          className={styles.back}
          onClick={onStepBack}
          data-testid="twin-step-back"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          {t('twin.stepBack')}
        </button>
      </div>
    </>
  );
}
