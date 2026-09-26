/**
 * The Honeypot Fleet. PROJECT.md section 6.3, innovation 4.
 *
 * When a visitor stays with one work at one device, the ambient displays near
 * it drift toward that work. Brignull and Rogers saw that a display in use
 * draws a crowd; this makes the fleet do it with content. What moves between
 * devices is a work's id and nothing else: no card token, no session, no time
 * a person arrived. A device learns that something near it is being read, not
 * who is reading it or where exactly.
 *
 * Everything here is a pure function, so the three rules can be tested
 * without a hall: when engagement counts as deep, which neighbour a device
 * drifts toward, and which passages it then shows.
 */

import type { CitedPassage } from './citation.ts';

/**
 * How long one work has to hold a visitor before the hall hears about it.
 *
 * Long enough that someone scanning past a page does not send the next wall
 * into a spin, and short enough that a person reading still is noticed while
 * they are still reading. The idle decay begins at 45 s, so a topic that
 * outlives its reader is dropped by the state machine, not by this.
 */
export const DEEP_ENGAGEMENT_MS = 30_000;

/**
 * How far a topic carries, in metres of hall floor.
 *
 * PROJECT.md's example is a wall two metres from the Provenance kiosk. Eight
 * metres reaches the next bay of the nave and not the far end of it, so a
 * crowd at the entrance does not rearrange the displays at the Chaitya arch.
 */
export const HONEYPOT_RADIUS_M = 8;

/** A work id, as the archive writes one. Nothing longer ever crosses the wire. */
const TOPIC = /^[a-z0-9][a-z0-9-]{1,63}$/;

export function readTopic(value: unknown): string | null {
  return typeof value === 'string' && TOPIC.test(value) ? value : null;
}

export interface EngagedDevice {
  readonly deviceId: string;
  readonly position: readonly [number, number, number];
  readonly topic: string;
}

export interface PlacedDevice {
  readonly deviceId: string;
  readonly position: readonly [number, number, number];
}

const floorDistance = (a: PlacedDevice['position'], b: PlacedDevice['position']) =>
  Math.hypot(a[0] - b[0], a[2] - b[2]);

/**
 * The topic a device should drift toward: the nearest other device within the
 * radius whose visitor is deep in a work. Null when none is. A device never
 * drifts toward itself, because its own visitor needs no invitation.
 */
export function driftFor(
  device: PlacedDevice,
  engaged: readonly EngagedDevice[],
  radius: number = HONEYPOT_RADIUS_M,
): string | null {
  let best: { topic: string; distance: number } | null = null;
  for (const other of engaged) {
    if (other.deviceId === device.deviceId) continue;
    const distance = floorDistance(device.position, other.position);
    if (distance > radius) continue;
    if (best === null || distance < best.distance)
      best = { topic: other.topic, distance };
  }
  return best?.topic ?? null;
}

/** An edge of the Provenance Graph, reduced to the two works it joins. */
export interface WorkLink {
  readonly from: string;
  readonly to: string;
}

/**
 * The works related to a topic, nearest first: the work itself, then the
 * works one link away in the Provenance Graph, then two. Someone reading the
 * Protection of Civil Rights Act at one device can then surface Article 17 at
 * the next, even where no passage of the Act is in the attract loop.
 */
export function relatedWorks(
  topic: string,
  links: readonly WorkLink[],
  depth = 2,
): string[] {
  const order = [topic];
  let frontier = [topic];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const work of frontier) {
      for (const link of links) {
        const other = link.from === work ? link.to : link.to === work ? link.from : null;
        if (other !== null && !order.includes(other)) {
          order.push(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return order;
}

/**
 * The passages a drifting device shows: those from the related works, nearest
 * relation first, keeping the pool's own order within a work. Empty when the
 * pool holds nothing related, and the device then stays with its own loop
 * rather than showing something unrelated under a "read nearby" line.
 */
export function driftPassages(
  pool: readonly CitedPassage[],
  related: readonly string[],
): CitedPassage[] {
  const out: CitedPassage[] = [];
  for (const work of related) {
    for (const p of pool) if (p.citation.workId === work && !out.includes(p)) out.push(p);
  }
  return out;
}

/**
 * Tracks one device's engagement: which work is on screen and since when.
 * `deep` is the work once it has held for DEEP_ENGAGEMENT_MS, else null.
 */
export function engagement(
  previous: { readonly topic: string | null; readonly since: number },
  topic: string | null,
  now: number,
): {
  readonly topic: string | null;
  readonly since: number;
  readonly deep: string | null;
} {
  const since = topic === previous.topic ? previous.since : now;
  return {
    topic,
    since,
    deep: topic !== null && now - since >= DEEP_ENGAGEMENT_MS ? topic : null,
  };
}
