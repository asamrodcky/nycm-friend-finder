// The view layer, which is the app's semantic layer.
//
// The API never touches a base table and never writes
// `WHERE is_current = 1` -- nine views carry that. So these views are
// not a convenience, they are where the meaning lives, and they are the
// right place to assert it.
//
// Two of the bugs this project actually shipped were view bugs: a
// complete spectator being told they needed a bib, and an overlap that
// read two unknowns as a match. Both are pinned below.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadSnapshot, count } from './helpers/snapshot.mjs';

let db;
before(() => { db = loadSnapshot(); });

describe('v_runner_start — the roster', () => {
  test('contains current rows only', () => {
    assert.equal(count(db, `
      SELECT COUNT(*) FROM v_runner_start v
        JOIN fct_runner_start f USING (runner_start_key)
       WHERE f.is_current = 0`), 0);
  });

  test('shows every runner exactly once', () => {
    assert.equal(count(db, `
      SELECT COUNT(*) FROM (
        SELECT runner_key FROM v_runner_start GROUP BY runner_key HAVING COUNT(*) > 1)`), 0);
  });

  test('is_complete for a runner means bib, colour, wave and corral', () => {
    assert.equal(count(db, `
      SELECT COUNT(*) FROM v_runner_start
       WHERE participant_role = 'runner' AND is_complete = 1
         AND (bib_number IS NULL OR color_key IS NULL
              OR wave_key IS NULL OR corral_key IS NULL)`), 0);
  });

  test('is_complete for a spectator means a mile, and nothing else', () => {
    // The whole point of the role split: a spectator with a mile is
    // complete WITHOUT a bib. If this fails, the model has gone back to
    // treating them as runners with missing fields.
    assert.equal(count(db, `
      SELECT COUNT(*) FROM v_runner_start
       WHERE participant_role = 'spectator' AND is_complete = 1
         AND spectator_miles IS NULL`), 0);
  });
});

describe('v_roster_gaps — who is still missing something', () => {
  test('a complete spectator is never listed', () => {
    // THE REGRESSION TEST FOR A REAL BUG. A spectator who had filled in
    // everything asked of them still appeared under "still missing
    // info", because this view inherited its filter from a time when
    // everyone was a runner. Found by reading the rendered page, not by
    // grepping for which views mention the column -- this view does not
    // mention participant_role at all, it only inherits from something
    // that does.
    assert.equal(count(db, `
      SELECT COUNT(*) FROM v_roster_gaps g
        JOIN v_runner_start v USING (display_name)
       WHERE v.participant_role = 'spectator' AND v.is_complete = 1`), 0);
  });

  test('a spectator is never asked for transport', () => {
    // Every transport option is a way to reach the Staten Island start.
    // Somebody watching at mile 18 in Manhattan is not "getting to the
    // start", so asking was the same mistake in a new place.
    assert.equal(count(db, `
      SELECT COUNT(*) FROM v_roster_gaps g
        JOIN v_runner_start v USING (display_name)
       WHERE v.participant_role = 'spectator' AND g.missing LIKE '%transport%'`), 0);
  });

  test('a runner with no transport IS still chased for it', () => {
    // The mirror of the test above. Narrowing the view until it reports
    // nothing would pass both of the previous assertions, so this one
    // makes sure it still does its job.
    const runnersMissingTransport = count(db, `
      SELECT COUNT(*) FROM v_runner_start
       WHERE participant_role = 'runner' AND transport_key IS NULL`);
    if (runnersMissingTransport === 0) return;      // nothing to assert against
    assert.ok(count(db, `SELECT COUNT(*) FROM v_roster_gaps WHERE missing LIKE '%transport%'`) > 0,
      'runners without transport exist but none are listed in the gaps view');
  });
});

describe('v_saved_overlap — NULL safety', () => {
  // `NULL = NULL` is NULL, not true. The guards exist so that two people
  // who have both left a field blank are not reported as sharing it --
  // the version of this code without them was wrong in a way that
  // looked right.
  for (const [label, flag, field] of [
    ['corral',          'same_corral',  'corral_letter'],
    ['wave',            'same_wave',    'wave_num'],
    ['village',         'same_village', 'color_name'],
    ['departure slot',  'same_slot',    'depart_time_local'],
    ['vehicle',         'same_vehicle', 'transport_label'],
  ]) {
    test(`two unknown ${label}s never read as a match`, () => {
      assert.equal(count(db, `SELECT COUNT(*) FROM v_saved_overlap
                               WHERE ${flag} = 1 AND ${field} IS NULL`), 0);
    });
  }

  test('a vague transport option never counts as a shared ride', () => {
    // "Bus - not sure which" and "Have my own transportation" are
    // legitimate answers that imply no meetup. is_matchable = 0 keeps
    // them out rather than inventing a match.
    assert.equal(count(db, `
      SELECT COUNT(*) FROM v_saved_overlap o
        JOIN v_runner_start v ON v.runner_key = o.saved_runner_key
        JOIN dim_transport d ON d.transport_key = v.transport_key
       WHERE o.same_vehicle = 1 AND d.is_matchable = 0`), 0);
  });

  test('drops follows whose target has left the roster, and only those', () => {
    // 50 follow edges, 49 rows in the view. The difference is one
    // person who followed somebody who later removed themselves: the
    // view inner-joins v_runner_start twice, and that holds current
    // rows only. Correct, but exactly the kind of silent row loss worth
    // pinning so it stays deliberate.
    const edges = count(db, 'SELECT COUNT(*) FROM fct_runner_saved');
    const dropped = count(db, `
      SELECT COUNT(*) FROM fct_runner_saved s
       WHERE NOT EXISTS (SELECT 1 FROM v_runner_start v WHERE v.runner_key = s.runner_key)
          OR NOT EXISTS (SELECT 1 FROM v_runner_start v WHERE v.runner_key = s.saved_runner_key)`);
    assert.equal(count(db, 'SELECT COUNT(*) FROM v_saved_overlap'), edges - dropped);
  });
});

describe('v_meetup_* — the discovery tiers', () => {
  for (const view of ['v_meetup_corral', 'v_meetup_wave', 'v_meetup_transport', 'v_meetup_vehicle']) {
    test(`${view} never reports a group of one`, () => {
      // A "meetup" of one person is not a meetup. Every tier carries
      // HAVING COUNT(*) >= 2 for this reason.
      assert.equal(count(db, `SELECT COUNT(*) FROM ${view} WHERE runner_count < 2`), 0);
    });
  }

  test('v_meetup_transport excludes the vague options entirely', () => {
    assert.equal(count(db, `
      SELECT COUNT(*) FROM v_meetup_transport t
        JOIN dim_transport d USING (transport_key)
       WHERE d.is_matchable = 0`), 0);
  });

  test('v_meetup_transport requires a departure time; v_meetup_vehicle does not', () => {
    // The two tiers differ by exactly this, which is what stops "we are
    // both on a ferry" -- a span of four and a half hours -- from
    // masquerading as a real match.
    assert.equal(count(db, 'SELECT COUNT(*) FROM v_meetup_transport WHERE depart_time_local IS NULL'), 0);
  });
});

describe('v_start_assignment — the form lookup', () => {
  test('is the full cross product of colour, wave and corral', () => {
    const [c, w, cr] = ['dim_color', 'dim_wave', 'dim_corral']
      .map(t => count(db, `SELECT COUNT(*) FROM ${t}`));
    assert.equal(count(db, 'SELECT COUNT(*) FROM v_start_assignment'), c * w * cr);
  });
});
