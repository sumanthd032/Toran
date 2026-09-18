'use client';

/**
 * The thirteen devices.
 *
 * Every device body in the hall is baked into world space and merged, so all
 * thirteen bodies cost one draw call in bronze and one in brass. Screens and
 * name plates carry per-device textures and are drawn individually.
 *
 * A device is selected by tapping it or by choosing it from the device sheet.
 * Selection marks it with a brass ring on the floor. Flying the camera to it
 * and opening its application is step 5.
 */

import { Billboard } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { DeviceHealth } from '@toran/contracts';
import { useI18n, type MessageKey } from '@/i18n';
import { DEVICES, statusOf, type HallDevice } from '@/fleet/devices';
import { mergeParts, type Part } from '../geometry';
import { hallMaterials } from '../materials';
import { label as labelTexture, screen as screenTexture } from '../textures';
import { useTwinState } from '../state';
import { formSpec, type ScreenSpec } from './deviceForms';

const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler();

/** Bake a part's local placement into its geometry. */
function bake(part: Part): THREE.BufferGeometry {
  const g = part.geometry.clone();
  const [rx, ry, rz] = part.rotation ?? [0, 0, 0];
  euler.set(rx, ry, rz, part.order ?? 'XYZ');
  quat.setFromEuler(euler);
  matrix.compose(
    new THREE.Vector3(...(part.position ?? [0, 0, 0])),
    quat,
    new THREE.Vector3(1, 1, 1),
  );
  g.applyMatrix4(matrix);
  return g;
}

function toWorld(parts: Part[], device: HallDevice): Part[] {
  return parts.map((p) => ({
    geometry: bake(p),
    position: [...device.position] as [number, number, number],
    rotation: [0, device.rotationY, 0] as [number, number, number],
  }));
}

function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}

function Screen({
  spec,
  device,
  health,
}: {
  spec: ScreenSpec;
  device: HallDevice;
  health: DeviceHealth | undefined;
}) {
  const { t, lang } = useI18n();
  const status = statusOf(health);
  const title = t(`device.channel.${device.channel}` as MessageKey);
  const statusLabel =
    status === 'offline' && health !== undefined
      ? t('device.status.offlineFor', { minutes: minutesSince(health.lastSeen) })
      : t(`device.status.${status}` as MessageKey);

  const material = useMemo(() => {
    const map = screenTexture(
      device.channel,
      title,
      status,
      statusLabel,
      lang,
      spec.portrait ?? false,
    );
    const m = new THREE.MeshBasicMaterial({ map, toneMapped: false });
    // Push lit screens past the bloom threshold so they glow in the dim hall.
    m.color.setScalar(status === 'online' ? 1.35 : status === 'idle' ? 0.8 : 1);
    return m;
  }, [device.channel, title, status, statusLabel, lang, spec.portrait]);

  useEffect(
    () => () => {
      material.map?.dispose();
      material.dispose();
    },
    [material],
  );

  return (
    <mesh
      position={spec.position}
      rotation={new THREE.Euler(...spec.rotation, spec.order ?? 'XYZ')}
      material={material}
    >
      <planeGeometry args={spec.size} />
    </mesh>
  );
}

function NamePlate({
  device,
  health,
  y,
}: {
  device: HallDevice;
  health: DeviceHealth | undefined;
  y: number;
}) {
  const { t, lang } = useI18n();
  const { entered } = useTwinState();
  const status = statusOf(health);
  const name = t(`device.channel.${device.channel}` as MessageKey);
  const ref = useRef<THREE.MeshBasicMaterial>(null);

  const map = useMemo(() => labelTexture(name, status, lang), [name, status, lang]);
  useEffect(() => () => map.dispose(), [map]);

  // Plates stay out of the entry shot and fade in once the visitor is inside.
  useFrame((_, delta) => {
    const m = ref.current;
    if (m === null) return;
    const target = entered ? 0.96 : 0;
    m.opacity += (target - m.opacity) * Math.min(1, delta * 3);
    m.visible = m.opacity > 0.01;
  });

  return (
    <Billboard position={[0, y, 0]}>
      <mesh renderOrder={5}>
        <planeGeometry args={[1.6, 0.35]} />
        <meshBasicMaterial
          ref={ref}
          map={map}
          transparent
          opacity={0}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </Billboard>
  );
}

function Device({
  device,
  health,
}: {
  device: HallDevice;
  health: DeviceHealth | undefined;
}) {
  const spec = useMemo(() => formSpec(device.form), [device.form]);
  const { hover, select, selected } = useTwinState();

  return (
    <group position={device.position} rotation={[0, device.rotationY, 0]}>
      {spec.screens.map((s, i) => (
        <Screen key={i} spec={s} device={device} health={health} />
      ))}
      <NamePlate device={device} health={health} y={spec.labelY} />
      {/* Hit volume. Invisible meshes are still raycast, and cost no draw. */}
      <mesh
        position={[0, spec.hitY, 0]}
        visible={false}
        onPointerOver={(e) => {
          e.stopPropagation();
          hover(device.deviceId);
        }}
        onPointerOut={() => hover(null)}
        onClick={(e) => {
          e.stopPropagation();
          select(selected === device.deviceId ? null : device.deviceId);
        }}
      >
        <boxGeometry args={[spec.hit[0] * 2, spec.hit[1] * 2, spec.hit[2] * 2]} />
      </mesh>
    </group>
  );
}

/** A brass ring on the floor under whichever device is hovered or selected. */
function Marker() {
  const { hovered, selected } = useTwinState();
  const ref = useRef<THREE.Mesh>(null);
  const target = hovered ?? selected;
  const device = DEVICES.find((d) => d.deviceId === target);

  useFrame((state) => {
    const mesh = ref.current;
    if (mesh === null) return;
    mesh.visible = device !== undefined;
    if (device === undefined) return;
    const [x, , z] = device.position;
    // Wall displays are marked on the floor in front of them.
    const inset = device.form === 'wall' ? 1.4 : 0;
    mesh.position.set(
      x + Math.sin(device.rotationY) * inset,
      0.02,
      z + Math.cos(device.rotationY) * inset,
    );
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 2.2) * 0.03;
    mesh.scale.setScalar(pulse);
  });

  const m = hallMaterials();
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} material={m.inlay} visible={false}>
      <ringGeometry args={[1.05, 1.13, 64]} />
    </mesh>
  );
}

export function Devices({ health }: { health: ReadonlyMap<string, DeviceHealth> }) {
  const m = hallMaterials();

  const { body, trim } = useMemo(() => {
    const bodyParts: Part[] = [];
    const trimParts: Part[] = [];
    for (const d of DEVICES) {
      const spec = formSpec(d.form);
      bodyParts.push(...toWorld(spec.body, d));
      trimParts.push(...toWorld(spec.trim, d));
    }
    return { body: mergeParts(bodyParts), trim: mergeParts(trimParts) };
  }, []);

  return (
    <group>
      <mesh geometry={body} material={m.bronze} />
      <mesh geometry={trim} material={m.brass} />
      {DEVICES.map((d) => (
        <Device key={d.deviceId} device={d} health={health.get(d.deviceId)} />
      ))}
      <Marker />
    </group>
  );
}
