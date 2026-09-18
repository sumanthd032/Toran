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

const BOUNDARY = new THREE.Box3(
  new THREE.Vector3(-4, 1.5, -19),
  new THREE.Vector3(4, 5, 5),
);

export function CameraRig({ replayToken }: { replayToken: number }) {
  const controls = useRef<CameraControls>(null);
  const { camera, gl } = useThree();
  const { setEntered } = useTwinState();
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
    if (c !== null) {
      c.setLookAt(...HOME.position, ...HOME.target, false);
      c.enabled = true;
    }
    setEntered(true);
    recordTiming('entryEnd');
  }, [setEntered]);

  // Start, or restart on replay.
  useEffect(() => {
    const c = controls.current;
    if (c !== null) c.enabled = false;
    setEntered(false);
    if (prefersReducedMotion()) {
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
  }, [replayToken, camera, flight, finish, position, target, setEntered, gl, scene]);

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
    c.boundaryEnclosesCamera = false;
  }, []);

  return (
    <CameraControls
      ref={controls}
      makeDefault
      minDistance={1.5}
      maxDistance={7}
      minPolarAngle={Math.PI * 0.3}
      maxPolarAngle={Math.PI * 0.5}
      smoothTime={0.35}
      draggingSmoothTime={0.18}
    />
  );
}
