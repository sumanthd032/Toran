'use client';

/**
 * The exterior of the memorial: an open book.
 *
 * Two pages lie either side of a spine trough on x = 0. Each page is one
 * surface, leaving the spine just above the hall roof and climbing to a rim
 * that is elliptical in plan, and from that rim a banded skirt hangs to the
 * plinth. From the air the surfaces read as the leaves of a book, which is the
 * form the memorial was designed as; from the ground the skirt reads as the
 * banded glazing of the building at 26 Alipur Road, which is the same shape
 * seen from a different place. The entrance is a round arch cut through a
 * sandstone drum at the front of the trough.
 *
 * Nothing here enters the hall. The page never falls below the roof slab and
 * the skirt never draws inside the nave walls, so `layout.ts` is untouched and
 * the room a visitor stands in is the room that was already there.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { BOOK, SITE } from '../campus';
import { box, mergeParts, type Part } from '../geometry';
import { HALL } from '../layout';
import { hallMaterials } from '../materials';

/** How finely the elliptical rim is walked. Every course follows the same run. */
const STEPS = 44;

const AX = BOOK.spineHalf + BOOK.reach;
const AZ = BOOK.lobeHalfLength;

/**
 * A page is spanned between two runs of points: the straight spine edge and
 * the elliptical rim. The spine edge is kept shorter than the rim so the ends
 * of the page slope down to it instead of pinching to nothing.
 */
function edges(side: 1 | -1): { spine: THREE.Vector2[]; rim: THREE.Vector2[] } {
  const t0 = Math.asin(BOOK.spineHalf / AX);
  const zFront = BOOK.lobeZ + AZ * 0.72;
  const zBack = BOOK.lobeZ - AZ * 0.72;
  const spine: THREE.Vector2[] = [];
  const rim: THREE.Vector2[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const th = t0 + (Math.PI - 2 * t0) * t;
    rim.push(new THREE.Vector2(side * AX * Math.sin(th), BOOK.lobeZ + AZ * Math.cos(th)));
    spine.push(new THREE.Vector2(side * BOOK.spineHalf, zFront + (zBack - zFront) * t));
  }
  return { spine, rim };
}

/** A point a fraction of the way from the spine edge out to the rim. */
function across(spine: THREE.Vector2, rim: THREE.Vector2, f: number): THREE.Vector2 {
  return new THREE.Vector2(
    spine.x + (rim.x - spine.x) * f,
    spine.y + (rim.y - spine.y) * f,
  );
}

/**
 * Quads between two runs of points of equal length, wound so the face looks
 * the way it is meant to.
 *
 * The two pages are mirror images and the courses run in opposite directions
 * around them, so deciding the winding by hand gets it wrong on one side and
 * silently: a back-facing surface is not a wrong-looking surface, it is an
 * absent one. So the caller says which way the face points and the first
 * triangle is checked against it.
 */
