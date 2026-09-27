'use client';

/**
 * What a first-time visitor is told once the camera has brought them into the
 * hall. D-169.
 *
 * Plainly: this is a digital view of a real hall, and each screen in it runs
 * the software written for a physical kiosk with a touchscreen, a proximity
 * sensor and a card reader. In a browser some of that behaves differently,
 * and some of it needs Toran Core running behind it. It offers the guided
 * tour, and says so once: after that it is in the Hall panel.
 */

import { useFleet } from '@/fleet/FleetProvider';
import { useI18n } from '@/i18n';
import styles from './tour.module.css';

const KEY = 'toran.twin.welcomed';

export function hasBeenWelcomed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function markWelcomed(): void {
  try {
    window.localStorage.setItem(KEY, '1');
  } catch {
    // Storage blocked: the note comes back next visit, which is harmless.
  }
}

export function Welcome({
  onTour,
  onClose,
}: {
  onTour: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { source } = useFleet();

  return (
    <div className={styles.scrim} data-testid="twin-welcome">
      <section
        className={styles.welcome}
        role="dialog"
        aria-modal="false"
        aria-labelledby="twin-welcome-title"
      >
        <p className={styles.count}>{t('welcome.kicker')}</p>
        <h2 id="twin-welcome-title" className={styles.welcomeTitle}>
          {t('welcome.title')}
        </h2>
        <p className={styles.body}>{t('welcome.what')}</p>
        <p className={styles.body}>{t('welcome.devices')}</p>
        <ul className={styles.list}>
          <li>{t('welcome.differs.sensor')}</li>
          <li>{t('welcome.differs.card')}</li>
          <li>{t('welcome.differs.core')}</li>
        </ul>
        <p className={styles.note}>
          {source === 'fleet' ? t('welcome.connected') : t('welcome.notConnected')}
        </p>
        <p className={styles.note}>{t('welcome.local')}</p>
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.primary}
            onClick={onTour}
            data-testid="welcome-tour"
          >
            {t('welcome.tour')}
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={onClose}
            data-testid="welcome-explore"
          >
            {t('welcome.explore')}
          </button>
        </div>
      </section>
    </div>
  );
}
