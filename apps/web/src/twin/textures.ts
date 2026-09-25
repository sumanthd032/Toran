/**
 * Procedural textures, generated at load from code.
 *
 * Nothing here is downloaded. The hall ships as JavaScript, which keeps the
 * cold load inside its three second budget and means there is no asset
 * pipeline to maintain. The cost is a few tens of milliseconds of canvas work
 * on startup, measured by the performance overlay.
 *
 * Text is drawn with Canvas 2D rather than as WebGL glyphs on purpose. The
 * browser's canvas text path shapes Devanagari conjuncts correctly; the SDF
 * text renderers commonly used in three.js do not, and a Marathi label with
 * broken conjuncts would be worse than no label.
 */

import * as THREE from 'three';

// ---------- noise ----------

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise, tileable over `period` cells so textures repeat without seams. */
function valueNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const wrap = (v: number) => ((v % period) + period) % period;
  const a = hash(wrap(xi), wrap(yi), seed);
  const b = hash(wrap(xi + 1), wrap(yi), seed);
  const c = hash(wrap(xi), wrap(yi + 1), seed);
  const d = hash(wrap(xi + 1), wrap(yi + 1), seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

function fbm(u: number, v: number, base: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = base;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(u * freq, v * freq, freq, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (ctx === null) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function toTexture(
  c: HTMLCanvasElement,
  srgb: boolean,
  repeat = false,
): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.needsUpdate = true;
  return t;
}

// ---------- stone ----------

/**
 * Red sandstone, from the Chaitya Arch and the interior friezes. Grain from
 * layered noise, and faint horizontal bedding, because sandstone is laid down
 * in strata and a uniform red reads as plastic.
 */
export function sandstone(size = 512): {
  map: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
} {
  const [c, ctx] = canvas(size, size);
  const [rc, rctx] = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const rough = rctx.createImageData(size, size);
  const base = [150, 86, 66];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const grain = fbm(u, v, 8, 5, 3);
      const strata = 0.5 + 0.5 * Math.sin(v * Math.PI * 2 * 9 + fbm(u, v, 3, 3, 9) * 5);
      const speck = hash(x, y, 41) > 0.985 ? 0.12 : 0;
      const k = 0.78 + grain * 0.36 + strata * 0.06 - speck;
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, base[0]! * k);
      img.data[i + 1] = Math.min(255, base[1]! * k * (0.96 + grain * 0.08));
      img.data[i + 2] = Math.min(255, base[2]! * k);
      img.data[i + 3] = 255;
      const r = 170 + (grain - 0.5) * 120;
      rough.data[i] = r;
      rough.data[i + 1] = r;
      rough.data[i + 2] = r;
      rough.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  rctx.putImageData(rough, 0, 0);
  return { map: toTexture(c, true, true), roughness: toTexture(rc, false, true) };
}

/**
 * Carved relief, used as a bump map. The Sanchi gateways are covered in dense
 * narrative relief. This does not model it; it suggests it under raking light
 * with rows of bosses, lotus medallions and figure-like uprights in framed
 * panels, which is enough for the eye at hall distances.
 */
export function relief(size = 512): THREE.CanvasTexture {
  // The Sanchi posts carry narrative panels stacked in registers, divided by
  // horizontal bands. A grid of square panels, which was the first attempt,
  // made every carved surface read as tiled wall. Registers read as carving.
  const [c, ctx] = canvas(size, size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Weathering: a low mid grey with soft variation, so flat stone is not flat.
      const v = 104 + (fbm(x / size, y / size, 6, 4, 23) - 0.5) * 40;
      const i = (y * size + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const register = size / 2;
  const band = (y: number) => {
    const g = ctx.createLinearGradient(0, y - 10, 0, y + 10);
    g.addColorStop(0, '#5a5a5a');
    g.addColorStop(0.5, '#c8c8c8');
    g.addColorStop(1, '#5a5a5a');
    ctx.fillStyle = g;
    ctx.fillRect(0, y - 10, size, 20);
  };
  band(0);
  band(register);
  band(size);

  // Upper register: three lotus medallions.
  for (let i = 0; i < 3; i++) {
    const cx = size * (0.18 + i * 0.32);
    const cy = register * 0.52;
    const radius = register * 0.3;
    for (let p = 0; p < 12; p++) {
      const a = (p / 12) * Math.PI * 2;
      const px = cx + Math.cos(a) * radius * 0.62;
      const py = cy + Math.sin(a) * radius * 0.62;
      const g = ctx.createRadialGradient(px, py, 1, px, py, radius * 0.34);
      g.addColorStop(0, '#c2c2c2');
      g.addColorStop(1, 'rgba(104,104,104,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, radius * 0.34, 0, Math.PI * 2);
      ctx.fill();
    }
    const core = ctx.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, radius * 0.3);
    core.addColorStop(0, '#d8d8d8');
    core.addColorStop(1, '#707070');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Lower register: a procession, figures of uneven height at uneven spacing.
  const heights = [0.62, 0.7, 0.55, 0.66, 0.6, 0.72];
  let fx = size * 0.08;
  heights.forEach((ht, i) => {
    const top = register + register * (0.86 - ht);
    const bottom = register + register * 0.86;
    const g = ctx.createLinearGradient(fx - 12, 0, fx + 12, 0);
    g.addColorStop(0, '#6a6a6a');
    g.addColorStop(0.5, '#cfcfcf');
    g.addColorStop(1, '#6a6a6a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(fx - 13, top + 26, 26, bottom - top - 26, 12);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(fx, top + 12, 13, 0, Math.PI * 2);
    ctx.fill();
    fx += size * (0.14 + ((i * 37) % 5) * 0.006);
  });

  const [s, sctx] = canvas(size, size);
  sctx.filter = 'blur(2.2px)';
  sctx.drawImage(c, 0, 0);
  return toTexture(s, false, true);
}

/** Dark polished floor in large slabs, with a faint sheen variation. */
export function floor(size = 1024): {
  map: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
} {
  const [c, ctx] = canvas(size, size);
  const [rc, rctx] = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const rough = rctx.createImageData(size, size);
  const tiles = 4;
  const seam = size / tiles;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const tileId = Math.floor(x / seam) + Math.floor(y / seam) * tiles;
      const tone = 0.9 + hash(tileId, 7, 5) * 0.2;
      const cloud = fbm(u, v, 4, 4, 11);
      const onSeam = x % seam < 2 || y % seam < 2;
      const k = (onSeam ? 0.78 : tone) * (0.82 + cloud * 0.3);
      const i = (y * size + x) * 4;
      img.data[i] = 52 * k;
      img.data[i + 1] = 44 * k;
      img.data[i + 2] = 36 * k;
      img.data[i + 3] = 255;
      const r = onSeam ? 230 : 70 + cloud * 70;
      rough.data[i] = r;
      rough.data[i + 1] = r;
      rough.data[i + 2] = r;
      rough.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  rctx.putImageData(rough, 0, 0);
  return { map: toTexture(c, true, true), roughness: toTexture(rc, false, true) };
}

/** Soft contact shadow. Cheaper than real shadows by a wide margin on a tablet. */
export function blob(size = 128): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(c, false);
}

/**
 * Alpha for light shafts: bright at the window, falling off toward the floor.
 *
 * three.js reads an alphaMap from the GREEN channel, not the alpha channel.
 * The gradient is therefore drawn in grey on an opaque black ground. Drawing
 * white with varying alpha, which is the obvious way, leaves green at 255
 * wherever any alpha exists and turns every shaft into a hard-edged slab.
 */
export function shaft(): THREE.CanvasTexture {
  const w = 64;
  const h = 256;
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, '#6a6a6a');
  g.addColorStop(0.75, '#1c1c1c');
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Darken toward both edges so a shaft has no hard sides.
  const img = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const across = Math.sin((x / (w - 1)) * Math.PI) ** 1.6;
      const i = (y * w + x) * 4;
      const v = img.data[i]! * across;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, false);
}

/**
 * A jali, the pierced stone lattice of Indian windows. Light comes through the
 * diamonds between the stone bars, warmer at the top where the sky is.
 */
export function jali(): THREE.CanvasTexture {
  const w = 128;
  const h = 400;
  const [c, ctx] = canvas(w, h);
  const glow = ctx.createLinearGradient(0, 0, 0, h);
  glow.addColorStop(0, '#fff0cf');
  glow.addColorStop(0.5, '#ffd79c');
  glow.addColorStop(1, '#e8a45e');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#2b1f16';
  ctx.lineWidth = 7;
  const step = 26;
  for (let k = -h; k < w + h; k += step) {
    ctx.beginPath();
    ctx.moveTo(k, 0);
    ctx.lineTo(k + h, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(k, 0);
    ctx.lineTo(k - h, h);
    ctx.stroke();
  }
  // Rosettes where the bars cross.
  ctx.fillStyle = '#2b1f16';
  for (let y = 0; y <= h; y += step / 2) {
    for (let x = (y / (step / 2)) % 2 === 0 ? 0 : step / 2; x <= w; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Stone frame.
  ctx.lineWidth = 10;
  ctx.strokeRect(0, 0, w, h);
  return toTexture(c, true);
}

/** Dusk sky for the forecourt: warm at the horizon, near black overhead. */
export function sky(): THREE.CanvasTexture {
  // Mapped onto a sphere, so the horizon is the middle of the texture.
  const [c, ctx] = canvas(8, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#0b0a09');
  g.addColorStop(0.34, '#15110e');
  g.addColorStop(0.46, '#34261b');
  g.addColorStop(0.5, '#5a3b25');
  g.addColorStop(0.54, '#2b2019');
  g.addColorStop(1, '#141210');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 256);
  return toTexture(c, true);
}

// ---------- documents and screens ----------

const FONT_UI = 'Archivo, system-ui, sans-serif';
const FONT_READ = 'Spectral, Georgia, serif';
const FONT_MONO = '"JetBrains Mono", ui-monospace, monospace';
const FONT_INDIC = '"Noto Serif Devanagari", Spectral, serif';

/**
 * The Preamble, on the wall at the end of the nave.
 *
 * It is read from the threshold, 37m away, through an arch that frames it at
 * about 230 screen pixels wide. Type set at one size for that distance is
 * unreadable at it: the old plate put 27px of a 768px canvas on the wall,
 * which arrives as four pixels. So it is set the way a memorial sets an
 * inscription, in three weights. The title and the four words the Preamble
 * turns on are cut large enough to read from the door; the text itself is
 * sized for someone standing at the dais. Nothing is abbreviated, because the
 * point of the wall is that the whole Preamble is on it.
 */
export function preamble(): THREE.CanvasTexture {
  const w = 1280;
  const h = 896;
  const [c, ctx] = canvas(w, h);
  const mid = w / 2;
  ctx.fillStyle = '#f4efe6';
  ctx.fillRect(0, 0, w, h);

  // A faint laid grain, so a large pale panel does not read as plastic.
  const grain = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const k = (hash(x >> 1, y >> 1, 7) - 0.5) * 16;
      grain.data[i] = 244 + k;
      grain.data[i + 1] = 239 + k;
      grain.data[i + 2] = 230 + k;
      grain.data[i + 3] = 26;
    }
  }
  ctx.putImageData(grain, 0, 0);

  ctx.strokeStyle = '#9a6a2f';
  ctx.lineWidth = 5;
  ctx.strokeRect(26, 26, w - 52, h - 52);
  ctx.lineWidth = 2;
  ctx.strokeRect(42, 42, w - 84, h - 84);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#1a1714';
  ctx.font = `600 48px ${FONT_READ}`;
  ctx.fillText('THE CONSTITUTION OF INDIA', mid, 100);
  ctx.fillStyle = '#803d29';
  ctx.fillRect(mid - 110, 124, 220, 3);

  ctx.fillStyle = '#1a1714';
  ctx.font = `700 70px ${FONT_READ}`;
  ctx.fillText('WE, THE PEOPLE OF INDIA', mid, 200);

  const body: [string, string][] = [
    ['400', 'having solemnly resolved to constitute India into a'],
    ['600', 'SOVEREIGN SOCIALIST SECULAR DEMOCRATIC REPUBLIC'],
    ['400', 'and to secure to all its citizens:'],
  ];
  let y = 256;
  for (const [weight, line] of body) {
    ctx.font = `${weight} 34px ${FONT_READ}`;
    ctx.fillText(line, mid, y);
    y += 44;
  }

  /**
   * One pillar: the word large in sandstone, its clause beside it in ink, the
   * pair centred as a unit. The clause is stepped down until the pair fits
   * inside the border, because "of thought, expression, belief, faith and
   * worship" is three times the length of "of status and of opportunity" and
   * a fixed size sets one of them off the edge of the plate.
   */
  const pillar = (word: string, clause: string, at: number) => {
    const limit = w - 140;
    let size = 30;
    let wordWidth = 0;
    let clauseWidth = 0;
    for (;;) {
      ctx.font = `700 56px ${FONT_READ}`;
      wordWidth = ctx.measureText(word).width;
      ctx.font = `400 ${size}px ${FONT_READ}`;
      clauseWidth = ctx.measureText(clause).width;
      if (wordWidth + 18 + clauseWidth <= limit || size <= 18) break;
      size -= 1;
    }
    const left = mid - (wordWidth + 18 + clauseWidth) / 2;
    ctx.textAlign = 'left';
    ctx.font = `700 56px ${FONT_READ}`;
    ctx.fillStyle = '#803d29';
    ctx.fillText(word, left, at);
    ctx.font = `400 ${size}px ${FONT_READ}`;
    ctx.fillStyle = '#1a1714';
    ctx.fillText(clause, left + wordWidth + 18, at - 3);
    ctx.textAlign = 'center';
  };

  y = 400;
  pillar('JUSTICE', 'social, economic and political;', y);
  pillar('LIBERTY', 'of thought, expression, belief, faith and worship;', y + 66);
  pillar('EQUALITY', 'of status and of opportunity;', y + 132);
  pillar('FRATERNITY', 'assuring the dignity of the individual', y + 198);

  ctx.fillStyle = '#1a1714';
  ctx.font = `400 32px ${FONT_READ}`;
  ctx.fillText('and the unity and integrity of the Nation;', mid, 678);
  ctx.font = `500 32px ${FONT_READ}`;
  ctx.fillText('IN OUR CONSTITUENT ASSEMBLY this twenty-sixth day of', mid, 722);
  ctx.fillText('November 1949, do HEREBY ADOPT, ENACT AND GIVE', mid, 760);
  ctx.fillText('TO OURSELVES THIS CONSTITUTION.', mid, 798);

  // The citation sits inside the inner rule at y = h - 42, not across it. A
  // 20px face on a 840 baseline drops to about 845, which clears it.
  ctx.font = `400 20px ${FONT_MONO}`;
  ctx.fillStyle = '#56503f';
  ctx.textAlign = 'left';
  ctx.fillText('Preamble, as adopted 26 November 1949', 64, 840);
  return toTexture(c, true);
}

export function portrait(): THREE.CanvasTexture {
  const w = 512;
  const h = 640;
  const [c, ctx] = canvas(w, h);
  const cx = w / 2;
  const SKIN = '#c9b294';
  const HAIR = '#221e1a';
  const INK = '#1a1714';

  // Ground: vellum, drawn down at the corners the way a studio plate is lit.
  ctx.fillStyle = '#e6dfd0';
  ctx.fillRect(0, 0, w, h);
  const lit = ctx.createRadialGradient(cx, 250, 40, cx, 300, 440);
  lit.addColorStop(0, 'rgba(246,241,232,0.9)');
  lit.addColorStop(1, 'rgba(58,50,40,0.5)');
  ctx.fillStyle = lit;
  ctx.fillRect(0, 0, w, h);

  // Jacket and shoulders.
  ctx.fillStyle = '#272320';
  ctx.beginPath();
  ctx.moveTo(cx - 54, 404);
  ctx.bezierCurveTo(cx - 168, 426, cx - 230, 486, cx - 244, h);
  ctx.lineTo(cx + 244, h);
  ctx.bezierCurveTo(cx + 230, 486, cx + 168, 426, cx + 54, 404);
  ctx.closePath();
  ctx.fill();

  // Collar, shirt and tie.
  ctx.fillStyle = '#ece6da';
  ctx.beginPath();
  ctx.moveTo(cx - 58, 408);
  ctx.lineTo(cx, 500);
  ctx.lineTo(cx + 58, 408);
  ctx.lineTo(cx + 32, 398);
  ctx.lineTo(cx, 440);
  ctx.lineTo(cx - 32, 398);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#463a30';
  ctx.beginPath();
  ctx.moveTo(cx - 16, 448);
  ctx.lineTo(cx + 16, 448);
  ctx.lineTo(cx + 24, h - 92);
  ctx.lineTo(cx - 24, h - 92);
  ctx.closePath();
  ctx.fill();

  // Neck, then the head.
  ctx.fillStyle = '#ab9679';
  ctx.fillRect(cx - 42, 330, 84, 86);
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.ellipse(cx, 236, 104, 128, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + sx * 102, 250, 15, 27, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // The hairline. Hair at the temples and over the ears, a high bare
  // forehead between them: the second thing after the spectacles that makes
  // this face his rather than any face in glasses.
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.ellipse(cx, 182, 106, 78, 0, Math.PI, 0);
  ctx.fill();
  // The forehead is cut back out of it, high and wide, which is what leaves a
  // hairline rather than a cap. The crown keeps only a thin band, and the
  // weight of the hair sits at the temples and over the ears.
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.ellipse(cx, 200, 96, 86, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = HAIR;
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + sx * 90, 218, 21, 58, 0, 0, Math.PI * 2);
    ctx.fill();
    // Grey at the temple, where his is.
    ctx.fillStyle = 'rgba(190,178,160,0.30)';
    ctx.beginPath();
    ctx.ellipse(cx + sx * 94, 232, 12, 34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = HAIR;
  }

  // Modelling, clipped to the head so it does not spill onto the ground.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, 236, 104, 128, 0, 0, Math.PI * 2);
  ctx.clip();
  const shade = ctx.createLinearGradient(cx - 104, 0, cx + 104, 0);
  shade.addColorStop(0, 'rgba(66,54,42,0.34)');
  shade.addColorStop(0.44, 'rgba(66,54,42,0)');
  shade.addColorStop(1, 'rgba(66,54,42,0.24)');
  ctx.fillStyle = shade;
  ctx.fillRect(cx - 104, 108, 208, 256);
  ctx.restore();

  // Brows, eyes, nose, mouth. All quiet: the rims carry the face.
  ctx.fillStyle = '#4a4034';
  for (const sx of [-1, 1]) ctx.fillRect(cx + sx * 50 - 30, 224, 60, 8);
  ctx.fillStyle = INK;
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + sx * 48, 258, 10, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(92,76,58,0.55)';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 3, 256);
  ctx.lineTo(cx - 10, 302);
  ctx.lineTo(cx + 12, 306);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(74,52,44,0.85)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(cx - 34, 338);
  ctx.quadraticCurveTo(cx, 348, cx + 34, 338);
  ctx.stroke();

  // The spectacles: heavy, level, wide. Unmistakable from the far end of the
  // nave, which is the whole reason this plate reads at all.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 11;
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.roundRect(cx + sx * 50 - 40, 232, 80, 56, 17);
    ctx.stroke();
  }
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(cx - 10, 254);
  ctx.lineTo(cx + 10, 254);
  ctx.stroke();
  ctx.lineWidth = 8;
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * 90, 244);
    ctx.lineTo(cx + sx * 106, 252);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';

  // Rules, and the name on a band clear of the plate's edge.
  ctx.strokeStyle = 'rgba(145,100,44,0.85)';
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, w - 28, h - 28);
  ctx.fillStyle = 'rgba(232,225,211,0.94)';
  ctx.fillRect(18, h - 86, w - 36, 68);
  ctx.fillStyle = '#803d29';
  ctx.fillRect(18, h - 86, w - 36, 3);
  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.font = `700 38px ${FONT_READ}`;
  ctx.fillText('DR. B. R. AMBEDKAR', cx, h - 48);
  ctx.fillStyle = '#56503f';
  ctx.font = `400 19px ${FONT_MONO}`;
  ctx.fillText('1891 - 1956', cx, h - 26);

  return toTexture(c, true);
}

/**
 * The same plate, made from a photograph instead of drawn.
 *
 * The picture is anchored to the top of its area and cropped at the foot, so
 * the head is never the part that is lost, and the name band is composited
 * under it rather than over it. The drawn plate above is what hangs if the
 * file is not on the device.
 */
export function portraitPlate(image: HTMLImageElement): THREE.CanvasTexture {
  const w = 512;
  const h = 640;
  // The band is deep enough for the name to be legible from the threshold.
  // At 2.72m wide the plate is about 150 pixels across from there, so a 56px
  // face on a 512px canvas arrives as 16, and a 38px one arrived as 11.
  const band = 104;
  const view = h - band;
  const [c, ctx] = canvas(w, h);

  ctx.fillStyle = '#e6dfd0';
  ctx.fillRect(0, 0, w, h);
  const scale = Math.max(w / image.width, view / image.height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, view);
  ctx.clip();
  ctx.drawImage(
    image,
    (w - image.width * scale) / 2,
    0,
    image.width * scale,
    image.height * scale,
  );
  ctx.restore();

  ctx.fillStyle = '#ece6da';
  ctx.fillRect(0, view, w, band);
  ctx.fillStyle = '#803d29';
  ctx.fillRect(0, view, w, 3);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#100e0c';
  // As large as the band will take. Eighteen characters of Spectral at 56px
  // run past a 512px plate, and a name clipped to AMBEDKA is worse than a
  // name two points smaller.
  let size = 56;
  do {
    ctx.font = `800 ${size}px ${FONT_READ}`;
    size -= 1;
  } while (ctx.measureText('DR. B. R. AMBEDKAR').width > w - 52 && size > 28);
  ctx.fillText('DR. B. R. AMBEDKAR', w / 2, view + 58);
  ctx.fillStyle = '#3a332b';
  ctx.font = `500 24px ${FONT_MONO}`;
  ctx.fillText('1891 - 1956', w / 2, view + 88);

  ctx.strokeStyle = 'rgba(145,100,44,0.85)';
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, w - 28, h - 28);
  return toTexture(c, true);
}

