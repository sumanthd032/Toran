/**
 * The archive on disk, as the curation service reads and writes it.
 *
 * Core runs beside the repository in every deployment that has a curator: a
 * workstation inside DAIC or a laptop at a demo. The files a curator changes
 * are the same ones `tools/confirm-edges.mjs` and `tools/correct-ocr.mjs`
 * write, through the same functions, so the console and the terminal cannot
 * disagree about what a decision looks like.
 *
 * Two rules hold for every write here. A log under data/curation is appended
 * to and never edited. And every decision also goes to the PREMIS event log,
 * because a preservation archive has to be able to say who changed what, and
 * when, without anyone reading the curation files.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const PATHS = {
  graph: 'apps/web/public/archive/graph.json',
  edges: 'data/curation/edges.jsonl',
  corrections: 'data/curation/corrections.jsonl',
  metadata: 'data/curation/metadata.jsonl',
  rights: 'data/curation/rights.jsonl',
  premis: 'data/aip/premis.jsonl',
  fixity: 'data/fixity.json',
  scans: 'data/dip/scans.json',
  ocr: 'data/dip/ocr',
  works: 'data/dip/works.json',
  sip: 'data/sip',
  aip: 'data/aip',
  sources: 'pipeline/sources.json',
  manuscripts: 'pipeline/manuscripts.json',
  photos: 'pipeline/photos.json',
  media: 'pipeline/media.json',
} as const;

export interface PremisEvent {
  readonly eventType: string;
  readonly eventDateTime: string;
  readonly eventOutcome: 'success' | 'failure';
  readonly eventOutcomeDetail: string;
  readonly linkingAgentIdentifier: string;
  readonly linkingObjectIdentifier: readonly string[];
}

export class ArchiveFiles {
  public readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  at(relative: string): string {
    return path.join(this.root, relative);
  }

  exists(relative: string): boolean {
    return fs.existsSync(this.at(relative));
  }

  json<T>(relative: string, fallback: T): T {
    const file = this.at(relative);
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  }

  /** Every line of a JSON Lines log. A line that does not parse is skipped, not fatal. */
  log(relative: string): unknown[] {
    const file = this.at(relative);
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as unknown];
        } catch {
          return [];
        }
      });
  }

  append(relative: string, record: unknown): void {
    const file = this.at(relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
  }

  premis(event: PremisEvent): void {
    this.append(PATHS.premis, event);
  }
}

export interface RebuildResult {
  readonly ok: boolean;
  readonly ms: number;
}

/**
 * Runs the build that republishes what a decision changed, one at a time.
 *
 * Two curators confirming two links a second apart would otherwise start two
 * graph builds writing the same file. Each build takes under half a second,
 * measured on this archive, so a queue costs nothing a curator would notice.
 */
export class Rebuilder {
  private readonly root: string;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(root: string) {
    this.root = root;
  }

  run(script: string): Promise<RebuildResult> {
    const next = this.tail.then(() => this.spawn(script));
    this.tail = next.catch(() => undefined);
    return next;
  }

  private spawn(script: string): Promise<RebuildResult> {
    const started = Date.now();
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [script], {
        cwd: this.root,
        stdio: 'ignore',
      });
      child.on('error', () => resolve({ ok: false, ms: Date.now() - started }));
      child.on('exit', (code) => resolve({ ok: code === 0, ms: Date.now() - started }));
    });
  }
}

export class CurationRefused extends Error {
  public override readonly name = 'CurationRefused';
}
