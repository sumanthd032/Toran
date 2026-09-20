/**
 * IIIF for the Manuscript Station: static level 0 image tiles and Presentation
 * 3.0 manifests, built from the scans step 8 ingested.
 *
 * Why static. The kiosk has no application server and the visitor surface has
 * to work with the network off, so there is nothing to answer an arbitrary
 * IIIF image request. A level 0 service answers exactly the regions and sizes
 * its info.json advertises and nothing else, which is what the specification
 * has level 0 for, and it is a directory of files. D-114.
 *
 * The tile set is not guessed. This mirrors OpenSeadragon's own URL
 * arithmetic for an IIIF 3 source, level by level, so every request the
 * viewer can make has a file waiting for it. verify:manuscript proves that by
 * counting the requests the browser actually makes and failing on a 404.
 *
 * Identifiers are absolute, as the specification requires, and are built from
 * IIIF_BASE. A kiosk serving the same files from some other origin rewrites
 * the identifier as it loads: the bytes do not change, so one build works
 * offline anywhere, and the published manifest stays valid.
 *
 * Output: apps/web/public/iiif/<pageId>/{info.json,manifest.json,tiles}
 *         apps/web/public/iiif/collection.json
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DIP = 'data/dip';
const OUT = 'apps/web/public/iiif';
const BASE = (process.env.IIIF_BASE ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const TILE = 512;
const SCALES = [1, 2, 4, 8, 16];
const QUALITY = 85;

const scans = JSON.parse(fs.readFileSync(`${DIP}/scans.json`, 'utf8'));
const works = new Map(
  JSON.parse(fs.readFileSync(`${DIP}/works.json`, 'utf8')).map((w) => [w.id, w]),
);

/** Every OCR reading of a page, whichever pipeline produced it. */
function readings(pageId) {
  const dir = `${DIP}/ocr`;
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${pageId}.`) && f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

/**
 * The levels OpenSeadragon will ask for, with the same arithmetic it uses:
 * maxLevel from the largest scale factor, and one level per factor.
 */
function levels(width, height) {
  const maxLevel = Math.round(Math.log(Math.max(...SCALES)) * Math.LOG2E);
  const out = [];
  for (let level = 0; level <= maxLevel; level++) {
    const scale = Math.pow(0.5, maxLevel - level);
    out.push({
      level,
      scale,
      width: Math.ceil(width * scale),
      height: Math.ceil(height * scale),
    });
  }
  return out;
}

/**
 * Every tile of one level, as OpenSeadragon names it: the region in
 * full-resolution coordinates, the size at this level.
 */
function tilesOf(width, height, level) {
  const { scale, width: levelWidth, height: levelHeight } = level;
  const full = TILE / scale;
  if (levelWidth < TILE && levelHeight < TILE) {
    const size = levelWidth === width && levelHeight === height ? 'max' : `${levelWidth},${levelHeight}`;
    return [{ x: 0, y: 0, region: 'full', size, width: levelWidth, height: levelHeight }];
  }
  const across = Math.ceil(levelWidth / TILE);
  const down = Math.ceil(levelHeight / TILE);
  const tiles = [];
  for (let y = 0; y < down; y++) {
    for (let x = 0; x < across; x++) {
      const rx = Math.round(x * full);
      const ry = Math.round(y * full);
      const rw = Math.min(Math.round(full), width - rx);
      const rh = Math.min(Math.round(full), height - ry);
      const sw = Math.min(TILE, levelWidth - x * TILE);
      const sh = Math.min(TILE, levelHeight - y * TILE);
      tiles.push({
        x,
        y,
        region: x === 0 && y === 0 && rw === width && rh === height ? 'full' : `${rx},${ry},${rw},${rh}`,
        size: sw === width && sh === height ? 'max' : `${sw},${sh}`,
        width: sw,
        height: sh,
      });
    }
  }
  return tiles;
}

function magick(args) {
  execFileSync('magick', args, { stdio: ['ignore', 'ignore', 'pipe'] });
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

/** Cut one level into its tiles with a single pass over the image. */
function cutLevel(master, scan, level, dir) {
  const grid = tilesOf(scan.width, scan.height, level);
  // Beside the output, not in the system temp: a tile is moved into place,
  // and a move across filesystems is a copy of every one of them.
  const temp = fs.mkdtempSync(path.join(path.dirname(OUT), '.iiif-cut-'));
  try {
    const scaled = path.join(temp, 'level.png');
    magick([master, '-resize', `${level.width}x${level.height}!`, scaled]);
    if (grid.length === 1) {
      const only = grid[0];
      const file = `${dir}/${only.region}/${only.size}/0/default.jpg`;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      magick([scaled, '-quality', String(QUALITY), '-strip', file]);
      return 1;
    }
    magick([scaled, '-crop', `${TILE}x${TILE}`, '+repage', '+adjoin',
            '-quality', String(QUALITY), '-strip', path.join(temp, 'tile-%d.jpg')]);
    grid.forEach((tile, i) => {
      const cut = path.join(temp, `tile-${i}.jpg`);
      if (!fs.existsSync(cut)) throw new Error(`${scan.id}: level ${level.level} tile ${i} not cut`);
      const file = `${dir}/${tile.region}/${tile.size}/0/default.jpg`;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.renameSync(cut, file);
    });
    return grid.length;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function infoJson(scan, pyramid) {
  return {
    '@context': 'http://iiif.io/api/image/3/context.json',
    id: `${BASE}/iiif/${scan.id}`,
    type: 'ImageService3',
    protocol: 'http://iiif.io/api/image',
    profile: 'level0',
    width: scan.width,
    height: scan.height,
    maxWidth: scan.width,
    maxHeight: scan.height,
    tiles: [{ type: 'Tile', width: TILE, height: TILE, scaleFactors: [...SCALES] }],
    // Every size and region below is a file on disk. A level 0 service
    // answers these and refuses anything else, which is what level 0 means.
    sizes: pyramid.map((l) => ({ width: l.width, height: l.height })),
    extraFeatures: ['sizeByWh'],
    extraFormats: ['jpg'],
    extraQualities: ['default'],
  };
}

/** The transcription, as annotations a IIIF viewer can show beside the page. */
function transcription(scan, reading, canvasId) {
  return {
    id: `${BASE}/iiif/${scan.id}/annotations/${reading.pipeline}`,
    type: 'AnnotationPage',
    items: reading.regions
      .filter((r) => r.text.trim() !== '')
      .map((region, i) => ({
        id: `${BASE}/iiif/${scan.id}/annotations/${reading.pipeline}/${i}`,
        type: 'Annotation',
        motivation: 'supplementing',
        body: {
          type: 'TextualBody',
          value: region.text,
          format: 'text/plain',
          language: reading.language,
        },
        // Where the machine read it, when it said where. A hand gives lines
        // and no coordinates, so those annotations take the whole canvas.
        target:
          region.polygon === null
            ? canvasId
            : `${canvasId}#xywh=${box(region.polygon).join(',')}`,
      })),
  };
}