/**
 * The lintel over the entrance arch.
 *
 * What was there was the end of the spine gutter, a pale bar in page stock
 * lying flush with the face of the drum. It is a sign now: sandstone ground,
 * brass rules and brass letters, with a chakra at each end. Brass on red is
 * what the rest of the building uses for anything meant to be read at a
 * distance in this light, and a pale bar under two floodlights is not.
 */
export function welcomeLintel(): THREE.CanvasTexture {
  const w = 1024;
  const h = 224;
  const [c, ctx] = canvas(w, h);
  const mid = h / 2;

  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = 0.82 + fbm(x / w, y / h, 7, 4, 53) * 0.34;
      const i = (y * w + x) * 4;
      img.data[i] = Math.min(255, 128 * k);
      img.data[i + 1] = Math.min(255, 61 * k);
      img.data[i + 2] = Math.min(255, 41 * k);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  ctx.strokeStyle = '#c89b52';
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, w - 48, h - 48);

  // A chakra at each end, the same wheel that is laid into the forecourt.
  for (const cx of [86, w - 86]) {
    ctx.strokeStyle = '#c89b52';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, mid, 34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 6, mid + Math.sin(a) * 6);
      ctx.lineTo(cx + Math.cos(a) * 31, mid + Math.sin(a) * 31);
      ctx.stroke();
    }
    ctx.fillStyle = '#c89b52';
    ctx.beginPath();
    ctx.arc(cx, mid, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#e0b877';
  ctx.font = `600 46px ${FONT_INDIC}`;
  ctx.fillText('स्वागत', w / 2, 84);
  ctx.fillStyle = '#c89b52';
  ctx.font = `700 74px ${FONT_READ}`;
  ctx.fillText('WELCOME', w / 2, 166);
  ctx.fillStyle = 'rgba(200,155,82,0.75)';
  ctx.fillRect(w / 2 - 210, 182, 420, 2);

  return toTexture(c, true);
}

