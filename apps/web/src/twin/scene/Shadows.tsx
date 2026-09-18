'use client';

/**
 * Contact shadows under everything that stands on the floor, as one instanced
 * quad. Real shadow maps would cost more than the rest of the scene combined
 * on a tablet; a soft dark pool at the base of each object is what the eye
 * actually uses to decide that something is standing on the ground.
 */

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { DEVICES } from '../devices';
import { HALL } from '../layout';
import { hallMaterials } from '../materials';
import { formSpec } from './deviceForms';
import { TORAN_Z } from './Toran';

interface Blot {
  x: number;
  z: number;
  sx: number;
  sz: number;
  rot: number;
}

export function Shadows() {
  const m = hallMaterials();

  const blots = useMemo(() => {
    const out: Blot[] = [];
    for (const d of DEVICES) {
      const spec = formSpec(d.form);
      if (!spec.floorStanding) continue;
      out.push({
        x: d.position[0],
        z: d.position[2],
        sx: spec.hit[0] * 3.2,
        sz: spec.hit[2] * 3.2,
        rot: d.rotationY,
      });
    }
    for (const sx of [-1, 1]) {
      for (const z of HALL.columnsZ)
        out.push({ x: sx * HALL.colonnadeX, z, sx: 2.6, sz: 2.6, rot: 0 });
      out.push({ x: sx * 3.0, z: TORAN_Z, sx: 3.0, sz: 3.0, rot: 0 });
    }
    return out;
  }, []);

  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (mesh === null) return;
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    blots.forEach((b, i) => {
      q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, b.rot, 'YXZ'));
      mtx.compose(
        new THREE.Vector3(b.x, 0.014, b.z),
        q,
        new THREE.Vector3(b.sx, b.sz, 1),
      );
      mesh.setMatrixAt(i, mtx);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [blots]);

  return (
    <instancedMesh ref={ref} args={[undefined, m.shadow, blots.length]} renderOrder={1}>
      <planeGeometry args={[1, 1]} />
    </instancedMesh>
  );
}
