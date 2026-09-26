'use client';

/**
 * The hall as Toran Core reports it, for the Twin and the Curator Console.
 *
 * With a Core configured, the view is Core's: what each device should be and
 * what it last said about itself, fetched every ten seconds. With none, it is
 * the roster the web app shipped with and the health fixture, and `source`
 * says so, because a fleet view that shows made-up health without saying it
 * is made up is worse than no fleet view.
 *
 * Only the channel, the language and the version are taken from Core. The
 * position and the form stay as shipped: the hall's geometry is baked from
 * them, and a curator changes what a device shows, not where it is bolted.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { DeviceHealth, FleetSnapshot } from '@toran/contracts';
import { sharedCore } from './core';
import { DEVICES, fixtureHealth, type HallDevice } from './devices';

/** How often the view asks Core. A third of a beat, so a push is seen landing. */
const POLL_MS = 10_000;

export interface FleetView {
  readonly devices: readonly HallDevice[];
  readonly health: ReadonlyMap<string, DeviceHealth>;
  readonly source: 'fleet' | 'fixture';
  /** When Core's view was taken, or null for the fixture. */
  readonly at: string | null;
  refresh: () => void;
}

export function mergeFleet(snapshot: FleetSnapshot): {
  devices: HallDevice[];
  health: Map<string, DeviceHealth>;
} {
  const live = new Map(snapshot.devices.map((d) => [d.deviceId, d]));
  const devices = DEVICES.map((shipped) => {
    const config = live.get(shipped.deviceId);
    return config === undefined
      ? shipped
      : {
          ...shipped,
          channel: config.channel,
          defaultLanguage: config.defaultLanguage,
          version: config.version,
        };
  });
  return { devices, health: new Map(snapshot.health.map((h) => [h.deviceId, h])) };
}

const Ctx = createContext<FleetView | null>(null);

export function FleetProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null);
  const [fixture] = useState(() => fixtureHealth());
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const core = sharedCore();
    if (core.base === null) return;
    let live = true;
    const fetchFleet = () =>
      void core.fleet().then((found) => {
        // A failed poll keeps the last view rather than falling back to the
        // fixture: the hall did not change because the network blinked.
        if (live && found !== null) setSnapshot(found);
      });
    fetchFleet();
    const id = window.setInterval(fetchFleet, POLL_MS);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [tick]);

  const value = useMemo<FleetView>(() => {
    if (snapshot === null) {
      return { devices: DEVICES, health: fixture, source: 'fixture', at: null, refresh };
    }
    const { devices, health } = mergeFleet(snapshot);
    return { devices, health, source: 'fleet', at: snapshot.at, refresh };
  }, [snapshot, fixture, refresh]);

  useEffect(() => {
    if (window.__toranTwin !== undefined) window.__toranTwin.statusSource = value.source;
  }, [value.source]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFleet(): FleetView {
  const ctx = useContext(Ctx);
  if (ctx === null) throw new Error('useFleet must be used inside FleetProvider');
  return ctx;
}