function box(polygon) {
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  const x = Math.max(0, Math.round(Math.min(...xs)));
  const y = Math.max(0, Math.round(Math.min(...ys)));
  return [x, y, Math.round(Math.max(...xs)) - x, Math.round(Math.max(...ys)) - y];
}

function label(text) {
  return { none: [text] };
}

function manifest(scan, pyramid) {
  const id = `${BASE}/iiif/${scan.id}/manifest.json`;
  const canvasId = `${BASE}/iiif/${scan.id}/canvas`;
  const cited = scan.cites === null ? null : works.get(scan.cites);
  const metadata = [
    ['Source', scan.title],
    ['Page', scan.printedPage === null ? scan.heading : `${scan.printedPage}, ${scan.heading}`],
    ['Written', scan.kind === 'handwritten' ? 'By hand' : 'Printed'],
    ['Script', scan.script],
    ['Held by', scan.credit],
    ['Master', `${scan.master.url} (sha1 ${scan.master.sha1})`],
    ['This image', scan.master.rendered],
    cited === null ? null : ['In the archive', cited.title],
  ].filter(Boolean);

  const pages = readings(scan.id).map((r) => transcription(scan, r, canvasId));

  return {
    '@context': 'http://iiif.io/api/presentation/3/context.json',
    id,
    type: 'Manifest',
    label: label(`${scan.title}: ${scan.heading}`),
    summary: label(scan.note ?? scan.heading),
    requiredStatement: {
      label: label('Rights'),
      value: label(`${scan.rights} Recorded by the repository and not independently confirmed.`),
    },
    metadata: metadata.map(([k, v]) => ({ label: label(k), value: label(String(v)) })),
    items: [
      {
        id: canvasId,
        type: 'Canvas',
        label: label(scan.printedPage === null ? scan.heading : `Page ${scan.printedPage}`),
        width: scan.width,
        height: scan.height,
        items: [
          {
            id: `${canvasId}/painting`,
            type: 'AnnotationPage',
            items: [
              {
                id: `${canvasId}/painting/1`,
                type: 'Annotation',
                motivation: 'painting',
                target: canvasId,
                body: {
                  id: `${BASE}/iiif/${scan.id}/full/max/0/default.jpg`,
                  type: 'Image',
                  format: 'image/jpeg',
                  width: scan.width,
                  height: scan.height,
                  service: [infoJson(scan, pyramid)],
                },
              },
            ],
          },
        ],
        ...(pages.length > 0 ? { annotations: pages } : {}),
      },
    ],
  };
}

