/**
 * Starts Toran Core.
 *
 * The same command runs the three deployments ARCHITECTURE.md section 7 names:
 * a workstation inside DAIC, a laptop at a demo, a Pi beside the kiosks. What
 * changes between them is the database file and the port, both environment
 * variables, and nothing else. The kiosks do not know which they are talking to.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEVICES } from '../../web/src/fleet/devices.ts';
import { openDb } from './db.ts';
import { createCore } from './server.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const envFile = path.join(ROOT, '.env.local');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const port = Number.parseInt(process.env['TORAN_CORE_PORT'] ?? '8787', 10);
// Loopback by default. A Core that binds every interface the moment it is
// installed is a Core somebody exposed by accident; a hall deployment sets
// this to 0.0.0.0 on a LAN that has a router in front of it.
const host = process.env['TORAN_CORE_HOST'] ?? '127.0.0.1';
const file = process.env['TORAN_CORE_DB'] ?? path.join(ROOT, 'data', 'core.sqlite');
const origins = (process.env['TORAN_CORE_ORIGINS'] ?? '*')
  .split(',')
  .map((o) => o.trim())
  .filter((o) => o !== '');

fs.mkdirSync(path.dirname(file), { recursive: true });
const db = openDb(file);
const core = createCore({
  db,
  version: '0.1.0',
  origins,
  seed: DEVICES,
});

const server = core.router.listen(port, host);

console.log(`Toran Core on http://${host}:${String(port)}${'/v1/status'}`);
console.log(`  store     ${path.relative(ROOT, file)}`);
console.log(`  devices   ${String(core.fleet.configs().length)}`);
console.log(`  sessions  ${String(core.sessions.count())} live`);
console.log(`  services  ${core.services.join(', ')}`);
if (origins.includes('*')) {
  console.log('  origins   any. Set TORAN_CORE_ORIGINS before facing the public.');
} else {
  console.log(`  origins   ${origins.join(', ')}`);
}

const stop = (signal: string) => {
  console.log(`\ncore: ${signal}, closing`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
