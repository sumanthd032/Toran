/**
 * The ingest queue. ARCHITECTURE.md section 3.
 *
 * Every object the archive holds or has been told to hold, and how far it has
 * come: listed in a manifest, submitted as a SIP with its digest taken on
 * arrival, or archived as an AIP. An object stays in the queue until it is
 * archived, its files still hash to what they did on arrival, and a person has
 * checked its rights statement against the source and said so. The pipeline
 * records rights as the source states them and marks nearly every one
 * unverified, so that last step is the one only a curator can do.
 *
 * Running the ingest itself stays at the terminal (`npm run ingest`). It
 * downloads, parses and runs OCR for minutes at a time, and a web request is
 * the wrong thing to hang that on.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  FixityResult,
  FixityState,
  IngestItem,
  IngestStage,
  RightsDecision,
} from '@toran/contracts';
import { CurationRefused, PATHS, type ArchiveFiles } from './files.ts';

interface Listed {
  readonly id: string;
  readonly title: string;
  readonly format: string;
  readonly rights: string;
}

interface Submission {
  url?: string;
  retrieved?: string;
  bytes?: number;
  format?: string;
  rights?: string;
  rightsVerified?: boolean | string;
}

interface RightsRow extends RightsDecision {
  id: string;
}

type Manifest = Record<string, unknown>;

const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? (value as Record<string, unknown>[]) : [];

const s = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Every object any manifest names, with its package id as the archive files it. */
function listed(files: ArchiveFiles): Listed[] {
  const out: Listed[] = [];
  const add = (id: string, row: Record<string, unknown>, format: string) =>
    out.push({
      id,
      title: s(row['title']) || id,
      format: s(row['format']) || format,
      rights: s(row['rights']),
    });

  for (const row of rows(files.json<Manifest>(PATHS.sources, {})['sources'])) {
    add(s(row['id']), row, '');
  }
  for (const row of rows(files.json<Manifest>(PATHS.manuscripts, {})['sources'])) {
    add(`manuscripts/${s(row['id'])}`, row, '');
  }
  const photos = files.json<Manifest>(PATHS.photos, {});
  for (const row of [...rows(photos['commons']), ...rows(photos['plates'])]) {
    add(`photos/${s(row['id'])}`, row, 'image');
  }
  for (const row of rows(files.json<Manifest>(PATHS.media, {})['recordings'])) {
    add(`media/${s(row['id'])}`, row, 'video/mp4');
  }
  return out.filter((l) => !l.id.endsWith('/') && l.id !== '');
}

/** The digests taken on arrival, grouped by package. */
function digests(files: ArchiveFiles): Map<string, Map<string, string>> {
  const all = files.json<Record<string, string>>(PATHS.fixity, {});
  const out = new Map<string, Map<string, string>>();
  for (const [file, sha] of Object.entries(all)) {
    const pkg = path.posix.dirname(file);
    const set = out.get(pkg) ?? new Map<string, string>();
    set.set(file, sha);
    out.set(pkg, set);
  }
  return out;
}

/**
 * A media recording is filed flat, as media/<id>.<ext>, where every other
 * object is a directory. Both are found here.
 */
function present(files: ArchiveFiles, base: string, id: string): boolean {
  if (files.exists(`${base}/${id}`)) return true;
  const dir = files.at(`${base}/${path.posix.dirname(id)}`);
  const stem = path.posix.basename(id);
  return fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.startsWith(`${stem}.`));
}

function stageOf(files: ArchiveFiles, id: string): IngestStage {
  if (present(files, PATHS.aip, id)) return 'archived';
  if (present(files, PATHS.sip, id)) return 'submitted';
  return 'listed';
}

interface FixityEvent {
  eventType?: string;
  eventDateTime?: string;
  eventOutcome?: string;
  eventOutcomeDetail?: string;
  linkingObjectIdentifier?: string[];
}

/** The last fixity check a curator ran on a package, read back from the PREMIS log. */
function lastCheck(files: ArchiveFiles): Map<string, { state: FixityState; at: string }> {
  const out = new Map<string, { state: FixityState; at: string }>();
  for (const raw of files.log(PATHS.premis) as FixityEvent[]) {
    if (raw.eventType !== 'fixity check' || raw.linkingObjectIdentifier?.length !== 1)
      continue;
    const id = raw.linkingObjectIdentifier[0]!;
    const detail = raw.eventOutcomeDetail ?? '';
    const state: FixityState =
      raw.eventOutcome === 'success'
        ? 'intact'
        : detail.startsWith('missing')
          ? 'missing'
          : 'changed';
    out.set(id, { state, at: raw.eventDateTime ?? '' });
  }
  return out;
}

