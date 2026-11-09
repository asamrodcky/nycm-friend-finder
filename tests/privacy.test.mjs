// The committed snapshot must never contain a real identity.
//
// snapshots/nycm2026-anon.sql is in git and will be public when the repo
// is. It came from a database that once held 73 real names, 62 bib
// numbers and 39 Instagram handles -- and a display name plus a bib is a
// lookup key, because race results are public.
//
// These tests cannot check against the real values: the list of them is
// gitignored, and a test that needed it could not run in CI. So they
// assert SHAPE instead -- every name must look synthetic, every bib must
// sit in the synthetic range, and the fields with no safe fake value
// must be empty. That is a property anyone can verify from a clean
// clone, which is the only kind of check worth having here.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadSnapshot, count, rows, SNAPSHOT } from './helpers/snapshot.mjs';

let db, raw;
before(() => { db = loadSnapshot(); raw = readFileSync(SNAPSHOT, 'utf8'); });

describe('identities', () => {
  test('every display name is a synthetic alias', () => {
    const bad = rows(db, `SELECT runner_key FROM dim_runner WHERE display_name NOT GLOB 'Runner [0-9][0-9][0-9]'`);
    assert.equal(bad.length, 0, `${bad.length} name(s) are not of the form "Runner NNN"`);
  });

  test('aliases are stable and unique — one per runner', () => {
    assert.equal(count(db, 'SELECT COUNT(DISTINCT display_name) FROM dim_runner'),
                 count(db, 'SELECT COUNT(*) FROM dim_runner'));
  });

  test('every bib sits in the synthetic range', () => {
    // 90000+ is clear of every real bib on this roster, checked at the
    // time: none fell in 90001-90073 and none was a substring of one.
    assert.equal(count(db, `
      SELECT COUNT(*) FROM fct_runner_start
       WHERE bib_number IS NOT NULL AND bib_number NOT GLOB '9[0-9][0-9][0-9][0-9]'`), 0);
  });

  test('no Instagram handle survives', () => {
    // Nulled rather than faked, and this is the reason: the roster card
    // links to instagram.com/<handle>, so any invented handle is a
    // plausible real account. There is no safe fake value for a field
    // that is a URL to a person.
    assert.equal(count(db, 'SELECT COUNT(*) FROM dim_runner WHERE instagram IS NOT NULL'), 0);
  });

  test('no first or last name survives', () => {
    assert.equal(count(db, `
      SELECT COUNT(*) FROM dim_runner
       WHERE first_name IS NOT NULL OR last_name IS NOT NULL`), 0);
  });

  test('no PIN material survives', () => {
    assert.equal(count(db, `
      SELECT COUNT(*) FROM dim_runner
       WHERE pin_hash IS NOT NULL OR pin_salt IS NOT NULL`), 0);
  });
});

describe('the file itself', () => {
  test('carries no table that was dropped by name', () => {
    // auth_throttle holds client IP addresses. The header comment names
    // it as excluded, so this looks for real schema or data rather than
    // any mention of the word.
    for (const t of ['auth_throttle', 'd1_migrations']) {
      assert.ok(!new RegExp(`CREATE\\s+(TABLE|INDEX|VIEW)[^;]*\\b${t}\\b`, 'i').test(raw),
        `${t} is defined in the snapshot`);
      assert.ok(!new RegExp(`INSERT\\s+INTO\\s+"?${t}"?\\b`, 'i').test(raw),
        `${t} has rows in the snapshot`);
    }
  });

  test('contains nothing shaped like a PBKDF2 hash', () => {
    assert.ok(!/pin_hash\s*,?\s*['"][A-Za-z0-9+/=_-]{16,}/.test(raw));
  });

  test('contains no bib-shaped number outside the synthetic range', () => {
    const quoted = [...raw.matchAll(/'(\d{4,6})'/g)].map(m => m[1]);
    const outside = quoted.filter(v => !/^9\d{4}$/.test(v));
    assert.deepEqual(outside, [], `found ${outside.length} quoted 4-6 digit value(s) outside 9xxxx`);
  });
});

describe('what anonymising deliberately kept', () => {
  // The counterpart to everything above. Anonymisation that also
  // flattened the data would be easy to pass and worthless: these
  // assert that the evidence of real use survived it.
  test('the edit history is intact', () => {
    assert.ok(count(db, 'SELECT COUNT(*) FROM fct_runner_start WHERE is_current = 0') >= 10);
  });

  test('the follow graph is intact', () => {
    assert.ok(count(db, 'SELECT COUNT(*) FROM fct_runner_saved') >= 25);
  });

  test('signup timestamps still span real days', () => {
    const { days } = db.prepare(`
      SELECT CAST(julianday(MAX(claimed_at_utc)) - julianday(MIN(claimed_at_utc)) AS INT) AS days
        FROM dim_runner WHERE claimed_at_utc IS NOT NULL`).get();
    assert.ok(days >= 7, `expected a real signup window, got ${days} days`);
  });

  test('the roster is still unevenly distributed across waves', () => {
    // Real data is lumpy. A uniform distribution would suggest the
    // snapshot had been regenerated from something synthetic.
    const counts = rows(db, `
      SELECT COUNT(*) AS n FROM v_runner_start
       WHERE wave_num IS NOT NULL GROUP BY wave_num`).map(r => r.n);
    assert.ok(counts.length >= 3, 'expected several waves represented');
    assert.ok(Math.max(...counts) > Math.min(...counts), 'wave distribution is suspiciously uniform');
  });

  test('plenty of people left optional fields blank', () => {
    // Real data is incomplete, and that incompleteness is evidence. A
    // perfectly filled roster would suggest fabrication.
    //
    // Deliberately NOT asserted on meetup_note: the snapshot tool nulls
    // every note unconditionally, which is the right default for a tool
    // that may be pointed at a database still holding real ones. The
    // cost is that this export loses the 25-of-69 outfit distribution
    // that production kept -- worth knowing, and the reason this test
    // reads the start fields instead.
    const total = count(db, 'SELECT COUNT(*) FROM v_runner_start');
    for (const field of ['bib_number', 'corral_key', 'transport_key', 'depart_time_local']) {
      const blank = count(db, `SELECT COUNT(*) FROM v_runner_start WHERE ${field} IS NULL`);
      assert.ok(blank > 0 && blank < total,
        `${field}: expected a realistic mix, got ${blank} blank of ${total}`);
    }
  });
});