fs.rmSync(OUT, { recursive: true, force: true });
let tiles = 0;
const built = [];
for (const scan of scans) {
  const master = `${DIP}/scans/${scan.file}`;
  const dir = `${OUT}/${scan.id}`;
  const pyramid = levels(scan.width, scan.height);
  for (const level of pyramid) tiles += cutLevel(master, scan, level, dir);
  // full/max is the whole page at full resolution: what a viewer with no
  // tiling support falls back to, and what the manifest paints.
  fs.mkdirSync(`${dir}/full/max/0`, { recursive: true });
  magick([master, '-quality', String(QUALITY), '-strip', `${dir}/full/max/0/default.jpg`]);
  tiles += 1;
  // And the whole page at each size info.json advertises. A client that
  // reads `sizes` rather than `tiles`, which OpenSeadragon does before it
  // has a viewport, asks for these by name, and level 0 has to answer every
  // size it lists or it is lying about what it holds.
  for (const level of pyramid) {
    if (level.width === scan.width && level.height === scan.height) continue;
    const at = `${dir}/full/${level.width},${level.height}/0`;
    fs.mkdirSync(at, { recursive: true });
    magick([master, '-resize', `${level.width}x${level.height}!`,
            '-quality', String(QUALITY), '-strip', `${at}/default.jpg`]);
    tiles += 1;
  }
  writeJson(`${dir}/info.json`, infoJson(scan, pyramid));
  writeJson(`${dir}/manifest.json`, manifest(scan, pyramid));
  built.push(scan);
  const bytes = du(dir);
  console.log(`  ${scan.id.padEnd(28)} ${scan.width}x${scan.height}  `
    + `${pyramid.length} levels  ${(bytes / 1e6).toFixed(1)} MB`);
}

writeJson(`${OUT}/collection.json`, {
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id: `${BASE}/iiif/collection.json`,
  type: 'Collection',
  label: label('Toran: scanned pages'),
  summary: label(
    'Printed pages and manuscript hands from the Ambedkar corpus, each with the '
    + 'transcription a machine read from it and the confidence it reported.',
  ),
  items: built.map((scan) => ({
    id: `${BASE}/iiif/${scan.id}/manifest.json`,
    type: 'Manifest',
    label: label(`${scan.title}: ${scan.heading}`),
  })),
});

function du(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += fs.statSync(path.join(entry.parentPath ?? dir, entry.name)).size;
  }
  return total;
}

console.log(`iiif: ${built.length} manifests, ${tiles} tiles, base ${BASE}`);