export type ScreenStatus = 'online' | 'idle' | 'offline';

/**
 * What each device is showing. These are miniatures of the real applications,
 * so a visitor looking across the hall sees a building full of working screens
 * rather than thirteen identical glowing rectangles.
 */
export function screen(
  channel: string,
  title: string,
  status: ScreenStatus,
  statusLabel: string,
  lang: string,
  portrait = false,
): THREE.CanvasTexture {
  const w = portrait ? 320 : 512;
  const h = portrait ? 576 : 320;
  const [c, ctx] = canvas(w, h);
  const indic = /^(hi|mr|sa|ne|kok|mai|doi|brx)$/.test(lang);

  if (status === 'offline') {
    ctx.fillStyle = '#0d0b0a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3a332b';
    ctx.font = `500 22px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText(statusLabel, w / 2, h / 2 + 8);
    return toTexture(c, true);
  }

  const dim = status === 'idle' ? 0.55 : 1;
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#1f1b17';
  ctx.fillRect(0, 0, w, h);

  // Header.
  ctx.globalAlpha = dim;
  ctx.fillStyle = '#c89b52';
  ctx.fillRect(0, 0, w, 3);
  ctx.font = `600 22px ${indic ? FONT_INDIC : FONT_UI}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e8e1d3';
  ctx.fillText(title, 24, 44);
  ctx.font = `500 14px ${FONT_MONO}`;
  ctx.fillStyle = '#a99e8c';
  ctx.textAlign = 'right';
  ctx.fillText('TORAN', w - 24, 42);
  ctx.textAlign = 'left';

  const paper = '#e8e1d3';
  const soft = '#a99e8c';
  const brass = '#c89b52';
  const sand = '#c2634a';
  const green = '#74a891';
  const line = (x: number, y: number, len: number, color = soft, hh = 6) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, len, hh);
  };

  switch (channel) {
    case 'reading': {
      for (let i = 0; i < 7; i++)
        line(24, 78 + i * 22, 300 + ((i * 53) % 150), i === 3 ? brass : soft);
      ctx.fillStyle = 'rgba(200,155,82,0.25)';
      ctx.fillRect(22, 138, 190, 12);
      ctx.font = `400 13px ${FONT_MONO}`;
      ctx.fillStyle = brass;
      ctx.fillText('BAWS vol. 1, p. 47', 24, 262);
      break;
    }
    case 'provenance': {
      const nodes: [number, number, string][] = [
        [90, 150, '1936'],
        [256, 110, '1948'],
        [420, 150, '1950'],
      ];
      ctx.strokeStyle = brass;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(90, 150);
      ctx.lineTo(256, 110);
      ctx.stroke();
      ctx.setLineDash([8, 7]);
      ctx.strokeStyle = sand;
      ctx.beginPath();
      ctx.moveTo(256, 110);
      ctx.lineTo(420, 150);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [x, y, label] of nodes) {
        ctx.fillStyle = '#141210';
        ctx.beginPath();
        ctx.arc(x, y, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = brass;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.font = `500 15px ${FONT_MONO}`;
        ctx.fillStyle = paper;
        ctx.textAlign = 'center';
        ctx.fillText(label, x, y + 56);
      }
      ctx.textAlign = 'left';
      ctx.font = `500 16px ${FONT_UI}`;
      ctx.fillStyle = brass;
      ctx.fillText('Article 17', 24, 268);
      break;
    }
    case 'timeline': {
      line(24, 220, w - 48, soft, 2);
      const years = ['1891', '1916', '1927', '1936', '1948', '1956'];
      years.forEach((y, i) => {
        const x = 34 + i * ((w - 88) / (years.length - 1));
        line(x, 212, 2, brass, 18);
        ctx.font = `500 13px ${FONT_MONO}`;
        ctx.fillStyle = soft;
        ctx.fillText(y, x - 16, 252);
        if (i % 2 === 0) {
          ctx.fillStyle = '#3a332b';
          ctx.fillRect(x - 30, 88, 64, 86);
          ctx.strokeStyle = brass;
          ctx.lineWidth = 1;
          ctx.strokeRect(x - 30, 88, 64, 86);
        }
      });
      break;
    }
    case 'manuscript': {
      ctx.fillStyle = '#d9cdb4';
      ctx.fillRect(28, 66, 250, 220);
      ctx.strokeStyle = '#6b4921';
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        for (let x = 40; x < 262; x += 6) {
          const y = 90 + i * 24 + Math.sin(x * 0.18 + i) * 2.5;
          if (x === 40) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = brass;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(380, 170, 70, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 5; i++) line(330, 132 + i * 18, 100 - i * 8, soft, 5);
      break;
    }
    case 'audio': {
      for (let i = 0; i < 44; i++) {
        const hgt = 12 + Math.abs(Math.sin(i * 0.61) * Math.cos(i * 0.23)) * 110;
        line(28 + i * 10, 170 - hgt / 2, 5, i < 18 ? brass : soft, hgt);
      }
      ctx.font = `500 16px ${FONT_INDIC}`;
      ctx.fillStyle = paper;
      ctx.fillText('मराठी   ·   हिन्दी   ·   English', 28, 272);
      break;
    }
    case 'av': {
      ctx.fillStyle = '#0d0b0a';
      ctx.fillRect(24, 64, w - 48, 150);
      ctx.fillStyle = brass;
      ctx.beginPath();
      ctx.moveTo(w / 2 - 16, 116);
      ctx.lineTo(w / 2 + 22, 139);
      ctx.lineTo(w / 2 - 16, 162);
      ctx.closePath();
      ctx.fill();
      for (let i = 0; i < 3; i++)
        line(24, 232 + i * 18, 380 - i * 60, i === 1 ? brass : soft, 5);
      break;
    }
    case 'assistant': {
      ctx.fillStyle = '#3a332b';
      ctx.beginPath();
      ctx.roundRect(210, 70, 278, 52, 10);
      ctx.fill();
      line(228, 92, 200, paper, 6);
      ctx.fillStyle = '#2a241f';
      ctx.beginPath();
      ctx.roundRect(24, 138, 350, 112, 10);
      ctx.fill();
      for (let i = 0; i < 3; i++) line(42, 160 + i * 22, 300 - i * 40, soft, 6);
      ctx.font = `500 13px ${FONT_MONO}`;
      ctx.fillStyle = brass;
      ctx.fillText('CAD 7.62.185+', 42, 238);
      break;
    }
    case 'curator': {
      for (let r = 0; r < 7; r++) {
        const y = 74 + r * 28;
        line(24, y, w - 48, '#2a241f', 22);
        ctx.fillStyle = r === 4 ? sand : green;
        ctx.beginPath();
        ctx.arc(40, y + 11, 5, 0, Math.PI * 2);
        ctx.fill();
        line(56, y + 8, 160, soft, 5);
        line(300, y + 8, 60, soft, 5);
      }
      line(24, 280, w - 48, '#2a241f', 10);
      line(24, 280, (w - 48) * 0.62, brass, 10);
      break;
    }
    case 'entrance':
    default: {
      // Portrait. The script carousel, frozen at one frame: the same welcome
      // in three scripts, so a visitor sees their own before touching anything.
      ctx.textAlign = 'center';
      ctx.font = `600 58px ${FONT_READ}`;
      ctx.fillStyle = paper;
      ctx.fillText('Toran', w / 2, h * 0.3);
      ctx.fillStyle = brass;
      ctx.fillRect(w / 2 - 36, h * 0.3 + 18, 72, 2);
      const greetings: [string, string][] = [
        ['स्वागत', FONT_INDIC],
        ['Welcome', FONT_READ],
        ['स्वागत आहे', FONT_INDIC],
      ];
      greetings.forEach(([text, face], i) => {
        ctx.font = `400 30px ${face}`;
        ctx.fillStyle = i === 1 ? paper : soft;
        ctx.fillText(text, w / 2, h * 0.47 + i * 48);
      });
      // The card, where a visitor taps.
      ctx.strokeStyle = brass;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(w / 2 - 54, h * 0.74, 108, 68, 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.74 + 34, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.textAlign = 'left';
      break;
    }
  }

  // Footer status.
  ctx.globalAlpha = 1;
  ctx.fillStyle = status === 'idle' ? '#a99e8c' : '#74a891';
  ctx.beginPath();
  ctx.arc(w - 34, h - 26, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `500 14px ${indic ? FONT_INDIC : FONT_MONO}`;
  ctx.fillStyle = '#a99e8c';
  ctx.textAlign = 'right';
  ctx.fillText(statusLabel, w - 48, h - 21);
  return toTexture(c, true);
}

/** Floating name plate above a device. Always visible, never hover-only. */
export function label(
  name: string,
  status: ScreenStatus,
  lang: string,
): THREE.CanvasTexture {
  const w = 512;
  const h = 112;
  const [c, ctx] = canvas(w, h);
  const indic = /^(hi|mr|sa|ne|kok|mai|doi|brx)$/.test(lang);
  ctx.fillStyle = 'rgba(20,18,16,0.82)';
  ctx.beginPath();
  ctx.roundRect(4, 4, w - 8, h - 8, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(200,155,82,0.7)';
  ctx.lineWidth = 2;
  ctx.stroke();
  const dot = status === 'online' ? '#74a891' : status === 'idle' ? '#a99e8c' : '#d4736b';
  ctx.fillStyle = dot;
  ctx.beginPath();
  ctx.arc(46, h / 2, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `600 38px ${indic ? FONT_INDIC : FONT_UI}`;
  ctx.fillStyle = '#e8e1d3';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 78, h / 2 + 2);
  return toTexture(c, true);
}

/** Wait for the faces canvas text depends on, or labels render in a fallback. */
export async function fontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  await Promise.all([
    document.fonts.load(`600 38px ${FONT_UI}`),
    document.fonts.load(`600 40px ${FONT_READ}`),
    document.fonts.load(`400 27px ${FONT_READ}`),
    document.fonts.load(`500 14px ${FONT_MONO}`),
    document.fonts.load(`400 24px ${FONT_INDIC}`, 'स्वागत'),
  ]);
}

// ---------- the campus ----------

/**
 * The page face of the open book: rag paper with the ghost of set type on it.
 *
 * Read from the air during the arrival and from nowhere else, so the lines are
 * suggested rather than set. Tileable, because the fascia courses of both page
 * blocks sample it through one box projection.
 */
export function pageFace(size = 256): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const base = [238, 231, 217];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = 0.93 + fbm(x / size, y / size, 6, 4, 23) * 0.12;
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, base[0]! * k);
      img.data[i + 1] = Math.min(255, base[1]! * k);
      img.data[i + 2] = Math.min(255, base[2]! * k * 0.99);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Twelve lines of type in two columns, at the weight the eye reads as text
  // from a hundred metres up.
  ctx.fillStyle = 'rgba(38,33,28,0.30)';
  for (let col = 0; col < 2; col++) {
    const x0 = size * (0.08 + col * 0.47);
    const w = size * 0.38;
    for (let line = 0; line < 13; line++) {
      const last = line % 7 === 6;
      ctx.fillRect(x0, size * (0.13 + line * 0.062), last ? w * 0.55 : w, 2);
    }
  }
  return toTexture(c, true, true);
}

