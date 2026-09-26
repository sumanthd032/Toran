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
import { haveCredentials } from '@toran/narrate/credentials';
import { groqProvider } from './assistant/provider.ts';
import { openDb } from './db.ts';
import { bhashiniTranscriber } from './language/transcribe.ts';
import { HallSimulator } from './simulate.ts';
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

// A Core with no key still runs the hall. It says so in its status, and the
// kiosks answer from their cache rather than calling a route that cannot work.
const groqKey = (process.env['GROQ_API_KEY'] ?? '').trim();

// Without a curator key the hall runs and nothing in it can be changed. A
// short key is treated as none, because ten guesses a minute would find it.
const curatorKey = (process.env['TORAN_CURATOR_KEY'] ?? '').trim();
const curatorKeyUsable = curatorKey.length >= 16;

fs.mkdirSync(path.dirname(file), { recursive: true });
const db = openDb(file);
const core = createCore({
  db,
  version: '0.1.0',
  origins,
  seed: DEVICES,
  assistant: groqKey === '' ? undefined : groqProvider(groqKey),
  curatorKey: curatorKeyUsable ? curatorKey : undefined,
  transcriber: haveCredentials() ? bhashiniTranscriber() : undefined,
  // The repository by default. A check points it at a copy, so a test
  // decision never lands in the real curation log.
  archiveRoot: process.env['TORAN_ARCHIVE_ROOT'] ?? ROOT,
});

// The built Twin, served from this origin, so a deployed hall and localhost
// are the same program on the same paths. D-160.
const webRoot = (process.env['TORAN_WEB_ROOT'] ?? '').trim();
const web = webRoot === '' ? undefined : path.resolve(ROOT, webRoot);
if (web !== undefined && !fs.existsSync(path.join(web, 'index.html'))) {
  console.error(
    `core: TORAN_WEB_ROOT names ${web}, which has no index.html. Build the web app first.`,
  );
  process.exit(1);
}

// The live archive answers /archive/ ahead of the export, so what a curator
// confirms or corrects is on the served Twin as soon as it is rebuilt.
const liveArchive = path.join(
  process.env['TORAN_ARCHIVE_ROOT'] ?? ROOT,
  'apps/web/public/archive',
);
const overlays =
  web !== undefined && fs.existsSync(liveArchive)
    ? [{ prefix: '/archive/', root: liveArchive }]
    : [];

const server = core.router.listen(port, host, web, overlays);

// The living hall: a simulated visitor at each device, for a Twin with no
// kiosks in the building. Off unless asked for, and every beat it sends is
// marked simulated. D-161.
const archiveRoot = process.env['TORAN_ARCHIVE_ROOT'] ?? ROOT;
const worksFile = path.join(archiveRoot, 'data/dip/works.json');
const works: string[] = fs.existsSync(worksFile)
  ? (JSON.parse(fs.readFileSync(worksFile, 'utf8')) as { id: string }[]).map((w) => w.id)
  : [];
const hall =
  process.env['TORAN_SIMULATE_HALL'] === '1'
    ? new HallSimulator(core.fleet, works)
    : null;
hall?.start();

console.log(`Toran Core on http://${host}:${String(port)}${'/v1/status'}`);
console.log(`  store     ${path.relative(ROOT, file)}`);
if (hall !== null) {
  console.log(
    `  hall      simulated visitors at every device, over ${String(works.length)} works`,
  );
}
if (web !== undefined)
  console.log(
    `  twin      ${path.relative(ROOT, web)}, at http://${host}:${String(port)}/`,
  );
console.log(`  devices   ${String(core.fleet.configs().length)}`);
console.log(`  sessions  ${String(core.sessions.count())} live`);
console.log(`  services  ${core.services.join(', ')}`);
if (groqKey === '') {
  console.log('  assistant no GROQ_API_KEY, so kiosks will answer from their cache');
}
if (!curatorKeyUsable) {
  console.log(
    curatorKey === ''
      ? '  curation no TORAN_CURATOR_KEY, so the fleet and the archive are read only'
      : '  curation TORAN_CURATOR_KEY is shorter than 16 characters and was ignored',
  );
}
if (origins.includes('*')) {
  console.log('  origins   any. Set TORAN_CORE_ORIGINS before facing the public.');
} else {
  console.log(`  origins   ${origins.join(', ')}`);
}

const stop = (signal: string) => {
  console.log(`\ncore: ${signal}, closing`);
  hall?.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
