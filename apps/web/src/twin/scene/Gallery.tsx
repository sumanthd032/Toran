'use client';

/**
 * The Constitution gallery, framed by the Chaitya arch at the end of the nave.
 * It is the one bright object in a dim hall and the endpoint of the sightline
 * from the door.
 *
 * Two plates: Dr. Ambedkar above, the Preamble below. Both are sized to the
 * aperture the arch leaves rather than to the wall, because the arch is what a
 * visitor at the threshold actually sees them through. The opening is 8.22m
 * across up to y=6.2 and then closes on a 4.2m radius, so the Preamble takes
 * the full width low down and the portrait is kept narrow enough to clear the
 * curve at its top corners.
 */

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { box, mergeParts, type Part } from '../geometry';
import { HALL } from '../layout';
import { hallMaterials } from '../materials';
import { portrait, preamble } from '../textures';

/** The Preamble, low and wide. Its backing board reaches 0.4m past it. */
const TEXT = { w: 7.0, h: 4.9, y: 3.4 };
/**
 * The portrait, above it. Its foot clears the top of the Preamble's backing
 * at 6.25, and its head clears the arch, which at y=10 leaves 1.79m of half
 * width against the 1.48m this needs.
 */
const FACE = { w: 2.72, h: 3.4, y: 8.3 };

/** A brass fillet around a plate. */
function fillet(w: number, h: number, y: number): Part[] {
  return [
    { geometry: box(w + 0.24, 0.1, 0.1), position: [0, y + h / 2 + 0.05, 0.03] },
    { geometry: box(w + 0.24, 0.1, 0.1), position: [0, y - h / 2 - 0.05, 0.03] },
    { geometry: box(0.1, h + 0.2, 0.1), position: [-w / 2 - 0.07, y, 0.03] },
    { geometry: box(0.1, h + 0.2, 0.1), position: [w / 2 + 0.07, y, 0.03] },
  ];
}

export function Gallery() {
  const m = hallMaterials();

  // Both plates are lit from the gallery lamp and carry their own emissive, so
  // they hold up as the bright end of a dim hall.
  const plates = useMemo(() => {
    const lit = (map: THREE.CanvasTexture, intensity: number) =>
      new THREE.MeshStandardMaterial({
        map,
        emissiveMap: map,
        emissive: new THREE.Color('#ffffff'),
        emissiveIntensity: intensity,
        roughness: 0.88,
      });
    return { text: lit(preamble(), 0.32), face: lit(portrait(), 0.26) };
  }, []);

  useEffect(
    () => () => {
      for (const p of [plates.text, plates.face]) {
        p.map?.dispose();
        p.dispose();
      }
    },
    [plates],
  );

  const frames = useMemo(
    () =>
      mergeParts([...fillet(TEXT.w, TEXT.h, TEXT.y), ...fillet(FACE.w, FACE.h, FACE.y)]),
    [],
  );

  return (
    <group position={[0, 0, HALL.galleryZ]}>
      <mesh position={[0, TEXT.y, -0.12]} material={m.bronze}>
        <boxGeometry args={[TEXT.w + 0.8, TEXT.h + 0.8, 0.16]} />
      </mesh>
      <mesh position={[0, TEXT.y, 0]} material={plates.text}>
        <planeGeometry args={[TEXT.w, TEXT.h]} />
      </mesh>

      <mesh position={[0, FACE.y, -0.12]} material={m.bronze}>
        <boxGeometry args={[FACE.w + 0.6, FACE.h + 0.6, 0.16]} />
      </mesh>
      <mesh position={[0, FACE.y, 0]} material={plates.face}>
        <planeGeometry args={[FACE.w, FACE.h]} />
      </mesh>

      <mesh geometry={frames} material={m.brass} />
    </group>
  );
}
