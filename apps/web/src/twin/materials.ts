/**
 * Shared materials, built once per page.
 *
 * Every colour traces to a token in tokens.css and through it to a material in
 * the building: red sandstone, brass, the dark stone of the floor. Nothing is
 * picked here that is not already in the palette. See CLAUDE.md section 5.
 */

import * as THREE from 'three';
import { blob, floor, jali, relief, sandstone, shaft, sky } from './textures';

export interface HallMaterials {
  sandstone: THREE.MeshStandardMaterial;
  carved: THREE.MeshStandardMaterial;
  gate: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  bronze: THREE.MeshStandardMaterial;
  ceiling: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  ground: THREE.MeshStandardMaterial;
  window: THREE.MeshBasicMaterial;
  shaft: THREE.MeshBasicMaterial;
  shadow: THREE.MeshBasicMaterial;
  sky: THREE.MeshBasicMaterial;
  inlay: THREE.MeshStandardMaterial;
  paper: THREE.MeshStandardMaterial;
  generatedMs: number;
}

let cached: HallMaterials | null = null;

export function hallMaterials(): HallMaterials {
  if (cached !== null) return cached;
  const started = performance.now();

  const stone = sandstone(512);
  const carving = relief(512);
  // 512 rather than 1024: each two metre slab still gets 128 pixels, which is
  // more than a standing eye resolves across the hall, and it saves about 8 MB
  // of texture memory on a tablet.
  const tiles = floor(512);
  // Two metre slabs. At one metre the floor read as a grid of bathroom tile.
  tiles.map.repeat.set(3, 5.5);
  tiles.roughness.repeat.set(3, 5.5);

  const brassColor = new THREE.Color('#c89b52');

  cached = {
    sandstone: new THREE.MeshStandardMaterial({
      map: stone.map,
      roughnessMap: stone.roughness,
      roughness: 0.92,
      metalness: 0,
    }),
    carved: new THREE.MeshStandardMaterial({
      map: stone.map,
      roughnessMap: stone.roughness,
      bumpMap: carving,
      bumpScale: 1.1,
      roughness: 0.9,
      metalness: 0,
    }),
    gate: new THREE.MeshStandardMaterial({
      map: stone.map,
      roughnessMap: stone.roughness,
      bumpMap: carving,
      bumpScale: 1.9,
      roughness: 0.88,
      metalness: 0,
    }),
    brass: new THREE.MeshStandardMaterial({
      color: brassColor,
      metalness: 0.92,
      roughness: 0.32,
      emissive: brassColor,
      emissiveIntensity: 0.06,
    }),
    bronze: new THREE.MeshStandardMaterial({
      color: '#3d332a',
      metalness: 0.7,
      roughness: 0.34,
    }),
    ceiling: new THREE.MeshStandardMaterial({ color: '#1a1714', roughness: 0.95 }),
    floor: new THREE.MeshStandardMaterial({
      map: tiles.map,
      roughnessMap: tiles.roughness,
      color: '#6b6157',
      roughness: 0.42,
      metalness: 0.1,
      envMapIntensity: 0.25,
    }),
    ground: new THREE.MeshStandardMaterial({ color: '#241d17', roughness: 1 }),
    window: new THREE.MeshBasicMaterial({
      map: jali(),
      color: new THREE.Color(1.25, 1.25, 1.25),
      toneMapped: false,
    }),
    shaft: new THREE.MeshBasicMaterial({
      color: '#ffcf8f',
      alphaMap: shaft(),
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
    shadow: new THREE.MeshBasicMaterial({
      map: blob(),
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
    }),
    sky: new THREE.MeshBasicMaterial({
      map: sky(),
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    }),
    inlay: new THREE.MeshStandardMaterial({
      color: brassColor,
      metalness: 0.95,
      roughness: 0.25,
      emissive: brassColor,
      emissiveIntensity: 0.18,
    }),
    paper: new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.85 }),
    generatedMs: 0,
  };
  cached.generatedMs = Math.round(performance.now() - started);
  return cached;
}
