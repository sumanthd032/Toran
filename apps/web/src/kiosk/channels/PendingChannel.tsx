'use client';

/**
 * A room whose application is built in a later step. It says so plainly, with
 * the step number, rather than showing a mock of software that does not exist.
 */

import type { DeviceChannel } from '@toran/contracts';
import { useT, type MessageKey } from '@/i18n';
import styles from '../kiosk.module.css';

/**
 * Rooms whose application a later step builds. A room that exists is not in
 * this map, so adding one here by mistake cannot hide a built room behind a
 * "coming later" notice.
 */
export const CHANNEL_STEP: Partial<Readonly<Record<DeviceChannel, number>>> = {
  entrance: 6,
  reading: 6,
  provenance: 7,
  timeline: 6,
  manuscript: 8,
  av: 10,
  curator: 10,
};

export function PendingChannel({ channel }: { channel: DeviceChannel }) {
  const t = useT();
  const step = CHANNEL_STEP[channel];
  return (
    <div className={styles.pending}>
      <p className={styles.about}>{t(`channel.${channel}.about` as MessageKey)}</p>
      <p className={styles.pendingNote}>
        {step === undefined ? null : t('kiosk.pending', { step })}
      </p>
    </div>
  );
}
