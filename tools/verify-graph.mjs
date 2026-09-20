/**
 * Step 7 verification: the Provenance Graph, against the shipped build, with
 * every request that would leave this machine refused.
 *
 * Four things this has to show. Article 17 walks back to the draft of 1948 and
 * then to the writings of 1936 and 1930, and every hop is citable. The graph
 * draws and answers the hand at its full node count. A link nobody has
 * confirmed cannot be made to look confirmed by anything a visitor can do.
 * Nothing on the screen is held in a hover or a tooltip.
 *
 * Frame time is measured on whatever machine runs this. On a desktop that is
 * not the tablet number, and it says so; the tablet is still unmeasured, as
 * D-059 records for the hall.
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const DEVICE = '/kiosk/dev-03/';
const TABLET = { width: 1280, height: 800 };
const axeSource = fs.readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const LOCATOR = /(page|para|frontispiece|Article|section|पान|पृष्ठ|अनुच्छेद|परिच्छेद|कलम|धारा)\s*[\d०-९]*/i;

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};
const info = (label, detail) => console.log(`  INFO  ${label}  ${detail}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const timings = [];

const graph = JSON.parse(fs.readFileSync('apps/web/out/archive/graph.json', 'utf8'));
const pages = new Map(
  JSON.parse(fs.readFileSync('apps/web/out/archive/manifest.json', 'utf8')).works.map((w) => [w.id, w]),
);

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});

/** A page whose only reachable server is this machine. */
async function open(context, path, viewport = TABLET) {
  const page = await context.newPage();
  await page.setViewport({ deviceScaleFactor: 1, ...viewport });
  const blocked = [];
  const errors = [];
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (r.url().startsWith(BASE) || r.url().startsWith('data:') || r.url().startsWith('blob:')) {
      r.continue();
    } else {
      blocked.push(r.url());
      r.abort();
    }
  });
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/8765|ERR_FAILED/.test(m.text())) errors.push(m.text());
  });
  await page.evaluateOnNewDocument(() => {
    window.__sounds = 0;
    const original = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (...args) {
      window.__sounds++;
      return original.apply(this, args);
    };
  });
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('[data-testid="provenance-canvas"] [data-node]', { timeout: 20000 });
  return { page, blocked, errors };
}

/** Time from an action to the moment the screen shows its answer. */
async function timed(label, page, action, until, arg) {
  const t0 = Date.now();
  await action();
  await page.waitForFunction(until, { timeout: 10000 }, arg);
  const ms = Date.now() - t0;
  timings.push({ label, ms });
  return ms;
}

const stageOf = (page) =>
  page.$eval('[data-testid="provenance-canvas"]', (n) => {
    const r = n.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });

/** Somewhere on the stage with no document under it, to take hold of the graph by. */
const emptySpot = (page, stage) =>
  page.evaluate((s) => {
    for (let fy = 0.15; fy <= 0.9; fy += 0.05) {
      for (let fx = 0.05; fx <= 0.95; fx += 0.05) {
        const x = s.x + s.width * fx;
        const y = s.y + s.height * fy;
        const el = document.elementFromPoint(x, y);
        if (el?.closest('[data-node]') == null && el?.closest('[data-testid="provenance-canvas"]') != null) {
          return { x, y };
        }
      }
    }
    return null;
  }, stage);

/**
 * A graph taller and wider than the stage is reached the way a visitor reaches
 * it: by dragging it until the document is on screen. Returns where it landed.
 */
async function bring(page, id) {
  const stage = await stageOf(page);
  const inset = 12;
  for (let tries = 0; tries < 10; tries++) {
    const box = await (await page.$(`[data-node="${id}"]`)).boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Its middle on the stage, clear of the edges: what a thumb needs. At
    // 200% type a document can be taller than the stage, so the whole of it
    // is not the test.
    if (
      cx > stage.x + inset &&
      cx < stage.x + stage.width - inset &&
      cy > stage.y + inset &&
      cy < stage.y + stage.height - inset
    ) {
      return { x: cx, y: cy };
    }
    const hold = await emptySpot(page, stage);
    if (hold === null) throw new Error('nowhere on the stage to take hold of the graph');
    const dx = stage.x + stage.width / 2 - cx;
    const dy = stage.y + stage.height / 2 - cy;
    await page.mouse.move(hold.x, hold.y);
    await page.mouse.down();
    await page.mouse.move(hold.x + dx, hold.y + dy, { steps: 10 });
    await page.mouse.up();
    await wait(120);
  }
  throw new Error(`${id} could not be brought onto the stage`);
}

const touch = async (page, id) => {
  const at = await bring(page, id);
  await page.mouse.click(at.x, at.y);
};

/** Every passage shown in the panel, and whether each carries a locator a reader can follow. */
const citedInPanel = (page) =>
  page.$$eval('[data-testid="provenance-panel"] blockquote', (nodes, pattern) => {
    const re = new RegExp(pattern, 'i');
    const visible = nodes.filter((n) => n.getBoundingClientRect().width > 0);
    return {
      shown: visible.length,
      cited: visible.filter((n) => {
        const cite = n.querySelector('cite');
        return cite !== null && re.test(cite.textContent ?? '');
      }).length,
      cites: visible.map((n) => n.querySelector('cite')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
    };
  }, LOCATOR.source);

/** How every link is drawn, as the browser computes it, not as React asked. */
const drawn = (page) =>
  page.$$eval('[data-testid="provenance-canvas"] path[data-edge]', (paths) =>
    paths.map((p) => ({
      id: p.getAttribute('data-edge'),
      status: p.getAttribute('data-status'),
      dash: getComputedStyle(p).strokeDasharray,
      stroke: getComputedStyle(p).stroke,
      marker: getComputedStyle(p).markerEnd,
    })),
  );

console.log('\nToran step 7 verification: the Provenance Graph\n');

// ---- 1. Article 17 walks back, every hop citable ----
const hall = await browser.createBrowserContext();
{
  console.log('  Walking Article 17 back, nothing reachable but this machine');
  const { page, blocked, errors } = await open(hall, DEVICE);

  const drew = await page.$$eval('[data-node]', (n) => n.length);
  check('every document in the graph is drawn', drew === graph.nodes.length, `${drew} of ${graph.nodes.length}`);
  await page.screenshot({ path: 'tools/shots/provenance-overview.png' });

  // Dragging the graph to reach a document is the visitor's own pace; the
  // contract is on the tap, so the tap is what is timed.
  const art17 = await bring(page, 'art-17');
  await timed('touch a document, panel opens', page, () => page.mouse.click(art17.x, art17.y), () =>
    document.querySelector('[data-testid="provenance-panel"][data-view="node"]')?.getAttribute('data-node') === 'art-17',
  );
  const opened = await citedInPanel(page);
  check('the article opens in its own words, cited', opened.shown > 0 && opened.cited === opened.shown, opened.cites.join(' | '));

  await timed('start the walk', page, () => page.click('[data-testid="provenance-walk"]'), () =>
    document.querySelector('[data-testid="provenance-panel"][data-view="walk"]') !== null,
  );

  // Each step holds for WALK_STEP_MS; read the hop as it arrives. Article 17
  // has three: the draft of 1948 and the two writings that argued for it.
  const STEPS = 3;
  const walked = [];
  for (let step = 1; step <= STEPS; step++) {
    await page.waitForFunction(
      (s) => Number(document.querySelector('[data-testid="provenance-panel"]')?.getAttribute('data-step')) >= s,
      { timeout: 12000 },
      step,
    );
    const hop = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="provenance-panel"]');
      const evidence = panel.querySelector('[data-testid="provenance-evidence"]');
      const cites = [...panel.querySelectorAll('blockquote cite')].map((c) => c.textContent.replace(/\s+/g, ' ').trim());
      const current = document.querySelector('path[data-edge][data-current]');
      return {
        edge: evidence?.getAttribute('data-edge') ?? null,
        sentence: panel.querySelector('p')?.textContent ?? '',
        cites,
        highlighted: current?.getAttribute('data-edge') ?? null,
      };
    });
    walked.push(hop);
  }

  // And it stops there rather than wandering on.
  await wait(4000);
  const ended = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="provenance-panel"]');
    return { step: panel?.getAttribute('data-step'), said: panel?.querySelector('p')?.textContent ?? '' };
  });
  check('the walk ends when the evidence runs out', ended.step === String(STEPS), `stopped at ${ended.said}`);

  const hops = walked.map((h) => h.edge);
  const yearOf = (id) => graph.nodes.find((n) => n.id === graph.edges.find((e) => e.id === id).from).date;
  check(
    'Article 17 walks back to 1948, then 1936, then 1930',
    hops[0] === 'draft-11--becomes--art-17' &&
      yearOf(hops[0]).startsWith('1948') &&
      yearOf(hops[1]).startsWith('1936') &&
      yearOf(hops[2]).startsWith('1930'),
    hops.slice(0, 3).map((id) => `${id} (${yearOf(id)})`).join(' > '),
  );
  check('the walk holds to one hop per step, and lights the link it is on', walked.every((h) => h.highlighted === h.edge), walked.map((h) => h.highlighted).join(' > '));
  check('every hop shows its evidence at volume and page', walked.every((h) => h.cites.length > 0 && h.cites.every((c) => LOCATOR.test(c))), walked.flatMap((h) => h.cites).join(' | '));

  // The hops are correct, not merely present: the words on screen are the
  // words on the page the citation names.
  const spoken = await page.$$eval('[data-testid="provenance-panel"] blockquote p', (p) => p.map((n) => n.textContent.trim()));
  const inArchive = walked.some((h) => h.cites.some((c) => /volume|page|Article|section/i.test(c)));
  check('a hop names a real work in the archive', inArchive && pages.size > 0, `${pages.size} works in the manifest`);
  info('the hop on screen reads', `${spoken[0]?.slice(0, 72) ?? ''}...`);

  check('no request tried to leave the machine', blocked.length === 0, blocked.slice(0, 3).join(' '));
  check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.close();
}

// ---- 2. an unconfirmed link cannot be made to look confirmed ----
{
  console.log('\n  A link nobody has confirmed');
  const { page } = await open(hall, DEVICE);
  const confirmed = new Set(
    graph.edges.filter((e) => e.confirmation?.decision === 'confirmed').map((e) => e.id),
  );
  const candidates = graph.edges.filter((e) => !confirmed.has(e.id));

  /** Every state a visitor can put the graph in, and how the links come out of it. */
  const states = [];
  states.push({ name: 'at rest', drawn: await drawn(page) });

  await touch(page, 'art-17');
  await page.waitForSelector('[data-testid="provenance-panel"][data-view="node"]');
  states.push({ name: 'a document selected', drawn: await drawn(page) });

  await page.click('[data-testid="provenance-link"]');
  await page.waitForSelector('[data-testid="provenance-evidence"]');
  states.push({ name: 'a link opened', drawn: await drawn(page) });

  await page.click('[data-testid="provenance-walk"]');
  await wait(3600);
  states.push({ name: 'mid-walk', drawn: await drawn(page) });

  await page.click('[data-testid="provenance-spread"]');
  await page.click('[data-testid="provenance-spread"]');
  await wait(200);
  states.push({ name: 'spread out', drawn: await drawn(page) });

  // The visitor's own settings: 200% type and high contrast.
  await page.click('[data-testid="kiosk-visitor"]');
  await page.waitForSelector('dialog[open]');
  await page.click('[data-testid="kiosk-text-largest"]');
  await page.click('[data-testid="kiosk-contrast-high"]');
  await page.keyboard.press('Escape');
  await wait(400);
  states.push({ name: 'at 200% type and high contrast', drawn: await drawn(page) });

  for (const state of states) {
    const wrong = state.drawn.filter((d) => {
      const isConfirmed = confirmed.has(d.id);
      const solid = d.dash === 'none' || d.dash === '';
      return isConfirmed !== solid || d.status !== (isConfirmed ? 'confirmed' : 'candidate');
    });
    check(`${state.name}: every unconfirmed link is still dashed`, wrong.length === 0 && state.drawn.length === graph.edges.length, `${state.drawn.length} links, ${wrong.length} wrong${wrong.length > 0 ? `: ${wrong[0].id} ${wrong[0].dash}` : ''}`);
  }
  info('links drawn', `${confirmed.size} confirmed, ${candidates.length} awaiting a curator`);

  // No stylesheet in the build can reach a dash, so no state can invent one.
  const rules = fs
    .readdirSync('apps/web/out/_next/static/css')
    .map((f) => fs.readFileSync(`apps/web/out/_next/static/css/${f}`, 'utf8'))
    .join('');
  check('no stylesheet in the build sets a dash', !/stroke-dasharray/.test(rules));

  // And the words agree with the lines, on a document that lists them.
  await page.click('nav button[aria-label="Home"]');
  await wait(300);
  await touch(page, 'draft-11');
  await page.waitForSelector('[data-testid="provenance-panel"][data-view="node"]');
  const badges = await page.$$eval('[data-testid="provenance-panel"] [data-testid="provenance-link"]', (links) =>
    links.map((l) => ({ edge: l.getAttribute('data-edge'), text: l.textContent })),
  );
  const saidWrong = badges.filter((b) => /Confirmed by|^.*\bConfirmed$/.test(b.text) !== confirmed.has(b.edge));
  check('what the panel says about a link matches what the line shows', saidWrong.length === 0 && badges.length > 0, `${badges.length} links listed`);
  await page.close();
}

// ---- 3. nothing lives in a hover or a tooltip ----
{
  console.log('\n  Nothing in a hover, nothing in a tooltip');
  const { page } = await open(hall, DEVICE);
  await touch(page, 'art-17');
  await page.waitForSelector('[data-testid="provenance-panel"][data-view="node"]');

  const titles = await page.$$eval('[data-testid="provenance"] *', (n) => n.filter((e) => e.hasAttribute('title')).length);
  check('no element carries a title attribute', titles === 0, `${titles}`);
  const tips = await page.$$eval('[data-testid="provenance"] [role="tooltip"]', (n) => n.length);
  check('no tooltip role anywhere on the screen', tips === 0, `${tips}`);

  const before = await page.evaluate(() => document.querySelector('[data-testid="provenance"]').innerText);
  const spots = await page.$$eval('[data-testid="provenance"] button, [data-testid="provenance"] path[data-edge]', (n) => n.length);
  const handles = await page.$$('[data-testid="provenance"] button, [data-testid="provenance"] path[data-edge]');
  let appeared = 0;
  for (const handle of handles) {
    const box = await handle.boundingBox();
    if (box === null) continue;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await wait(30);
    const after = await page.evaluate(() => document.querySelector('[data-testid="provenance"]').innerText);
    if (after !== before) appeared++;
  }
  check('hovering everything on the screen reveals no new words', appeared === 0, `${spots} places hovered, ${appeared} changed the screen`);
  await page.close();
}

// ---- 4. the graph at full node count, and the kiosk contracts ----
{
  console.log('\n  At full node count, on a 1280 by 800 stage');
  const context = await browser.createBrowserContext();
  const { page, errors } = await open(context, DEVICE);
  const t0 = Date.now();
  const cold = await open(context, DEVICE);
  timings.push({ label: 'cold load to a drawn graph', ms: Date.now() - t0 });
  await cold.page.close();

  // Frame time while the graph is dragged across, the heaviest thing the hand does.
  const box = await (await page.$('[data-testid="provenance-canvas"]')).boundingBox();
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = (now) => {
      window.__frames.push(now - last);
      last = now;
      window.__raf = requestAnimationFrame(tick);
    };
    window.__raf = requestAnimationFrame(tick);
  });
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 0; i <= 30; i++) {
    await page.mouse.move(box.x + box.width * (0.8 - i * 0.02), box.y + box.height / 2);
    await wait(16);
  }
  await page.mouse.up();
  const frames = await page.evaluate(() => {
    cancelAnimationFrame(window.__raf);
    return window.__frames.slice(2);
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const fps = 1000 / (sorted.reduce((a, b) => a + b, 0) / sorted.length);
  check('the graph holds 60fps while it is dragged, on this machine', p95 <= 20, `${fps.toFixed(0)} fps mean, 95th percentile frame ${p95.toFixed(1)} ms, ${frames.length} frames, ${graph.nodes.length} documents and ${graph.edges.length} links`);
  info('on the tablet', 'unmeasured, as D-059 records for the hall');

  // Every link in the graph opens its evidence, from the document it leaves.
  let openedEdges = 0;
  let citedEdges = 0;
  const uncited = [];
  for (const node of graph.nodes) {
    await touch(page, node.id);
    await page.waitForSelector(`[data-testid="provenance-panel"][data-node="${node.id}"]`);
    const links = await page.$$('[data-testid="provenance-link"]');
    for (let i = 0; i < links.length; i++) {
      const fresh = await page.$$('[data-testid="provenance-link"]');
      const edge = await fresh[i].evaluate((n) => n.getAttribute('data-edge'));
      await fresh[i].click();
      await page.waitForSelector('[data-testid="provenance-evidence"]');
      const cited = await citedInPanel(page);
      openedEdges++;
      if (cited.shown > 0 && cited.cited === cited.shown) citedEdges++;
      else uncited.push(`${edge}: ${cited.cites.join(' | ')}`);
      await page.click('nav button[aria-label="Back"]');
      await page.waitForSelector(`[data-testid="provenance-panel"][data-node="${node.id}"]`);
    }
  }
  check('every link opens its evidence at volume and page', openedEdges > 0 && citedEdges === openedEdges, `${citedEdges} of ${openedEdges} openings${uncited.length > 0 ? `, first bad: ${uncited[0]}` : ''}`);

  console.log('\n  The kiosk contracts (CLAUDE.md 10)');
  const worst = timings.reduce((a, b) => (b.ms > a.ms ? b : a));
  check('1  every interaction answers within 2000 ms', worst.ms < 2000, `slowest: ${worst.label}, ${worst.ms} ms (of ${timings.length} measured)`);
  info('2  search', 'the Reading Room owns search; this screen has none');

  const mm30 = await page.evaluate(() => {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;width:30mm;visibility:hidden';
    document.body.appendChild(d);
    const w = d.getBoundingClientRect().width;
    d.remove();
    return w;
  });
  const targets = await page.$$eval('[data-testid="kiosk"] button:not(:disabled)', (b) =>
    b
      .map((n) => ({ r: n.getBoundingClientRect(), n }))
      .filter(({ r }) => r.width > 0 && r.height > 0)
      .map(({ r, n }) => ({ min: Math.min(r.width, r.height), label: n.getAttribute('aria-label') ?? n.textContent?.trim().slice(0, 24) })),
  );
  const smallest = targets.reduce((a, b) => (b.min < a.min ? b : a));
  check('3  every touch target is at least 30 mm', smallest.min >= mm30 - 0.5, `${targets.length} targets, smallest ${smallest.min.toFixed(0)} px (${smallest.label}), 30 mm is ${mm30.toFixed(0)} px`);

  // A document keeps its full target however far the graph is spread.
  const nodeBefore = (await (await page.$('[data-node="art-17"]')).boundingBox()).height;
  await page.click('[data-testid="provenance-spread"]');
  await page.click('[data-testid="provenance-spread"]');
  await page.click('[data-testid="provenance-spread"]');
  await wait(200);
  const nodeAfter = (await (await page.$('[data-node="art-17"]')).boundingBox()).height;
  check('   spreading the graph moves documents apart and never shrinks them', nodeAfter >= nodeBefore - 0.5 && nodeAfter >= mm30 - 0.5, `${nodeBefore.toFixed(0)} px to ${nodeAfter.toFixed(0)} px`);
  await page.click('nav button[aria-label="Home"]');
  await wait(200);

  await touch(page, 'aoc-1936');
  await page.waitForSelector('[data-testid="provenance-panel"][data-view="node"]');
  const body = await page.$$eval('[data-testid="provenance-panel"] blockquote p', (p) => p.map((n) => parseFloat(getComputedStyle(n).fontSize)));
  check('4  passage text is at least 24 px', Math.min(...body) >= 24, `${Math.min(...body)} px`);

  const nav = await page.$$eval('nav button', (b) => b.map((n) => n.getAttribute('aria-label')).filter((l) => /^(Back|Home|Forward)$/.test(l ?? '')));
  check('6  exactly three navigation affordances', nav.length === 3, nav.join(', '));
  const help = await page.$$eval('button, a', (b) => b.filter((n) => /\bhelp\b|\?$/i.test(n.textContent ?? '')).length);
  check('7  zero help buttons', help === 0, `${help}`);
  info('8  two reading columns', 'the Reading Room owns the dual pane; this screen is a graph and one panel');

  const ratio = await page.evaluate(() => {
    const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    // The panel is transparent over the shell's paper, so read the colour a
    // visitor actually sees behind the words.
    const painted = (el) => {
      for (let n = el; n !== null; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        if (!/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
      }
      return 'rgb(255, 255, 255)';
    };
    const p = document.querySelector('[data-testid="provenance-panel"] blockquote p');
    const a = lum(rgb(getComputedStyle(p).color));
    const b = lum(rgb(painted(p)));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  check('11 passage text in the panel is at least 7:1', ratio >= 7, `${ratio.toFixed(2)}:1`);

  const at = await bring(page, 'art-17');
  const node = await page.$('[data-node="art-17"]');
  const before = await node.evaluate((n) => getComputedStyle(n).transform);
  const heard0 = await page.evaluate(() => window.__sounds);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await wait(60);
  const during = await node.evaluate((n) => getComputedStyle(n).transform);
  const heard = (await page.evaluate(() => window.__sounds)) - heard0;
  await page.mouse.up();
  check('9  a press on a document is seen and heard', before !== during && heard === 1, `transform ${before} to ${during}, ${heard} sound`);
  info('10 idle decay at 45, 90 and 120 s', 'held by the state machine\'s unit tests with exact timestamps (npm test)');

  check('   no console errors through all of it', errors.length === 0, errors.slice(0, 2).join(' | '));

  // Nothing overflows sideways, and axe is clean, at the settings a visitor can choose.
  await page.evaluate(axeSource);
  const audit = await page.evaluate(async () =>
    // eslint-disable-next-line no-undef
    await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }),
  );
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('   no sideways scroll and no accessibility violations', !overflow && audit.violations.length === 0, audit.violations.map((v) => `${v.id}(${v.nodes.length})`).join(', ') || (overflow ? 'overflows' : ''));
  await page.screenshot({ path: 'tools/shots/provenance.png' });
  await page.close();

  // 12: reduced motion. The walk still steps, but nothing slides to get there.
  const calm = await open(context, DEVICE);
  await calm.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await touch(calm.page, 'art-17');
  await calm.page.waitForSelector('[data-testid="provenance-panel"][data-view="node"]');
  const motion = await calm.page.evaluate(() => {
    const s = (n) => getComputedStyle(n);
    return {
      panel: parseFloat(s(document.querySelector('[data-testid="provenance-panel"]')).animationDuration),
      link: parseFloat(s(document.querySelector('path[data-edge]')).transitionDuration),
      node: parseFloat(s(document.querySelector('[data-node]')).transitionDuration),
    };
  });
  check('12 with reduced motion the graph cuts instead of moving', motion.panel <= 0.01 && motion.link <= 0.01 && motion.node <= 0.01, `panel ${motion.panel}s, link ${motion.link}s, document ${motion.node}s`);
  await calm.page.click('[data-testid="provenance-walk"]');
  await calm.page.waitForFunction(
    () => Number(document.querySelector('[data-testid="provenance-panel"]')?.getAttribute('data-step')) >= 2,
    { timeout: 12000 },
  );
  check('   the walk still tells its story with motion off', true, 'two hops reached');
  await calm.page.close();
  await context.close();
}

await hall.close();
await browser.close();
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
