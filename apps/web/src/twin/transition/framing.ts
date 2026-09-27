/**
 * Where the camera stands to look straight at a device's screen.
 *
 * The camera goes out along the screen's normal to the distance at which the
 * screen fills most of the view, and looks at its centre. Screens in the hall
 * only pitch and yaw, never roll, so with world up the screen then projects to
 * an axis aligned rectangle in the middle of the viewport, which is exactly
 * where the DOM application has to land.
 */

import * as THREE from 'three';
import type { HallDevice } from '@/fleet/devices';
import { formSpec } from '../scene/deviceForms';

export interface Framing {
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
  /** The four corners of the screen area in world space, for projection. */
  readonly corners: readonly THREE.Vector3[];
  /**
   * The size, in CSS pixels, the application is laid out at when it runs on
   * this screen in the hall: the device's own resolution, at the screen's own
   * aspect. D-165.
   */
  readonly layout: { readonly w: number; readonly h: number };
}

/**
 * Each form's panel height in pixels. A kiosk is the 1280 by 800 tablet the
 * kiosk contracts are measured on; the Timeline Wall is a 1920 panel; the
 * welcome totem is a portrait 1080 by 1920. A portrait screen in a landscape
 * window is drawn small, but a narrower layout was tried and the welcome's two
 * columns collapsed to a word a line, so the totem keeps its real size.
 */
const LAYOUT_HEIGHT: Readonly<Record<HallDevice['form'], number>> = {
  kiosk: 800,
  desk: 800,
  booth: 800,
  console: 800,
  wall: 1200,
  totem: 1920,
};

/** Fraction of the viewport the screen fills when the camera arrives. */
export const FILL = 0.86;

export function framingFor(
  device: HallDevice,
  fovDegrees: number,
  aspect: number,
): Framing {
  const spec = formSpec(device.form);
  const deviceMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...device.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, device.rotationY, 0)),
    new THREE.Vector3(1, 1, 1),
  );

  // Every screen on the device, so a two screen console is framed as a pair.
  const corners: THREE.Vector3[] = [];
  const normal = new THREE.Vector3();
  for (const s of spec.screens) {
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(...s.position),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(...s.rotation, s.order ?? 'XYZ'),
      ),
      new THREE.Vector3(1, 1, 1),
    );
    const world = new THREE.Matrix4().multiplyMatrices(deviceMatrix, local);
    const [w, h] = s.size;
    for (const [x, y] of [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2],
    ] as const) {
      corners.push(new THREE.Vector3(x, y, 0).applyMatrix4(world));
    }
    normal.add(new THREE.Vector3(0, 0, 1).transformDirection(world));
  }
  normal.normalize();

  const centre = corners
    .reduce((sum, c) => sum.add(c), new THREE.Vector3())
    .divideScalar(corners.length);

  // Extent of the screens across and up, measured in the screen's own plane.
  const up = new THREE.Vector3(0, 1, 0).projectOnPlane(normal).normalize();
  const across = new THREE.Vector3().crossVectors(up, normal).normalize();
  let halfW = 0;
  let halfH = 0;
  for (const c of corners) {
    const d = c.clone().sub(centre);
    halfW = Math.max(halfW, Math.abs(d.dot(across)));
    halfH = Math.max(halfH, Math.abs(d.dot(up)));
  }

  const tan = Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2);
  let distance = Math.max(halfH / (tan * FILL), halfW / (tan * aspect * FILL));

  // The estimate above measures the screens flat in one plane. The curator's
  // two screens are angled toward each other, their outer edges nearer the
  // camera, and perspective makes them project larger than that plane says:
  // the first version arrived at 92 percent instead of 86. Project the real
  // corners from the proposed position and correct the distance until the
  // fill is right. Two or three passes converge.
  const probe = new THREE.PerspectiveCamera(fovDegrees, aspect, 0.05, 100);
  const v = new THREE.Vector3();
  // Screens that tilt back also project off centre: the lower edge is nearer
  // and lands further from the middle than the upper edge. So both the distance
  // and the aim are corrected, by projecting the real corners and panning the
  // camera until the rectangle sits in the middle at the planned size.
  const aim = centre.clone();
  const right = new THREE.Vector3();
  const upward = new THREE.Vector3();
  for (let pass = 0; pass < 6; pass++) {
    probe.position.copy(aim).addScaledVector(normal, distance);
    probe.lookAt(aim);
    probe.updateMatrixWorld();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of corners) {
      v.copy(c).project(probe);
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    }
    const offX = (minX + maxX) / 2;
    const offY = (minY + maxY) / 2;
    const fill = Math.max((maxX - minX) / 2, (maxY - minY) / 2);
    if (Math.abs(fill - FILL) < 0.001 && Math.abs(offX) < 0.001 && Math.abs(offY) < 0.001)
      break;
    right.setFromMatrixColumn(probe.matrixWorld, 0);
    upward.setFromMatrixColumn(probe.matrixWorld, 1);
    aim
      .addScaledVector(right, offX * tan * aspect * distance)
      .addScaledVector(upward, offY * tan * distance);
    distance *= fill / FILL;
  }

  const layoutH = LAYOUT_HEIGHT[device.form];
  return {
    position: aim.clone().addScaledVector(normal, distance),
    target: aim,
    corners,
    layout: { w: Math.round((layoutH * halfW) / halfH), h: layoutH },
  };
}
