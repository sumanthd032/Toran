/**
 * Toran Core against a database in memory. Run with `npm test`.
 *
 * Three things are worth testing here and the rest is plumbing. Core must
 * decide config versions itself, or two curators drift. It must refuse a
 * dossier item that has lost its citation, because the whole reason the
 * contract is a shared package is that this rule holds on the server as well as
 * in the browser. And it must forget: an expired card and a returned card leave
 * nothing behind.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  citation,
  citedPassage,
  needsCurator,
  pageLocator,
  readEdgeReviews,
  readOcrPages,
  readTranscript,
  readReply,
  refFor,
  SESSION_TTL_MS,
  store,
  type DeviceConfig,
} from '@toran/contracts';
import { ProviderError, type Provider } from './assistant/provider.ts';
import { listEdges } from './curation/edges.ts';
import { ArchiveFiles, CurationRefused } from './curation/files.ts';
import { checkFixity, listIngest, verifyRights } from './curation/ingest.ts';
import { editMetadata } from './curation/metadata.ts';
import { correctOcr, listOcr } from './curation/ocr.ts';
import { one, openDb, rows } from './db.ts';
import { Fleet } from './fleet.ts';
import type { Transcriber } from './language/transcribe.ts';
import { HallSimulator, seeded } from './simulate.ts';
import { RateLimit } from './http.ts';
import { createCore } from './server.ts';
import { Sessions } from './session.ts';

const HALL: readonly DeviceConfig[] = [
  {
    deviceId: 'dev-01',
    channel: 'reading',
    defaultLanguage: 'en',
    position: [-5.4, 0, 4],
    rotationY: 0.7,
    version: 1,
  },
  {
    deviceId: 'dev-09',
    channel: 'av',
    defaultLanguage: 'en',
    position: [-5.7, 0, -13.2],
    rotationY: 0.5,
    version: 1,
  },
];

const passage = citedPassage({
  text: 'Caste is a notion, it is a state of the mind.',
  citation: citation({
    corpus: 'baws',
    workId: 'baws-v1',
    pageId: 'baws-v1-p0100',
    locator: pageLocator({ volume: 1, page: 68, observed: true }),
  }),
  language: 'en',
});

const kept = store({ ref: refFor(passage, 3), passage });

function core(at = Date.parse('2026-09-21T10:00:00Z')) {
  const db = openDb(':memory:');
  let clock = at;
  const now = () => clock;
  const fleet = new Fleet(db, now);
  fleet.seed(HALL);
  return {
    db,
    fleet,
    sessions: new Sessions(db, now),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

test('the hall is seeded once, and never again over a curator', () => {
  const { fleet } = core();
  assert.equal(fleet.configs().length, 2);
  fleet.put('dev-01', { ...HALL[0], defaultLanguage: 'mr' });
  assert.equal(fleet.seed(HALL), 0);
  assert.equal(fleet.config('dev-01')?.defaultLanguage, 'mr');
});

test('Core sets the version, not the caller', () => {
  const { fleet } = core();
  // A caller claiming version 99 gets 2, because the stored one was 1.
  const first = fleet.put('dev-01', { ...HALL[0], defaultLanguage: 'hi', version: 99 });
  assert.equal(first.version, 2);
  const second = fleet.put('dev-01', { ...HALL[0], defaultLanguage: 'hi', version: 99 });
  assert.equal(second.version, 3);
});

test('a device running an old config is told it changed', () => {
  const { fleet } = core();
  const behind = fleet.beat('dev-01', {
    state: 'ambient',
    configVersion: 1,
    uptimeSeconds: 60,
    topic: null,
  });
  assert.equal(behind.changed, false);

  fleet.put('dev-01', { ...HALL[0], channel: 'timeline' });
  const now = fleet.beat('dev-01', {
    state: 'ambient',
    configVersion: 1,
    uptimeSeconds: 90,
    topic: null,
  });
  assert.equal(now.changed, true);
  assert.equal(now.config.channel, 'timeline');
  assert.equal(now.config.version, 2);
});

test('a device that stops reporting goes offline on its own', () => {
  const { fleet, advance } = core();
  fleet.beat('dev-09', {
    state: 'subtle',
    configVersion: 1,
    uptimeSeconds: 10,
    topic: null,
  });
  assert.equal(fleet.health()[0]?.online, true);
  // Two missed beats and a margin. Nothing that crashes sends a goodbye.
  advance(91_000);
  assert.equal(fleet.health()[0]?.online, false);
});

test('a beat from a device nobody configured is refused by name', () => {
  const { fleet } = core();
  assert.throws(
    () =>
      fleet.beat('dev-99', {
        state: 'ambient',
        configVersion: 1,
        uptimeSeconds: 1,
        topic: null,
      }),
    /no device dev-99/,
  );
});

test('a card carries its language and its passages to the next kiosk', () => {
  const { sessions } = core();
  sessions.write('card-0f3a91', {
    session: {
      language: 'mr',
      accessibility: { typeScale: 'largest', audioFirst: true },
      issuedAt: '2026-09-21T09:58:00Z',
    },
    dossier: [kept],
  });
  const read = sessions.read('card-0f3a91');
  assert.equal(read?.session.language, 'mr');
  assert.equal(read?.session.accessibility.typeScale, 'largest');
  assert.equal(read?.session.accessibility.audioFirst, true);
  assert.equal(read?.dossier.length, 1);
  assert.equal(read?.dossier[0]?.pageId, 'baws-v1-p0100');
});

test('a passage that lost its citation is dropped, and counted', () => {
  const { sessions } = core();
  const { refused } = sessions.write('card-0f3a91', {
    session: { language: 'en', issuedAt: '2026-09-21T09:58:00Z' },
    dossier: [kept, { ...kept, ref: 'other~1', locator: undefined }],
  });
  assert.equal(refused, 1);
  assert.equal(sessions.read('card-0f3a91')?.dossier.length, 1);
});

test('the dossier replaces, so removing a passage works', () => {
  const { sessions } = core();
  const session = { language: 'en', issuedAt: '2026-09-21T09:58:00Z' };
  sessions.write('card-0f3a91', { session, dossier: [kept] });
  sessions.write('card-0f3a91', { session, dossier: [] });
  assert.equal(sessions.read('card-0f3a91')?.dossier.length, 0);
});

test('a card returned to the bowl leaves nothing behind', () => {
  const { db, sessions } = core();
  sessions.write('card-0f3a91', {
    session: { language: 'en', issuedAt: '2026-09-21T09:58:00Z' },
    dossier: [kept],
  });
  sessions.forget('card-0f3a91');
  assert.equal(sessions.read('card-0f3a91'), null);
  assert.equal(rows(db, 'select * from dossier_item').length, 0);
  assert.equal(one<{ n: number }>(db, 'select count(*) as n from session')?.n, 0);
});

test('a card expires with the day, and reading it is what collects it', () => {
  const { db, sessions, advance } = core();
  sessions.write('card-0f3a91', {
    session: { language: 'en', issuedAt: '2026-09-21T10:00:00Z' },
    dossier: [kept],
  });
  advance(SESSION_TTL_MS + 1000);
  assert.equal(sessions.read('card-0f3a91'), null);
  assert.equal(rows(db, 'select * from dossier_item').length, 0);
});

test('a token that is not a card token never reaches the database', () => {
  const { sessions } = core();
  assert.throws(() => sessions.read("x' or 1=1 --"), /not a card token/);
  assert.throws(() => sessions.write('ab', { session: {} }), /not a card token/);
});

test('the rate limiter holds a window and then opens', () => {
  let clock = 0;
  const limit = new RateLimit(2, 60_000, () => clock);
  assert.equal(limit.take('a'), true);
  assert.equal(limit.take('a'), true);
  assert.equal(limit.take('a'), false);
  // One caller's ceiling is not another's.
  assert.equal(limit.take('b'), true);
  assert.equal(limit.retryAfter('a'), 60);
  clock += 60_000;
  assert.equal(limit.take('a'), true);
});

/**
 * The assistant route, over real HTTP, against a provider that returns what a
 * test tells it to.
 *
 * A stub rather than Groq, because these are about what Core does with an
 * answer, not about what a model writes: the retry, the refusal, the rate
 * limit and the deployment with no key. What the live model actually produces
 * is measured in `verify:core`, which spends two requests of a 1,000 a day
 * quota rather than a dozen.
 */

