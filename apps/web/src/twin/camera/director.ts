/**
 * The arrival.
 *
 * The camera opens high enough to hold the whole site, drops along the axis of
 * the road, crosses the gate, runs low past the Ashoka pillar on the ceremonial
 * circle, and goes in through the arch to settle inside looking down the nave
 * at the Chaitya arch. It is one continuous move rather than a sequence of
 * stops, so position and target run along splines through the keyframes and are
 * driven by a single eased clock.
 *
 * Easing is sine in and out. Of the common curves it has the lowest peak
 * velocity for a given duration, about 1.57 times the average against 3 for a
 * cubic, which is what "architectural pacing, no overshoot" means in numbers.
 *
 * Keyframes are spaced so their spacing falls through the flight, 60m, 57m,
 * 35m, 24m, 17m. A Catmull-Rom curve gives each segment the same share of the
 * parameter, so that spacing is what makes the descent quick and the last
 * approach slow, before the easing is applied on top of it.
 *
 * The final pose is the one the hall rests at and is not ours to move: the
 * device transitions and the verification both start from it.
 */

import * as THREE from 'three';

export type Vec3 = readonly [number, number, number];

export interface Shot {
  readonly position: Vec3;
  readonly target: Vec3;
}

export const ENTRY_DURATION_MS = 7200;

export const ENTRY: readonly Shot[] = [
  { position: [0, 86, 168], target: [0, 14, 26] },
  { position: [0, 50, 118], target: [0, 10, 22] },
  { position: [-9, 20, 78], target: [0, 11, 24] },
  { position: [-7, 6.8, 48], target: [0, 9, 20] },
  { position: [0, 3.4, 26], target: [0, 6.2, 8] },
  { position: [0, 2.5, 9.0], target: [0, 3.6, -26] },
];

export const HOME: Shot = ENTRY[ENTRY.length - 1] as Shot;

export function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

export class Flight {
  private readonly positions: THREE.CatmullRomCurve3;
  private readonly targets: THREE.CatmullRomCurve3;

  constructor(shots: readonly Shot[]) {
    this.positions = new THREE.CatmullRomCurve3(
      shots.map((s) => new THREE.Vector3(...s.position)),
      false,
      'centripetal',
    );
    this.targets = new THREE.CatmullRomCurve3(
      shots.map((s) => new THREE.Vector3(...s.target)),
      false,
      'centripetal',
    );
  }

  /** Pose at a normalised time in [0, 1]. */
  at(t: number, position: THREE.Vector3, target: THREE.Vector3): void {
    const u = easeInOutSine(Math.min(1, Math.max(0, t)));
    this.positions.getPoint(u, position);
    this.targets.getPoint(u, target);
  }
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
