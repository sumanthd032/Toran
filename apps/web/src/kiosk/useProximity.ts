'use client';

/**
 * Wires a sensor driver to the state machine and keeps time.
 *
 * The machine is pure and knows nothing about sensors going missing. This hook
 * does: a hardware driver that is not live, or that drops for more than three
 * seconds, is reported to the machine as no sensor, so the kiosk behaves as a
 * touch kiosk rather than sitting in its attract loop ignoring the person in
 * front of it.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  ENGAGEMENT_RADIUS,
  IDLE,
  PROXEMIC_HYSTERESIS,
  PROXEMIC_THRESHOLDS,
} from '@toran/contracts';
import {
  boot,
  reduce,
  type Proximity,
  type ProximityConfig,
  type ProximityEvent,
} from './machine';
import type { DriverStatus, SensorDriver } from './sensor/drivers';
import { createMedian } from './sensor/smooth';

export const PROXIMITY_CONFIG: ProximityConfig = {
  thresholds: PROXEMIC_THRESHOLDS,
  hysteresis: PROXEMIC_HYSTERESIS,
  engagementRadius: ENGAGEMENT_RADIUS,
  idle: IDLE,
};

const DOWN_GRACE_MS = 3000;

export interface ProximityHandle {
  readonly proximity: Proximity;
  readonly driverStatus: DriverStatus;
  touch: () => void;
}

export function useProximity(
  driver: SensorDriver,
  options: { startEngaged?: boolean } = {},
): ProximityHandle {
  const [proximity, dispatch] = useReducer(
    (m: Proximity, e: ProximityEvent) => reduce(m, e, PROXIMITY_CONFIG),
    undefined,
    // A hardware driver starts as no sensor until it proves it is live.
    () => boot(performance.now(), 'none'),
  );
  const [driverStatus, setDriverStatus] = useState<DriverStatus>('connecting');
  const downTimer = useRef(0);

  const touch = useCallback(() => dispatch({ type: 'touch', at: performance.now() }), []);

  useEffect(() => {
    if (options.startEngaged) touch();
  }, [options.startEngaged, touch]);

  useEffect(() => {
    const smooth = createMedian(5);
    const stop = driver.start({
      distance: (metres, at) =>
        dispatch({ type: 'distance', metres: smooth(metres), at }),
      // A card tap means someone is standing there. The session it carries is step 6.
      card: (_token, at) => dispatch({ type: 'touch', at }),
      status: (status) => {
        setDriverStatus(status);
        window.clearTimeout(downTimer.current);
        if (status === 'live' && driver.kind !== 'null') {
          dispatch({ type: 'sensor', presence: 'sensor', at: performance.now() });
        } else if (status === 'down') {
          downTimer.current = window.setTimeout(
            () => dispatch({ type: 'sensor', presence: 'none', at: performance.now() }),
            driver.kind === 'null' ? 0 : DOWN_GRACE_MS,
          );
        }
      },
    });
    return () => {
      window.clearTimeout(downTimer.current);
      stop();
    };
  }, [driver]);

  useEffect(() => {
    const id = window.setInterval(
      () => dispatch({ type: 'tick', at: performance.now() }),
      1000,
    );
    return () => window.clearInterval(id);
  }, []);

  return { proximity, driverStatus, touch };
}