function stub(replies: string[]): { provider: Provider; asked: number } {
  const state = { asked: 0 };
  return {
    get asked() {
      return state.asked;
    },
    provider: {
      engine: 'stub',
      generate: (prompt) => {
        const text = replies[state.asked] ?? 'INSUFFICIENT';
        state.asked++;
        if (text === 'THROW') throw new ProviderError('groq rate limit reached', true);
        return Promise.resolve({
          text,
          model: 'stub',
          promptTokens: prompt.user.length,
          completionTokens: text.length,
          ms: 1,
        });
      },
    },
  };
}

const RETRIEVED = [
  {
    corpus: 'constitution',
    workId: 'coi',
    pageId: 'coi-art17-a17',
    language: 'en',
    locator: { kind: 'article', article: '17', version: null },
    text: '"Untouchability" is abolished and its practice in any form is forbidden.',
  },
];

async function serving(provider: Provider | undefined) {
  const core = createCore({
    db: openDb(':memory:'),
    version: 'test',
    origins: ['*'],
    seed: HALL,
    ...(provider === undefined ? {} : { assistant: provider }),
  });
  const server = core.router.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as { port: number };
  return {
    close: () => server.close(),
    ask: async (body: unknown) => {
      const r = await fetch(`http://127.0.0.1:${String(port)}/v1/assistant/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      return { status: r.status, json: text === '' ? null : JSON.parse(text) };
    },
    status: async () => {
      const r = await fetch(`http://127.0.0.1:${String(port)}/v1/status`);
      return (await r.json()) as { services: string[] };
    },
  };
}

test('a cited answer comes back through the route with its passages', async () => {
  const { provider } = stub(['Article 17 abolishes untouchability [1].']);
  const core = await serving(provider);
  try {
    const { status, json } = await core.ask({
      question: 'What does Article 17 do?',
      passages: RETRIEVED,
    });
    assert.equal(status, 200);
    const reply = readReply(json);
    assert.equal(reply.kind, 'answer');
    assert.equal(
      reply.kind === 'answer' ? reply.segments[0]?.support[0]?.citation.pageId : null,
      'coi-art17-a17',
    );
  } finally {
    core.close();
  }
});

test('an ungrounded answer is retried once, and the second try is shown', async () => {
  // The first reply ends with a claim nobody sourced, which is the failure the
  // retry exists for.
  const s = stub([
    'Article 17 abolishes untouchability [1]. It was enforced from 1955.',
    'Article 17 abolishes untouchability [1].',
  ]);
  const core = await serving(s.provider);
  try {
    const { json } = await core.ask({
      question: 'What does it do?',
      passages: RETRIEVED,
    });
    assert.equal(readReply(json).kind, 'answer');
    assert.equal(s.asked, 2);
  } finally {
    core.close();
  }
});

test('an answer that fails twice is refused, never shown with the bad sentence removed', async () => {
  const s = stub([
    'Article 17 abolishes untouchability [1]. It was enforced from 1955.',
    'Article 17 abolishes untouchability [1]. It was enforced from 1955.',
  ]);
  const core = await serving(s.provider);
  try {
    const { json } = await core.ask({
      question: 'What does it do?',
      passages: RETRIEVED,
    });
    const reply = readReply(json);
    assert.equal(reply.kind, 'refusal');
    assert.equal(reply.kind === 'refusal' ? reply.because : null, 'ungrounded');
    // The refusal still hands back what search found, so the screen has
    // somewhere to send the visitor.
    assert.equal(reply.kind === 'refusal' ? reply.nearest.length : 0, 1);
    assert.equal(s.asked, 2);
  } finally {
    core.close();
  }
});

test('a model that says the corpus does not cover it is believed, not asked again', async () => {
  const s = stub(['INSUFFICIENT', 'Article 17 abolishes untouchability [1].']);
  const core = await serving(s.provider);
  try {
    const { json } = await core.ask({
      question: 'Where did he study?',
      passages: RETRIEVED,
    });
    const reply = readReply(json);
    assert.equal(reply.kind === 'refusal' ? reply.because : null, 'not-in-corpus');
    assert.equal(s.asked, 1, 'asking twice is asking it to change its mind');
  } finally {
    core.close();
  }
});

test('a provider over its quota refuses as rate-limited, not as an error', async () => {
  const { provider } = stub(['THROW']);
  const core = await serving(provider);
  try {
    const { status, json } = await core.ask({
      question: 'Anything?',
      passages: RETRIEVED,
    });
    // A spent quota is a refusal a visitor can read, not a 500 they cannot.
    assert.equal(status, 200);
    const reply = readReply(json);
    assert.equal(reply.kind, 'refusal');
    assert.equal(reply.kind === 'refusal' ? reply.because : null, 'rate-limited');
  } finally {
    core.close();
  }
});

test('the hall shares one quota, so a caller is held to four questions a minute', async () => {
  const { provider } = stub(Array(10).fill('Article 17 abolishes untouchability [1].'));
  const core = await serving(provider);
  try {
    const body = { question: 'What does Article 17 do?', passages: RETRIEVED };
    for (let i = 0; i < 4; i++) {
      assert.equal((await core.ask(body)).status, 200, `question ${String(i + 1)}`);
    }
    const fifth = await core.ask(body);
    assert.equal(fifth.status, 429);
    assert.match(String(fifth.json?.error), /the hall shares one quota/);
  } finally {
    core.close();
  }
});

test('a Core with no key says so, rather than failing one question at a time', async () => {
  const core = await serving(undefined);
  try {
    assert.equal((await core.status()).services.includes('assistant'), false);
    const { status } = await core.ask({ question: 'Anything?', passages: RETRIEVED });
    assert.equal(status, 503);
  } finally {
    core.close();
  }
});

test('a question that is not a question never reaches the provider', async () => {
  const s = stub(['Article 17 abolishes untouchability [1].']);
  const core = await serving(s.provider);
  try {
    assert.equal((await core.ask({ passages: RETRIEVED })).status, 400);
    assert.equal((await core.ask({ question: 'hi', passages: RETRIEVED })).status, 400);
    assert.equal(
      (await core.ask({ question: 'x'.repeat(401), passages: RETRIEVED })).status,
      400,
    );
    assert.equal((await core.ask({ question: 'What does Article 17 do?' })).status, 400);
    assert.equal(s.asked, 0);
  } finally {
    core.close();
  }
});

/**
 * A scratch archive: one scan with one machine reading, one work with its
 * Dublin Core record, one photograph with the digest it arrived with.
 */
function scratchArchive(): { root: string; files: ArchiveFiles } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toran-curation-'));
  const put = (rel: string, value: unknown) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(
      path.join(root, rel),
      typeof value === 'string' ? value : JSON.stringify(value),
    );
  };
  put('data/dip/scans.json', [
    {
      id: 'riddles-p001',
      sourceId: 'riddles',
      corpus: 'manuscript',
      workId: 'riddles',
      language: 'en',
      title: 'Riddles in Hinduism',
      heading: 'A leaf',
      width: 1000,
      height: 1400,
      locator: {
        kind: 'folio',
        manuscript: 'Riddles in Hinduism',
        folio: null,
        printed: null,
      },
    },
  ]);
  put('data/dip/ocr/riddles-p001.vlm.json', {
    pageId: 'riddles-p001',
    pipeline: 'vlm',
    model: 'a vision model',
    confidenceIs: 'agreement between three readings',
    regions: [
      { id: 'l000', text: 'What is most ridiculous is', confidence: 1, polygon: null },
      {
        id: 'l001',
        text: 'the Brahmin theorv',
        confidence: 0.4,
        polygon: [
          [10, 20],
          [110, 20],
          [110, 40],
          [10, 40],
        ],
      },
    ],
  });
  put('data/dip/works.json', [
    { id: 'baws-v1', title: 'Volume 1', creator: 'Ambedkar, B. R.' },
  ]);
  put('data/aip/baws-v1/dublin-core.json', {
    title: 'Volume 1',
    creator: 'Ambedkar, B. R.',
    publisher: 'Dr. Ambedkar Foundation',
    rights: 'As stated by the ministry',
  });
  put('data/sip/photos/yeola/original.jpg', 'a photograph');
  put('data/sip/photos/yeola/submission.json', {
    rights: 'Public domain',
    rightsVerified: false,
  });
  put('data/aip/photos/yeola/dublin-core.json', { title: 'Yeola, 1935' });
  put('pipeline/photos.json', {
    commons: [{ id: 'yeola', title: 'Yeola, 1935' }],
    plates: [],
  });
  put('data/fixity.json', {
    'photos/yeola/original.jpg': createHash('sha256')
      .update('a photograph')
      .digest('hex'),
  });
  return { root, files: new ArchiveFiles(root) };
}

