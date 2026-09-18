'use client';

/**
 * The Constitution gallery, framed by the Chaitya arch at the end of the nave.
 * It is the one bright object in a dim hall and the endpoint of the sightline
 * from the door.
 */

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { box, mergeParts } from '../geometry';
import { HALL } from '../layout';
import { hallMaterials } from '../materials';
import { preamble } from '../textures';

const W = 4.4;
const H = 6.6;
const Y = 0.45 + 1.05 + H / 2;

export function Gallery() {
  const m = hallMaterials();

  const panel = useMemo(() => {
    const map = preamble();
    return new THREE.MeshStandardMaterial({
      map,
      emissiveMap: map,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0.32,
      roughness: 0.88,
    });
  }, []);
  useEffect(
    () => () => {
      panel.map?.dispose();
      panel.dispose();
    },
    [panel],
  );

  const frame = useMemo(
    () =>
      mergeParts([
        { geometry: box(W + 0.24, 0.1, 0.1), position: [0, Y + H / 2 + 0.05, 0.03] },
        { geometry: box(W + 0.24, 0.1, 0.1), position: [0, Y - H / 2 - 0.05, 0.03] },
        { geometry: box(0.1, H + 0.2, 0.1), position: [-W / 2 - 0.07, Y, 0.03] },
        { geometry: box(0.1, H + 0.2, 0.1), position: [W / 2 + 0.07, Y, 0.03] },
      ]),
    [],
  );

  return (
    <group position={[0, 0, HALL.galleryZ]}>
      <mesh position={[0, Y, -0.12]} material={m.bronze}>
        <boxGeometry args={[W + 0.8, H + 0.8, 0.16]} />
      </mesh>
      <mesh position={[0, Y, 0]} material={panel}>
        <planeGeometry args={[W, H]} />
      </mesh>
      <mesh geometry={frame} material={m.brass} />
    </group>
  );
}
