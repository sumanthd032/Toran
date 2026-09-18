'use client';

/**
 * The Sanchi Stupa Toran, the main facade of the Dr. Ambedkar International
 * Centre and the gateway the camera passes through on entry.
 *
 * The anatomy follows the Sanchi gateways: two square posts, carved capitals,
 * three architraves that overshoot the posts and curl into volutes, uprights
 * continuing between the architraves, small balusters in the spans, bracket
 * figures under the projecting ends, and symbols on the crown. The relief is
 * suggested by a bump map rather than modelled.
 *
 * Every stone part merges into one mesh and every brass part into another, so
 * the gateway costs two draw calls.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { box, mergeParts, Spiral, type Part } from '../geometry';
import { hallMaterials } from '../materials';

export const TORAN_Z = 17;

const POST_X = 3.0;
const ARCHITRAVES = [8.85, 10.25, 11.65];
const BEAM_HALF = 5.6;

function architrave(y: number): THREE.BufferGeometry {
  // A gentle rise to the centre. Sanchi architraves are not flat beams.
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 16; i++) {
    const x = -BEAM_HALF + (i / 16) * BEAM_HALF * 2;
    const rise = 0.14 * (1 - (x / BEAM_HALF) ** 2);
    points.push(new THREE.Vector3(x, y + rise, 0.04));
  }
  const path = new THREE.CatmullRomCurve3(points);
  // Shape x maps to the curve's normal (depth here) and shape y to its
  // binormal (height), per three.js ExtrudeGeometry. Symmetric under a half
  // turn, so a frame flip along the path cannot show.
  const section = new THREE.Shape();
  section.moveTo(-0.28, -0.3);
  section.lineTo(0.28, -0.3);
  section.lineTo(0.28, 0.3);
  section.lineTo(-0.28, 0.3);
  section.closePath();
  return new THREE.ExtrudeGeometry(section, {
    steps: 48,
    bevelEnabled: false,
    extrudePath: path,
  });
}

function volutes(y: number): THREE.BufferGeometry[] {
  // Each end curls outward and under, like a scroll rolling back on itself.
  // A thin coil in a wide spiral reads as a scroll. The first attempt used a
  // tube too thick for its spiral and the turns fused into a ring.
  const right = new Spiral(BEAM_HALF, y - 0.52, 0.04, 0.52, 0.13, 1.15, Math.PI / 2, -1);
  const left = new Spiral(-BEAM_HALF, y - 0.52, 0.04, 0.52, 0.13, 1.15, Math.PI / 2, 1);
  return [right, left].map((curve) => new THREE.TubeGeometry(curve, 64, 0.15, 10, false));
}

export function Toran() {
  const m = hallMaterials();

  const { stone, brass } = useMemo(() => {
    const stoneParts: Part[] = [];
    const brassParts: Part[] = [];

    for (const side of [-1, 1] as const) {
      const x = side * POST_X;
      // Base, post, capital with four carved forms, and abacus.
      stoneParts.push({ geometry: box(1.3, 0.35, 1.3), position: [x, 0.175, 0] });
      stoneParts.push({ geometry: box(0.86, 7.0, 0.86), position: [x, 3.85, 0] });
      stoneParts.push({
        geometry: new RoundedBoxGeometry(1.25, 0.95, 1.25, 2, 0.08),
        position: [x, 7.8, 0],
      });
      for (const [dx, dz, ry] of [
        [0, 0.7, 0],
        [0, -0.7, 0],
        [0.7, 0, Math.PI / 2],
        [-0.7, 0, Math.PI / 2],
      ] as const) {
        stoneParts.push({
          geometry: new RoundedBoxGeometry(0.52, 0.64, 0.3, 2, 0.1),
          position: [x + dx, 7.72, dz],
          rotation: [0, ry, 0],
        });
      }
      stoneParts.push({ geometry: box(1.42, 0.18, 1.42), position: [x, 8.39, 0] });
      // Upright continuing between the architraves.
      stoneParts.push({ geometry: box(0.7, 4.3, 0.46), position: [x, 10.63, -0.03] });
      // Bracket figure under the projecting end of the lowest architrave.
      stoneParts.push({
        geometry: new RoundedBoxGeometry(0.26, 1.3, 0.34, 2, 0.08),
        position: [side * 4.1, 7.95, 0.14],
        rotation: [0, 0, -side * 0.6],
      });
      // Figures on the projecting ends, between the architraves.
      for (const gapY of [9.55, 10.95]) {
        stoneParts.push({
          geometry: box(0.3, 0.8, 0.34),
          position: [side * 4.35, gapY, 0.02],
        });
      }
      // Crown: triratna on each upright, in brass.
      brassParts.push({ geometry: box(0.14, 0.42, 0.14), position: [x, 12.99, 0] });
      brassParts.push({
        geometry: new THREE.TorusGeometry(0.27, 0.06, 8, 28),
        position: [x, 13.38, 0],
      });
      brassParts.push({
        geometry: new THREE.CapsuleGeometry(0.07, 0.42, 4, 8),
        position: [x, 13.95, 0],
      });
      for (const lean of [-1, 1]) {
        brassParts.push({
          geometry: new THREE.CapsuleGeometry(0.06, 0.32, 4, 8),
          position: [x + lean * 0.2, 13.84, 0],
          rotation: [0, 0, -lean * 0.38],
        });
      }
    }

    // Architraves and their volutes.
    for (const y of ARCHITRAVES) {
      stoneParts.push({ geometry: architrave(y) });
      for (const v of volutes(y)) stoneParts.push({ geometry: v });
    }

    // Balusters in the central span.
    for (const gapY of [9.55, 10.95]) {
      for (const bx of [-1.8, -0.6, 0.6, 1.8]) {
        stoneParts.push({ geometry: box(0.26, 0.8, 0.3), position: [bx, gapY, 0.02] });
      }
    }

    // Pedestal for the wheel.
    stoneParts.push({ geometry: box(0.9, 0.35, 0.55), position: [0, 12.13, 0] });

    // Dharmachakra: rim, hub, sixteen spokes.
    const cy = 13.2;
    brassParts.push({
      geometry: new THREE.TorusGeometry(0.85, 0.09, 12, 64),
      position: [0, cy, 0.05],
    });
    brassParts.push({
      geometry: new THREE.CylinderGeometry(0.17, 0.17, 0.16, 20),
      position: [0, cy, 0.05],
      rotation: [Math.PI / 2, 0, 0],
    });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      brassParts.push({
        geometry: box(0.045, 0.68, 0.045),
        position: [Math.sin(a) * 0.5, cy + Math.cos(a) * 0.5, 0.05],
        rotation: [0, 0, -a],
      });
    }

    return {
      // A tight repeat, so each 0.86m post face carries whole registers of
      // relief. At the hall's repeat the carving vanished on the posts.
      stone: mergeParts(stoneParts, 1.5),
      brass: mergeParts(brassParts),
    };
  }, []);

  return (
    <group position={[0, 0, TORAN_Z]}>
      <mesh geometry={stone} material={m.gate} />
      <mesh geometry={brass} material={m.brass} />
    </group>
  );
}