const premisOf = (root: string): Record<string, unknown>[] =>
  fs
    .readFileSync(path.join(root, 'data/aip/premis.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>);

test('an OCR correction keeps the machine reading and says who changed it', () => {
  const { root, files } = scratchArchive();
  const [page] = readOcrPages(listOcr(files));
  // The wire carries what a citation is built from, and the reader builds it.
  assert.equal(page?.citation.corpus, 'manuscript');
  // Least confident first, because that is where a curator's time is worth most.
  assert.equal(page?.readings[0]?.regions[0]?.id, 'l001');
  assert.deepEqual(page?.readings[0]?.regions[0]?.box, [10, 20, 100, 20]);

  correctOcr(files, {
    pageId: 'riddles-p001',
    regionId: 'l001',
    pipeline: 'vlm',
    text: 'the Brahmin theory',
    by: 'A Curator',
    note: null,
  });
  const region = listOcr(files)[0]?.readings[0]?.regions[0];
  assert.equal(region?.text, 'the Brahmin theorv', 'the machine text is unchanged');
  assert.equal(region?.correction?.text, 'the Brahmin theory');
  const [event] = premisOf(root);
  assert.equal(event?.['eventType'], 'modification');
  assert.equal(event?.['linkingAgentIdentifier'], 'A Curator');

  assert.throws(
    () =>
      correctOcr(files, {
        pageId: 'riddles-p001',
        regionId: 'l001',
        pipeline: 'vlm',
        text: 'the Brahmin theory',
        by: 'A Curator',
        note: null,
      }),
    CurationRefused,
    'correcting a line to what it already reads is refused',
  );
});

test('a metadata edit changes the record and keeps what was submitted', () => {
  const { root, files } = scratchArchive();
  const work = editMetadata(files, {
    workId: 'baws-v1',
    field: 'title',
    value: 'Writings and Speeches, Volume 1',
    by: 'A Curator',
    note: 'the title page',
  });
  assert.equal(work.fields.title, 'Writings and Speeches, Volume 1');
  assert.equal(work.submitted.title, 'Volume 1');
  assert.equal(work.edits[0]?.was, 'Volume 1');
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(root, 'data/aip/baws-v1/dublin-core.json'), 'utf8'),
    ).title,
    'Volume 1',
    'the AIP record is not rewritten',
  );
  assert.equal(premisOf(root)[0]?.['eventType'], 'metadata modification');
  assert.throws(
    () =>
      editMetadata(files, {
        workId: 'baws-v9',
        field: 'title',
        value: 'x',
        by: 'A',
        note: null,
      }),
    CurationRefused,
  );
});

