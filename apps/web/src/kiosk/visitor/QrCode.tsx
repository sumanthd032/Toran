'use client';

/**
 * A QR code as a single SVG path: crisp at any size, no image to decode, and
 * drawn in the theme's ink on its paper, so high contrast applies to it too.
 *
 * Error correction M. A code on a glossy kiosk screen, read by a phone held at
 * an angle, loses more than the 7% that level L can recover.
 */

import { useMemo } from 'react';
import { encode } from 'uqr';
import styles from './qr.module.css';

export function QrCode({ value, label }: { value: string; label: string }) {
  const qr = useMemo(() => encode(value, { ecc: 'M', border: 2 }), [value]);
  const d = useMemo(() => {
    let path = '';
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) path += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return path;
  }, [qr]);
  return (
    <svg
      className={styles.qr}
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      data-testid="dossier-qr"
      data-value={value}
    >
      <rect width={qr.size} height={qr.size} className={styles.paper} />
      <path d={d} className={styles.ink} />
    </svg>
  );
}
