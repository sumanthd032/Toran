'use client';

/**
 * Drives the camera through the entry sequence, then hands it to
 * CameraControls for free movement inside the hall.
 *
 * During the entry the controls are disabled and the camera is posed directly
 * from the flight. At the end the controls are told the final pose without a
 * transition, so the handover is invisible. A tap during the entry skips to the
 * end, because a visitor at a kiosk should never be made to wait for an
 * animation, and reduced motion skips it entirely.
 */

import { CameraControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useTwinState } from '../state';
import { recordTiming, telemetry } from '../telemetry';
import { ENTRY, ENTRY_DURATION_MS, Flight, HOME, prefersReducedMotion } from './director';

/**
 * Where a visitor may stand. The box holds the camera itself, not the point it
 * is looking at, which is the difference between being kept in the building
 * and being free to drift out through a wall while still facing into it.
 *
 * It is the room, less a margin: the nave walls are at x = +-12.3 and their
 * inner faces at +-12, so +-10.6 lets someone walk the side aisles behind the
 * colonnade without putting their eye inside the stone. The floor is at zero
 * and the ceiling slab at 12, so 1.2 to 8 is standing height up to the sill of
 * the clerestory. The far end stops short of the dais under the Chaitya arch
 * at -25, and the near end at the inner face of the facade.
 */
const BOUNDARY = new THREE.Box3(
  new THREE.Vector3(-10.6, 1.2, -23),
  new THREE.Vector3(10.6, 8, 12.2),
);

export function CameraRig({
  replayToken,
  skipEntry,
}: {
  replayToken: number;
  skipEntry: boolean;
}) {
  const controls = useRef<CameraControls>(null);
  const { camera, gl } = useThree();
  const { setEntered, entered, phase } = useTwinState();

  // One rule, one place: the visitor can move the camera only when they are
  // in the hall and nothing is open. The entry and the device transitions
  // pose the camera directly and must not be fought by the controls.
  useEffect(() => {
    const c = controls.current;
    if (c !== null) c.enabled = entered && phase === 'hall';
  }, [entered, phase]);
  const flight = useMemo(() => new Flight(ENTRY), []);
  const started = useRef<number | null>(null);
  const running = useRef(false);
  const position = useMemo(() => new THREE.Vector3(), []);
  const target = useMemo(() => new THREE.Vector3(), []);
  // Frames must be steady before the flight starts. Shader compilation and the
  // environment bake land in the first frames, and an entry that begins then
  // stutters through its opening second, which is the one moment it matters.
  const warm = useRef({ steady: 0, since: 0, last: 0, ready: false });
  const { scene } = useThree();

  const finish = useCallback(() => {
    running.current = false;
    started.current = null;
    const c = controls.current;
    if (c !== null) c.setLookAt(...HOME.position, ...HOME.target, false);
    setEntered(true);
    recordTiming('entryEnd');
  }, [setEntered]);

  // Start, or restart on replay.
  useEffect(() => {
    setEntered(false);
    if (prefersReducedMotion() || skipEntry) {
      camera.position.set(...HOME.position);
      camera.lookAt(...HOME.target);
      recordTiming('entryStart');
      finish();
      return;
    }
    flight.at(0, position, target);
    camera.position.copy(position);
    camera.lookAt(target);
    running.current = true;
    started.current = null;
    // Front-load shader compilation rather than paying for it mid-flight.
    void gl.compileAsync(scene, camera);
  }, [
    replayToken,
    camera,
    flight,
    finish,
    position,
    target,
    setEntered,
    gl,
    scene,
    skipEntry,
  ]);

  // Tap to skip.
  useEffect(() => {
    const el = gl.domElement;
    const skip = () => {
      if (running.current) finish();
    };
    el.addEventListener('pointerdown', skip);
    return () => el.removeEventListener('pointerdown', skip);
  }, [gl, finish]);

  useFrame(() => {
    if (!running.current) return;
    const now = performance.now();
    const w = warm.current;
    if (!w.ready) {
      if (w.since === 0) w.since = now;
      const dt = w.last === 0 ? Infinity : now - w.last;
      w.last = now;
      w.steady = dt < 26 ? w.steady + 1 : 0;
      // Five steady frames, or give up waiting after two seconds.
      if (w.steady < 5 && now - w.since < 2000) return;
      w.ready = true;
    }
    if (started.current === null) {
      started.current = now;
      telemetry().entryFrames = [];
      telemetry().entryEnd = null;
      recordTiming('entryStart');
    }
    const t = (now - started.current) / ENTRY_DURATION_MS;
    flight.at(t, position, target);
    camera.position.copy(position);
    camera.lookAt(target);
    if (t >= 1) finish();
  });

  useEffect(() => {
    const c = controls.current;
    if (c === null) return;
    c.setBoundary(BOUNDARY);
    c.boundaryEnclosesCamera = true;
  }, []);

  return (
    <CameraControls
      ref={controls}
      makeDefault
      /*
        The hall is 24m across and 43m long, so these are the distances a
        visitor actually moves through it. The old ceiling of 7m was shorter
        than the hall and shorter than the distance the camera rests at, which
        meant the first turn of the wheel snapped the view several metres down
        the nave before it started zooming.
      */
      minDistance={1.5}
      maxDistance={24}
      /*
        Room to look up at the coffered ceiling and down at the floor inlay.
        The old range stopped level with the horizon, so the ceiling, which is
        most of what is above a visitor in this building, could not be seen.
      */
      minPolarAngle={Math.PI * 0.16}
      maxPolarAngle={Math.PI * 0.58}
      smoothTime={0.26}
      draggingSmoothTime={0.13}
      /*
        Twice the default. The hall is 43m deep and a visitor crosses it often,
        so the wheel is geared for the room rather than for a model on a desk.
        Held back at 0.45 it took a dozen notches to get anywhere.
      */
      dollySpeed={2}
      truckSpeed={2.4}
      /* The wheel moves toward whatever is under the pointer, so a visitor
         goes to the thing they are looking at rather than to the middle. */
      dollyToCursor
    />
  );
}
