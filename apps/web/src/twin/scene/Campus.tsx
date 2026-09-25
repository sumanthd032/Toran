'use client';

/**
 * The grounds: the compound wall and its gate, the name board, the ceremonial
 * circle, the Ashoka pillar on the axis, and the planting, lighting and
 * traffic that make the site read as a place rather than a plinth.
 *
 * All of it stands outside the building and none of it is reachable, so it is
 * built for one job: to be legible from the air during the arrival and from
 * the forecourt at the end of it. Repeats are instanced, the rest is merged by
 * material, and the low tier thins the counts rather than dropping elements,
 * so both tiers show the same campus.
 */

import { Instance, Instances } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import { BOOK, SITE } from '../campus';
import { box, mergeParts, type Part } from '../geometry';
import { hallMaterials } from '../materials';
import { useTier } from '../quality';
import { mulberry32 } from '../random';

const GY = SITE.groundY;
type Vec2 = [number, number];

/**
 * Ground is drawn flat, in layers far enough apart that they cannot fight.
 *
 * Far enough is not a centimetre. With the camera 250m up at the top of the
 * arrival, a 24 bit depth buffer running from 0.1 to 420 resolves about 3.7cm,
 * so layers a centimetre apart trade places from frame to frame and the whole
 * site shimmers until the camera is close enough to separate them. The steps
 * here are 15cm and up, which is a kerb, and clears the worst of them by
 * fourfold.
 */
function Ground({
  w,
  d,
  x = 0,
  z = 0,
  y = GY,
  material,
}: {
  w: number;
  d: number;
  x?: number;
  z?: number;
  y?: number;
  material: THREE.Material;
}) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, y, z]} material={material}>
      <planeGeometry args={[w, d]} />
    </mesh>
  );
}

/**
 * Where the planting and the lighting go. One seed, so the site is the same
 * site on every load and a screenshot can be compared with the last one.
 */
function sitePlan(trees: number, lamps: number) {
  const rng = mulberry32(1891);
  const planted: [number, number, number][] = [];
  const lit: Vec2[] = [];
  const { wall, plaza } = SITE;
  const keepOut = BOOK.spineHalf + BOOK.reach + 7;

  for (let i = 0; i < trees; i++) {
    let x: number;
    let z: number;
    if (i % 3 !== 0) {
      // A belt just inside the wall, all the way round.
      const along = rng();
      const edge = Math.floor(rng() * 3);
      const inset = 6 + rng() * 14;
      if (edge === 2) {
        x = -wall.x + 16 + along * (wall.x * 2 - 32);
        z = wall.front - inset;
      } else {
        x = (edge === 0 ? -1 : 1) * (wall.x - inset);
        z = wall.back + 14 + along * (wall.front - wall.back - 30);
      }
    } else {
      // The lawns either side of the circle.
      const a = rng() * Math.PI * 2;
      const r = plaza.radius + 9 + rng() * 26;
      x = Math.cos(a) * r * 1.6;
      z = plaza.z + Math.sin(a) * r * 0.75;
    }
    // Nothing outside the wall, nothing in the drive, and nothing standing
    // inside the building.
    if (Math.abs(x) > wall.x - 5 || z > wall.front - 5 || z < wall.back + 5) continue;
    if (Math.abs(x) < 13 && z > -40) continue;
    if (Math.abs(x) < keepOut && z < BOOK.lobeZ + BOOK.lobeHalfLength + 7) continue;
    planted.push([x, z, 0.7 + rng() * 0.8]);
  }

  for (let i = 0; i < lamps; i++) {
    if (i % 2 === 0) {
      const t = i / lamps;
      lit.push([
        i % 4 === 0 ? -13.5 : 13.5,
        plaza.z + plaza.radius + 5 + t * (wall.front - plaza.z - 34),
      ]);
    } else {
      const a = (i / lamps) * Math.PI * 2;
      lit.push([
        Math.cos(a) * (plaza.radius - 2.5),
        plaza.z + Math.sin(a) * (plaza.radius - 2.5),
      ]);
    }
  }

  return { planted, lit };
}