export function listIngest(files: ArchiveFiles): IngestItem[] {
  const decided = new Map<string, RightsRow>();
  for (const r of files.log(PATHS.rights) as RightsRow[]) decided.set(r.id, r);
  const checks = lastCheck(files);

  return listed(files).map((item) => {
    const submission = files.json<Submission>(
      `${PATHS.sip}/${item.id}/submission.json`,
      {},
    );
    const recorded = submission.rightsVerified;
    const decision = decided.get(item.id);
    const check = checks.get(item.id);
    return {
      id: item.id,
      title: item.title,
      format: submission.format ?? item.format,
      stage: stageOf(files, item.id),
      bytes: typeof submission.bytes === 'number' ? submission.bytes : null,
      retrieved: submission.retrieved ?? null,
      rights: submission.rights ?? item.rights,
      rightsRecorded:
        typeof recorded === 'string'
          ? recorded
          : recorded === true
            ? 'marked verified by the pipeline'
            : 'not verified',
      rightsDecision:
        decision === undefined
          ? null
          : { by: decision.by, at: decision.at, note: decision.note },
      fixity: check?.state ?? 'unchecked',
      fixityCheckedAt: check?.at ?? null,
    };
  });
}

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Hashes a package's files again and compares them with the digests taken on
 * arrival. Streams, because a volume is tens of megabytes and Core is also
 * answering the hall while it reads one.
 */
export async function checkFixity(
  files: ArchiveFiles,
  id: string,
  by: string,
  now: () => number = Date.now,
): Promise<FixityResult> {
  const expected = digests(files).get(id);
  if (expected === undefined) {
    throw new CurationRefused(
      `no digest was taken for ${id} on arrival, so there is nothing to check it against`,
    );
  }
  const changed: string[] = [];
  const missing: string[] = [];
  for (const [file, sha] of expected) {
    const at = files.at(`${PATHS.sip}/${file}`);
    if (!fs.existsSync(at)) missing.push(file);
    else if ((await sha256(at)) !== sha) changed.push(file);
  }
  const fixity: FixityState =
    missing.length > 0 ? 'missing' : changed.length > 0 ? 'changed' : 'intact';
  const checkedAt = new Date(now()).toISOString();
  files.premis({
    eventType: 'fixity check',
    eventDateTime: checkedAt,
    eventOutcome: fixity === 'intact' ? 'success' : 'failure',
    eventOutcomeDetail:
      fixity === 'intact'
        ? `${String(expected.size)} file(s) match the digests taken on arrival`
        : `${fixity}: ${[...missing, ...changed].join(', ')}`,
    linkingAgentIdentifier: by,
    linkingObjectIdentifier: [id],
  });
  return { id, fixity, checkedAt };
}

/** A curator saying they checked the rights statement against the source. */
export function verifyRights(
  files: ArchiveFiles,
  input: { id: string; by: string; note: string | null },
  now: () => number = Date.now,
): RightsDecision {
  const item = listIngest(files).find((i) => i.id === input.id);
  if (item === undefined)
    throw new CurationRefused(`nothing called ${input.id} is in any manifest`);
  if (item.stage === 'listed') {
    throw new CurationRefused(
      `${input.id} has not arrived yet, so there is no source to check`,
    );
  }
  const record: RightsRow = {
    id: item.id,
    by: input.by,
    at: new Date(now()).toISOString(),
    note: input.note,
  };
  files.append(PATHS.rights, record);
  files.premis({
    eventType: 'validation',
    eventDateTime: record.at,
    eventOutcome: 'success',
    eventOutcomeDetail:
      `rights statement checked against the source by a curator: ${JSON.stringify(item.rights)}` +
      (record.note === null ? '' : `. ${record.note}`),
    linkingAgentIdentifier: input.by,
    linkingObjectIdentifier: [item.id],
  });
  return { by: record.by, at: record.at, note: record.note };
}