test('a package leaves the queue only when it is intact and a person checked its rights', async () => {
  const { root, files } = scratchArchive();
  const [first] = listIngest(files);
  assert.equal(first?.id, 'photos/yeola');
  assert.equal(first?.stage, 'archived');
  assert.equal(first?.rightsRecorded, 'not verified');
  assert.equal(needsCurator(first!), true);

  assert.equal((await checkFixity(files, 'photos/yeola', 'A Curator')).fixity, 'intact');
  verifyRights(files, { id: 'photos/yeola', by: 'A Curator', note: 'Commons page read' });
  const done = listIngest(files)[0]!;
  assert.equal(done.fixity, 'intact');
  assert.equal(done.rightsDecision?.by, 'A Curator');
  assert.equal(needsCurator(done), false);

  fs.appendFileSync(path.join(root, 'data/sip/photos/yeola/original.jpg'), '!');
  assert.equal((await checkFixity(files, 'photos/yeola', 'A Curator')).fixity, 'changed');
  assert.equal(needsCurator(listIngest(files)[0]!), true, 'a changed file puts it back');
});

test('the fleet and the archive refuse a change without the curator key', async () => {
  const db = openDb(':memory:');
  const { root } = scratchArchive();
  const core = createCore({
    db,
    version: 'test',
    origins: ['*'],
    seed: HALL,
    curatorKey: 'a-curator-key-for-tests',
    archiveRoot: root,
  });
  const server = core.router.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const put = (key: string | null) =>
    fetch(`http://127.0.0.1:${String(port)}/v1/fleet/dev-01`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        ...(key === null ? {} : { authorization: `Bearer ${key}` }),
      },
      body: JSON.stringify({ ...HALL[0], channel: 'timeline' }),
    }).then((r) => r.status);
  try {
    assert.ok(core.services.includes('curation'));
    assert.equal(await put(null), 401);
    assert.equal(await put('wrong'), 401);
    assert.equal(await put('a-curator-key-for-tests'), 200);
    assert.equal(core.fleet.config('dev-01')?.channel, 'timeline');
  } finally {
    server.close();
    db.close();
  }
});