export function Campus() {
  const m = hallMaterials();
  const tier = useTier();
  const plan = useMemo(
    () => (tier === 'high' ? sitePlan(108, 34) : sitePlan(42, 18)),
    [tier],
  );

  // The compound wall, the piers and the board's backing, in one geometry, and
  // the gate leaves in another.
  const built = useMemo(() => {
    const stone: Part[] = [];
    const metal: Part[] = [];
    const { wall, gate, sign } = SITE;
    const h = wall.height;
    const len = wall.front - wall.back;
    const midZ = (wall.front + wall.back) / 2;

    for (const sx of [-1, 1] as const) {
      stone.push({
        geometry: box(0.7, h, len),
        position: [sx * wall.x, GY + h / 2, midZ],
      });
      stone.push({
        geometry: box(1.0, 0.34, len),
        position: [sx * wall.x, GY + h + 0.17, midZ],
      });
    }
    stone.push({
      geometry: box(wall.x * 2, h, 0.7),
      position: [0, GY + h / 2, wall.back],
    });
    stone.push({
      geometry: box(wall.x * 2, 0.34, 1.0),
      position: [0, GY + h + 0.17, wall.back],
    });

    // The front wall runs in two lengths with the gate between them.
    const run = wall.x - gate.halfWidth;
    for (const sx of [-1, 1] as const) {
      stone.push({
        geometry: box(run, h, 0.7),
        position: [sx * (gate.halfWidth + run / 2), GY + h / 2, wall.front],
      });
      stone.push({
        geometry: box(run, 0.34, 1.0),
        position: [sx * (gate.halfWidth + run / 2), GY + h + 0.17, wall.front],
      });
      stone.push({
        geometry: box(gate.pierHalf * 2, gate.height, 1.9),
        position: [
          sx * (gate.halfWidth - gate.pierHalf),
          GY + gate.height / 2,
          wall.front,
        ],
      });
      stone.push({
        geometry: box(gate.pierHalf * 2 + 0.55, 0.45, 2.4),
        position: [
          sx * (gate.halfWidth - gate.pierHalf),
          GY + gate.height + 0.22,
          wall.front,
        ],
      });
    }

    // The board stands proud of the wall, so the wall thickens behind it.
    stone.push({
      geometry: box(sign.width + 2.6, sign.height + 1.8, 0.9),
      position: [sign.x, GY + (sign.height + 1.8) / 2, wall.front - 0.5],
    });

    // Two gate leaves meeting on the axis: rails, bars and a row of finials.
    const leaf = gate.halfWidth - gate.pierHalf * 2;
    for (const sx of [-1, 1] as const) {
      const cx = sx * (leaf / 2);
      for (const y of [0.35, 1.9, 3.4]) {
        metal.push({
          geometry: box(leaf, 0.16, 0.13),
          position: [cx, GY + y, wall.front],
        });
      }
      const bars = 9;
      for (let i = 0; i < bars; i++) {
        const t = (i + 0.5) / bars;
        const bx = cx - leaf / 2 + t * leaf;
        metal.push({
          geometry: box(0.1, 3.35, 0.1),
          position: [bx, GY + 1.88, wall.front],
        });
        metal.push({
          geometry: new THREE.ConeGeometry(0.12, 0.38, 5),
          position: [bx, GY + 3.67, wall.front],
        });
      }
    }

    return { stone: mergeParts(stone, 2.6), metal: mergeParts(metal) };
  }, []);

  // The Ashoka pillar: a polished shaft on a stepped plinth, the bell capital,
  // the abacus, and four lions seated back to back on it.
  const pillar = useMemo(() => {
    const dark: Part[] = [];
    const brass: Part[] = [];
    const H = SITE.pillar.height;
    dark.push({ geometry: box(4.8, 0.5, 4.8), position: [0, GY + 0.25, 0] });
    dark.push({ geometry: box(3.7, 0.5, 3.7), position: [0, GY + 0.75, 0] });
    dark.push({ geometry: box(2.8, 1.1, 2.8), position: [0, GY + 1.55, 0] });
    dark.push({
      geometry: new THREE.CylinderGeometry(0.6, 0.9, H - 3.7, 20),
      position: [0, GY + 2.1 + (H - 3.7) / 2, 0],
    });
    brass.push({
      geometry: new THREE.CylinderGeometry(1.02, 0.6, 1.2, 20),
      position: [0, GY + H - 1.0, 0],
    });
    brass.push({
      geometry: new THREE.CylinderGeometry(1.2, 1.2, 0.44, 20),
      position: [0, GY + H - 0.18, 0],
    });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      // Body and head only. At the distance this is ever read, a mane is a
      // pixel, and four lions that read as lions is the whole requirement.
      brass.push({
        geometry: box(0.52, 0.86, 0.95),
        position: [Math.cos(a) * 0.4, GY + H + 0.47, Math.sin(a) * 0.4],
        rotation: [0, -a, 0],
      });
      brass.push({
        geometry: new THREE.SphereGeometry(0.33, 10, 8),
        position: [Math.cos(a) * 0.8, GY + H + 0.95, Math.sin(a) * 0.8],
      });
    }
    return { dark: mergeParts(dark, 2), brass: mergeParts(brass) };
  }, []);

  const tree = useMemo(() => {
    const trunk = new THREE.CylinderGeometry(0.16, 0.3, 3.4, 6);
    trunk.translate(0, 1.7, 0);
    const canopy = mergeParts([
      { geometry: new THREE.IcosahedronGeometry(2.1, 0), position: [0, 4.7, 0] },
      { geometry: new THREE.IcosahedronGeometry(1.5, 0), position: [1.1, 3.7, 0.5] },
      { geometry: new THREE.IcosahedronGeometry(1.35, 0), position: [-1.0, 3.9, -0.6] },
    ]);
    return { trunk, canopy };
  }, []);

  const lampPost = useMemo(() => {
    const pole = mergeParts([
      { geometry: new THREE.CylinderGeometry(0.09, 0.15, 6.2, 6), position: [0, 3.1, 0] },
      { geometry: box(0.95, 0.12, 0.12), position: [0.4, 6.14, 0] },
    ]);
    const head = new THREE.SphereGeometry(0.33, 8, 6);
    head.translate(0.8, 6.04, 0);
    return { pole, head };
  }, []);

  // Traffic: a rank parked inside the gate, and both lanes of the road busy.
  const cars = useMemo(() => {
    const rng = mulberry32(2604);
    const body = mergeParts([
      { geometry: box(1.86, 0.74, 4.3), position: [0, 0.74, 0] },
      { geometry: box(1.64, 0.6, 2.3), position: [0, 1.4, -0.2] },
    ]);
    const wheels = mergeParts(
      (
        [
          [-0.95, 1.42],
          [0.95, 1.42],
          [-0.95, -1.42],
          [0.95, -1.42],
        ] as Vec2[]
      ).map(([x, z]) => {
        const g = new THREE.CylinderGeometry(0.36, 0.36, 0.24, 10);
        g.rotateZ(Math.PI / 2);
        return { geometry: g, position: [x, 0.36, z] as [number, number, number] };
      }),
    );
    const lamps = mergeParts([
      { geometry: box(0.44, 0.17, 0.08), position: [-0.58, 0.94, 2.14] },
      { geometry: box(0.44, 0.17, 0.08), position: [0.58, 0.94, 2.14] },
    ]);
    const placed: { at: Vec2; yaw: number }[] = [];
    for (let i = 0; i < 7; i++) {
      placed.push({ at: [-54 + i * 7.6, SITE.wall.front - 14], yaw: Math.PI / 2 });
    }
    for (let i = 0; i < 6; i++) {
      const outbound = i % 2 === 0;
      placed.push({
        at: [-64 + rng() * 128, outbound ? SITE.road.near + 5 : SITE.road.far - 5],
        yaw: outbound ? Math.PI / 2 : -Math.PI / 2,
      });
    }
    return { body, wheels, lamps, placed };
  }, []);

  const { wall, plaza, sign, road } = SITE;

  return (
    <group>
      <Ground
        w={wall.x * 2}
        d={wall.front - wall.back}
        z={(wall.front + wall.back) / 2}
        material={m.lawn}
      />
      <Ground
        w={27}
        d={wall.front - plaza.z}
        y={GY + 0.16}
        z={(wall.front + plaza.z) / 2}
        material={m.paving}
      />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, GY + 0.3, plaza.z]}
        material={m.plaza}
      >
        <circleGeometry args={[plaza.radius, 64]} />
      </mesh>
      <Ground
        w={360}
        d={road.far - road.near}
        y={GY - 0.2}
        z={(road.far + road.near) / 2}
        material={m.road}
      />

      <mesh geometry={built.stone} material={m.gate} />
      <mesh geometry={built.metal} material={m.brass} />
      <mesh
        position={[sign.x, GY + (sign.height + 1.8) / 2, wall.front - 0.96]}
        material={m.sign}
      >
        <planeGeometry args={[sign.width, sign.height]} />
      </mesh>

      <group position={[0, 0, SITE.pillar.z]}>
        <mesh geometry={pillar.dark} material={m.granite} />
        <mesh geometry={pillar.brass} material={m.brass} />
      </group>

      <Instances geometry={tree.trunk} material={m.bark} limit={plan.planted.length}>
        {plan.planted.map(([x, z, s], i) => (
          <Instance key={i} position={[x, GY, z]} scale={[s, s, s]} />
        ))}
      </Instances>
      <Instances geometry={tree.canopy} material={m.foliage} limit={plan.planted.length}>
        {plan.planted.map(([x, z, s], i) => (
          <Instance
            key={i}
            position={[x, GY, z]}
            scale={[s, s, s]}
            rotation={[0, i * 1.37, 0]}
          />
        ))}
      </Instances>

      <Instances geometry={lampPost.pole} material={m.paint} limit={plan.lit.length}>
        {plan.lit.map(([x, z], i) => (
          <Instance
            key={i}
            position={[x, GY, z]}
            rotation={[0, x > 0 ? Math.PI : 0, 0]}
          />
        ))}
      </Instances>
      <Instances geometry={lampPost.head} material={m.lamp} limit={plan.lit.length}>
        {plan.lit.map(([x, z], i) => (
          <Instance
            key={i}
            position={[x, GY, z]}
            rotation={[0, x > 0 ? Math.PI : 0, 0]}
          />
        ))}
      </Instances>

      <Instances geometry={cars.body} material={m.paint} limit={cars.placed.length}>
        {cars.placed.map((c, i) => (
          <Instance key={i} position={[c.at[0], GY, c.at[1]]} rotation={[0, c.yaw, 0]} />
        ))}
      </Instances>
      <Instances geometry={cars.wheels} material={m.glass} limit={cars.placed.length}>
        {cars.placed.map((c, i) => (
          <Instance key={i} position={[c.at[0], GY, c.at[1]]} rotation={[0, c.yaw, 0]} />
        ))}
      </Instances>
      <Instances geometry={cars.lamps} material={m.headlight} limit={cars.placed.length}>
        {cars.placed.map((c, i) => (
          <Instance key={i} position={[c.at[0], GY, c.at[1]]} rotation={[0, c.yaw, 0]} />
        ))}
      </Instances>
    </group>
  );
}
