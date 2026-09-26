'use client';

/**
 * The hall. Everything inside the WebGL canvas.
 */

import { Environment, Lightformer, PerformanceMonitor } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  Bloom,
  EffectComposer,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { CameraRig } from './camera/CameraRig';
import { ENTRY } from './camera/director';
import { useFleet } from '@/fleet/FleetProvider';
import { hallMaterials } from './materials';
import { QualityContext, type Tier } from './quality';
import { useTwinState } from './state';
import { Architecture } from './scene/Architecture';
import { Atmosphere } from './scene/Atmosphere';
import { Campus } from './scene/Campus';
import { Devices } from './scene/Devices';
import { Floor } from './scene/Floor';
import { Gallery } from './scene/Gallery';
import { Library } from './scene/Library';
import { Lights } from './scene/Lights';
import { Memorial } from './scene/Memorial';
import { Outdoors } from './scene/Outdoors';
import { Outside } from './scene/outside';
import { Shadows } from './scene/Shadows';
import { Toran } from './scene/Toran';
import { recordTiming, telemetry } from './telemetry';
import { TransitionDirector } from './transition/Director';

/**
 * Per-frame counters. info.autoReset is off, so these include every pass the
 * frame took, the reflector and bloom included, rather than only the last one.
 */
const TEXTURE_SLOTS = [
  'map',
  'roughnessMap',
  'bumpMap',
  'emissiveMap',
  'alphaMap',
  'normalMap',
  'metalnessMap',
] as const;

function measureTextures(scene: THREE.Scene): number {
  const seen = new Set<THREE.Texture>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      for (const slot of TEXTURE_SLOTS) {
        const t = (m as unknown as Record<string, unknown>)[slot];
        if (
          t instanceof THREE.Texture &&
          !(t as { isRenderTargetTexture?: boolean }).isRenderTargetTexture
        )
          seen.add(t);
      }
    }
  });
  let bytes = 0;
  for (const t of seen) {
    const image = t.image as { width?: number; height?: number } | undefined;
    if (image?.width && image.height) bytes += image.width * image.height * 4 * (4 / 3);
  }
  return Math.round(bytes);
}

function Probe({ tier }: { tier: Tier }) {
  const { gl, scene } = useThree();
  const measured = useRef(0);
  const last = useRef(performance.now());
  const samples = useRef<number[]>([]);
  const firstFrame = useRef(false);

  useEffect(() => {
    telemetry().tier = tier;
  }, [tier]);

  useFrame(() => {
    const now = performance.now();
    const dt = now - last.current;
    last.current = now;
    if (!firstFrame.current) {
      firstFrame.current = true;
      recordTiming('firstFrame');
    }
    // Screens rebuild when language changes, so re-measure now and then.
    measured.current += 1;
    if (measured.current % 120 === 1) telemetry().textureBytes = measureTextures(scene);
    const s = samples.current;
    s.push(dt);
    if (s.length > 60) s.shift();
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    const tel = telemetry();
    tel.framesDrawn += 1;
    if (tel.entryStart !== null && tel.entryEnd === null) tel.entryFrames.push(dt);
    const f = tel.frame;
    f.ms = mean;
    f.fps = 1000 / mean;
    f.calls = gl.info.render.calls;
    f.triangles = gl.info.render.triangles;
    f.geometries = gl.info.memory.geometries;
    f.textures = gl.info.memory.textures;
    gl.info.reset();
  });
  return null;
}

