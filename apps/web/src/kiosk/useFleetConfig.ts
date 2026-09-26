'use client';

/**
 * A kiosk reporting in, and taking the configuration it is given.
 *
 * ARCHITECTURE.md section 10: every thirty seconds a device tells Core what
 * state it is in and which config version it is running, and Core answers with
 * the config a curator decided on. When the two versions differ the device is
 * behind, and it applies what it was handed.
 *
 * A device with no Core reachable keeps the configuration it shipped with and
 * runs unchanged. That is the whole of the fleet row in the degradation matrix:
 * fleet management is unavailable, and nothing else is.
 *
 * Only a standalone kiosk beats. A kiosk opened inside the Twin is a view of a
 * device, not the device, and thirteen of them reporting in would fill the
 * fleet view with machines that are not in the hall.
 */

import { useEffect, useRef, useState } from 'react';
import { BEAT_INTERVAL_MS, type ProxemicState } from '@toran/contracts';
import { sharedCore } from '@/fleet/core';
import type { HallDevice } from '@/fleet/devices';
import type { EngagementTracker } from './engagement';

/** Seconds this page has been up. For a browser kiosk that is the device's uptime. */
const uptime = (): number => Math.floor(performance.now() / 1000);

/**
 * The Honeypot Fleet rides on the same beat. A kiosk tells Core which work its
 * visitor has stayed with, and Core answers with the work being read at the
 * nearest engaged neighbour, which the attract loop drifts toward. Only a
 * visitor who is there counts: a kiosk sinking into its ambient state has
 * nobody reading, whatever is still on the screen.
 */
const PRESENT: readonly ProxemicState[] = ['subtle', 'personal'];

export function useFleetConfig(
  shipped: HallDevice | undefined,
  state: ProxemicState,
  enabled: boolean,
  engagement: EngagementTracker,
): { device: HallDevice | undefined; drift: string | null } {
  const [pushed, setPushed] = useState<HallDevice | null>(null);
  const [drift, setDrift] = useState<string | null>(null);

  // What a beat reports is read at the moment it is sent. Both of these change
  // several times a minute, and putting either in the effect's dependencies
  // would restart the timer on each change, so a device would report in
  // whenever a visitor moved rather than on a schedule.
  const now = useRef({ state, version: shipped?.version ?? 1 });
  now.current = { state, version: pushed?.version ?? shipped?.version ?? 1 };

  const deviceId = shipped?.deviceId;
  const form = shipped?.form;

  useEffect(() => {
    if (!enabled || deviceId === undefined) return;
    const core = sharedCore();
    if (core.base === null) return;

    let live = true;
    const report = async () => {
      const reply = await core.beat(deviceId, {
        state: now.current.state,
        configVersion: now.current.version,
        uptimeSeconds: uptime(),
        topic: PRESENT.includes(now.current.state) ? engagement.deep() : null,
      });
      if (!live || reply === null) return;
      setDrift(reply.drift);
      if (!reply.changed) return;
      // The form is physical. A curator can change what a device shows and
      // what language it opens in; they cannot turn a wall into a booth from
      // a console, so the form is carried over rather than taken from the wire.
      setPushed({ ...reply.config, form: form ?? 'kiosk' });
    };

    void report();
    const timer = setInterval(() => void report(), BEAT_INTERVAL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [deviceId, enabled, form, engagement]);

  return { device: pushed ?? shipped, drift };
}
