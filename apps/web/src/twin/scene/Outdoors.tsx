'use client';

/**
 * Air and horizon for the part of the flight that happens outside.
 *
 * The hall is deliberately close and smoky: exponential fog at 0.012 puts the
 * far wall in haze at forty metres, which is most of what makes a lit interior
 * read as an interior. The same fog at the top of the arrival would erase the
 * campus, which is two hundred and seventy metres across.
 *
 * So the air is driven by where the camera is rather than by a second clock.
 * High up or far out in front of the building it thins to an aerial haze the
 * colour of the horizon; at the threshold it is back to exactly the values the
 * hall has always had. Nothing else reads this, and a visitor who skips the
 * arrival lands on the interior values with no transition to run.
 *
 * The sky dome and the ground under it follow the camera. Both are featureless
 * at the scale they are seen, so moving them is invisible, and it means
 * neither one ever shows an edge however far the camera pulls back.
 *
 * Both are drawn as cheaply as the picture allows, because the arrival is
 * bound by pixels rather than by triangles: at 1600x1000 the flight holds
 * 21.9ms a frame and at 800x500 it holds 16.7ms, which is the signature of
 * shading cost, not of geometry. The ground outside the compound is unlit,
 * since six lights shading a plane that reaches the horizon is six lights of
 * work for a surface the fog has already taken most of. The dome is drawn
 * last, so the pixels the building and the campus have covered are rejected
 * on depth instead of being shaded twice.
 */

import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { SITE } from '../campus';
import { HALL } from '../layout';
import { hallMaterials } from '../materials';

/** The hall's own air. These are the values the scene rests at. */
const INSIDE = { density: 0.012, colour: new THREE.Color('#141210') };
const INSIDE_BG = new THREE.Color('#0b0a09');
/** Night haze, matched to the warm band at the horizon of the sky dome. */
const OUTSIDE = { density: 0.0024, colour: new THREE.Color('#2a2119') };
const OUTSIDE_BG = new THREE.Color('#2a2119');

const SKY_RADIUS = 340;

export function Outdoors() {
  const m = hallMaterials();
  const { scene, camera } = useThree();
  const dome = useRef<THREE.Mesh>(null);
  const ground = useRef<THREE.Mesh>(null);
  const colour = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    // How far out of the building the camera is, in one number. Either being
    // well in front of the threshold or well above it counts as outside.
    const openness = Math.min(
      1,
      Math.max(
        0,
        Math.max((camera.position.z - HALL.front - 3) / 26, (camera.position.y - 5) / 12),
      ),
    );

    const fog = scene.fog;
    if (fog instanceof THREE.FogExp2) {
      fog.density = INSIDE.density + (OUTSIDE.density - INSIDE.density) * openness;
      fog.color.copy(INSIDE.colour).lerp(OUTSIDE.colour, openness);
    }
    if (scene.background instanceof THREE.Color) {
      scene.background.copy(colour.copy(INSIDE_BG).lerp(OUTSIDE_BG, openness));
    }

    const d = dome.current;
    if (d !== null) d.position.set(camera.position.x, 0, camera.position.z);
    const g = ground.current;
    if (g !== null)
      g.position.set(camera.position.x, SITE.groundY - 0.04, camera.position.z);
  });

  return (
    <group>
      <mesh ref={dome} material={m.sky} renderOrder={1000}>
        <sphereGeometry args={[SKY_RADIUS, 32, 16]} />
      </mesh>
      <mesh ref={ground} rotation={[-Math.PI / 2, 0, 0]} material={m.distance}>
        <planeGeometry args={[SKY_RADIUS * 2.4, SKY_RADIUS * 2.4]} />
      </mesh>
    </group>
  );
}
