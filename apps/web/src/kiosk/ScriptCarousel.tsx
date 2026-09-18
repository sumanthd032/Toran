'use client';

/**
 * The same welcome in every script the carousel has a face for, one at a
 * time. Shown only in the ambient and implicit states, before anyone has
 * touched the kiosk. PROJECT.md section 6.3.
 */

import { useEffect, useState } from 'react';
import { CAROUSEL, CAROUSEL_HOLD_MS } from './carousel';
import styles from './kiosk.module.css';

export function ScriptCarousel({ running }: { running: boolean }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % CAROUSEL.length),
      CAROUSEL_HOLD_MS,
    );
    return () => window.clearInterval(id);
  }, [running]);

  return (
    <div className={styles.carousel} aria-hidden="true">
      {CAROUSEL.map((p, i) => (
        <span
          key={p.lang}
          lang={p.lang}
          dir={p.direction}
          className={styles.carouselPhrase}
          data-shown={i === index}
          style={{ fontFamily: `"${p.family}", var(--font-read)` }}
        >
          {p.text}
        </span>
      ))}
    </div>
  );
}
