'use client';

/**
 * The hall floor. On the high tier it is a blurred reflector, which is what
 * makes a dark stone floor read as polished; that renders the scene a second
 * time, so the low tier falls back to a plain material and relies on the
 * roughness map for its sheen.
 *
 * The second render used to pick up the campus, which is why the exterior is
 * on its own layer now; see scene/outside.tsx. With that in place the
 * reflector costs what it always cost, so it is built with the hall rather
 * than deferred to the threshold. Deferring it moved a 916ms stall onto the
 * exact frame the camera arrives at the door.
 */

import { MeshReflectorMaterial } from '@react-three/drei';
import { hallCentreZ, hallLength, HALL } from '../layout';
import { hallMaterials } from '../materials';
import { useTier } from '../quality';

export function Floor() {
  const tier = useTier();
  const m = hallMaterials();
  const size: [number, number] = [HALL.halfWidth * 2, hallLength];

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, hallCentreZ]}>
      <planeGeometry args={size} />
      {tier === 'high' ? (
        <MeshReflectorMaterial
          map={m.floor.map}
          roughnessMap={m.floor.roughnessMap}
          roughness={0.45}
          metalness={0.1}
          color="#5c534a"
          envMapIntensity={0.12}
          resolution={512}
          mirror={0.75}
          mixBlur={0.8}
          mixStrength={5}
          mixContrast={1.15}
          blur={[320, 90]}
          depthScale={0.9}
          minDepthThreshold={0.3}
          maxDepthThreshold={1.4}
        />
      ) : (
        <primitive object={m.floor} attach="material" />
      )}
    </mesh>
  );
}
