'use client';

/**
 * Light shafts from the clerestory windows, and dust drifting through them.
 *
 * Real volumetric light is far beyond a tablet's budget. Two crossed additive
 * sheets per window, bright at the glass and fading toward the floor, read as
 * a shaft from almost any angle for one draw call in total.
 */

import { Sparkles } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import { mergeParts } from '../geometry';
import { HALL, SUN, WINDOW } from '../layout';
import { hallMaterials } from '../materials';
import { useTier } from '../quality';

export function Atmosphere() {
  const m = hallMaterials();
  const tier = useTier();

  const shafts = useMemo(() => {
    const dir = new THREE.Vector3(
      SUN.to[0] - SUN.from[0],
      SUN.to[1] - SUN.from[1],
      SUN.to[2] - SUN.from[2],
    ).normalize();
    // Tilt from vertical so the sheet's bright end points back at the window.
    // rotateZ(theta) takes +Y to (-sin, cos), which must equal -dir.
    const theta = Math.atan2(dir.x, -dir.y);
    const parts = [];
    for (let i = 0; i < HALL.columnsZ.length - 1; i++) {
      const z = ((HALL.columnsZ[i] ?? 0) + (HALL.columnsZ[i + 1] ?? 0)) / 2;
      const top = new THREE.Vector3(-(HALL.halfWidth - 0.1), WINDOW.centreY, z);
      const length = top.y / -dir.y;
      const centre = top.clone().addScaledVector(dir, length / 2);

      const across = new THREE.PlaneGeometry(1.5, length);
      across.rotateY(Math.PI / 2);
      across.rotateZ(theta);
      across.translate(centre.x, centre.y, centre.z);

      const edge = new THREE.PlaneGeometry(1.0, length);
      edge.rotateZ(theta);
      edge.translate(centre.x, centre.y, centre.z);

      parts.push({ geometry: across }, { geometry: edge });
    }
    return mergeParts(parts);
  }, []);

  return (
    <group>
      <mesh geometry={shafts} material={m.shaft} renderOrder={2} />
      <Sparkles
        count={tier === 'high' ? 420 : 160}
        scale={[22, 9, 40]}
        position={[0, 4.8, -8.5]}
        size={2.4}
        speed={0.22}
        opacity={0.55}
        noise={0.7}
        color="#e9c98f"
      />
    </group>
  );
}
