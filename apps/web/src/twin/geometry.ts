/**
 * Geometry helpers.
 *
 * The hall is built from many small parts. Drawn one mesh per part it would
 * cost several hundred draw calls, which a tablet will not sustain at 60fps.
 * Parts that share a material are merged into one geometry, so the Toran
 * gateway, for example, is two draw calls rather than forty.
 *
 * Merged parts lose their individual UV spaces, so stone gets world-space box
 * projection instead: every face samples the texture at the same density,
 * whether it belongs to a pillar or a beam.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface Part {
  geometry: THREE.BufferGeometry;
  position?: [number, number, number];
  rotation?: [number, number, number];
  /**
   * Euler order. The default XYZ tilts about the world X axis after yawing,
   * which is wrong for a screen that is both turned and tilted back; those use
   * YXZ, so the yaw is about world Y and the tilt about the screen's own X.
   */
  order?: THREE.EulerOrder;
  scale?: [number, number, number];
}

const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler();

/** Texture repeats once every `metresPerRepeat` along each projected axis. */
export function boxProjectUVs(
  geometry: THREE.BufferGeometry,
  metresPerRepeat: number,
): void {
  const pos = geometry.getAttribute('position');
  const nrm = geometry.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  const k = 1 / metresPerRepeat;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ax = Math.abs(nrm.getX(i));
    const ay = Math.abs(nrm.getY(i));
    const az = Math.abs(nrm.getZ(i));
    if (ax >= ay && ax >= az) {
      uv[i * 2] = z * k;
      uv[i * 2 + 1] = y * k;
    } else if (ay >= az) {
      uv[i * 2] = x * k;
      uv[i * 2 + 1] = z * k;
    } else {
      uv[i * 2] = x * k;
      uv[i * 2 + 1] = y * k;
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Place each part, merge into one geometry, and project UVs in world space. */
export function mergeParts(
  parts: readonly Part[],
  metresPerRepeat?: number,
): THREE.BufferGeometry {
  const placed = parts.map((p) => {
    let g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone();
    // Keep only the attributes every primitive shares, or the merge refuses.
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv')
        g.deleteAttribute(name);
    }
    if (!g.getAttribute('uv')) {
      g.setAttribute(
        'uv',
        new THREE.BufferAttribute(
          new Float32Array(g.getAttribute('position').count * 2),
          2,
        ),
      );
    }
    const [rx, ry, rz] = p.rotation ?? [0, 0, 0];
    euler.set(rx, ry, rz, p.order ?? 'XYZ');
    quat.setFromEuler(euler);
    matrix.compose(
      new THREE.Vector3(...(p.position ?? [0, 0, 0])),
      quat,
      new THREE.Vector3(...(p.scale ?? [1, 1, 1])),
    );
    g.applyMatrix4(matrix);
    return g;
  });
  const merged = mergeGeometries(placed, false);
  if (merged === null) throw new Error('mergeParts: geometries are not compatible');
  if (metresPerRepeat !== undefined) boxProjectUVs(merged, metresPerRepeat);
  merged.computeBoundingSphere();
  return merged;
}

/** An Archimedean spiral in the XY plane, for the volutes on the architraves. */
export class Spiral extends THREE.Curve<THREE.Vector3> {
  constructor(
    private readonly cx: number,
    private readonly cy: number,
    private readonly cz: number,
    private readonly r0: number,
    private readonly r1: number,
    private readonly turns: number,
    private readonly start: number,
    private readonly direction: 1 | -1,
  ) {
    super();
  }

  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const a = this.start + this.direction * t * this.turns * Math.PI * 2;
    const r = this.r0 + (this.r1 - this.r0) * t;
    return target.set(this.cx + r * Math.cos(a), this.cy + r * Math.sin(a), this.cz);
  }
}

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
