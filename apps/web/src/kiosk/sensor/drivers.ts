'use client';

/**
 * Three ways a kiosk learns how close someone is. STEPS.md step 5.
 *
 *   hardware   the kiosk daemon's local WebSocket, which owns the GPIO pins or
 *              the serial port on the Pi. The browser cannot touch hardware
 *              itself, so this is the only real path.
 *   simulator  the keyboard, for development and for demos without a sensor.
 *   null       nothing. The kiosk boots to subtle and is a touch kiosk.
 *
 * Chosen with ?sensor=hw|sim|null. The default is null, because the tablet and
 * the web build have no sensor, and a kiosk that guessed wrong about a sensor
 * would sit in its attract loop ignoring the person in front of it.
 */

import { HARDWARE_SOCKET, type KioskHardwareMessage } from '@toran/contracts';
import { NOBODY_M } from './smooth';

export type DriverKind = 'hardware' | 'simulator' | 'null';
export type DriverStatus = 'connecting' | 'live' | 'down';

export interface DriverSink {
  distance: (metres: number, at: number) => void;
  card: (token: string, at: number) => void;
  status: (status: DriverStatus) => void;
}

export interface SensorDriver {
  readonly kind: DriverKind;
  start: (sink: DriverSink) => () => void;
}

export const nullDriver: SensorDriver = {
  kind: 'null',
  start: (sink) => {
    sink.status('down');
    return () => undefined;
  },
};

/**
 * Keys 0 to 4 put a simulated visitor at a distance, arrows walk them in and
 * out by 25 cm. Readings stream at 10 Hz like the real sensor, so the rest of
 * the kiosk cannot tell the difference.
 */
export const SIMULATOR_KEYS: Readonly<Record<string, number>> = {
  '0': NOBODY_M,
  '1': 3.6,
  '2': 2.2,
  '3': 1.0,
  '4': 0.3,
};

export function simulatorDriver(start = NOBODY_M): SensorDriver {
  return {
    kind: 'simulator',
    start: (sink) => {
      let metres = start;
      sink.status('live');
      const onKey = (e: KeyboardEvent) => {
        const preset = SIMULATOR_KEYS[e.key];
        if (preset !== undefined) metres = preset;
        else if (e.key === 'ArrowUp') metres = Math.max(0.1, metres - 0.25);
        else if (e.key === 'ArrowDown') metres = Math.min(NOBODY_M, metres + 0.25);
        else return;
        sink.distance(metres, performance.now());
      };
      window.addEventListener('keydown', onKey);
      const id = window.setInterval(() => sink.distance(metres, performance.now()), 100);
      return () => {
        window.removeEventListener('keydown', onKey);
        window.clearInterval(id);
      };
    },
  };
}

function isMessage(value: unknown): value is KioskHardwareMessage {
  if (typeof value !== 'object' || value === null) return false;
  const t = (value as { type?: unknown }).type;
  return t === 'hello' || t === 'distance' || t === 'card';
}

export function hardwareDriver(url: string = HARDWARE_SOCKET): SensorDriver {
  return {
    kind: 'hardware',
    start: (sink) => {
      let socket: WebSocket | null = null;
      let closed = false;
      let retry = 500;
      let timer = 0;

      const connect = () => {
        sink.status('connecting');
        socket = new WebSocket(url);
        socket.addEventListener('open', () => {
          retry = 500;
          sink.status('live');
        });
        socket.addEventListener('message', (event: MessageEvent<string>) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(event.data);
          } catch {
            return; // A malformed frame from the daemon is dropped, never fatal.
          }
          if (!isMessage(parsed)) return;
          const now = performance.now();
          if (parsed.type === 'distance') sink.distance(parsed.metres, now);
          else if (parsed.type === 'card') sink.card(parsed.token, now);
        });
        socket.addEventListener('close', () => {
          if (closed) return;
          sink.status('down');
          // The daemon restarts; the kiosk keeps trying, backing off to 8 s.
          timer = window.setTimeout(connect, retry);
          retry = Math.min(8000, retry * 2);
        });
      };

      connect();
      return () => {
        closed = true;
        window.clearTimeout(timer);
        socket?.close();
      };
    },
  };
}

export function selectDriver(search: string): SensorDriver {
  const choice = new URLSearchParams(search).get('sensor');
  if (choice === 'hw') return hardwareDriver();
  if (choice === 'sim') return simulatorDriver();
  return nullDriver;
}
