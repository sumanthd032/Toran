'use client';

/**
 * The transition between the hall and a device's application.
 *
 * In: the camera flies to face the screen, the hall dims and on the high tier
 * blurs, the real application fades in exactly over the screen as the camera
 * arrives, then grows to fill the frame while the hall fades out. Out is the
 * same in reverse, ending on the exact camera pose the visitor left from.
 *
 * One clock drives the camera and the DOM, written through the bezel store in
 * the same animation frame. D-015 explains why this is a DOM layer and not
 * CSS3DRenderer.
 */

import type { CameraControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { DEVICES } from '@/fleet/devices';
import { easeInOutSine, HOME, prefersReducedMotion } from '../camera/director';
import type { Tier } from '../quality';
import { useTwinState } from '../state';
import { telemetry } from '../telemetry';
import { framingFor, type Framing } from './framing';
import { bezel, type Rect } from './store';

export const FLY_MS = 1100;
export const EXPAND_MS = 450;
const REVEAL_FROM = 0.7;
const FADE_OUT_MS = 280;
const DIM = 0.42;
const BLUR_PX = 7;
/**
 * The gaze arrives first. The camera turns to face the screen over the first
 * 55 percent of the move, then walks straight at it. Leaving mirrors this:
 * step back first, then turn. The first version moved gaze and position on one
 * curve, and the screen slid across the frame just as the application faded
 * in over it, a whip pan at exactly the wrong moment.
 */
const GAZE_LEAD = 0.55;

interface Pose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

function readPose(controls: CameraControls | null, camera: THREE.Camera): Pose {
  if (controls !== null) {
    return {
      position: controls.getPosition(new THREE.Vector3()),
      target: controls.getTarget(new THREE.Vector3()),
    };
  }
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  return {
    position: camera.position.clone(),
    target: camera.position.clone().add(dir.multiplyScalar(10)),
  };
}

export function TransitionDirector({ tier }: { tier: Tier }) {
  const { camera, size } = useThree();
  const controls = useThree((s) => s.controls) as CameraControls | null;
  const { open, phase, setPhase, finishClose, deepLinked } = useTwinState();

  const saved = useRef<Pose | null>(null);
  const frame = useRef<Framing | null>(null);
  const started = useRef<number | null>(null);
  const lastFrame = useRef(0);
  const scratch = useMemo(
    () => ({ p: new THREE.Vector3(), t: new THREE.Vector3(), v: new THREE.Vector3() }),
    [],
  );

  const path = useRef<{
    positions: THREE.CatmullRomCurve3;
    from: THREE.Vector3;
    to: THREE.Vector3;
  } | null>(null);

  const device = open === null ? undefined : DEVICES.find((d) => d.deviceId === open);
  const fov = (camera as THREE.PerspectiveCamera).fov;

  function project(corners: readonly THREE.Vector3[]): Rect {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of corners) {
      scratch.v.copy(c).project(camera);
      const x = (scratch.v.x * 0.5 + 0.5) * size.width;
      const y = (1 - (scratch.v.y * 0.5 + 0.5)) * size.height;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function pose(position: THREE.Vector3, target: THREE.Vector3) {
    camera.position.copy(position);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }

  function buildPath(from: Pose, to: Framing) {
    // Approach along the screen's normal for the final push in, from a point
    // set back and slightly above. This also keeps the path out of columns.
    const normal = to.position.clone().sub(to.target).normalize();
    const approach = to.position
      .clone()
      .addScaledVector(normal, 1.6)
      .add(new THREE.Vector3(0, 0.35, 0));
    path.current = {
      positions: new THREE.CatmullRomCurve3(
        [from.position, approach, to.position],
        false,
        'centripetal',
      ),
      from: from.target.clone(),
      to: to.target.clone(),
    };
  }

  /** Where the camera is looking, for a move that is `k` of the way from the hall. */
  function gaze(k: number, out: THREE.Vector3): THREE.Vector3 {
    const p = path.current;
    if (p === null) return out;
    return out.copy(p.from).lerp(p.to, easeInOutSine(clamp01(k / GAZE_LEAD)));
  }

  function arrive(rect: Rect) {
    bezel.write({ rect, expand: 1, opacity: 1, canvas: 0, dim: DIM, blur: 0 });
  }

  // Phase changes set up the move; frames carry it out.
  useEffect(() => {
    telemetry().transitionPhase = phase;
    if (device === undefined) return;

    const aspect = size.width / size.height;
    frame.current = framingFor(device, fov, aspect);
    const reduced = prefersReducedMotion();

    if (phase === 'in') {
      saved.current = readPose(controls, camera);
      telemetry().poseBeforeOpen = [
        ...saved.current.position.toArray(),
        ...saved.current.target.toArray(),
      ];
      telemetry().transitionFrames = [];
      telemetry().arrivalRect = null;
      buildPath(saved.current, frame.current);
      started.current = null;
      if (reduced) {
        pose(frame.current.position, frame.current.target);
        arrive(project(frame.current.corners));
        setPhase('open');
      }
    }

    if (phase === 'open' && deepLinked && saved.current === null) {
      // Opened by URL: there was no hall visit to return to, so Back goes home.
      saved.current = {
        position: new THREE.Vector3(...HOME.position),
        target: new THREE.Vector3(...HOME.target),
      };
      pose(frame.current.position, frame.current.target);
      buildPath(saved.current, frame.current);
      arrive(project(frame.current.corners));
    }

    if (phase === 'out') {
      telemetry().transitionFrames = [];
      started.current = null;
      if (reduced && saved.current !== null) {
        pose(saved.current.position, saved.current.target);
        bezel.write({
          rect: project(frame.current.corners),
          expand: 0,
          opacity: 0,
          canvas: 1,
          dim: 0,
          blur: 0,
        });
        handBack();
      }
    }
    // Set up once per phase change. The camera, controls and viewport read here
    // are current at that moment, and re-running on a resize mid flight would
    // restart the move from wherever the camera happened to be.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, open]);

  function handBack() {
    const s = saved.current;
    if (s !== null && controls !== null) {
      // Controls are re-enabled by the camera rig once the phase is back to
      // hall; setting the pose here only updates where they will resume.
      controls.setLookAt(...s.position.toArray(), ...s.target.toArray(), false);
      const after = readPose(controls, camera);
      telemetry().poseAfterClose = [
        ...after.position.toArray(),
        ...after.target.toArray(),
      ];
    }
    saved.current = null;
    finishClose();
  }

  useFrame(() => {
    if (phase !== 'in' && phase !== 'out') return;
    const f = frame.current;
    const p = path.current;
    if (f === null || p === null || saved.current === null) return;

    const now = performance.now();
    if (lastFrame.current !== 0)
      telemetry().transitionFrames.push(now - lastFrame.current);
    lastFrame.current = now;
    if (started.current === null) started.current = now;
    const t = now - started.current;
    const blurMax = tier === 'high' ? BLUR_PX : 0;

    if (phase === 'in') {
      const k = clamp01(t / FLY_MS);
      const u = easeInOutSine(k);
      pose(p.positions.getPoint(u, scratch.p), gaze(k, scratch.t));
      const rect = project(f.corners);
      if (k < 1) {
        bezel.write({
          rect,
          expand: 0,
          opacity: smooth((k - REVEAL_FROM) / (1 - REVEAL_FROM)),
          canvas: 1,
          dim: DIM * u,
          blur: blurMax * smooth((k - 0.55) / 0.45),
        });
        return;
      }
      if (telemetry().arrivalRect === null) telemetry().arrivalRect = rect;
      const e = easeInOutSine(clamp01((t - FLY_MS) / EXPAND_MS));
      bezel.write({
        rect,
        expand: e,
        opacity: 1,
        canvas: 1 - e,
        dim: DIM,
        blur: blurMax,
      });
      if (e >= 1) {
        lastFrame.current = 0;
        setPhase('open');
      }
      return;
    }

    // Out: collapse onto the screen, fade the application, fly home.
    const rectAtScreen = project(f.corners);
    if (t < EXPAND_MS) {
      const c = easeInOutSine(clamp01(t / EXPAND_MS));
      bezel.write({
        rect: rectAtScreen,
        expand: 1 - c,
        opacity: 1,
        canvas: c,
        dim: DIM,
        blur: blurMax * (1 - c),
      });
      return;
    }
    const k = clamp01((t - EXPAND_MS) / FLY_MS);
    const u = easeInOutSine(k);
    pose(p.positions.getPoint(1 - u, scratch.p), gaze(1 - k, scratch.t));
    bezel.write({
      rect: project(f.corners),
      expand: 0,
      opacity: 1 - clamp01((t - EXPAND_MS) / FADE_OUT_MS),
      canvas: 1,
      dim: DIM * (1 - u),
      blur: 0,
    });
    if (k >= 1) {
      lastFrame.current = 0;
      handBack();
    }
  });

  return null;
}
