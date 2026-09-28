'use client';

/**
 * The hall floor, a plain stone material on both tiers.
 *
 * The high tier used to render it as a blurred reflector. The reflection was
 * drawn at 512 pixels and blurred, so as the camera moved it shimmered and
 * threw flashes of colour across the slabs, and bloom made the flashes worse.
 * The roughness map already gives the slabs a sheen without it.
 */

import { hallCentreZ, hallLength, HALL } from '../layout';
import { hallMaterials } from '../materials';

export function Floor() {
  const m = hallMaterials();
  const size: [number, number] = [HALL.halfWidth * 2, hallLength];

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, hallCentreZ]}
      material={m.floor}
    >
      <planeGeometry args={size} />
    </mesh>
  );
}
