'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/design/primitives';
import { useT } from '@/i18n';
import styles from './Ruler.module.css';

/**
 * Touch geometry calibration.
 *
 * CSS millimetres are a fiction: browsers map 1in to exactly 96 CSS px
 * regardless of the panel's real pixel density, so `30mm` is only 30mm on a
 * display that happens to be 96 DPI. The 30mm touch contract in CLAUDE.md
 * section 10 is a physical claim, so it needs a physical reference.
 *
 * A bank card is one every visitor and every judge has on them, and it is
 * exactly 85.60mm by 53.98mm under ISO/IEC 7810 ID-1. Match the outline to a
 * real card and --device-scale is solved for this panel.
 */

const CARD_WIDTH_MM = 85.6;
const STORAGE_KEY = 'toran.device-scale';

export function Ruler() {
  const t = useT();
  const [scale, setScale] = useState(1);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let stored: number | null = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const parsed = Number.parseFloat(raw);
        if (Number.isFinite(parsed) && parsed > 0.2 && parsed < 5) stored = parsed;
      }
    } catch {
      // Private browsing or blocked storage. Calibration falls back to 1.
    }
    if (stored !== null) setScale(stored);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    document.documentElement.style.setProperty('--device-scale', String(scale));
    try {
      window.localStorage.setItem(STORAGE_KEY, String(scale));
    } catch {
      // Calibration simply does not persist. The UI still works.
    }
  }, [scale, loaded]);

  const reset = useCallback(() => {
    setScale(1);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  // A 0 to 100mm scale, major tick every 10mm.
  const ticks = Array.from({ length: 101 }, (_, i) => i);

  return (
    <div className={styles.wrap}>
      <p style={{ color: 'var(--text-soft)', maxWidth: '62ch' }}>
        {t('system.ruler.intro')}
      </p>

      <div
        className={styles.card}
        style={{ width: `calc(${CARD_WIDTH_MM}mm * ${scale})` }}
      >
        {CARD_WIDTH_MM} mm &times; 53.98 mm
      </div>

      <label className={styles.readout} htmlFor="calibration">
        {t('system.ruler.calibrate')}
      </label>
      <input
        id="calibration"
        className={styles.slider}
        type="range"
        min={0.4}
        max={2.5}
        step={0.005}
        value={scale}
        onChange={(event) => setScale(Number.parseFloat(event.target.value))}
      />

      <div className={styles.scale} aria-hidden="true">
        {ticks.map((mm) => (
          <span
            key={mm}
            className={[styles.tick, mm % 10 === 0 ? styles.tickMajor : '']
              .filter(Boolean)
              .join(' ')}
            style={{ width: `calc(1mm * ${scale})` }}
          />
        ))}
      </div>

      <div className={styles.readout}>
        <span>scale {scale.toFixed(3)}</span>
        <span>1mm = {(scale * (96 / 25.4)).toFixed(2)} css px</span>
        <span>30mm = {(scale * 30 * (96 / 25.4)).toFixed(0)} css px</span>
      </div>

      <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center' }}>
        <div className={styles.target}>30</div>
        <span style={{ color: 'var(--text-soft)', fontSize: 'var(--t-meta)' }}>
          {t('system.ruler.target')}
        </span>
      </div>

      <div>
        <Button variant="quiet" onClick={reset}>
          {t('system.ruler.reset')}
        </Button>
      </div>
    </div>
  );
}
