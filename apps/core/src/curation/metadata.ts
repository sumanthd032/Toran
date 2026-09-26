/**
 * Dublin Core editing, for the works a visitor reads.
 *
 * The AIP's dublin-core.json is what arrived with the submission and is never
 * rewritten. An edit is a line in data/curation/metadata.jsonl and a PREMIS
 * `metadata modification` event, and `tools/build-archive.mjs` applies the
 * latest edit of each field when it publishes the Reading Room's manifest. So
 * the record a visitor sees changes, and the record the archive received is
 * still there to compare it with.
 *
 * Only the text works are open to editing, because they are the records whose
 * edited title and creator a visitor then reads. D-151.
 */

import {
  EDITABLE_FIELDS,
  type EditableField,
  type MetadataEdit,
  type MetadataEditInput,
  type WorkRecord,
} from '@toran/contracts';
import { CurationRefused, PATHS, type ArchiveFiles } from './files.ts';

interface WorkRow {
  id: string;
  title: string;
  creator: string;
}

interface EditRow extends MetadataEdit {
  workId: string;
}

function works(files: ArchiveFiles): WorkRow[] {
  return files.json<WorkRow[]>(PATHS.works, []);
}

function submitted(files: ArchiveFiles, work: WorkRow): Record<EditableField, string> {
  const dc = files.json<Partial<Record<string, unknown>>>(
    `${PATHS.aip}/${work.id}/dublin-core.json`,
    {},
  );
  const out = {} as Record<EditableField, string>;
  for (const field of EDITABLE_FIELDS) {
    const value = dc[field];
    out[field] = typeof value === 'string' ? value : '';
  }
  // The DIP carries the title and creator even for a work whose package
  // predates its Dublin Core record.
  if (out.title === '') out.title = work.title;
  if (out.creator === '') out.creator = work.creator;
  return out;
}

function edits(files: ArchiveFiles): EditRow[] {
  return files.log(PATHS.metadata) as EditRow[];
}

function recordOf(
  files: ArchiveFiles,
  work: WorkRow,
  all: readonly EditRow[],
): WorkRecord {
  const mine = all.filter((e) => e.workId === work.id);
  const first = submitted(files, work);
  const fields = { ...first };
  for (const e of mine) fields[e.field] = e.value;
  return {
    id: work.id,
    fields,
    submitted: first,
    edits: mine.map(({ field, was, value, by, at, note }) => ({
      field,
      was,
      value,
      by,
      at,
      note,
    })),
  };
}

export function listWorks(files: ArchiveFiles): WorkRecord[] {
  const all = edits(files);
  return works(files).map((w) => recordOf(files, w, all));
}

export function editMetadata(
  files: ArchiveFiles,
  input: MetadataEditInput,
  now: () => number = Date.now,
): WorkRecord {
  const work = works(files).find((w) => w.id === input.workId);
  if (work === undefined)
    throw new CurationRefused(`no work ${input.workId} in the archive`);
  const before = recordOf(files, work, edits(files));
  const was = before.fields[input.field];
  if (was === input.value)
    throw new CurationRefused(`the ${input.field} already reads that`);

  const record: EditRow = {
    workId: work.id,
    field: input.field,
    was,
    value: input.value,
    by: input.by,
    at: new Date(now()).toISOString(),
    note: input.note,
  };
  files.append(PATHS.metadata, record);
  files.premis({
    eventType: 'metadata modification',
    eventDateTime: record.at,
    eventOutcome: 'success',
    eventOutcomeDetail:
      `${work.id} ${input.field}: ${JSON.stringify(was)} changed to ${JSON.stringify(input.value)}. ` +
      'The submitted Dublin Core record is unchanged.',
    linkingAgentIdentifier: input.by,
    linkingObjectIdentifier: [`${work.id}/dublin-core.json`],
  });
  return recordOf(files, work, edits(files));
}
