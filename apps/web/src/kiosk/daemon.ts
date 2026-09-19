'use client';

/**
 * The connection to the kiosk's hardware daemon, on loopback. DECISIONS.md
 * D-061.
 *
 * The daemon owns the proximity sensor and the card reader and speaks the
 * `KioskHardwareMessage` protocol. It restarts on its own, so the kiosk keeps
 * reconnecting, backing off to 8 s. A malformed frame is dropped, never fatal.
 */

import { HARDWARE_SOCKET, type KioskHardwareMessage } from '@toran/contracts';

export type DaemonStatus = 'connecting' | 'live' | 'down';

function isMessage(value: unknown): value is KioskHardwareMessage {
  if (typeof value !== 'object' || value === null) return false;
  const t = (value as { type?: unknown }).type;
  return t === 'hello' || t === 'distance' || t === 'card';
}

export function connectDaemon(
  handlers: {
    message: (message: KioskHardwareMessage) => void;
    status?: (status: DaemonStatus) => void;
  },
  url: string = HARDWARE_SOCKET,
): () => void {
  let socket: WebSocket | null = null;
  let closed = false;
  let retry = 500;
  let timer = 0;

  const connect = () => {
    handlers.status?.('connecting');
    socket = new WebSocket(url);
    socket.addEventListener('open', () => {
      retry = 500;
      handlers.status?.('live');
    });
    socket.addEventListener('message', (event: MessageEvent<string>) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (isMessage(parsed)) handlers.message(parsed);
    });
    socket.addEventListener('close', () => {
      if (closed) return;
      handlers.status?.('down');
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
}