/**
 * The glazed courses between the fascias. Dark glass with a mullion every
 * bay and a warm smear where the floodlights catch it.
 */
export function glazing(size = 256): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size);
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, '#242019');
  g.addColorStop(0.42, '#14120f');
  g.addColorStop(0.6, '#2e251b');
  g.addColorStop(1, '#100e0c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(200,155,82,0.10)';
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(0, size * (0.1 + i * 0.16), size, 2);
  }
  ctx.fillStyle = 'rgba(58,51,43,0.9)';
  for (let i = 0; i < 16; i++) ctx.fillRect(Math.round(size * (i / 16)), 0, 2, size);
  return toTexture(c, true, true);
}

/** Cut grass at night: dark, and mottled enough not to read as felt. */
export function lawn(size = 256): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const k = 0.62 + fbm(u, v, 5, 4, 71) * 0.7 + (hash(x, y, 13) - 0.5) * 0.16;
      // Mowing stripes, which is what makes a lawn read as kept.
      const stripe = Math.sin(u * Math.PI * 2 * 6) > 0 ? 1.1 : 0.92;
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, 57 * k * stripe);
      img.data[i + 1] = Math.min(255, 86 * k * stripe);
      img.data[i + 2] = Math.min(255, 75 * k * stripe);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, true, true);
}

