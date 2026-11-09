// Structural guarantees of the dimensional model.
//
// These are assertions about MEANING, not about code: that the grain is
// what the documentation claims, that the insert-only history is
// coherent, and that the constraints which make the model trustworthy
// are actually enforced rather than merely intended.
//
// Every one of them is expressed against the real race data.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadSnapshot, count } from './helpers/snapshot.mjs';

let db;
before(() => { db = loadSnapshot(); });

describe('grain', () => {
  test('fct_runner_start: at most one live row per runner', () => {
    // The stated grain is "one row per VERSION of a start assignment",
    // which only means anything if exactly one version is current. A
    // partial unique index enforces it; this proves the data agrees.
    assert.equal(count(db, `
      SELECT COUNT(*) FROM (
        SELECT runner_key FROM fct_runner_start
         WHERE is_current = 1 GROUP BY runner_key HAVING COUNT(*) > 1)`), 0);
  });

  test('a live bib number identifies exactly one runner', () => {
    assert.equal(count(db, `
      SELECT COUNT(*) FROM (
        SELECT bib_number FROM fct_runner_start
         WHERE is_current = 1 AND bib_number IS NOT NULL
         GROUP BY bib_number HAVING COUNT(*) > 1)`), 0);
  });

  test('an unknown bib is NULL, never an empty string', () => {
    // Empty strings are not distinct to a unique index, so three blank
    // bibs would collide where three NULLs coexist. This is the reason
    // the CHECK constraint exists and the reason it matters.
    assert.equal(count(db, `SELECT COUNT(*) FROM fct_runner_start WHERE bib_number = ''`), 0);
  });

  test('fct_runner_saved: one row per directed pair, and nobody follows themselves', () => {
    assert.equal(count(db, `
      SELECT COUNT(*) FROM (
        SELECT runner_key, saved_runner_key FROM fct_runner_saved
         GROUP BY runner_key, saved_runner_key HAVING COUNT(*) > 1)`), 0);
    assert.equal(count(db, 'SELECT COUNT(*) FROM fct_runner_saved WHERE runner_key = saved_runner_key'), 0);
  });
});

describe('insert-only history', () => {
  test('a live row is open-ended and a superseded row is closed', () => {
    assert.equal(count(db, `
      SELECT COUNT(*) FROM fct_runner_start
       WHERE (is_current = 1 AND valid_to_utc IS NOT NULL)
          OR (is_current = 0 AND valid_to_utc IS NULL)`), 0);
  });

  test('history is non-trivial — people really did come back and edit', () => {
    // Guards against a snapshot that technically satisfies every rule
    // above by containing no history at all. 18 people produced 29
    // superseded rows; if that ever reads 0, the export is broken.
    const edited = count(db, `
      SELECT COUNT(*) FROM (
        SELECT runner_key FROM fct_runner_start GROUP BY runner_key HAVING COUNT(*) > 1)`);
    assert.ok(edited >= 10, `expected a meaningful edit history, got ${edited} people`);
    assert.ok(count(db, 'SELECT COUNT(*) FROM fct_runner_start WHERE is_current = 0') >= 10);
  });

  test('a superseded row never closes before it opened', () => {
    assert.equal(count(db, `
      SELECT COUNT(*) FROM fct_runner_start
       WHERE valid_to_utc IS NOT NULL AND valid_to_utc < valid_from_utc`), 0);
  });
});

describe('referential integrity', () => {
  test('every fact row points at a runner that exists', () => {
    assert.equal(count(db, `
      SELECT COUNT(*) FROM fct_runner_start f
       WHERE NOT EXISTS (SELECT 1 FROM dim_runner r WHERE r.runner_key = f.runner_key)`), 0);
  });

  test('both sides of every follow exist', () => {
    assert.equal(count(db, `
      SELECT COUNT(*) FROM fct_runner_saved s
       WHERE NOT EXISTS (SELECT 1 FROM dim_runner r WHERE r.runner_key = s.runner_key)
          OR NOT EXISTS (SELECT 1 FROM dim_runner r WHERE r.runner_key = s.saved_runner_key)`), 0);
  });

  test('spectator miles hang off a real start row', () => {
    assert.equal(count(db, `
      SELECT COUNT(*) FROM fct_spectator_mile m
       WHERE NOT EXISTS (SELECT 1 FROM fct_runner_start f
                          WHERE f.runner_start_key = m.runner_start_key)`), 0);
  });

  test('every set dimension key resolves', () => {
    for (const [col, dim, key] of [
      ['color_key', 'dim_color', 'color_key'],
      ['wave_key', 'dim_wave', 'wave_key'],
      ['corral_key', 'dim_corral', 'corral_key'],
      ['transport_key', 'dim_transport', 'transport_key'],
    ]) {
      assert.equal(count(db, `
        SELECT COUNT(*) FROM fct_runner_start f
         WHERE f.${col} IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM ${dim} d WHERE d.${key} = f.${col})`), 0, col);
    }
  });
});

describe('domain rules', () => {
  test('mile markers are 1..26', () => {
    assert.equal(count(db, 'SELECT COUNT(*) FROM fct_spectator_mile WHERE mile_marker NOT BETWEEN 1 AND 26'), 0);
  });

  test('participant_role is runner or spectator', () => {
    assert.equal(count(db, `
      SELECT COUNT(*) FROM fct_runner_start
       WHERE participant_role NOT IN ('runner', 'spectator')`), 0);
  });

  test('goal times are bounded on both ends', () => {
    // 1500s is a 25-minute marathon and 46800s is thirteen hours. Both
    // are wrong rather than surprising, which is the point of a bound:
    // a typo must not produce a projection that reads as authoritative.
    assert.equal(count(db, `
      SELECT COUNT(*) FROM fct_runner_start
       WHERE goal_time_seconds IS NOT NULL
         AND goal_time_seconds NOT BETWEEN 1500 AND 46800`), 0);
  });

  test('a spectator carries no runner-only fields', () => {
    // The role split exists because a spectator is not a runner with
    // missing fields. If these ever become non-zero, the normalisation
    // in parseRunner has stopped running.
    assert.equal(count(db, `
      SELECT COUNT(*) FROM fct_runner_start
       WHERE participant_role = 'spectator'
         AND (bib_number IS NOT NULL OR color_key IS NOT NULL
              OR wave_key IS NOT NULL OR corral_key IS NOT NULL
              OR transport_key IS NOT NULL OR depart_time_local IS NOT NULL)`), 0);
  });

  test('departure times are HH:MM', () => {
    assert.equal(count(db, `
      SELECT COUNT(*) FROM fct_runner_start
       WHERE depart_time_local IS NOT NULL
         AND depart_time_local NOT GLOB '[0-2][0-9]:[0-5][0-9]'`), 0);
  });
});
