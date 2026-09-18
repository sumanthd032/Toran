'use client';

/**
 * `?perf` readout. The tablet number in STEPS.md step 4 cannot be measured
 * from a laptop, so this puts the instrument on the device: open the hall
 * with ?perf on the tablet and read the numbers off the screen.
 */

import { useEffect, useRef } from 'react';

export function PerfOverlay() {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = window.__toranTwin;
      const el = ref.current;
      if (t === undefined || el === null) return;
      const since = (v: number | null) => (v === null ? '...' : `${Math.round(v)}ms`);
      const entry =
        t.entryStart !== null && t.entryEnd !== null
          ? `${Math.round(t.entryEnd - t.entryStart)}ms`
          : '...';
      el.textContent = [
        `fps        ${t.frame.fps.toFixed(0)}`,
        `frame      ${t.frame.ms.toFixed(1)}ms`,
        `draws      ${t.frame.calls}`,
        `triangles  ${t.frame.triangles.toLocaleString()}`,
        `geometries ${t.frame.geometries}`,
        `textures   ${t.frame.textures}, ${(t.textureBytes / 1048576).toFixed(1)} MB`,
        `tier       ${t.tier}`,
        `first draw ${since(t.firstFrame)}`,
        `entry      ${entry}`,
        `procedural ${t.texturesMs ?? '...'}ms`,
        `status     ${t.statusSource}`,
        `gpu        ${t.renderer.slice(0, 38)}`,
      ].join('\n');
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  return (
    <pre
      ref={ref}
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        margin: 0,
        padding: '10px 14px',
        background: 'rgba(13,11,10,0.86)',
        border: '1px solid var(--m-rule-dk)',
        borderRadius: 3,
        color: 'var(--m-light)',
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        lineHeight: 1.5,
        pointerEvents: 'none',
        zIndex: 20,
      }}
    />
  );
}
