'use client';

/**
 * What the visitor at this kiosk is reading, for the Honeypot Fleet.
 *
 * A room says which work is on its screen with `useReportTopic`. The tracker
 * keeps the work and when it appeared, and the kiosk's beat asks it for the
 * work only once it has held for DEEP_ENGAGEMENT_MS. A work id is all it
 * holds: no card, no page, no history. honeypot.ts in the contracts.
 */

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { engagement, readTopic } from '@toran/contracts';

export interface EngagementTracker {
  report: (topic: string | null) => void;
  /** The work held past the threshold, or null. */
  deep: () => string | null;
}

export function createEngagementTracker(now: () => number = Date.now): EngagementTracker {
  let state = { topic: null as string | null, since: 0 };
  return {
    report(topic) {
      const next = engagement(state, readTopic(topic), now());
      state = { topic: next.topic, since: next.since };
    },
    deep() {
      return engagement(state, state.topic, now()).deep;
    },
  };
}

const Ctx = createContext<EngagementTracker | null>(null);
const DriftCtx = createContext<string | null>(null);

export function EngagementProvider({
  tracker,
  drift,
  children,
}: {
  tracker: EngagementTracker;
  /** The work being read at a device nearby, as Core last said. */
  drift: string | null;
  children: ReactNode;
}) {
  return (
    <Ctx.Provider value={tracker}>
      <DriftCtx.Provider value={drift}>{children}</DriftCtx.Provider>
    </Ctx.Provider>
  );
}

/** The work being read nearby, for a room with an attract loop of its own. */
export function useDrift(): string | null {
  return useContext(DriftCtx);
}

/**
 * A room reporting the work on its screen. Null when nothing is open. The
 * report is withdrawn when the room unmounts, so a new visitor, who gets the
 * room fresh, does not inherit the last one's reading.
 */
export function useReportTopic(workId: string | null): void {
  const tracker = useContext(Ctx);
  useEffect(() => {
    if (tracker === null) return;
    tracker.report(workId);
    return () => tracker.report(null);
  }, [tracker, workId]);
}
