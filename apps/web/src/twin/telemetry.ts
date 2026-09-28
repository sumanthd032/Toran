/**
 * Timing and render counters, exposed on window for the verification script
 * and the on-screen performance overlay. Measured, not asserted.
 */

export interface TwinTelemetry {
  navigationStart: number;
  firstFrame: number | null;
  entryStart: number | null;
  entryEnd: number | null;
  tier: string;
  renderer: string;
  texturesMs: number | null;
  frame: {
    fps: number;
    ms: number;
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
  /**
   * Bytes of sampled texture data in the scene: width x height x 4, plus a
   * third for mipmaps. Render targets (bloom, the environment bake) are
   * excluded; they scale with the screen, not with the content.
   */
  textureBytes: number;
  /** Frame intervals while a device transition runs, in or out. */
  transitionFrames: number[];
  /** The screen rectangle at the moment the camera arrives, CSS pixels. */
  arrivalRect: { x: number; y: number; w: number; h: number } | null;
  /** Camera pose before a device opened and after it closed, to prove the return is exact. */
  poseBeforeOpen: number[] | null;
  poseAfterClose: number[] | null;
  transitionPhase: string;
  /**
   * When the application finished covering the hall, stamped by the Director
   * at the phase change itself. A verification that polls for the phase on an
   * animation frame reads up to two frames late under load, which is enough to
   * make a timing check flap; this is the moment rather than a sighting of it.
   */
  openedAt: number | null;
  /** Frames the hall has drawn. Must not advance while an application covers it. */
  framesDrawn: number;
  /** When the shared search engine began loading, and when it became ready. */
  searchStarted: number | null;
  searchReady: number | null;
  /**
   * Every frame interval recorded while the entry flight is running. The
   * rolling fps average includes start-up frames, so it cannot say whether the
   * flight itself stutters; this can.
   */
  entryFrames: number[];
  statusSource: 'fixture' | 'fleet';
}

declare global {
  interface Window {
    __toranTwin?: TwinTelemetry;
  }
}

export function telemetry(): TwinTelemetry {
  if (typeof window === 'undefined') {
    throw new Error('telemetry is browser only');
  }
  window.__toranTwin ??= {
    navigationStart: performance.timeOrigin,
    firstFrame: null,
    entryStart: null,
    entryEnd: null,
    tier: 'unknown',
    renderer: 'unknown',
    texturesMs: null,
    frame: { fps: 0, ms: 0, calls: 0, triangles: 0, geometries: 0, textures: 0 },
    entryFrames: [],
    textureBytes: 0,
    transitionFrames: [],
    arrivalRect: null,
    poseBeforeOpen: null,
    poseAfterClose: null,
    transitionPhase: 'hall',
    openedAt: null,
    framesDrawn: 0,
    searchStarted: null,
    searchReady: null,
    // The fixture until FleetProvider hears from a Core.
    statusSource: 'fixture',
  };
  return window.__toranTwin;
}

export function recordTiming(key: 'firstFrame' | 'entryStart' | 'entryEnd'): void {
  if (typeof window === 'undefined') return;
  telemetry()[key] = performance.now();
}
