'use client';

/**
 * Library shelving along the right side aisle, behind the colonnade.
 *
 * Several thousand books drawn as one instanced mesh, one draw call. Spine
 * colours are drawn from the palette and jittered, and placement is seeded so
 * the shelves are identical on every load.
 */

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { box, mergeParts, type Part } from '../geometry';
import { HALL } from '../layout';
import { hallMaterials } from '../materials';
import { mulberry32 } from '../random';

const BACK_X = HALL.halfWidth - 0.1;
const DEPTH = 0.85;
const Z_START = -1.5;
const Z_END = -25;
const BAYS = 10;
const LEVELS = 12;
const LEVEL_GAP = 0.52;
const BASE_Y = 0.45;

const SPINES = [
  '#5b3a2a',
  '#6b4921',
  '#39564b',
  '#2a241f',
  '#c8bfae',
  '#803d29',
  '#56503f',
  '#1a1714',
  '#9a6a2f',
  '#3a332b',
];

export function Library() {
  const m = hallMaterials();

  const frame = useMemo(() => {
    const length = Z_START - Z_END;
    const zc = (Z_START + Z_END) / 2;
    const x = BACK_X - DEPTH / 2;
    const parts: Part[] = [
      { geometry: box(0.05, 6.6, length), position: [BACK_X, 3.3, zc] },
      { geometry: box(DEPTH, 0.3, length), position: [x, 0.15, zc] },
      { geometry: box(DEPTH, 0.06, length), position: [x, 6.6, zc] },
    ];
    for (let i = 0; i <= BAYS; i++) {
      parts.push({
        geometry: box(DEPTH, 6.6, 0.06),
        position: [x, 3.3, Z_START - (i * length) / BAYS],
      });
    }
    for (let l = 0; l < LEVELS; l++) {
      parts.push({
        geometry: box(DEPTH, 0.04, length),
        position: [x, BASE_Y + l * LEVEL_GAP - 0.02, zc],
      });
    }
    return mergeParts(parts);
  }, []);

  const books = useMemo(() => {
    const rand = mulberry32(1956);
    const placed: {
      pos: THREE.Vector3;
      scale: THREE.Vector3;
      color: THREE.Color;
      lean: number;
    }[] = [];
    const bayLength = (Z_START - Z_END) / BAYS;
    for (let b = 0; b < BAYS; b++) {
      for (let l = 0; l < LEVELS; l++) {
        const y0 = BASE_Y + l * LEVEL_GAP;
        let z = Z_START - b * bayLength - 0.06;
        const zEnd = z - bayLength + 0.1;
        while (z > zEnd) {
          if (rand() < 0.05) {
            z -= 0.06 + rand() * 0.14; // a gap where a book is out
            continue;
          }
          const thick = 0.032 + rand() * 0.045;
          if (z - thick < zEnd) break;
          const tall = 0.27 + rand() * 0.18;
          const deep = 0.2 + rand() * 0.08;
          const base = new THREE.Color(SPINES[Math.floor(rand() * SPINES.length)]);
          base.offsetHSL(0, 0, (rand() - 0.5) * 0.06);
          placed.push({
            pos: new THREE.Vector3(
              BACK_X - 0.03 - deep / 2,
              y0 + tall / 2,
              z - thick / 2,
            ),
            scale: new THREE.Vector3(deep, tall, thick),
            color: base,
            lean: rand() < 0.03 ? (rand() - 0.5) * 0.3 : 0,
          });
          z -= thick + 0.003;
        }
      }
    }
    return placed;
  }, []);

  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (mesh === null) return;
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    books.forEach((b, i) => {
      q.setFromEuler(new THREE.Euler(b.lean, 0, 0));
      mtx.compose(b.pos, q, b.scale);
      mesh.setMatrixAt(i, mtx);
      mesh.setColorAt(i, b.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [books]);

  return (
    <group>
      <mesh geometry={frame} material={m.bronze} />
      <instancedMesh ref={ref} args={[undefined, undefined, books.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.86} metalness={0} />
      </instancedMesh>
    </group>
  );
}
