// Tests for the tests.
//
// Every assertion in this suite passes against the real data, which on
// its own proves very little: a check that cannot fail is worth nothing,
// and `SELECT COUNT(*) ... WHERE <condition I typo'd>` returns 0 just as
// happily as a correct one.
//
// So each control here deliberately breaks a rule and asserts that the
// thing meant to catch it does. Two kinds:
//
//   1. rules the SCHEMA enforces -- the write must be rejected
//   2. rules the VIEWS express   -- the write succeeds, and the view
//      must then report the problem
//
// Writing these is also how the missing indexes were found. The control
// for "at most one live row per runner" passed when it should have
// failed, because the snapshot carried no indexes at all: the partial
// unique index that enforces the grain had never been exported. The
// control caught what every passing test had missed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadSnapshot, count } from './helpers/snapshot.mjs';

/** A throwaway database, so a deliberate violation cannot affect anything else. */
const scratch = () => loadSnapshot();

/** Asserts the database refuses a write, and that it refuses it for the stated reason. */
function rejects(sql, because) {
  const db = scratch();
  assert.throws(() => db.exec(sql), e => new RegExp(because, 'i').test(e.message),
    `expected the write to be rejected because of ${because}`);
}

describe('the schema rejects what it claims to reject', () => {
  test('a second live row for one runner', () => {
    // The grain depends entirely on this. idx_fct_current_runner is a
    // partial unique index; without it the model's headline claim is
    // just a comment.
    const db = scratch();
    const { runner_key } = db.prepare('SELECT runner_key FROM v_runner_start LIMIT 1').get();
    assert.throws(
      () => db.exec(`INSERT INTO fct_runner_start (runner_key, is_current) VALUES (${runner_key}, 1)`),
      /UNIQUE/i);
  });

  test('a live row that is already closed', () => {
    rejects(`INSERT INTO fct_runner_start (runner_key, is_current, valid_to_utc)
             SELECT runner_key, 1, '2026-01-01T00:00:00Z' FROM dim_runner LIMIT 1`, 'CHECK');
  });

  test('an empty-string bib', () => {
    rejects(`INSERT INTO fct_runner_start (runner_key, bib_number)
             SELECT runner_key, '' FROM dim_runner LIMIT 1`, 'CHECK');
  });

  test('a mile marker outside 1..26', () => {
    rejects(`INSERT INTO fct_spectator_mile (runner_start_key, mile_marker)
             SELECT runner_start_key, 99 FROM fct_runner_start LIMIT 1`, 'CHECK');
  });

  test('following yourself', () => {
    rejects(`INSERT INTO fct_runner_saved (runner_key, saved_runner_key)
             SELECT runner_key, runner_key FROM dim_runner LIMIT 1`, 'CHECK');
  });

  test('a role that is neither runner nor spectator', () => {
    rejects(`INSERT INTO fct_runner_start (runner_key, participant_role)
             SELECT runner_key, 'cyclist' FROM dim_runner LIMIT 1`, 'CHECK');
  });

  test('a 10-second marathon', () => {
    rejects(`INSERT INTO fct_runner_start (runner_key, goal_time_seconds)
             SELECT runner_key, 10 FROM dim_runner LIMIT 1`, 'CHECK');
  });

  test('a departure time of 25:99', () => {
    rejects(`INSERT INTO fct_runner_start (runner_key, depart_time_local)
             SELECT runner_key, '25:99' FROM dim_runner LIMIT 1`, 'CHECK');
  });

  test('a fact row pointing at a runner who does not exist', () => {
    rejects('INSERT INTO fct_runner_start (runner_key) VALUES (999999)', 'FOREIGN KEY');
  });
});

