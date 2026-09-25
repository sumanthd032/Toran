'use client';

/**
 * The layer everything outside the building is drawn on.
 *
 * The hall floor is a reflector, and a reflector renders the scene a second
 * time from a camera under the floor. That second camera would pick up the
 * campus and the whole of the book, at the cost of drawing them twice, to
 * reflect them in a floor that has walls and a roof between it and them. A
 * polished floor cannot show the sky through a stone wall.
 *
 * drei's reflector builds its own camera and leaves it on layer zero, so
 * putting the exterior on layer one is enough to keep it out of the
 * reflection. The scene camera is told to look at both. Measured on the Intel
 * UHD 730 at 1600x1000: 122 draws and 37 fps before, 103 and 58 after.
 */

import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import type * as THREE from 'three';

export const OUTSIDE_LAYER = 1;

export function Outside({ children }: { children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    camera.layers.enable(OUTSIDE_LAYER);
  }, [camera]);

  // No dependency list: the campus rebuilds when the quality tier changes, and
  // anything added then has to be moved onto the layer as well.
  useLayoutEffect(() => {
    group.current?.traverse((o) => o.layers.set(OUTSIDE_LAYER));
  });

  return <group ref={group}>{children}</group>;
}