function Scene({
  tier,
  replayToken,
  skipEntry,
}: {
  tier: Tier;
  replayToken: number;
  skipEntry: boolean;
}) {
  const { devices, health } = useFleet();
  return (
    <>
      <color attach="background" args={['#0b0a09']} />
      <fogExp2 attach="fog" args={['#141210', 0.012]} />
      {/*
        Image based fill, built from light panels and rendered once. Metals
        with no environment to reflect render close to black, so without this
        the brass, the signature material of the building, reads as dark
        bronze. It also gives the sandstone a soft bounce light at no per
        light cost, and it is generated here rather than downloaded.
      */}
      <Environment resolution={64} frames={1} environmentIntensity={0.55}>
        {/* The real ceiling is dark, so its bounce is dim. A bright panel here
            made the floor mirror a ceiling that is not there. */}
        <Lightformer
          form="rect"
          intensity={0.3}
          color="#ffe2bd"
          position={[0, 12, -8]}
          rotation-x={Math.PI / 2}
          scale={[24, 42, 1]}
        />
        <Lightformer
          form="rect"
          intensity={2.4}
          color="#ffd29a"
          position={[-12, 8, -8]}
          rotation-y={Math.PI / 2}
          scale={[40, 5, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.9}
          color="#c87a4e"
          position={[12, 5, -8]}
          rotation-y={-Math.PI / 2}
          scale={[40, 8, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1.2}
          color="#fff0d8"
          position={[0, 5, -30]}
          scale={[10, 8, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.35}
          color="#5a3b25"
          position={[0, 6, 40]}
          rotation-y={Math.PI}
          scale={[80, 14, 1]}
        />
      </Environment>
      <Lights />
      <Outside>
        <Outdoors />
        <Campus />
        <Memorial />
      </Outside>
      <Architecture />
      <Toran />
      <Floor />
      <Library />
      <Gallery />
      <Shadows />
      <Devices devices={devices} health={health} />
      <Atmosphere />
      <CameraRig replayToken={replayToken} skipEntry={skipEntry} />
      <TransitionDirector tier={tier} />
      <Probe tier={tier} />
      {tier === 'high' && (
        <EffectComposer multisampling={4}>
          <Bloom
            mipmapBlur
            luminanceThreshold={0.7}
            luminanceSmoothing={0.18}
            intensity={0.85}
            radius={0.7}
          />
          <Vignette offset={0.3} darkness={0.6} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      )}
    </>
  );
}

/** True once `on` has been true for `delay` without interruption. */
function useSettled(on: boolean, delay: number): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!on) {
      setSettled(false);
      return;
    }
    const id = window.setTimeout(() => setSettled(true), delay);
    return () => window.clearTimeout(id);
  }, [on, delay]);
  return settled;
}

export interface TwinCanvasProps {
  tier: Tier;
  pinned: boolean;
  onTier: (tier: Tier) => void;
  replayToken: number;
  skipEntry: boolean;
  /**
   * False while a device's application covers the hall. The GPU has no reason
   * to draw a building nobody can see, and on a tablet that is battery and heat.
   */
  rendering: boolean;
}

export default function TwinCanvas({
  tier,
  pinned,
  onTier,
  replayToken,
  skipEntry,
  rendering,
}: TwinCanvasProps) {
  const start = ENTRY[0];
  const { entered } = useTwinState();
  const judging = useSettled(entered, 1800);
  return (
    <QualityContext.Provider value={tier}>
      <Canvas
        frameloop={rendering ? 'always' : 'never'}
        dpr={tier === 'high' ? [1, 1.75] : 1}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{
          fov: 50,
          near: 0.1,
          far: 420,
          position: start ? [...start.position] : [0, 2, 30],
        }}
        onCreated={({ gl }) => {
          gl.info.autoReset = false;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.08;
          const context = gl.getContext();
          const ext = context.getExtension('WEBGL_debug_renderer_info');
          const t = telemetry();
          t.renderer = ext
            ? String(context.getParameter(ext.UNMASKED_RENDERER_WEBGL))
            : 'unknown';
          t.texturesMs = hallMaterials().generatedMs;
        }}
      >
        {/*
          The monitor judges the hall at rest, and nothing else.

          The tier decides whether there is bloom, whether the floor reflects,
          how many motes are in the light shafts and how thickly the grounds
          are planted, so a tier change is a visible change to every one of
          them at once. It must never be made on a transient.

          Two transients sit either side of the threshold. The arrival crosses
          the whole site and its heaviest frames are nothing like the hall's.
          The handover itself then costs a frame or two as the camera controls
          take over. Judging either one drops the tier on a machine that holds
          the hall at sixty, and the drop is what the screen shows as a flicker
          a second or so after the camera lands.

          So it waits for the hall, and then for the hall to settle.
        */}
        {!pinned && judging && (
          <PerformanceMonitor
            flipflops={2}
            onDecline={() => onTier('low')}
            onIncline={() => onTier('high')}
            onFallback={() => onTier('low')}
          />
        )}
        <Scene tier={tier} replayToken={replayToken} skipEntry={skipEntry} />
      </Canvas>
    </QualityContext.Provider>
  );
}
