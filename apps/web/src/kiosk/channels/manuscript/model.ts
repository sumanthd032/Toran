/**
 * The Manuscript Station without React: which reading a visitor is shown,
 * how a region is found from a point on the page, and how a page's readings
 * are compared.
 */

import {
  applyCorrections,
  heatOf,
  type Correction,
  type CorrectedRegion,
  type Pipeline,
  type Scan,
  type Transcription,
} from '@toran/contracts';

/** A page, its readings and the corrections over them, ready to show. */
export interface Reading {
  readonly transcription: Transcription;
  readonly regions: readonly CorrectedRegion[];
  /** How many regions a curator has changed. */
  readonly corrected: number;
  /** How many the machine itself was least sure of. */
  readonly doubtful: number;
}

export function readingOf(
  transcription: Transcription,
  corrections: readonly Correction[],
): Reading {
  const regions = applyCorrections(transcription, corrections);
  return {
    transcription,
    regions,
    corrected: regions.filter((r) => r.correction !== null).length,
    doubtful: regions.filter(
      (r) => r.correction === null && heatOf(r, transcription.pipeline) === 'low',
    ).length,
  };
}

/**
 * Which pipeline read a page. Printed pages go to Surya and hands go to the
 * vision model, so a page usually has one reading; where it has two, the one
 * meant for that kind of page is shown first.
 */
export function preferred(readings: readonly Reading[], scan: Scan): Pipeline | null {
  const intended: Pipeline = scan.hand === 'printed' ? 'surya' : 'vlm';
  if (readings.some((r) => r.transcription.pipeline === intended)) return intended;
  return readings[0]?.transcription.pipeline ?? null;
}

/**
 * The region under a point on the page, in the page's own pixels.
 *
 * A long press on the scan asks "what does this say", so the hit test is
 * generous: the smallest region whose box contains the point, and nothing
 * when the point is on blank paper. A reading that reports no boxes, as a
 * hand does, cannot answer, and the station says so rather than guessing.
 */
export function regionAt(
  regions: readonly CorrectedRegion[],
  x: number,
  y: number,
): CorrectedRegion | null {
  let found: CorrectedRegion | null = null;
  let area = Infinity;
  for (const region of regions) {
    if (region.polygon === null) continue;
    const xs = region.polygon.map((p) => p[0]);
    const ys = region.polygon.map((p) => p[1]);
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const size = (x1 - x0) * (y1 - y0);
    if (size < area) {
      found = region;
      area = size;
    }
  }
  return found;
}

/**
 * A region's box in viewport coordinates: the page is one unit wide and
 * height/width tall, which is how OpenSeadragon measures an image. Both axes
 * are divided by the width for that reason, not by mistake.
 */
export function boxOf(
  region: CorrectedRegion,
  scan: Scan,
): { x: number; y: number; width: number; height: number } | null {
  if (region.polygon === null) return null;
  const xs = region.polygon.map((p) => p[0]);
  const ys = region.polygon.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x: x / scan.width,
    y: y / scan.width,
    width: (Math.max(...xs) - x) / scan.width,
    height: (Math.max(...ys) - y) / scan.width,
  };
}
