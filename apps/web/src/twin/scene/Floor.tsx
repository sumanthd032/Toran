'use client';

/**
 * The hall floor. On the high tier it is a blurred reflector, which is what
 * makes a dark stone floor read as polished; that renders the scene a second
 * time, so the low tier falls back to a plain material and relies on the
 * roughness map for its sheen.
 *
 * The second render is of whatever is in the scene, and during the arrival
 * that is the entire campus, drawn again for a floor the camera cannot yet
 * see. So the reflector waits for the hall. From the moment the visitor is
 * inside, which is every frame they spend looking at the floor, it is the
 * same reflector it has always been.
 */

import { MeshReflectorMaterial } from '@react-three/drei';
import { hallCentreZ, hallLength, HALL } from '../layout';
import { hallMaterials } from '../materials';
import { useTier } from '../quality';
import { useTwinState } from '../state';

export function Floor() {
  const tier = useTier();
  const m = hallMaterials();
  const { entered } = useTwinState();
  const size: [number, number] = [HALL.halfWidth * 2, hallLength];

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, hallCentreZ]}>
      <planeGeometry args={size} />
      {tier === 'high' && entered ? (
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