test('a Core with no curator key serves the hall read only', () => {
  const db = openDb(':memory:');
  const core = createCore({ db, version: 'test', origins: ['*'], seed: HALL });
  assert.equal(core.services.includes('curation'), false);
  db.close();
});

test('the links Core sends are the links the console reads', () => {
  const { root, files } = scratchArchive();
  fs.mkdirSync(path.join(root, 'apps/web/public/archive'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'apps/web/public/archive/graph.json'),
    JSON.stringify({
      nodes: [
        { id: 'draft-11', title: 'Draft Article 11', date: '1948' },
        { id: 'art-17', title: 'Article 17', date: '1950' },
      ],
      edges: [
        {
          id: 'draft-11--becomes--art-17',
          from: 'draft-11',
          to: 'art-17',
          assertion: 'becomes',
          method: 'record',
          evidence: [
            {
              corpus: 'baws',
              workId: 'baws-v1',
              pageId: 'baws-v1-p0100',
              locator: { kind: 'page', volume: 1, part: null, page: 68, observed: true },
              language: 'en',
              speaker: null,
              text: 'Caste is a notion, it is a state of the mind.',
            },
          ],
          digest: 'abc',
          confirmation: null,
        },
        {
          id: 'no-evidence',
          from: 'draft-11',
          to: 'art-17',
          assertion: 'becomes',
          method: 'record',
          evidence: [],
          digest: 'def',
          confirmation: null,
        },
      ],
    }),
  );
  // Through JSON, as over the wire.
  const read = readEdgeReviews(JSON.parse(JSON.stringify(listEdges(files))));
  assert.equal(read.length, 1, 'the link with no evidence is not sent');
  assert.equal(read[0]?.from.title, 'Draft Article 11');
  assert.equal(read[0]?.evidence[0]?.citation.pageId, 'baws-v1-p0100');
});

