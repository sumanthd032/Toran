'use client';

import { createContext, useContext } from 'react';

/**
 * Two tiers. High adds bloom, a reflective floor and more particles. Low is
 * what a tablet gets when the performance monitor sees frames slipping, and it
 * must still look like the same building.
 *
 * `?quality=low` or `?quality=high` pins a tier, so a kiosk can be configured
 * rather than left to guess, and so the tablet can be measured in both.
 */
export type Tier = 'high' | 'low';

export const QualityContext = createContext<Tier>('high');

export function useTier(): Tier {
  return useContext(QualityContext);
}

export function pinnedTier(): Tier | null {
  if (typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search).get('quality');
  return q === 'high' || q === 'low' ? q : null;
}
