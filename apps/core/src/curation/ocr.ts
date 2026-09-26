/**
 * OCR review. STEPS.md step 8, ARCHITECTURE.md section 3.
 *
 * The machine's reading stays in data/dip/ocr exactly as the model wrote it. A
 * correction is a new line in data/curation/corrections.jsonl and a PREMIS
 * `modification` event, and the Manuscript Station shows it as a change from
 * the machine's text rather than in its place. Regions are served least
 * confident first, because that is where the model has already said to look.
 */

import fs from 'node:fs';
import type {
  OcrCorrectionInput,
  OcrPage,
  OcrReading,
  RegionBox,
} from '@toran/contracts';
import { CurationRefused, PATHS, type ArchiveFiles } from './files.ts';

interface ScanRow {
  id: string;
  sourceId: string;
  corpus: string;
  workId: string;
  language?: string;
  heading?: string | null;
  width: number;
  height: number;
  /** Passed through as the pipeline wrote it; the console's reader checks it. */
  locator: unknown;
}

/**
 * A page as it goes over the wire. The console builds the citation from the
 * corpus, work and locator with the contract's own reader, so this side never
 * formats one.
 */
type OcrPageWire = Omit<OcrPage, 'citation'> & {
  readonly corpus: string;
  readonly workId: string;
  readonly locator: unknown;
};

interface RegionRow {
  id: string;
  text: string;
  confidence: number;
  polygon?: readonly (readonly [number, number])[] | null;
}

interface ReadingRow {
  pageId: string;
  pipeline: string;
  model: string;
  confidenceIs?: string;
  regions: RegionRow[];
}

interface CorrectionRow {
  pageId: string;
  regionId: string;
  corrects: string;
  was: string;
  text: string;
  by: string;
  at: string;
  note: string | null;
}

function box(polygon: RegionRow['polygon']): RegionBox | null {
  if (polygon === null || polygon === undefined || polygon.length === 0) return null;
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return [x, y, Math.max(...xs) - x, Math.max(...ys) - y];
}

function scans(files: ArchiveFiles): ScanRow[] {
  return files.json<ScanRow[]>(PATHS.scans, []);
}

function readings(files: ArchiveFiles, pageId: string): ReadingRow[] {
  const dir = files.at(PATHS.ocr);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${pageId}.`) && /\.(surya|vlm)\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')) as ReadingRow);
}

function corrections(files: ArchiveFiles): CorrectionRow[] {
  return files.log(PATHS.corrections) as CorrectionRow[];
}

export function listOcr(files: ArchiveFiles): OcrPageWire[] {
  const latest = new Map<string, CorrectionRow>();
  // The log is in order, so the last correction of a region is the one that counts.
  for (const c of corrections(files))
    latest.set(`${c.pageId} ${c.corrects} ${c.regionId}`, c);

  return scans(files).map((scan) => ({
    pageId: scan.id,
    heading: scan.heading ?? '',
    language: scan.language ?? 'en',
    corpus: scan.corpus,
    workId: scan.workId,
    locator: scan.locator,
    width: scan.width,
    height: scan.height,
    readings: readings(files, scan.id).map((r): OcrReading => ({
      pipeline: r.pipeline,
      model: r.model,
      confidenceIs: r.confidenceIs ?? "the model's own probability",
      regions: [...r.regions]
        .sort((a, b) => a.confidence - b.confidence)
        .map((region) => {
          const c = latest.get(`${scan.id} ${r.pipeline} ${region.id}`);
          return {
            id: region.id,
            text: region.text,
            confidence: region.confidence,
            box: box(region.polygon),
            correction:
              c === undefined ? null : { text: c.text, by: c.by, at: c.at, note: c.note },
          };
        }),
    })),
  }));
}

/** Records a correction to one region. Returns the correction as written. */
export function correctOcr(
  files: ArchiveFiles,
  input: OcrCorrectionInput,
  now: () => number = Date.now,
): CorrectionRow {
  const scan = scans(files).find((s) => s.id === input.pageId);
  if (scan === undefined) throw new CurationRefused(`no scan ${input.pageId}`);
  const reading = readings(files, scan.id).find((r) => r.pipeline === input.pipeline);
  if (reading === undefined) {
    throw new CurationRefused(`${input.pipeline} has not read ${input.pageId}`);
  }
  const region = reading.regions.find((r) => r.id === input.regionId);
  if (region === undefined) {
    throw new CurationRefused(
      `no region ${input.regionId} in the ${input.pipeline} reading`,
    );
  }
  const current = latestFor(files, input) ?? region.text;
  if (current === input.text)
    throw new CurationRefused('that is what the page already reads');

  const record: CorrectionRow = {
    pageId: scan.id,
    regionId: region.id,
    corrects: reading.pipeline,
    was: region.text,
    text: input.text,
    by: input.by,
    at: new Date(now()).toISOString(),
    note: input.note,
  };
  files.append(PATHS.corrections, record);
  // The machine output is untouched. This says what changed and who changed
  // it, which is the record an archive has to keep.
  files.premis({
    eventType: 'modification',
    eventDateTime: record.at,
    eventOutcome: 'success',
    eventOutcomeDetail:
      `${scan.id} ${region.id}: ${reading.pipeline} read ${JSON.stringify(region.text)}, ` +
      `corrected to ${JSON.stringify(record.text)}. The machine output is unchanged.`,
    linkingAgentIdentifier: input.by,
    linkingObjectIdentifier: [`manuscripts/${scan.sourceId}`],
  });
  return record;
}

function latestFor(files: ArchiveFiles, input: OcrCorrectionInput): string | null {
  let found: string | null = null;
  for (const c of corrections(files)) {
    if (
      c.pageId === input.pageId &&
      c.corrects === input.pipeline &&
      c.regionId === input.regionId
    ) {
      found = c.text;
    }
  }
  return found;
}
