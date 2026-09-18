'use client';

/**
 * Six lights, chosen for a tablet: every standard material shades every light,
 * so the count is a direct cost.
 *
 * A dim warm fill; the clerestory sun that also sets the direction of the
 * light shafts; two floodlights raking up the Toran the way monuments in India
 * are lit at night; a lamp on the Constitution gallery; and a glow from inside
 * the doorway that spills onto the forecourt so the hall reads as lit from
 * within before the camera is through the gate.
 */

import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { HALL, SUN } from '../layout';
import { TORAN_Z } from './Toran';

/** Wraps a spot or directional light and puts its target into the scene. */
function Aimed({
  light,
  target,
}: {
  light: React.ReactElement;
  target: [number, number, number];
}) {
  const holder = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    const group = holder.current;
    if (group === null) return;
    const l = group.children.find(
      (c): c is THREE.SpotLight | THREE.DirectionalLight =>
        c instanceof THREE.SpotLight || c instanceof THREE.DirectionalLight,
    );
    if (l === undefined) return;
    // A light's target must be in the scene graph for its direction to update.
    l.target.position.set(...target);
    group.add(l.target);
    l.target.updateMatrixWorld();
  }, [target]);
  return <group ref={holder}>{light}</group>;
}

export function Lights() {
  return (
    <>
      <hemisphereLight args={['#6b5a48', '#1a1612', 1.3]} />
      <Aimed
        target={[...SUN.to]}
        light={
          <directionalLight position={[...SUN.from]} intensity={1.7} color="#ffd8a8" />
        }
      />
      {[-1, 1].map((side) => (
        <Aimed
          key={side}
          target={[side * 2.2, 9.5, TORAN_Z]}
          light={
            <spotLight
              position={[side * 4.4, 0.35, TORAN_Z + 4.6]}
              angle={0.62}
              penumbra={0.85}
              intensity={420}
              distance={34}
              decay={2}
              color="#ffcf9e"
            />
          }
        />
      ))}
      <Aimed
        target={[0, 4.6, HALL.galleryZ]}
        light={
          <spotLight
            position={[0, 11.2, HALL.galleryZ + 7]}
            angle={0.44}
            penumbra={0.75}
            intensity={320}
            distance={30}
            decay={2}
            color="#ffe3bd"
          />
        }
      />
      <pointLight
        position={[0, 5, HALL.front - 1.5]}
        intensity={70}
        distance={24}
        decay={2}
        color="#ffcf94"
      />
    </>
  );
}