function strip(
  a: THREE.Vector3[],
  b: THREE.Vector3[],
  facing: THREE.Vector3,
): THREE.BufferGeometry {
  const n = new THREE.Vector3()
    .subVectors(b[0]!, a[0]!)
    .cross(new THREE.Vector3().subVectors(b[1]!, a[0]!));
  const [p, q] = n.dot(facing) >= 0 ? [a, b] : [b, a];

  const v: number[] = [];
  const push = (t: THREE.Vector3) => v.push(t.x, t.y, t.z);
  for (let i = 0; i < p.length - 1; i++) {
    push(p[i]!);
    push(q[i]!);
    push(q[i + 1]!);
    push(p[i]!);
    push(q[i + 1]!);
    push(p[i + 1]!);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

/** Which way is out, at the point where a course's winding gets decided. */
function outward(spine: THREE.Vector2, rim: THREE.Vector2): THREE.Vector3 {
  return new THREE.Vector3(rim.x - spine.x, 0, rim.y - spine.y).normalize();
}

/**
 * How high the rim stands at a point along the lobe.
 *
 * Holding it level all the way round makes a ring, and a ring reads as a bowl.
 * A page is highest where it is widest and falls away to nothing at both ends,
 * so the rim does too, and that is what turns the form back into a leaf.
 */
function crestAt(t: number): number {
  return BOOK.spineY + (BOOK.crestY - BOOK.spineY) * Math.sin(Math.PI * t) ** 0.65;
}

/** The page itself, as a grid between the spine edge and the rim. */
function pageSurface(side: 1 | -1): THREE.BufferGeometry {
  const { spine, rim } = edges(side);
  const bays = 9;
  const runs: THREE.Vector3[][] = [];
  for (let j = 0; j <= bays; j++) {
    const f = j / bays;
    runs.push(
      spine.map((s, i) => {
        const p = across(s, rim[i]!, f);
        // A page does not leave its spine as a ramp. The exponent bends the
        // climb so it is shallow at the trough and steepest under the rim.
        const y = BOOK.spineY + (crestAt(i / STEPS) - BOOK.spineY) * f ** 1.35;
        return new THREE.Vector3(p.x, y, p.y);
      }),
    );
  }
  const parts: Part[] = [];
  for (let j = 0; j < bays; j++) {
    parts.push({ geometry: strip(runs[j]!, runs[j + 1]!, UP) });
  }
  return mergeParts(parts);
}

export function Memorial() {
  const m = hallMaterials();

  const g = useMemo(() => {
    const stone: Part[] = [];
    const fascia: Part[] = [];
    const glazing: Part[] = [];

    // The platform, from the paving up to the level of the hall floor.
    const pad = new THREE.Shape();
    pad.absellipse(0, -BOOK.lobeZ, AX + 4, AZ + 4, 0, Math.PI * 2, false, 0);
    const padGeometry = new THREE.ExtrudeGeometry(pad, {
      depth: -SITE.groundY,
      bevelEnabled: false,
      curveSegments: 40,
    });
    padGeometry.rotateX(-Math.PI / 2);
    stone.push({ geometry: padGeometry, position: [0, SITE.groundY, 0] });

    for (const side of [-1, 1] as const) {
      fascia.push({ geometry: pageSurface(side) });

      // The skirt: courses of glazing under stone fascias, hung from the rim
      // and drawing in as they fall, so each course oversails the one below.
      const { spine, rim } = edges(side);
      const K = BOOK.courses;
      const foot = BOOK.skirtFoot;
      const factor = (k: number) => foot + (1 - foot) * (k / K);
      // A run of points around the lobe at course `k`, pushed `out` metres
      // past it, at a height given by `at`. Course heights are a fraction of
      // the way from the plinth to the rim, and the rim rises and falls, so
      // every course rises and falls with it: that is the banding of the real
      // elevation. The plinth is the one run set at a flat height instead.
      const run = (k: number, out: number, at: (top: number) => number) =>
        spine.map((s, i) => {
          const p = across(s, rim[i]!, factor(k));
          const d = new THREE.Vector2(p.x - s.x, p.y - s.y).normalize();
          return new THREE.Vector3(
            p.x + d.x * out,
            at(crestAt(i / STEPS)),
            p.y + d.y * out,
          );
        });
      const upTo = (level: number) => (top: number) =>
        BOOK.plinthY + (top - BOOK.plinthY) * level;
      const flat = (y: number) => () => y;

      for (let k = 0; k < K; k++) {
        const yLow = k / K;
        const yHigh = (k + 1) / K;
        const lip = 0.4 / K;
        // The glazed face, then the fascia that oversails it: a flat soffit
        // out to the lip line and a short return down its face.
        const a = run(k, 0, upTo(yLow));
        const b = run(k + 1, 0, upTo(yHigh - lip));
        const c = run(k + 1, 0.85, upTo(yHigh - lip));
        const d = run(k + 1, 0.85, upTo(yHigh));
        const e = run(k + 1, 0, upTo(yHigh));
        const out = outward(spine[0]!, rim[0]!);
        // The glazed face looks out; then the fascia's soffit looks down, its
        // edge looks out, and its top looks up.
        glazing.push({ geometry: strip(a, b, out) });
        fascia.push({ geometry: strip(b, c, DOWN) });
        fascia.push({ geometry: strip(c, d, out) });
        fascia.push({ geometry: strip(d, e, UP) });
      }

      // The plinth the skirt stands on, from the platform to the first course.
      stone.push({
        geometry: strip(
          run(0, 0, flat(0)),
          run(0, 0, flat(BOOK.plinthY)),
          outward(spine[0]!, rim[0]!),
        ),
      });
    }

    // The spine: a sandstone strip in the trough, level with the roof slab and
    // set just inside the pages, so their inner edges cast a line down it.
    const sx = BOOK.spineHalf - 0.25;
    stone.push({
      geometry: box(sx * 2, 0.9, AZ * 1.8),
      position: [0, HALL.height + 0.7, BOOK.lobeZ],
    });

    // The entrance drum. It is wider than the hall facade behind it, because
    // that facade stands taller than the hall and would otherwise show its
    // top and its outer corners over the shoulders of the drum.
    stone.push({ geometry: apse() });

    // The band recessed inside the arch, which is what gives it its depth.
    const reveal = new THREE.Shape();
    const rh = BOOK.arch.halfWidth + 0.75;
    archPath(reveal, rh);
    const cut = new THREE.Path();
    archPath(cut, BOOK.arch.halfWidth);
    reveal.holes.push(cut);
    const band = new THREE.ExtrudeGeometry(reveal, {
      depth: 0.55,
      bevelEnabled: false,
      curveSegments: 26,
    });
    band.translate(0, 0, BOOK.apse.front);
    stone.push({ geometry: band });

    // Three steps down from the threshold to the paving.
    for (let i = 0; i < 3; i++) {
      const drop = (-SITE.groundY * (i + 1)) / 3;
      stone.push({
        geometry: box(BOOK.arch.halfWidth * 2 + 7 + i * 2, drop, 1.6),
        position: [0, -drop / 2, BOOK.apse.front + 0.8 + i * 1.6],
      });
    }

    return {
      stone: mergeParts(stone, 3.2),
      fascia: mergeParts(fascia, 34),
      glazing: mergeParts(glazing, 7),
    };
  }, []);

  return (
    <group>
      <mesh geometry={g.stone} material={m.sandstone} />
      <mesh geometry={g.fascia} material={m.fascia} />
      <mesh geometry={g.glazing} material={m.glazing} />
    </group>
  );
}

/** A round arch on short jambs, drawn into a shape or a hole. */
function archPath(p: THREE.Shape | THREE.Path, halfWidth: number): void {
  const { springY } = BOOK.arch;
  p.moveTo(-halfWidth, 0);
  p.lineTo(-halfWidth, springY);
  p.absarc(0, springY, halfWidth, Math.PI, 0, true);
  p.lineTo(halfWidth, 0);
  p.closePath();
}

/** The drum at the front, with the entrance arch cut through it. */
function apse(): THREE.BufferGeometry {
  const { halfWidth: a, height: b, front, back } = BOOK.apse;
  const s = new THREE.Shape();
  // A flattened dome. The exponent keeps its shoulders wide instead of letting
  // the profile collapse into a half circle.
  const n = 2 / 2.7;
  const steps = 44;
  s.moveTo(-a, 0);
  for (let i = 0; i <= steps; i++) {
    const p = Math.PI - (Math.PI * i) / steps;
    const cx = Math.cos(p);
    s.lineTo(a * Math.sign(cx) * Math.abs(cx) ** n, b * Math.abs(Math.sin(p)) ** n);
  }
  s.lineTo(a, 0);
  s.closePath();

  const hole = new THREE.Path();
  archPath(hole, BOOK.arch.halfWidth);
  s.holes.push(hole);

  const g = new THREE.ExtrudeGeometry(s, {
    depth: front - back,
    bevelEnabled: false,
    curveSegments: 30,
  });
  g.translate(0, 0, back);
  return g;
}
