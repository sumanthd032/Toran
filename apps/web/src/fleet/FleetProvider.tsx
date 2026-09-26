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
import { manifest } from '@/archive/client';
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
  /** The work each device is drifting toward, by device id. D-162. */
  readonly drift: ReadonlyMap<string, string>;
  /** A work's title, for a drift drawn on a screen in the hall. */
  readonly titleOf: (workId: string) => string;
  /** How many devices are reporting through Core's hall simulator. */
  readonly simulated: number;
  refresh: () => void;
}

export function mergeFleet(
  snapshot: FleetSnapshot,
  { visitors = true }: { visitors?: boolean } = {},
): {
  devices: HallDevice[];
  health: Map<string, DeviceHealth>;
  drift: Map<string, string>;
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
  // ?visitors=0 shows the hall as its real kiosks report it: a simulated
  // device is then a device with no report. A drift does not say where it
  // came from, so while any device is simulated none is trusted to be real.
  const health = snapshot.health.filter((h) => visitors || !h.simulated);
  const anySimulated = snapshot.health.some((h) => h.simulated);
  return {
    devices,
    health: new Map(health.map((h) => [h.deviceId, h])),
    drift:
      visitors || !anySimulated
        ? new Map(snapshot.drift.map((d) => [d.deviceId, d.work]))
        : new Map(),
  };
}

const Ctx = createContext<FleetView | null>(null);

export function FleetProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null);
  const [fixture] = useState(() => fixtureHealth());
  const [tick, setTick] = useState(0);
  const [titles, setTitles] = useState<ReadonlyMap<string, string>>(new Map());
  const [visitors, setVisitors] = useState(true);

  // Read after mount, so the first render matches the static export.
  useEffect(() => {
    setVisitors(new URLSearchParams(window.location.search).get('visitors') !== '0');
    manifest().then(
      (m) => setTitles(new Map(m.works.map((w) => [w.id, w.title]))),
      () => undefined,
    );
  }, []);

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
    const titleOf = (workId: string) => titles.get(workId) ?? workId;
    if (snapshot === null) {
      return {
        devices: DEVICES,
        health: fixture,
        source: 'fixture',
        at: null,
        drift: new Map(),
        titleOf,
        simulated: 0,
        refresh,
      };
    }
    const { devices, health, drift } = mergeFleet(snapshot, { visitors });
    const simulated = [...health.values()].filter((h) => h.simulated).length;
    return {
      devices,
      health,
      source: 'fleet',
      at: snapshot.at,
      drift,
      titleOf,
      simulated,
      refresh,
    };
  }, [snapshot, fixture, refresh, titles, visitors]);

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
