'use client';

/**
 * The DOM layer a device's application runs in while the Twin is showing it.
 *
 * It is always laid out at the full viewport, and mapped onto the screen's
 * projected rectangle with a transform and a clip. Growing it to fill the frame
 * is then a transform returning to identity, which the compositor animates
 * without relaying out the application, and the application inside looks the
 * same at every size because it is the same layout, scaled.
 */

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { bezel, type BezelFrame } from './store';

export interface BezelLayerProps {
  canvasWrap: RefObject<HTMLDivElement | null>;
  interactive: boolean;
  children: ReactNode;
}

export function BezelLayer({ canvasWrap, interactive, children }: BezelLayerProps) {
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const apply = (f: BezelFrame) => {
      const el = layer.current;
      if (el === null) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const { rect } = f;

      // Cover the screen rectangle, centred on it, then clip to it. A screen
      // whose aspect differs from the viewport, such as the portrait welcome
      // totem, shows the middle of the application rather than a squashed one.
      const s0 = Math.max(rect.w / vw, rect.h / vh, 0.0001);
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      const e = f.expand;
      const s = s0 + (1 - s0) * e;
      const tx = (cx - (s0 * vw) / 2) * (1 - e);
      const ty = (cy - (s0 * vh) / 2) * (1 - e);
      const insetX = Math.max(0, (vw - rect.w / s0) / 2) * (1 - e);
      const insetY = Math.max(0, (vh - rect.h / s0) / 2) * (1 - e);

      el.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${s})`;
      el.style.clipPath = `inset(${insetY}px ${insetX}px)`;
      el.style.opacity = String(f.opacity);
      el.style.visibility = f.opacity < 0.002 ? 'hidden' : 'visible';

      const wrap = canvasWrap.current;
      if (wrap !== null) {
        wrap.style.opacity = String(f.canvas);
        const filters: string[] = [];
        if (f.dim > 0.001) filters.push(`brightness(${(1 - f.dim).toFixed(3)})`);
        if (f.blur > 0.05) filters.push(`blur(${f.blur.toFixed(2)}px)`);
        wrap.style.filter = filters.length > 0 ? filters.join(' ') : 'none';
      }
    };
    return bezel.subscribe(apply);
  }, [canvasWrap]);

  return (
    <div
      ref={layer}
      data-testid="bezel"
      style={{
        position: 'fixed',
        inset: 0,
        transformOrigin: '0 0',
        visibility: 'hidden',
        opacity: 0,
        pointerEvents: interactive ? 'auto' : 'none',
        zIndex: 10,
        willChange: 'transform, opacity, clip-path',
      }}
    >
      {children}
    </div>
  );
}
