'use client';

import { createContext, useContext } from 'react';

/**
 * Two tiers. High adds bloom, a reflective floor and more particles. Low is
 * what a tablet gets when the performance monitor sees frames slipping, and it
 * must still look like the same building.
 *
 * `?quality=low` or `?quality=high`, or the Hall panel, pins a tier
 * (settings.ts), so a kiosk can be configured rather than left to guess, and
 * so the tablet can be measured in both.
 */
export type Tier = 'high' | 'low';

export const QualityContext = createContext<Tier>('high');

export function useTier(): Tier {
  return useContext(QualityContext);
}
