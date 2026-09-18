/**
 * The kiosk display in the bill of materials: a 15.6 inch 1920x1080 panel.
 *
 * Its pixel density is what turns CSS pixels into millimetres a visitor
 * actually sees, so the device scale for this panel is derived here rather
 * than guessed, and the legibility check in tools/verify-kiosk.mjs uses the
 * same numbers.
 */

export const KIOSK_PANEL = {
  diagonalInches: 15.6,
  widthPx: 1920,
  heightPx: 1080,
} as const;

export function panelPpi(
  p: { diagonalInches: number; widthPx: number; heightPx: number } = KIOSK_PANEL,
): number {
  return Math.hypot(p.widthPx, p.heightPx) / p.diagonalInches;
}

/** CSS assumes 96 px per inch. This is the factor that makes a CSS mm a real mm. */
export function panelDeviceScale(p = KIOSK_PANEL): number {
  return panelPpi(p) / 96;
}

/** Minimum capital height for a viewing distance, per ADA 703.5.5, in mm. */
export function adaMinimumCapMm(distanceMetres: number): number {
  const feet = distanceMetres / 0.3048;
  const inches = 5 / 8 + Math.max(0, feet - 6) / 8;
  return inches * 25.4;
}

/**
 * Spectral 600 capital height as a fraction of the em, measured from the font
 * file with canvas text metrics. Not the two thirds usually assumed.
 */
export const SPECTRAL_CAP_HEIGHT = 0.672;

/** The ambient headline's em, in millimetres. Must match --t-ambient. */
export const AMBIENT_EM_MM = 46;
