/**
 * A stand-in for the kiosk hardware daemon: a minimal RFC 6455 WebSocket
 * server on the loopback port the kiosk expects, sending the same messages
 * the real daemon will. It lets the browser's hardware driver be tested end
 * to end without a Raspberry Pi and an ultrasonic sensor on the desk.
 *
 * Server to client text frames only, which is all the protocol needs.
 */
import crypto from 'node:crypto';
import http from 'node:http';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function frame(text) {
  const payload = Buffer.from(text);
  const n = payload.length;
  const head =
    n < 126 ? Buffer.from([0x81, n]) : Buffer.from([0x81, 126, (n >> 8) & 0xff, n & 0xff]);
  return Buffer.concat([head, payload]);
}

export function startDaemon(port = 8765) {
  const sockets = new Set();
  const server = http.createServer();
  server.on('upgrade', (req, socket) => {
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
    socket.write(frame(JSON.stringify({ type: 'hello', daemon: 'toran-test-daemon', sensors: ['proximity'] })));
  });

  let metres = 5;
  let timer = null;
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      // Stream at 10 Hz, like the real sensor.
      timer = setInterval(() => {
        const msg = frame(JSON.stringify({ type: 'distance', metres, at: Date.now() }));
        for (const s of sockets) s.write(msg);
      }, 100);
      resolve({
        set: (m) => { metres = m; },
        connected: () => sockets.size,
        stop: () =>
          new Promise((done) => {
            clearInterval(timer);
            for (const s of sockets) s.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}
