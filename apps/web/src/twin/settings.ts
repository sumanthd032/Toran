'use client';

/**
 * The Twin's own settings, which the Hall panel sets. D-167.
 *
 * Each of these used to be a flag in the address: ?visitors=0, ?perf,
 * ?quality, ?status. They are one viewer's choices about how they look at the
 * hall, so they live in this browser, and a flag in the address still wins
 * when it is there, so every link made before keeps working.
 */

import { useEffect, useState } from 'react';

export type Quality = 'auto' | 'high' | 'low';
export type Motion = 'system' | 'reduced';

export interface HallSettings {
  /** Show the simulated visitors, and what they drift. */
  readonly visitors: boolean;
  /** The operator strip across the top of an open kiosk. */
  readonly status: boolean;
  /** The frame-time readout. */
  readonly perf: boolean;
  readonly quality: Quality;
  readonly motion: Motion;
}

const DEFAULTS: HallSettings = {
  visitors: true,
  status: false,
  perf: false,
  quality: 'auto',
  motion: 'system',
};

const KEY = 'toran.twin.settings';
let current: HallSettings = DEFAULTS;
let loaded = false;
const listeners = new Set<(s: HallSettings) => void>();

function fromStorage(): Partial<HallSettings> {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw === null ? {} : (JSON.parse(raw) as Partial<HallSettings>);
  } catch {
    return {};
  }
}

function fromAddress(): Partial<HallSettings> {
  const q = new URLSearchParams(window.location.search);
  const out: { -readonly [K in keyof HallSettings]?: HallSettings[K] } = {};
  if (q.get('visitors') === '0') out.visitors = false;
  if (q.has('perf')) out.perf = true;
  if (q.has('status')) out.status = true;
  const quality = q.get('quality');
  if (quality === 'high' || quality === 'low') out.quality = quality;
  return out;
}

function apply(s: HallSettings): void {
  // The kiosk and the hall both honour this, as they honour the system setting.
  if (s.motion === 'reduced')
    document.documentElement.setAttribute('data-motion', 'reduced');
  else document.documentElement.removeAttribute('data-motion');
}

export const hallSettings = {
  get(): HallSettings {
    if (!loaded && typeof window !== 'undefined') {
      loaded = true;
      current = { ...DEFAULTS, ...fromStorage(), ...fromAddress() };
      apply(current);
    }
    return current;
  },
  set(change: Partial<HallSettings>): void {
    current = { ...hallSettings.get(), ...change };
    try {
      window.localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      // Storage blocked: the setting holds for this page.
    }
    apply(current);
    for (const l of listeners) l(current);
  },
  subscribe(listener: (s: HallSettings) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** Whether motion should be cut rather than animated, by this viewer's choice or the system's. */
export function motionReduced(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    hallSettings.get().motion === 'reduced' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function useHallSettings(): HallSettings {
  const [s, setS] = useState<HallSettings>(DEFAULTS);
  useEffect(() => {
    setS(hallSettings.get());
    return hallSettings.subscribe(setS);
  }, []);
  return s;
}