describe('the views report what they claim to report', () => {
  test('a spectator with no mile IS listed as missing one', () => {
    // The positive half of the regression test in views.test.mjs. That
    // one proves a COMPLETE spectator is not listed; without this one it
    // would also pass if the view had simply stopped reporting anybody.
    const db = scratch();
    db.exec(`INSERT INTO dim_runner (display_name) VALUES ('Runner 900')`);
    db.exec(`INSERT INTO fct_runner_start (runner_key, participant_role)
             SELECT runner_key, 'spectator' FROM dim_runner WHERE display_name = 'Runner 900'`);

    const gap = db.prepare(`SELECT missing FROM v_roster_gaps WHERE display_name = 'Runner 900'`).get();
    assert.ok(gap, 'a spectator with no mile should appear in the gaps view');
    assert.match(gap.missing, /mile/, 'they should be told a mile is what is missing');
    assert.doesNotMatch(gap.missing, /bib|corral|transport/,
      'and never told to supply a bib, a corral or a way to the start');
  });

  test('a runner missing a bib IS listed as missing one', () => {
    const db = scratch();
    db.exec(`INSERT INTO dim_runner (display_name) VALUES ('Runner 901')`);
    db.exec(`INSERT INTO fct_runner_start (runner_key, participant_role)
             SELECT runner_key, 'runner' FROM dim_runner WHERE display_name = 'Runner 901'`);

    const gap = db.prepare(`SELECT missing FROM v_roster_gaps WHERE display_name = 'Runner 901'`).get();
    assert.ok(gap, 'an empty runner should appear in the gaps view');
    assert.match(gap.missing, /bib/);
  });

  test('a superseded row disappears from the roster view', () => {
    const db = scratch();
    const before = count(db, 'SELECT COUNT(*) FROM v_runner_start');
    const { runner_start_key } = db.prepare('SELECT runner_start_key FROM v_runner_start LIMIT 1').get();
    db.exec(`UPDATE fct_runner_start
                SET is_current = 0, valid_to_utc = '2026-11-02T00:00:00Z'
              WHERE runner_start_key = ${runner_start_key}`);
    assert.equal(count(db, 'SELECT COUNT(*) FROM v_runner_start'), before - 1);
  });

  test('two blank corrals do not become a match', () => {
    // The NULL-safety assertions pass on real data partly because few
    // rows have blank corrals. This forces the case.
    const db = scratch();
    const pair = db.prepare(`
      SELECT runner_key, saved_runner_key FROM fct_runner_saved LIMIT 1`).get();
    db.exec(`UPDATE fct_runner_start SET corral_key = NULL
              WHERE is_current = 1 AND runner_key IN (${pair.runner_key}, ${pair.saved_runner_key})`);
    assert.equal(count(db, `
      SELECT COUNT(*) FROM v_saved_overlap
       WHERE runner_key = ${pair.runner_key}
         AND saved_runner_key = ${pair.saved_runner_key}
         AND same_corral = 1`), 0);
  });

  test('a meetup tier never surfaces a lone person', () => {
    // Give somebody a unique colour/wave/corral combination and confirm
    // they do not appear as a "meetup" of one.
    const db = scratch();
    db.exec(`INSERT INTO dim_corral (corral_key, corral_letter) VALUES (99, 'Z')`);
    db.exec(`UPDATE fct_runner_start SET corral_key = 99
              WHERE runner_start_key = (SELECT runner_start_key FROM v_runner_start
                                         WHERE corral_letter IS NOT NULL LIMIT 1)`);
    assert.equal(count(db, `SELECT COUNT(*) FROM v_meetup_corral WHERE corral_letter = 'Z'`), 0);
  });
});

describe('the privacy checks detect a leak', () => {
  test('a non-synthetic display name is caught', () => {
    const db = scratch();
    db.exec(`UPDATE dim_runner SET display_name = 'Jane Doe'
              WHERE runner_key = (SELECT MIN(runner_key) FROM dim_runner)`);
    assert.ok(count(db, `SELECT COUNT(*) FROM dim_runner WHERE display_name NOT GLOB 'Runner [0-9][0-9][0-9]'`) > 0);
  });

  test('a bib outside the synthetic range is caught', () => {
    const db = scratch();
    db.exec(`UPDATE fct_runner_start SET bib_number = '12345'
              WHERE runner_start_key = (SELECT MIN(runner_start_key) FROM fct_runner_start
                                         WHERE bib_number IS NOT NULL)`);
    assert.ok(count(db, `
      SELECT COUNT(*) FROM fct_runner_start
       WHERE bib_number IS NOT NULL AND bib_number NOT GLOB '9[0-9][0-9][0-9][0-9]'`) > 0);
  });

  test('a restored Instagram handle is caught', () => {
    const db = scratch();
    db.exec(`UPDATE dim_runner SET instagram = 'someones_handle'
              WHERE runner_key = (SELECT MIN(runner_key) FROM dim_runner)`);
    assert.ok(count(db, 'SELECT COUNT(*) FROM dim_runner WHERE instagram IS NOT NULL') > 0);
  });
});
