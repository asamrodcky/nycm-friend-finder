// Loads the committed anonymised snapshot into an in-memory database.
//
// WHY THIS WORKS WITHOUT CLOUDFLARE. snapshots/nycm2026-anon.sql is a
// plain SQL dump of the real race data with the identities removed, and
// it carries the schema, the indexes and all nine views. So the whole
// suite runs against the real shape of the real data with no account, no
// network, no credentials and no npm install -- node:test and
// node:sqlite are both built in.
//
// That is the reason these tests can run in CI at all. Most data tests
// need a database to point at; this one ships with its own.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT = join(here, '..', '..', 'snapshots', 'nycm2026-anon.sql');

/**
 * A fresh database per call, so a test that writes cannot affect one
 * that reads. Foreign keys are off during load only because the dump is
 * not ordered parent-first; they are switched back on afterwards, which
 * is what makes the referential tests meaningful rather than decorative.
 */
export function loadSnapshot({ foreignKeys = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(readFileSync(SNAPSHOT, 'utf8'));
  if (foreignKeys) db.exec('PRAGMA foreign_keys = ON');
  return db;
}

/** First column of the first row — for `SELECT COUNT(*) ...` assertions. */
export const count = (db, sql) => Object.values(db.prepare(sql).get())[0];

/** Rows, for the cases where seeing which ones failed is the point. */
export const rows = (db, sql) => db.prepare(sql).all();
