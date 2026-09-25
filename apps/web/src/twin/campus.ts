/**
 * The site, in metres. The building is the open book; the campus is everything
 * inside the compound wall and outside it.
 *
 * One place, so the camera flight, the grounds and the memorial cannot
 * disagree about where the gate is. The hall in `layout.ts` is untouched by
 * any of this: the book is a shell built around it, and the ground it stands
 * on is a slab under it.
 *
 * The axis runs north up the page: +z is the road, -z is the back of the site.
 */

/**
 * The open book. The spine lies on x = 0 and the two pages rise away from it.
 *
 * Every height here is above the hall roof, and every skirt stands outside the
 * hall walls. That is not decoration: the shell has to enclose `layout.ts`
 * without any part of it entering the room.
 */
export const BOOK = {
  /** Half width of the gutter between the two pages, where they meet. */
  spineHalf: 3.8,
  /** The pages are elliptical in plan, centred here and this long. */
  lobeZ: -13,
  lobeHalfLength: 30,
  /** Reach of the page rim, measured out from the gutter. */
  reach: 32,
  /** The page leaves the spine above the hall roof and climbs to its rim. */
  spineY: 13.2,
  crestY: 25,
  /** Courses in the banded skirt that hangs from the rim to the plinth. */
  courses: 12,
  /** The plinth under the skirt, in sandstone, as at 26, Alipur Road. */
  plinthY: 2.4,
  /** How far the skirt draws in at the bottom, as a fraction of its reach. */
  skirtFoot: 0.74,
  /** The entrance drum, in front of the hall facade. */
  apse: { halfWidth: 17.5, height: 16.4, front: 19.4, back: 11.6 },
  /** The arched opening cut through it, around the hall doorway. */
  arch: { halfWidth: 4.6, springY: 5.6 },
} as const;

/** The campus. */
export const SITE = {
  /** Paving sits below the building platform, so the hall floor stays at zero. */
  groundY: -0.9,
  /** Compound wall, inside face. */
  wall: { x: 60, front: 86, back: -62, height: 3.3 },
  /** The gate in the front wall, and the piers either side of it. */
  gate: { halfWidth: 7, pierHalf: 1.5, height: 4.4 },
  /** The sign board, on the wall to the right of the gate as you arrive. */
  sign: { x: 18, width: 20, height: 3.8 },
  /** The ceremonial circle in front of the building. */
  plaza: { z: 50, radius: 28 },
  /** The Ashoka pillar, on the axis between the plaza and the entrance. */
  pillar: { z: 43, height: 17.5 },
  /** The road outside the wall. */
  road: { near: 94, far: 112 },
} as const;

/** Furthest extent of anything on the site, for the sky and the camera. */
export const SITE_RADIUS = 200;
