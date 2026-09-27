'use client';

/**
 * The visitor standing at a kiosk opened in the Twin. D-167.
 *
 * A kiosk in the Twin has no sensor and no reader in front of it, so the Hall
 * panel plays the visitor: it can step them back to three metres, bring them
 * to arm's length, and lay either of two cards on the reader. The kiosk hears
 * this through the same driver and reader interfaces the hardware daemon's
 * messages arrive by, so the proxemic states and the card run their real code.
 * F8 and F9 still tap the two cards, as they always have in the Twin.
 */

import type { CardReader } from '../visitor/card';
import { SIMULATED_CARDS } from '../visitor/card';
import type { SensorDriver } from './drivers';

/** Where the panel can put the visitor, in metres from the screen. */
export const TWIN_DISTANCES = { away: 5, passing: 2.2, near: 1, reading: 0.3 } as const;
export type TwinDistance = keyof typeof TWIN_DISTANCES;

let metres: number = TWIN_DISTANCES.reading;
const distanceListeners = new Set<(m: number) => void>();
const cardListeners = new Set<(token: string) => void>();

export const twinVisitor = {
  /** Where the visitor stands now. */
  at(): number {
    return metres;
  },
  stand(where: TwinDistance): void {
    metres = TWIN_DISTANCES[where];
    for (const l of distanceListeners) l(metres);
  },
  tap(card: 'a' | 'b'): void {
    const token = card === 'a' ? SIMULATED_CARDS['F8']! : SIMULATED_CARDS['F9']!;
    for (const l of cardListeners) l(token);
  },
  /** A newly opened kiosk has its visitor at the screen, as opening it was a choice to use it. */
  reset(): void {
    metres = TWIN_DISTANCES.reading;
  },
};

export const twinDriver: SensorDriver = {
  kind: 'simulator',
  start: (sink) => {
    sink.status('live');
    const report = (m: number) => sink.distance(m, performance.now());
    distanceListeners.add(report);
    report(metres);
    // Ten a second, like the real sensor, so the rest of the kiosk cannot tell.
    const id = window.setInterval(() => report(metres), 100);
    return () => {
      distanceListeners.delete(report);
      window.clearInterval(id);
    };
  },
};

export const twinReader: CardReader = {
  kind: 'simulator',
  start: (onCard) => {
    cardListeners.add(onCard);
    const onKey = (e: KeyboardEvent) => {
      const token = SIMULATED_CARDS[e.key];
      if (token === undefined || e.repeat) return;
      e.preventDefault();
      onCard(token);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cardListeners.delete(onCard);
      window.removeEventListener('keydown', onKey);
    };
  },
};