/**
 * The ceremonial circle, drawn in one texture rather than in rings of
 * geometry: concentric bands of stone with the Ashoka chakra at the centre,
 * after the paving of the real forecourt.
 */
export function plazaPaving(size = 1024): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size);
  const mid = size / 2;
  ctx.fillStyle = '#4a443c';
  ctx.fillRect(0, 0, size, size);

  // Bands, alternating pale stone and the blue grey of the kerbing.
  const bands = 26;
  for (let i = bands; i > 0; i--) {
    const r = (mid * i) / bands;
    ctx.fillStyle = i % 2 === 0 ? '#6f675c' : '#575048';
    ctx.beginPath();
    ctx.arc(mid, mid, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Radial joints over the whole circle, so the bands read as laid rather than
  // printed. Once here rather than once per band: the same lines, a fiftieth
  // of the canvas calls.
  ctx.strokeStyle = 'rgba(28,25,21,0.45)';
  ctx.lineWidth = 1.5;
  const spokes = 48;
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(mid + Math.cos(a) * mid * 0.2, mid + Math.sin(a) * mid * 0.2);
    ctx.lineTo(mid + Math.cos(a) * mid, mid + Math.sin(a) * mid);
    ctx.stroke();
  }

  // The chakra at the centre: a hub, a rim and twenty-four spokes.
  const R = mid * 0.16;
  ctx.fillStyle = '#3b4a43';
  ctx.beginPath();
  ctx.arc(mid, mid, R * 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c89b52';
  ctx.lineWidth = Math.max(2, size * 0.004);
  ctx.beginPath();
  ctx.arc(mid, mid, R, 0, Math.PI * 2);
  ctx.stroke();
  for (let s = 0; s < 24; s++) {
    const a = (s / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(mid + Math.cos(a) * R * 0.14, mid + Math.sin(a) * R * 0.14);
    ctx.lineTo(mid + Math.cos(a) * R * 0.94, mid + Math.sin(a) * R * 0.94);
    ctx.stroke();
  }
  ctx.fillStyle = '#c89b52';
  ctx.beginPath();
  ctx.arc(mid, mid, R * 0.16, 0, Math.PI * 2);
  ctx.fill();
  return toTexture(c, true);
}

/**
 * The board on the compound wall, after the plaque at 26, Alipur Road:
 * Devanagari above, English below, the address in small type under both.
 *
 * Canvas text needs its faces loaded, and the hall draws its textures at first
 * frame, which can be before the Devanagari face arrives. So it redraws itself
 * once and marks the texture dirty, rather than baking a fallback for good.
 */
export function memorialSign(): THREE.CanvasTexture {
  const w = 1024;
  const h = 200;
  const [c, ctx] = canvas(w, h);

  const draw = () => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#efe9dc';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#9c4b32';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.textAlign = 'center';

    ctx.fillStyle = '#6b4921';
    ctx.font = `600 40px ${FONT_INDIC}`;
    ctx.fillText('डॉ. अम्बेडकर राष्ट्रीय स्मारक', w / 2, 66);

    ctx.fillStyle = '#1a1714';
    ctx.font = `700 56px ${FONT_UI}`;
    ctx.fillText('DR. AMBEDKAR NATIONAL MEMORIAL', w / 2, 130);

    ctx.fillStyle = '#803d29';
    ctx.fillRect(w / 2 - 150, 148, 300, 2);
    ctx.fillStyle = '#56503f';
    ctx.font = `400 24px ${FONT_MONO}`;
    ctx.fillText('26 ALIPUR ROAD, DELHI', w / 2, 178);
  };

  draw();
  const t = toTexture(c, true);
  if (typeof document !== 'undefined' && 'fonts' in document) {
    void document.fonts.ready.then(() => {
      draw();
      t.needsUpdate = true;
    });
  }
  return t;
}
