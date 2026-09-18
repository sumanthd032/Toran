'use client';

import { useEffect, useState } from 'react';
import styles from './Swatch.module.css';

/**
 * Reads the token's actual computed value from the document rather than
 * repeating a hex in the source. A swatch that claims a colour the theme is
 * not currently using is worse than no swatch, and the label has to stay
 * readable whatever the chip resolves to.
 */

function toHex(rgb: string): string {
  const m = rgb.match(/\d+(\.\d+)?/g);
  if (m === null || m.length < 3) return rgb;
  return (
    '#' +
    m
      .slice(0, 3)
      .map((v) => Math.round(Number(v)).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

export interface SwatchProps {
  name: string;
  token: string;
  role: string;
  /** Measured against the reading surface by tools/contrast-check.mjs. */
  ratio: string;
  /** Redraw when the theme changes. */
  themeKey: string;
}

export function Swatch({ name, token, role, ratio, themeKey }: SwatchProps) {
  const [computed, setComputed] = useState({ hex: '' });

  useEffect(() => {
    let frame = 0;

    const read = () => {
      // Read after paint. The theme attribute is written by an effect on the
      // parent, and React runs child effects before parent effects, so a
      // synchronous read here would report the previous theme's value.
      frame = requestAnimationFrame(() => {
        const probe = document.createElement('span');
        probe.style.color = `var(${token})`;
        probe.style.display = 'none';
        document.body.appendChild(probe);
        const rgb = getComputedStyle(probe).color;
        probe.remove();
        // Pick whichever label colour actually contrasts better against
        // this chip, rather than guessing from a luminance threshold. A
        // mid-tone like brass-lit needs ink, not paper.
        setComputed({ hex: toHex(rgb) });
      });
    };

    read();

    // The theme can also change without React knowing, for example from the
    // system preference or an automated check. Observing the attribute keeps
    // the label and its contrast correct whatever moved it.
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [token, themeKey]);

  return (
    <div className={styles.swatch}>
      <div className={styles.chip} style={{ background: `var(${token})` }} />
      <div className={styles.meta}>
        <span className={styles.name}>{name}</span>
        <span className={styles.hex}>{computed.hex}</span>
        <span>{token}</span>
        <span>
          {ratio} &middot; {role}
        </span>
      </div>
    </div>
  );
}