test('a work read deeply at one device drifts to its neighbour, and only while it is read', () => {
  let clock = 1_000_000;
  const db = openDb(':memory:');
  const fleet = new Fleet(db, () => clock);
  fleet.seed([
    { ...HALL[0]!, deviceId: 'dev-03', position: [0, 0, 0] },
    { ...HALL[0]!, deviceId: 'dev-04', position: [2, 0, 0] },
    { ...HALL[0]!, deviceId: 'dev-10', position: [0, 0, -30] },
  ]);
  const beat = (id: string, topic: string | null) =>
    fleet.beat(id, {
      state: topic === null ? 'ambient' : 'personal',
      configVersion: 1,
      uptimeSeconds: 1,
      topic,
    });

  assert.equal(beat('dev-04', null).drift, null, 'nobody is reading anything yet');
  beat('dev-03', 'coi-art17');
  assert.equal(beat('dev-04', null).drift, 'coi-art17', 'two metres away');
  assert.equal(beat('dev-10', null).drift, null, 'thirty metres away');
  assert.equal(
    beat('dev-03', 'coi-art17').drift,
    null,
    'a device never drifts toward itself',
  );

  // The reader leaves, and the neighbour stops drifting on its next beat.
  beat('dev-03', null);
  assert.equal(beat('dev-04', null).drift, null);

  // A device that went quiet mid-read is not still being read.
  beat('dev-03', 'baws-v1');
  clock += 91_000;
  assert.equal(beat('dev-04', null).drift, null);

  // What Core keeps is a work id per device. No time, no token.
  const columns = rows<{ name: string }>(
    db,
    "select name from pragma_table_info('device_topic')",
  );
  assert.deepEqual(
    columns.map((c) => c.name),
    ['device_id', 'topic'],
  );
  db.close();
});

