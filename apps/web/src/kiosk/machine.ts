/**
 * Sannidhi, the proxemic state machine. DECISIONS.md D-022.
 *
 * Vogel and Balakrishnan's four phases for public displays, plus a decay
 * state. A pure reducer: no React, no timers, no hardware. Time arrives in
 * events, so every transition can be tested by replaying a sequence.
 *
 *   ambient    nobody near. The attract loop, readable from across the hall.
 *   implicit   someone passing within 3 m. The screen invites, asks nothing.
 *   subtle     someone within 1.5 m. The interface rises from the bottom third.
 *   personal   someone at the kiosk, or touching it. Full interaction.
 *   decaying   the engaged visitor has gone quiet. The interface settles.
 *              There is no "are you still there" modal, ever.
 *
 * With no sensor the kiosk cannot know anyone is near, so it boots to subtle
 * and behaves as an ordinary touch kiosk: the interface is up and waiting.
 */

import type { ProxemicState } from '@toran/contracts';

export interface ProximityConfig {
  readonly thresholds: {
    readonly implicit: number;
    readonly subtle: number;
    readonly personal: number;
  };
  readonly hysteresis: number;
  readonly engagementRadius: number;
  readonly idle: {
    readonly decayBegins: number;
    readonly returnToAmbient: number;
    readonly dropSession: number;
  };
}

export type SensorPresence = 'sensor' | 'none';

export interface Proximity {
  readonly state: ProxemicState;
  readonly sensor: SensorPresence;
  /** Last smoothed reading in metres, or null with no sensor. */
  readonly distance: number | null;
  /** Last touch, or last moment a visitor stood within the engagement radius. */
  readonly lastActivity: number;
  /** A visitor session exists: language and dossier are held for them. */
  readonly session: boolean;
  /** When the current state was entered. */
  readonly since: number;
}

export type ProximityEvent =
  | { readonly type: 'boot'; readonly at: number; readonly sensor: SensorPresence }
  | { readonly type: 'distance'; readonly at: number; readonly metres: number }
  | { readonly type: 'touch'; readonly at: number }
  | { readonly type: 'tick'; readonly at: number }
  /**
   * The sensor came or went, typically the hardware daemon restarting. This
   * changes how the kiosk decides, not what it holds: a visitor's session is
   * never dropped because a cable was pulled.
   */
  | { readonly type: 'sensor'; readonly at: number; readonly presence: SensorPresence };

export function boot(at: number, sensor: SensorPresence): Proximity {
  return {
    state: sensor === 'none' ? 'subtle' : 'ambient',
    sensor,
    distance: null,
    lastActivity: at,
    session: false,
    since: at,
  };
}

function enter(m: Proximity, state: ProxemicState, at: number): Proximity {
  return state === m.state ? m : { ...m, state, since: at };
}

const RANK: Record<ProxemicState, number> = {
  ambient: 0,
  implicit: 1,
  subtle: 2,
  personal: 3,
  decaying: 2,
};

/**
 * Which zone a reading falls in. Entering a closer zone needs the reading to
 * cross the threshold; leaving it needs the reading to cross the threshold
 * plus the hysteresis margin.
 */
export function zone(
  metres: number,
  current: ProxemicState,
  c: ProximityConfig,
): ProxemicState {
  const { implicit, subtle, personal } = c.thresholds;
  const r = RANK[current];
  const h = c.hysteresis;
  if (metres < (r >= 3 ? personal + h : personal)) return 'personal';
  if (metres < (r >= 2 ? subtle + h : subtle)) return 'subtle';
  if (metres < (r >= 1 ? implicit + h : implicit)) return 'implicit';
  return 'ambient';
}

export function reduce(m: Proximity, e: ProximityEvent, c: ProximityConfig): Proximity {
  switch (e.type) {
    case 'boot':
      return boot(e.at, e.sensor);

    case 'touch':
      // A touch means someone is there, whatever the sensor thinks.
      return enter({ ...m, lastActivity: e.at, session: true }, 'personal', e.at);

    case 'distance': {
      const engaged = e.metres < c.engagementRadius;
      const next: Proximity = {
        ...m,
        distance: e.metres,
        lastActivity: engaged ? e.at : m.lastActivity,
      };
      const z = zone(e.metres, m.state, c);

      if (m.state === 'personal') {
        if (z === 'personal') return next;
        if (z === 'subtle') return enter(next, 'subtle', e.at);
        // They left mid session. Settle rather than snap to the attract loop.
        return enter(next, 'decaying', e.at);
      }
      if (m.state === 'decaying') {
        if (z === 'personal') return enter({ ...next, session: true }, 'personal', e.at);
        if (z === 'subtle') return enter(next, 'subtle', e.at);
        return next;
      }
      // Before anyone engages, the kiosk follows whoever is passing.
      if (z === 'personal') return enter({ ...next, session: true }, 'personal', e.at);
      return enter(next, z, e.at);
    }

    case 'sensor': {
      if (e.presence === m.sensor) return m;
      const next: Proximity = {
        ...m,
        sensor: e.presence,
        distance: e.presence === 'none' ? null : m.distance,
      };
      // Without a sensor nobody can be detected approaching, so a kiosk left in
      // a sensor driven state would wait forever. Put the interface up instead.
      if (e.presence === 'none' && (m.state === 'ambient' || m.state === 'implicit')) {
        return enter({ ...next, lastActivity: e.at }, 'subtle', e.at);
      }
      return next;
    }

    case 'tick': {
      const idle = e.at - m.lastActivity;
      let next = m;
      if (next.session && idle >= c.idle.dropSession) next = { ...next, session: false };
      if (
        (next.state === 'personal' || next.state === 'subtle') &&
        idle >= c.idle.decayBegins
      ) {
        next = enter(next, 'decaying', e.at);
      }
      if (next.state === 'decaying' && idle >= c.idle.returnToAmbient) {
        next = enter(next, 'ambient', e.at);
      }
      return next;
    }
  }
}
