/**
 * The per-frame link between the camera and the DOM application.
 *
 * The director writes here from inside the render loop; the bezel layer reads
 * and applies styles directly, without a React render per frame. Both happen
 * in the same animation frame, so the DOM rectangle and the WebGL screen it
 * sits on cannot drift apart.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BezelFrame {
  /** The screen's projected rectangle, in CSS pixels. */
  rect: Rect;
  /** 0: the application sits exactly on the screen. 1: it fills the viewport. */
  expand: number;
  /** Opacity of the application layer. */
  opacity: number;
  /** Opacity of the hall canvas. */
  canvas: number;
  /** How far the hall has fallen away: dimming, and blur on the high tier. */
  dim: number;
  blur: number;
}

type Listener = (frame: BezelFrame) => void;

const listeners = new Set<Listener>();
let last: BezelFrame | null = null;

export const bezel = {
  write(frame: BezelFrame): void {
    last = frame;
    for (const l of listeners) l(frame);
  },
  latest(): BezelFrame | null {
    return last;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    if (last !== null) listener(last);
    return () => listeners.delete(listener);
  },
};