/** Two seconds of silence as the kiosk would send it: 16 kHz mono 16-bit WAV, base64. */
function silence(seconds: number): string {
  const samples = 16_000 * seconds;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + samples * 2, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24);
  bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  return bytes.toString('base64');
}

async function speaking(transcriber: Transcriber | undefined) {
  const core = createCore({
    db: openDb(':memory:'),
    version: 'test',
    origins: ['*'],
    seed: HALL,
    ...(transcriber === undefined ? {} : { transcriber }),
  });
  const server = core.router.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as { port: number };
  const say = async (body: unknown) => {
    const r = await fetch(`http://127.0.0.1:${String(port)}/v1/language/transcribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  return { core, say, close: () => server.close() };
}

test('a spoken query comes back as words, and Core says it serves them', async () => {
  const heard: string[] = [];
  const { core, say, close } = await speaking({
    transcribe: async (language) => {
      heard.push(language);
      return ' mahad satyagraha ';
    },
  });
  try {
    assert.ok(core.services.includes('language'));
    const { status, json } = await say({ language: 'hi', audio: silence(2) });
    assert.equal(status, 200);
    assert.equal(readTranscript(json).text, 'mahad satyagraha');
    assert.deepEqual(heard, ['hi']);
    // Not a WAV, and not asked of the recogniser at all.
    assert.equal(
      (
        await say({
          language: 'hi',
          audio: Buffer.from('x'.repeat(9000)).toString('base64'),
        })
      ).status,
      400,
    );
    assert.deepEqual(heard, ['hi']);
  } finally {
    close();
  }
});

test('a recogniser that fails or stalls is a 503 the kiosk can act on, never a hang', async () => {
  let asked = 0;
  const { say, close } = await speaking({
    transcribe: () => {
      asked++;
      return Promise.reject(new Error('upstream 500'));
    },
  });
  try {
    const { status, json } = await say({ language: 'en', audio: silence(1) });
    assert.equal(status, 503);
    assert.match(String(json['error']), /not answering/);
    // The next visitor is told at once, not made to wait out the same failure.
    assert.equal((await say({ language: 'en', audio: silence(1) })).status, 503);
    assert.equal(asked, 1);
  } finally {
    close();
  }
  const none = await speaking(undefined);
  try {
    assert.equal(none.core.services.includes('language'), false);
    assert.equal((await none.say({ language: 'en', audio: silence(1) })).status, 503);
  } finally {
    none.close();
  }
});

test("one kiosk cannot spend the hall's speech recognition in a minute", async () => {
  const { say, close } = await speaking({ transcribe: async () => 'x' });
  try {
    for (let i = 0; i < 6; i++)
      assert.equal((await say({ language: 'en', audio: silence(1) })).status, 200);
    assert.equal((await say({ language: 'en', audio: silence(1) })).status, 429);
  } finally {
    close();
  }
});

test('Core serves the built Twin from its own origin, and nothing outside it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toran-web-'));
  fs.mkdirSync(path.join(root, 'kiosk/dev-01'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>hall</h1>');
  fs.writeFileSync(path.join(root, 'kiosk/dev-01/index.html'), '<h1>kiosk</h1>');
  fs.writeFileSync(path.join(root, '404.html'), '<h1>missing</h1>');
  fs.writeFileSync(path.join(root, 'film.mp4'), Buffer.from('0123456789'));
  fs.writeFileSync(path.join(os.tmpdir(), 'toran-secret.txt'), 'not for the web');
  const db = openDb(':memory:');
  const core = createCore({ db, version: 'test', origins: ['*'], seed: HALL });
  const server = core.router.listen(0, '127.0.0.1', root);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${String((server.address() as { port: number }).port)}`;
  try {
    assert.equal(await (await fetch(`${base}/`)).text(), '<h1>hall</h1>');
    assert.equal(await (await fetch(`${base}/kiosk/dev-01/`)).text(), '<h1>kiosk</h1>');
    const bare = await fetch(`${base}/kiosk/dev-01`, { redirect: 'manual' });
    assert.equal(bare.status, 308, 'a route without its slash is sent to it');
    const missing = await fetch(`${base}/nowhere/`);
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), '<h1>missing</h1>');
    const ranged = await fetch(`${base}/film.mp4`, { headers: { range: 'bytes=2-5' } });
    assert.equal(ranged.status, 206);
    assert.equal(await ranged.text(), '2345');
    // The API is still the API.
    const status = (await (await fetch(`${base}/v1/status`)).json()) as {
      service: string;
    };
    assert.equal(status.service, 'toran-core');
    for (const escape of [
      '/../toran-secret.txt',
      '/%2e%2e/toran-secret.txt',
      '/..%2ftoran-secret.txt',
    ]) {
      const r = await fetch(`${base}${escape}`);
      assert.notEqual(await r.text(), 'not for the web', escape);
    }
  } finally {
    server.close();
    db.close();
  }
});

