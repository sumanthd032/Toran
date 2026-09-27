/**
 * The living hall: visitors at every device, for a hall with no kiosks in it.
 * D-161.
 *
 * The Twin is the product for now, and a Twin of an empty hall shows a fleet
 * of dark screens. So Core can run a visitor at each device that behaves the
 * way the proxemic state machine says a person does: arrives, reads for a
 * while, stays with one work long enough for the Honeypot Fleet to notice,
 * and leaves. Each one reports through the same `Fleet.beat` a kiosk's HTTP
 * beat uses, so the fleet view, config pushes and the drift are all the real
 * code paths, fed by made-up people.
 *
 * Made up, and said to be. Every beat from here marks its device simulated,
 * and the fleet snapshot carries that flag to the Twin, which labels it. A
 * real kiosk that starts reporting for a device takes it over at once.
 */

import {
  BEAT_INTERVAL_MS,
  type DeviceChannel,
  type ProxemicState,
} from '@toran/contracts';
import type { Fleet } from './fleet.ts';

/** Channels whose visitor reads one work at length. They stay longest, and always hold one. */
const READING_CHANNELS: ReadonlySet<DeviceChannel> = new Set([
  'reading',
  'provenance',
  'timeline',
  'manuscript',
]);

/**
 * Channels whose visitor never holds a work: the welcome totem, where a card
 * is picked up, and the curator's desk, which is staff at work, not reading.
 * Every other room is about a work, so its visitor usually holds one.
 */
const NO_TOPIC: ReadonlySet<DeviceChannel> = new Set(['entrance', 'curator']);

interface Visit {
  /** When each phase of the current cycle begins, in ms from its start. */
  readonly implicit: number;
  readonly subtle: number;
  readonly personal: number;
  readonly decaying: number;
  readonly ambient: number;
  readonly topic: string | null;
}

interface Simulated {
  started: number;
  visit: Visit;
  nextBeat: number;
  bootedAt: number;
}

/** A small, seedable generator, so a test can know which visitor comes when. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class HallSimulator {
  private readonly fleet: Fleet;
  private readonly works: readonly string[];
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly devices = new Map<string, Simulated>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    fleet: Fleet,
    works: readonly string[],
    now: () => number = Date.now,
    random: () => number = Math.random,
  ) {
    this.fleet = fleet;
    this.works = works;
    this.now = now;
    this.random = random;
  }

  private between(lo: number, hi: number): number {
    return lo + this.random() * (hi - lo);
  }

  /**
   * One visit: an empty spell, then a visitor who comes close, reads, and
   * goes. Reading rooms hold a visitor longer than a welcome totem does, and a
   * visitor at a reading room stays with one work past the Honeypot threshold.
   */
  private visitFor(channel: DeviceChannel): Visit {
    const reading = READING_CHANNELS.has(channel);
    const implicit = this.between(30_000, 150_000);
    const subtle = implicit + this.between(4000, 9000);
    const personal = subtle + this.between(6000, 15_000);
    const decaying =
      personal + (reading ? this.between(50_000, 160_000) : this.between(20_000, 60_000));
    const ambient = decaying + this.between(15_000, 30_000);
    const holds = !NO_TOPIC.has(channel) && (reading || this.random() < 0.7);
    const topic =
      holds && this.works.length > 0
        ? this.works[Math.floor(this.random() * this.works.length)]!
        : null;
    return { implicit, subtle, personal, decaying, ambient, topic };
  }

  /** Where a visit stands at `t` ms in, and the topic it reports. */
  static phase(
    visit: Visit,
    t: number,
    deepAfter = 30_000,
  ): { state: ProxemicState; topic: string | null } {
    if (t < visit.implicit) return { state: 'ambient', topic: null };
    if (t < visit.subtle) return { state: 'implicit', topic: null };
    if (t < visit.personal) return { state: 'subtle', topic: null };
    if (t < visit.decaying) {
      // A work counts once it has held for the engagement threshold, as a kiosk counts it.
      return {
        state: 'personal',
        topic: t - visit.personal >= deepAfter ? visit.topic : null,
      };
    }
    if (t < visit.ambient) return { state: 'decaying', topic: null };
    return { state: 'ambient', topic: null };
  }

  /** Moves every simulated visitor on, and sends the beats that are due. */
  tick(): void {
    const at = this.now();
    for (const config of this.fleet.configs()) {
      // A real kiosk reporting for this device has the floor.
      if (this.fleet.reportedByDevice(config.deviceId)) {
        this.devices.delete(config.deviceId);
        continue;
      }
      let sim = this.devices.get(config.deviceId);
      if (sim === undefined) {
        const visit = this.visitFor(config.channel);
        sim = {
          // A hall that opens mid-afternoon, not at dawn: each visitor starts
          // somewhere in its visit, so the first look at the Twin finds some
          // devices in use rather than every one in its empty spell.
          started: at - this.random() * visit.ambient,
          visit,
          // Staggered over the first few seconds, so the hall is reporting
          // by the time anyone looks, without thirteen beats in one instant.
          nextBeat: at + this.random() * 3000,
          bootedAt: at - this.between(3600_000, 8 * 3600_000),
        };
        this.devices.set(config.deviceId, sim);
      }
      if (at - sim.started >= sim.visit.ambient) {
        sim.started = at;
        sim.visit = this.visitFor(config.channel);
      }
      if (at < sim.nextBeat) continue;
      sim.nextBeat = at + BEAT_INTERVAL_MS;
      const { state, topic } = HallSimulator.phase(sim.visit, at - sim.started);
      // A simulated kiosk applies a pushed config on its next beat, as a real one does.
      this.fleet.beat(
        config.deviceId,
        {
          state,
          configVersion: config.version,
          uptimeSeconds: Math.floor((at - sim.bootedAt) / 1000),
          topic,
        },
        { simulated: true },
      );
    }
  }

  start(everyMs = 5000): void {
    if (this.timer !== null) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), everyMs);
  }

  /**
   * Stops the visitors, and takes back what they reported, so the Twin shows
   * the hall as its real kiosks report it at once rather than after the
   * simulated beats go stale.
   */
  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.devices.clear();
    this.fleet.forgetSimulated();
  }

  get running(): boolean {
    return this.timer !== null;
  }
}
