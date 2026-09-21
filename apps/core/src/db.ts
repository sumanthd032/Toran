/**
 * Core's store: one SQLite file, opened with the runtime's own driver.
 *
 * There is no ORM and no migration tool. The schema below is the whole of it,
 * it is applied on every boot with `create table if not exists`, and a column
 * that changes gets a new table rather than a migration framework. That is a
 * defensible trade for a server with four tables whose operator is an
 * archivist, not a platform team.
 *
 * What is deliberately absent matters more than what is here. No table records
 * which device a card touched, what a visitor searched for, when they read a
 * page, or in what order. ARCHITECTURE.md section 8 calls the token the only
 * identifier, and a schema that cannot hold a visit history cannot leak one.
 * The dossier table holds a passage and the card it belongs to. Nothing else.
 */

import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
create table if not exists device (
  device_id        text primary key,
  channel          text not null,
  default_language text not null,
  x                real not null,
  y                real not null,
  z                real not null,
  rotation_y       real not null,
  version          integer not null,
  updated_at       text not null
);

create table if not exists device_health (
  device_id      text primary key,
  last_seen      text not null,
  config_version integer not null,
  state          text not null,
  uptime_seconds integer not null
);

create table if not exists session (
  token           text primary key,
  language        text not null,
  type_scale      text not null,
  high_contrast   integer not null,
  audio_first     integer not null,
  reduced_motion  integer not null,
  issued_at       text not null
);

create table if not exists dossier_item (
  token text not null,
  ref   text not null,
  item  text not null,
  primary key (token, ref)
);

create index if not exists dossier_by_token on dossier_item (token);
`;

export type Db = DatabaseSync;

export function openDb(file: string): Db {
  const db = new DatabaseSync(file);
  // A kiosk hall loses power. WAL survives it better than the rollback
  // journal, and a foreign key that is not enforced is a comment.
  db.exec('pragma journal_mode = wal');
  db.exec('pragma foreign_keys = on');
  db.exec(SCHEMA);
  return db;
}

/**
 * Typed reads.
 *
 * `node:sqlite` returns `Record<string, SQLOutputValue>`, which is honest,
 * because a driver cannot know the shape of a query it was handed as a string.
 * These three put that cast in one place, beside the schema that makes it
 * true, instead of at every call site where it would read as a claim rather
 * than an assumption.
 */
type Param = string | number | bigint | null | Uint8Array;

export function rows<T>(db: Db, sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

export function one<T>(db: Db, sql: string, ...params: Param[]): T | null {
  return (db.prepare(sql).get(...params) as unknown as T | undefined) ?? null;
}

export function run(db: Db, sql: string, ...params: Param[]): void {
  db.prepare(sql).run(...params);
}