test('a simulated visit walks the proxemic states and names a work only once it has held', () => {
  const visit = {
    implicit: 10_000,
    subtle: 15_000,
    personal: 25_000,
    decaying: 100_000,
    ambient: 120_000,
    topic: 'baws-v1',
  };
  assert.deepEqual(HallSimulator.phase(visit, 5_000), { state: 'ambient', topic: null });
  assert.equal(HallSimulator.phase(visit, 12_000).state, 'implicit');
  assert.equal(HallSimulator.phase(visit, 20_000).state, 'subtle');
  assert.deepEqual(HallSimulator.phase(visit, 40_000), {
    state: 'personal',
    topic: null,
  });
  assert.deepEqual(HallSimulator.phase(visit, 56_000), {
    state: 'personal',
    topic: 'baws-v1',
  });
  assert.equal(HallSimulator.phase(visit, 110_000).state, 'decaying');
});

test('the simulated hall reports through the fleet, says it is simulated, and gives way to a real kiosk', () => {
  let clock = 5_000_000;
  const db = openDb(':memory:');
  const fleet = new Fleet(db, () => clock);
  fleet.seed([
    { ...HALL[0]!, deviceId: 'dev-03', channel: 'provenance', position: [0, 0, 0] },
    { ...HALL[0]!, deviceId: 'dev-07', channel: 'manuscript', position: [5, 0, 0] },
    { ...HALL[0]!, deviceId: 'dev-12', channel: 'curator', position: [40, 0, 0] },
  ]);
  const hall = new HallSimulator(fleet, ['baws-v17-1'], () => clock, seeded(7));
  // Twenty minutes of the hall, five seconds at a time.
  let drifted = false;
  for (let i = 0; i < 240; i++) {
    clock += 5000;
    hall.tick();
    if (fleet.snapshot().drift.length > 0) drifted = true;
  }
  const health = fleet.health();
  assert.deepEqual(
    health.map((h) => [h.deviceId, h.simulated]),
    [
      ['dev-03', true],
      ['dev-07', true],
    ],
    'every device but the curator desk has a simulated visitor, and says so',
  );
  assert.ok(
    drifted,
    'in twenty minutes a simulated reader drifts a neighbour at least once',
  );

  // A pushed config is taken up on the next simulated beat, like a real kiosk.
  fleet.put('dev-07', { ...fleet.config('dev-07')!, channel: 'timeline' });
  for (let i = 0; i < 7; i++) {
    clock += 5000;
    hall.tick();
  }
  assert.equal(fleet.health().find((h) => h.deviceId === 'dev-07')?.configVersion, 2);

  // A real kiosk reports for dev-03; the simulator stops speaking for it.
  fleet.beat('dev-03', {
    state: 'ambient',
    configVersion: 1,
    uptimeSeconds: 5,
    topic: null,
  });
  for (let i = 0; i < 12; i++) {
    clock += 5000;
    hall.tick();
  }
  const real = fleet.health().find((h) => h.deviceId === 'dev-03');
  assert.equal(real?.simulated, false);
  assert.equal(real?.uptimeSeconds, 5, 'no simulated beat overwrote the real one');
  db.close();
});
