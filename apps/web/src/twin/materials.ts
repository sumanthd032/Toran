/**
 * Shared materials, built once per page.
 *
 * Every colour traces to a token in tokens.css and through it to a material in
 * the building: red sandstone, brass, the dark stone of the floor. Nothing is
 * picked here that is not already in the palette. See CLAUDE.md section 5.
 */

import * as THREE from 'three';
import {
  blob,
  floor,
  glazing,
  jali,
  lawn,
  memorialSign,
  pageFace,
  plazaPaving,
  relief,
  sandstone,
  shaft,
  sky,
} from './textures';

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
  /** The open book: stone fascias, the glazing between them, the page face. */
  fascia: THREE.MeshStandardMaterial;
  glazing: THREE.MeshStandardMaterial;
  page: THREE.MeshStandardMaterial;
  /** The campus. */
  lawn: THREE.MeshStandardMaterial;
  paving: THREE.MeshStandardMaterial;
  plaza: THREE.MeshStandardMaterial;
  road: THREE.MeshStandardMaterial;
  sign: THREE.MeshStandardMaterial;
  bark: THREE.MeshStandardMaterial;
  foliage: THREE.MeshStandardMaterial;
  granite: THREE.MeshStandardMaterial;
  paint: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  /** The ground beyond the compound. Unlit on purpose: see Outdoors.tsx. */
  distance: THREE.MeshBasicMaterial;
  lamp: THREE.MeshBasicMaterial;
  headlight: THREE.MeshBasicMaterial;
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

  // The campus. Grass and paving repeat over tens of metres, so they are small
  // maps tiled hard rather than one large one.
  const grass = lawn(256);
  grass.repeat.set(26, 26);
  const page = pageFace(256);
  const glass = glazing(256);
  const board = memorialSign();
  const circle = plazaPaving(512);
  const tarmac = floor(256);
  tarmac.map.repeat.set(2, 24);
  tarmac.roughness.repeat.set(2, 24);

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

    // The open book. The fascia courses carry the page, so they take the
    // paper map and the sandstone roughness: stone edge, paper top.
    fascia: new THREE.MeshStandardMaterial({
      map: page,
      roughnessMap: stone.roughness,
      color: '#bcb2a0',
      roughness: 0.86,
      metalness: 0,
    }),
    glazing: new THREE.MeshStandardMaterial({
      map: glass,
      color: '#8f8578',
      roughness: 0.22,
      metalness: 0.55,
      envMapIntensity: 0.9,
    }),
    page: new THREE.MeshStandardMaterial({
      map: page,
      roughness: 0.82,
      metalness: 0,
    }),

    // The campus.
    lawn: new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }),
    paving: new THREE.MeshStandardMaterial({ color: '#4e483f', roughness: 0.94 }),
    plaza: new THREE.MeshStandardMaterial({
      map: circle,
      roughness: 0.7,
      metalness: 0.05,
      envMapIntensity: 0.35,
    }),
    road: new THREE.MeshStandardMaterial({
      map: tarmac.map,
      roughnessMap: tarmac.roughness,
      color: '#211d19',
      roughness: 0.8,
    }),
    sign: new THREE.MeshStandardMaterial({
      map: board,
      roughness: 0.7,
      // The board is lit from a batten under it, which no light in the hall
      // can reach, so it carries its own. One canvas serves both slots.
      emissiveMap: board,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0.34,
    }),
    bark: new THREE.MeshStandardMaterial({ color: '#2d251d', roughness: 1 }),
    foliage: new THREE.MeshStandardMaterial({
      color: '#39564b',
      roughness: 1,
      flatShading: true,
    }),
    granite: new THREE.MeshStandardMaterial({
      color: '#2b2824',
      roughness: 0.38,
      metalness: 0.2,
      envMapIntensity: 0.5,
    }),
    paint: new THREE.MeshStandardMaterial({
      color: '#6e675e',
      roughness: 0.42,
      metalness: 0.35,
      envMapIntensity: 0.7,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: '#15130f',
      roughness: 0.12,
      metalness: 0.7,
      envMapIntensity: 1,
    }),
    distance: new THREE.MeshBasicMaterial({ color: '#2a2620' }),
    lamp: new THREE.MeshBasicMaterial({ color: '#ffd9a0', toneMapped: false }),
    headlight: new THREE.MeshBasicMaterial({ color: '#fff3dc', toneMapped: false }),
    generatedMs: 0,
  };
  cached.generatedMs = Math.round(performance.now() - started);
  return cached;
}
