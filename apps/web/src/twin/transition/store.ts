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
  /**
   * The application's own layout size, when it runs on the screen in the
   * hall. Null when it is laid out at the viewport and grows to fill it.
   */
  layout: { w: number; h: number } | null;
}

/**
 * How an opened device is shown. `hall`: the application runs on the
 * device's screen, at the device's resolution, with the hall around it.
 * `full`: it grows to fill the window, as a standalone kiosk looks. D-165.
 */
export type OpenMode = 'hall' | 'full';

/**
 * Whether the guided tour is running. While it is, every device opens on its
 * screen, placed to the left so the tour's caption stands beside it. D-169.
 */
let touring = false;
export const tourFraming = {
  get(): boolean {
    return touring;
  },
  set(on: boolean): void {
    touring = on;
  },
};

/**
 * The mode a given device opens in. The curator's console always fills the
 * window: two angled screens make one very wide frame, and the console is a
 * desk a curator sits at with a mouse (D-153), not a screen a visitor stands
 * in front of. D-165.
 */
export function modeFor(form: string, chosen: OpenMode): OpenMode {
  return form === 'console' ? 'full' : chosen;
}

const MODE_KEY = 'toran.twin.open-mode';
let mode: OpenMode = 'hall';
const modeListeners = new Set<(m: OpenMode) => void>();

export const openMode = {
  get(): OpenMode {
    return mode;
  },
  set(next: OpenMode): void {
    mode = next;
    try {
      window.localStorage.setItem(MODE_KEY, next);
    } catch {
      // Storage blocked: the choice holds for this page.
    }
    for (const l of modeListeners) l(next);
  },
  /** Read the saved choice, once, after mount. */
  load(): void {
    try {
      const saved = window.localStorage.getItem(MODE_KEY);
      if (saved === 'hall' || saved === 'full') mode = saved;
    } catch {
      mode = 'hall';
    }
    for (const l of modeListeners) l(mode);
  },
  subscribe(listener: (m: OpenMode) => void): () => void {
    modeListeners.add(listener);
    listener(mode);
    return () => modeListeners.delete(listener);
  },
};

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
