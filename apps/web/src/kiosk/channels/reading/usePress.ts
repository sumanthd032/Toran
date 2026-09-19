'use client';

/**
 * Hold to choose a passage.
 *
 * Drag selection on a vertical touchscreen is miserable (PROJECT.md 7.1), so a
 * visitor holds a finger on a paragraph for under half a second to choose it.
 * A finger that moves more than a few pixels is scrolling, and cancels. The
 * handlers go on the container and find the paragraph from the event, because
 * a page has dozens of them and hooks cannot be called per item.
 *
 * Keyboard and switch users choose by focus instead: every choosable passage
 * is focusable, and focusing it chooses it.
 */

import { useCallback, useRef, type PointerEvent, type SyntheticEvent } from 'react';

export const HOLD_MS = 450;
const SLOP_PX = 10;

export function usePress(onPress: (key: string) => void) {
  const timer = useRef(0);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    origin.current = null;
  }, []);

  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const target = (e.target as Element).closest<HTMLElement>('[data-choose]');
      const key = target?.dataset['choose'];
      if (key === undefined) return;
      origin.current = { x: e.clientX, y: e.clientY };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        origin.current = null;
        onPress(key);
      }, HOLD_MS);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const o = origin.current;
      if (o !== null && Math.hypot(e.clientX - o.x, e.clientY - o.y) > SLOP_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    // A long press on touch otherwise opens the browser's own menu.
    onContextMenu: (e: SyntheticEvent) => e.preventDefault(),
  };
}
