/**
 * Geometry for each device form, in local space: origin on the floor under the
 * device, facing +z. Bronze body parts, brass trim, screen rectangles, and the
 * height the name plate floats at.
 */

import * as THREE from 'three';
import type { DeviceForm } from '../devices';
import { box, type Part } from '../geometry';

export interface ScreenSpec {
  size: [number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  order?: THREE.EulerOrder;
  portrait?: boolean;
}

export interface FormSpec {
  body: Part[];
  trim: Part[];
  screens: ScreenSpec[];
  labelY: number;
  /** Half extents of the selection hit box. */
  hit: [number, number, number];
  hitY: number;
  /** False for wall-mounted forms, which cast no floor shadow. */
  floorStanding: boolean;
}

/** A point on a tilted panel, offset along the panel's own axes. */
function onPanel(
  centre: [number, number, number],
  tilt: number,
  along: number,
  out: number,
): [number, number, number] {
  const up = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), tilt);
  const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(
    new THREE.Vector3(1, 0, 0),
    tilt,
  );
  return [
    centre[0],
    centre[1] + up.y * along + normal.y * out,
    centre[2] + up.z * along + normal.z * out,
  ];
}

function boothWall(): THREE.BufferGeometry {
  // A solid shell rather than an open cylinder, so its inside face is real
  // geometry and needs no double-sided material.
  const gap = 0.95;
  const s = new THREE.Shape();
  s.absarc(0, 0, 1.2, Math.PI / 2 + gap, Math.PI * 2.5 - gap, false);
  s.absarc(0, 0, 1.1, Math.PI * 2.5 - gap, Math.PI / 2 + gap, true);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 2.3,
    bevelEnabled: false,
    curveSegments: 32,
  });
  g.rotateX(-Math.PI / 2);
  return g;
}

export function formSpec(form: DeviceForm): FormSpec {
  switch (form) {
    case 'kiosk': {
      const tilt = -0.38;
      const housing: [number, number, number] = [0, 1.33, 0];
      return {
        body: [
          { geometry: box(0.72, 0.05, 0.52), position: [0, 0.025, 0] },
          { geometry: box(0.16, 1.02, 0.13), position: [0, 0.56, -0.02] },
          { geometry: box(1.0, 0.66, 0.07), position: housing, rotation: [tilt, 0, 0] },
        ],
        trim: [
          {
            geometry: box(1.0, 0.026, 0.09),
            position: onPanel(housing, tilt, -0.33, 0),
            rotation: [tilt, 0, 0],
          },
          { geometry: box(0.76, 0.012, 0.56), position: [0, 0.056, 0] },
        ],
        screens: [
          {
            size: [0.92, 0.575],
            position: onPanel(housing, tilt, 0, 0.038),
            rotation: [tilt, 0, 0],
          },
        ],
        labelY: 2.15,
        hit: [0.6, 1.1, 0.5],
        hitY: 1.1,
        floorStanding: true,
      };
    }
    case 'wall':
      return {
        body: [{ geometry: box(2.95, 1.78, 0.06), position: [0, 0, 0.03] }],
        trim: [
          { geometry: box(2.95, 0.05, 0.1), position: [0, 0.89, 0.06] },
          { geometry: box(2.95, 0.05, 0.1), position: [0, -0.89, 0.06] },
          { geometry: box(0.05, 1.78, 0.1), position: [-1.475, 0, 0.06] },
          { geometry: box(0.05, 1.78, 0.1), position: [1.475, 0, 0.06] },
        ],
        screens: [{ size: [2.8, 1.75], position: [0, 0, 0.066], rotation: [0, 0, 0] }],
        labelY: 1.35,
        hit: [1.5, 0.9, 0.2],
        hitY: 0,
        floorStanding: false,
      };
    case 'desk': {
      const tilt = -0.12;
      const housing: [number, number, number] = [0, 1.3, -0.18];
      return {
        body: [
          { geometry: box(1.9, 0.7, 0.62), position: [0, 0.35, -0.05] },
          { geometry: box(2.3, 0.06, 0.9), position: [0, 0.73, 0] },
          { geometry: box(0.08, 0.36, 0.06), position: [0, 0.93, -0.2] },
          { geometry: box(1.1, 0.7, 0.05), position: housing, rotation: [tilt, 0, 0] },
        ],
        trim: [{ geometry: box(2.3, 0.03, 0.025), position: [0, 0.73, 0.46] }],
        screens: [
          {
            size: [1.02, 0.6375],
            position: onPanel(housing, tilt, 0, 0.03),
            rotation: [tilt, 0, 0],
          },
        ],
        labelY: 2.1,
        hit: [1.2, 1.0, 0.55],
        hitY: 0.9,
        floorStanding: true,
      };
    }
    case 'booth':
      return {
        body: [
          { geometry: boothWall() },
          {
            geometry: new THREE.CylinderGeometry(1.32, 1.32, 0.08, 36),
            position: [0, 2.34, 0],
          },
          { geometry: box(0.9, 0.45, 0.45), position: [0, 0.225, -0.5] },
        ],
        trim: [
          {
            geometry: new THREE.TorusGeometry(1.32, 0.03, 6, 56),
            position: [0, 2.3, 0],
            rotation: [Math.PI / 2, 0, 0],
          },
        ],
        screens: [{ size: [0.8, 0.5], position: [0, 1.45, -1.07], rotation: [0, 0, 0] }],
        labelY: 2.8,
        hit: [1.25, 1.2, 1.25],
        hitY: 1.2,
        floorStanding: true,
      };
    case 'console': {
      const screens: ScreenSpec[] = [];
      const body: Part[] = [
        { geometry: box(1.6, 0.7, 0.6), position: [0, 0.35, -0.05] },
        { geometry: box(1.9, 0.06, 0.85), position: [0, 0.73, 0] },
      ];
      for (const side of [-1, 1]) {
        const yaw = -side * 0.22;
        body.push({
          geometry: box(0.82, 0.52, 0.05),
          position: [side * 0.43, 1.22, -0.2],
          rotation: [-0.1, yaw, 0],
          order: 'YXZ',
        });
        screens.push({
          size: [0.76, 0.475],
          position: [
            side * 0.43 + Math.sin(yaw) * 0.03,
            1.223,
            -0.2 + Math.cos(yaw) * 0.03,
          ],
          rotation: [-0.1, yaw, 0],
          order: 'YXZ',
        });
      }
      return {
        body,
        trim: [{ geometry: box(1.9, 0.03, 0.025), position: [0, 0.73, 0.43] }],
        screens,
        labelY: 2.05,
        hit: [1.0, 1.0, 0.5],
        hitY: 0.9,
        floorStanding: true,
      };
    }
    case 'totem':
      return {
        body: [
          { geometry: box(0.9, 0.12, 0.55), position: [0, 0.06, 0] },
          { geometry: box(1.18, 2.1, 0.14), position: [0, 1.25, 0] },
        ],
        trim: [
          { geometry: box(1.18, 0.04, 0.16), position: [0, 2.32, 0] },
          { geometry: box(1.18, 0.04, 0.16), position: [0, 0.2, 0] },
        ],
        screens: [
          {
            size: [1.06, 1.9],
            position: [0, 1.27, 0.076],
            rotation: [0, 0, 0],
            portrait: true,
          },
        ],
        labelY: 2.8,
        hit: [0.6, 1.3, 0.35],
        hitY: 1.25,
        floorStanding: true,
      };
  }
}
