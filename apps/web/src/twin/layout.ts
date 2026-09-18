/**
 * Hall dimensions, in metres. One place, so the camera bounds, the lighting
 * and the architecture cannot disagree about where the walls are.
 */
export const HALL = {
  halfWidth: 12,
  height: 12,
  front: 13,
  back: -30,
  doorHalfWidth: 3.2,
  doorHeight: 8.6,
  colonnadeX: 8.6,
  columnsZ: [9, 4, -1, -6, -11, -16, -21] as const,
  archZ: -25,
  galleryZ: -28.5,
} as const;

export const hallLength = HALL.front - HALL.back;
export const hallCentreZ = (HALL.front + HALL.back) / 2;

/** Clerestory windows on the left wall. The light shafts start here. */
export const WINDOW = { centreY: 8.5, height: 4.2 } as const;

/** Direction the clerestory light travels: down and across the nave. */
export const SUN = { from: [-20, 26, -6] as const, to: [0, 0, -6] as const };
