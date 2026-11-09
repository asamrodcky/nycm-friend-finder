-- NYCM Friend Finder — race-day snapshot
-- taken 2026-11-09T20:15:06.955Z from production D1
--
-- Scrubbed before committing: password hashes, names, instagram handles, bib numbers, meetup notes.
-- Excluded: auth_throttle (operational state, and it holds client IP addresses); d1_migrations (wrangler bookkeeping, rebuilt by `migrations apply`); _cf_KV (Cloudflare internal); _cf_METADATA (Cloudflare internal (local miniflare only)).
-- Names and bib numbers are synthetic. Distributions are real.
--
-- Loads into SQLite, DuckDB or Postgres as-is: sqlite3 new.db < this-file

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

CREATE TABLE dim_color (
  color_key    INTEGER PRIMARY KEY,
  color_name   TEXT NOT NULL UNIQUE,
  color_hex    TEXT NOT NULL,
  village_name TEXT NOT NULL,
  bridge_level TEXT,
  route_note   TEXT
);
CREATE TABLE dim_corral (
  corral_key    INTEGER PRIMARY KEY,
  corral_letter TEXT NOT NULL UNIQUE
);
CREATE TABLE dim_runner (
  runner_key   INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  first_name   TEXT,
  last_name    TEXT, pin_hash TEXT, pin_salt TEXT, claimed_at_utc TEXT, instagram TEXT,
  CHECK (length(trim(display_name)) > 0)
);
CREATE TABLE dim_transport (
  transport_key    INTEGER PRIMARY KEY,
  transport_label  TEXT NOT NULL UNIQUE,
  method           TEXT NOT NULL,
  origin_name      TEXT,
  origin_borough   TEXT,
  icon_id          TEXT NOT NULL,
  sort_order       INTEGER NOT NULL,
  -- 0 = too vague to imply a meetup. Two people who both said only
  -- "a bus" are not necessarily on the same bus, so these are excluded
  -- from v_meetup_transport to avoid inventing false matches.
  is_matchable     INTEGER NOT NULL DEFAULT 1 CHECK (is_matchable IN (0, 1))
);
CREATE TABLE dim_wave (
  wave_key         INTEGER PRIMARY KEY,
  wave_num         INTEGER NOT NULL UNIQUE,
  start_time_local TEXT NOT NULL,
  corral_open      TEXT NOT NULL,
  corral_close     TEXT NOT NULL,
  wave_label       TEXT NOT NULL
);
CREATE TABLE fct_runner_saved (
  saved_key        INTEGER PRIMARY KEY AUTOINCREMENT,

  -- who is doing the saving
  runner_key       INTEGER NOT NULL REFERENCES dim_runner (runner_key),
  -- who they saved
  saved_runner_key INTEGER NOT NULL REFERENCES dim_runner (runner_key),

  created_at_utc   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

  -- saving someone twice is a no-op, not two rows
  UNIQUE (runner_key, saved_runner_key),
  -- you are already going to find yourself
  CHECK (runner_key <> saved_runner_key)
);
CREATE TABLE fct_runner_start (
  runner_start_key  INTEGER PRIMARY KEY AUTOINCREMENT,

  -- degenerate dimension: a real-world identifier with no attributes of
  -- its own worth a table, so it rides along on the fact.
  -- Nullable: bibs are not assigned until a few weeks out.
  bib_number        TEXT,

  -- the only required dimension -- a row with no runner means nothing
  runner_key        INTEGER NOT NULL REFERENCES dim_runner (runner_key),

  -- all optional: filled in as people learn them
  color_key         INTEGER REFERENCES dim_color (color_key),
  wave_key          INTEGER REFERENCES dim_wave (wave_key),
  corral_key        INTEGER REFERENCES dim_corral (corral_key),
  transport_key     INTEGER REFERENCES dim_transport (transport_key),

  -- assigned ferry/bus departure slot, 'HH:MM' 24-hour. The single most
  -- useful field for an actual meetup: method alone spreads eight
  -- friends across a three-hour window.
  depart_time_local TEXT,

  -- deliberately unmodellable: "orange poncho, by the Starbucks"
  meetup_note       TEXT,

  -- type-2 bookkeeping
  is_current        INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  valid_from_utc    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  valid_to_utc      TEXT,
  created_at_utc    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), participant_role TEXT NOT NULL DEFAULT 'runner'
  CHECK (participant_role IN ('runner', 'spectator')), goal_time_seconds INTEGER
  CHECK (goal_time_seconds IS NULL OR (goal_time_seconds BETWEEN 1500 AND 46800)), has_sign    INTEGER NOT NULL DEFAULT 0 CHECK (has_sign    IN (0, 1)), has_support INTEGER NOT NULL DEFAULT 0 CHECK (has_support IN (0, 1)),

  -- An unknown bib must be NULL, never ''. Empty strings are NOT
  -- distinct to a unique index, so three blank bibs would collide on
  -- idx_fct_current_bib below; three NULL bibs coexist fine.
  CHECK (bib_number IS NULL OR length(trim(bib_number)) > 0),

  -- 'HH:MM', 24-hour
  CHECK (depart_time_local IS NULL OR depart_time_local GLOB '[0-2][0-9]:[0-5][0-9]'),

  -- a live row must be open-ended; a superseded row must be closed
  CHECK ((is_current = 1 AND valid_to_utc IS NULL)
      OR (is_current = 0 AND valid_to_utc IS NOT NULL))
);
CREATE TABLE fct_spectator_mile (
  runner_start_key INTEGER NOT NULL REFERENCES fct_runner_start (runner_start_key),
  mile_marker      INTEGER NOT NULL CHECK (mile_marker BETWEEN 1 AND 26),
  PRIMARY KEY (runner_start_key, mile_marker)
) WITHOUT ROWID;

-- dim_color: 3 rows
INSERT INTO "dim_color" ("color_key", "color_name", "color_hex", "village_name", "bridge_level", "route_note") VALUES (1, 'Blue', '#2563eb', 'Blue Start Village', 'Upper level', 'Right-hand lanes, exits 92nd St onto 4th Ave');
INSERT INTO "dim_color" ("color_key", "color_name", "color_hex", "village_name", "bridge_level", "route_note") VALUES (2, 'Orange', '#ea580c', 'Orange Start Village', 'Upper level', 'Left-hand lanes of the upper deck');
INSERT INTO "dim_color" ("color_key", "color_name", "color_hex", "village_name", "bridge_level", "route_note") VALUES (3, 'Pink', '#db2777', 'Pink Start Village', 'Lower level', 'No view, but no wind either');

-- dim_wave: 5 rows
INSERT INTO "dim_wave" ("wave_key", "wave_num", "start_time_local", "corral_open", "corral_close", "wave_label") VALUES (1, 1, '09:10', '08:10', '08:45', 'Wave 1 - 9:10 AM');
INSERT INTO "dim_wave" ("wave_key", "wave_num", "start_time_local", "corral_open", "corral_close", "wave_label") VALUES (2, 2, '09:45', '09:05', '09:25', 'Wave 2 - 9:45 AM');
INSERT INTO "dim_wave" ("wave_key", "wave_num", "start_time_local", "corral_open", "corral_close", "wave_label") VALUES (3, 3, '10:20', '09:45', '10:00', 'Wave 3 - 10:20 AM');
INSERT INTO "dim_wave" ("wave_key", "wave_num", "start_time_local", "corral_open", "corral_close", "wave_label") VALUES (4, 4, '10:55', '10:25', '10:40', 'Wave 4 - 10:55 AM');
INSERT INTO "dim_wave" ("wave_key", "wave_num", "start_time_local", "corral_open", "corral_close", "wave_label") VALUES (5, 5, '11:30', '11:00', '11:15', 'Wave 5 - 11:30 AM');

-- dim_corral: 6 rows
INSERT INTO "dim_corral" ("corral_key", "corral_letter") VALUES (1, 'A');
INSERT INTO "dim_corral" ("corral_key", "corral_letter") VALUES (2, 'B');
INSERT INTO "dim_corral" ("corral_key", "corral_letter") VALUES (3, 'C');
INSERT INTO "dim_corral" ("corral_key", "corral_letter") VALUES (4, 'D');
INSERT INTO "dim_corral" ("corral_key", "corral_letter") VALUES (5, 'E');
INSERT INTO "dim_corral" ("corral_key", "corral_letter") VALUES (6, 'F');

-- dim_transport: 7 rows
INSERT INTO "dim_transport" ("transport_key", "transport_label", "method", "origin_name", "origin_borough", "icon_id", "sort_order", "is_matchable") VALUES (1, 'Staten Island Ferry', 'Ferry', 'Whitehall Terminal', 'Manhattan', 'ferry', 1, 1);
INSERT INTO "dim_transport" ("transport_key", "transport_label", "method", "origin_name", "origin_borough", "icon_id", "sort_order", "is_matchable") VALUES (2, 'Midtown Bus (NYPL)', 'Bus', 'NY Public Library, 5th Ave & 42nd St', 'Manhattan', 'bus', 3, 1);
INSERT INTO "dim_transport" ("transport_key", "transport_label", "method", "origin_name", "origin_borough", "icon_id", "sort_order", "is_matchable") VALUES (3, 'New Jersey Bus (Meadowlands)', 'Bus', 'Meadowlands', 'New Jersey', 'bus', 2, 1);
INSERT INTO "dim_transport" ("transport_key", "transport_label", "method", "origin_name", "origin_borough", "icon_id", "sort_order", "is_matchable") VALUES (4, 'Charity / team bus', 'Bus', 'Varies by team', NULL, 'bus', 5, 1);
INSERT INTO "dim_transport" ("transport_key", "transport_label", "method", "origin_name", "origin_borough", "icon_id", "sort_order", "is_matchable") VALUES (5, 'Have My Own Transportation', 'Own', NULL, NULL, 'car', 4, 0);
INSERT INTO "dim_transport" ("transport_key", "transport_label", "method", "origin_name", "origin_borough", "icon_id", "sort_order", "is_matchable") VALUES (7, 'Bus - not sure which', 'Bus', NULL, NULL, 'bus', 6, 0);
INSERT INTO "dim_transport" ("transport_key", "transport_label", "method", "origin_name", "origin_borough", "icon_id", "sort_order", "is_matchable") VALUES (8, 'Still deciding', 'Unknown', NULL, NULL, 'unknown', 7, 0);

-- dim_runner: 73 rows
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (1, 'Runner 001', NULL, NULL, NULL, NULL, '2026-10-15T19:58:59Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (2, 'Runner 002', NULL, NULL, NULL, NULL, '2026-10-15T20:26:41Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (3, 'Runner 003', NULL, NULL, NULL, NULL, '2026-10-15T20:30:07Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (4, 'Runner 004', NULL, NULL, NULL, NULL, '2026-10-15T21:00:24Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (5, 'Runner 005', NULL, NULL, NULL, NULL, '2026-10-15T21:04:08Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (6, 'Runner 006', NULL, NULL, NULL, NULL, '2026-10-15T21:07:17Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (7, 'Runner 007', NULL, NULL, NULL, NULL, '2026-10-15T21:25:36Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (8, 'Runner 008', NULL, NULL, NULL, NULL, '2026-10-15T21:26:14Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (9, 'Runner 009', NULL, NULL, NULL, NULL, '2026-10-15T21:29:22Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (10, 'Runner 010', NULL, NULL, NULL, NULL, '2026-10-15T21:31:30Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (11, 'Runner 011', NULL, NULL, NULL, NULL, '2026-10-15T21:31:31Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (12, 'Runner 012', NULL, NULL, NULL, NULL, '2026-10-15T21:36:20Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (13, 'Runner 013', NULL, NULL, NULL, NULL, '2026-10-15T21:39:12Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (14, 'Runner 014', NULL, NULL, NULL, NULL, '2026-10-15T21:43:34Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (15, 'Runner 015', NULL, NULL, NULL, NULL, '2026-10-15T21:47:55Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (16, 'Runner 016', NULL, NULL, NULL, NULL, '2026-10-15T21:55:15Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (17, 'Runner 017', NULL, NULL, NULL, NULL, '2026-10-15T21:55:23Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (18, 'Runner 018', NULL, NULL, NULL, NULL, '2026-10-16T02:39:34Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (19, 'Runner 019', NULL, NULL, NULL, NULL, '2026-10-16T06:40:55Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (20, 'Runner 020', NULL, NULL, NULL, NULL, '2026-10-16T14:40:25Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (21, 'Runner 021', NULL, NULL, NULL, NULL, '2026-10-20T16:39:18Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (22, 'Runner 022', NULL, NULL, NULL, NULL, '2026-10-25T01:11:44Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (23, 'Runner 023', NULL, NULL, NULL, NULL, '2026-10-26T16:56:45Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (24, 'Runner 024', NULL, NULL, NULL, NULL, '2026-10-28T19:52:45Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (25, 'Runner 025', NULL, NULL, NULL, NULL, '2026-10-29T14:03:30Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (26, 'Runner 026', NULL, NULL, NULL, NULL, '2026-10-29T14:26:45Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (27, 'Runner 027', NULL, NULL, NULL, NULL, '2026-10-29T14:39:12Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (28, 'Runner 028', NULL, NULL, NULL, NULL, '2026-10-29T14:44:46Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (29, 'Runner 029', NULL, NULL, NULL, NULL, '2026-10-29T14:46:33Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (30, 'Runner 030', NULL, NULL, NULL, NULL, '2026-10-29T14:55:21Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (31, 'Runner 031', NULL, NULL, NULL, NULL, '2026-10-29T15:20:04Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (32, 'Runner 032', NULL, NULL, NULL, NULL, '2026-10-29T15:23:36Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (33, 'Runner 033', NULL, NULL, NULL, NULL, '2026-10-29T15:27:06Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (34, 'Runner 034', NULL, NULL, NULL, NULL, '2026-10-29T15:33:12Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (35, 'Runner 035', NULL, NULL, NULL, NULL, '2026-10-29T15:34:29Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (36, 'Runner 036', NULL, NULL, NULL, NULL, '2026-10-29T15:34:59Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (37, 'Runner 037', NULL, NULL, NULL, NULL, '2026-10-29T15:35:04Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (38, 'Runner 038', NULL, NULL, NULL, NULL, '2026-10-29T15:41:33Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (39, 'Runner 039', NULL, NULL, NULL, NULL, '2026-10-29T15:57:53Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (40, 'Runner 040', NULL, NULL, NULL, NULL, '2026-10-29T16:02:57Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (41, 'Runner 041', NULL, NULL, NULL, NULL, '2026-10-29T16:04:26Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (42, 'Runner 042', NULL, NULL, NULL, NULL, '2026-10-29T16:04:51Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (43, 'Runner 043', NULL, NULL, NULL, NULL, '2026-10-29T16:08:40Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (44, 'Runner 044', NULL, NULL, NULL, NULL, '2026-10-29T16:29:40Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (45, 'Runner 045', NULL, NULL, NULL, NULL, '2026-10-29T16:47:38Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (46, 'Runner 046', NULL, NULL, NULL, NULL, '2026-10-29T17:18:24Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (47, 'Runner 047', NULL, NULL, NULL, NULL, '2026-10-29T17:58:37Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (48, 'Runner 048', NULL, NULL, NULL, NULL, '2026-10-29T18:03:30Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (49, 'Runner 049', NULL, NULL, NULL, NULL, '2026-10-29T18:19:53Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (50, 'Runner 050', NULL, NULL, NULL, NULL, '2026-10-29T19:12:53Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (51, 'Runner 051', NULL, NULL, NULL, NULL, '2026-10-29T20:18:55Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (52, 'Runner 052', NULL, NULL, NULL, NULL, '2026-10-29T21:40:00Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (53, 'Runner 053', NULL, NULL, NULL, NULL, '2026-10-29T23:08:24Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (54, 'Runner 054', NULL, NULL, NULL, NULL, '2026-10-29T23:16:58Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (55, 'Runner 055', NULL, NULL, NULL, NULL, '2026-10-29T23:17:45Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (56, 'Runner 056', NULL, NULL, NULL, NULL, '2026-10-29T23:30:37Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (57, 'Runner 057', NULL, NULL, NULL, NULL, '2026-10-30T01:53:32Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (58, 'Runner 058', NULL, NULL, NULL, NULL, '2026-10-30T02:37:37Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (59, 'Runner 059', NULL, NULL, NULL, NULL, '2026-10-30T02:52:02Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (60, 'Runner 060', NULL, NULL, NULL, NULL, '2026-10-30T03:19:00Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (61, 'Runner 061', NULL, NULL, NULL, NULL, '2026-10-30T05:39:24Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (62, 'Runner 062', NULL, NULL, NULL, NULL, '2026-10-30T12:33:34Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (63, 'Runner 063', NULL, NULL, NULL, NULL, '2026-10-30T13:03:20Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (64, 'Runner 064', NULL, NULL, NULL, NULL, '2026-10-30T15:35:04Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (65, 'Runner 065', NULL, NULL, NULL, NULL, '2026-10-30T16:51:54Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (66, 'Runner 066', NULL, NULL, NULL, NULL, '2026-10-31T02:34:47Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (67, 'Runner 067', NULL, NULL, NULL, NULL, '2026-10-31T02:37:53Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (68, 'Runner 068', NULL, NULL, NULL, NULL, '2026-10-31T14:41:58Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (69, 'Runner 069', NULL, NULL, NULL, NULL, '2026-11-01T01:00:52Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (70, 'Runner 070', NULL, NULL, NULL, NULL, '2026-11-01T01:50:02Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (71, 'Runner 071', NULL, NULL, NULL, NULL, '2026-11-01T11:30:52Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (72, 'Runner 072', NULL, NULL, NULL, NULL, '2026-11-01T13:19:24Z', NULL);
INSERT INTO "dim_runner" ("runner_key", "display_name", "first_name", "last_name", "pin_hash", "pin_salt", "claimed_at_utc", "instagram") VALUES (73, 'Runner 073', NULL, NULL, NULL, NULL, '2026-11-01T13:32:29Z', NULL);

-- fct_runner_start: 98 rows
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (1, '90001', 1, 2, 1, 3, 1, '05:30', NULL, 0, '2026-10-15T19:58:59Z', '2026-10-29T05:58:13Z', '2026-10-15T19:58:59Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (2, '90002', 2, 2, 1, 3, 1, '05:30', NULL, 1, '2026-10-15T20:26:41Z', NULL, '2026-10-15T20:26:41Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (3, '90003', 3, 1, 5, 6, 1, '08:00', NULL, 0, '2026-10-15T20:30:07Z', '2026-10-17T17:24:05Z', '2026-10-15T20:30:07Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (4, '90004', 4, 1, 2, 4, 1, '06:00', NULL, 0, '2026-10-15T21:00:24Z', '2026-10-15T21:20:01Z', '2026-10-15T21:00:24Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (5, '90005', 5, 1, 5, 2, 1, '08:00', NULL, 0, '2026-10-15T21:04:08Z', '2026-10-15T21:37:15Z', '2026-10-15T21:04:08Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (6, '90006', 6, 3, 2, 6, 1, '06:15', NULL, 1, '2026-10-15T21:07:17Z', NULL, '2026-10-15T21:07:17Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (7, '90007', 7, 1, 1, 3, 8, NULL, NULL, 1, '2026-10-15T21:25:36Z', NULL, '2026-10-15T21:25:36Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (8, '90008', 8, 1, 2, 4, 1, '06:00', NULL, 1, '2026-10-15T21:26:14Z', NULL, '2026-10-15T21:26:14Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (9, '90009', 9, 1, 3, 5, 1, NULL, NULL, 1, '2026-10-15T21:29:22Z', NULL, '2026-10-15T21:29:22Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (10, '90010', 10, 2, 3, 3, 1, '07:30', NULL, 0, '2026-10-15T21:31:30Z', '2026-10-15T21:32:24Z', '2026-10-15T21:31:30Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (11, '90011', 11, 2, 1, 2, 1, '05:00', NULL, 0, '2026-10-15T21:31:31Z', '2026-10-15T21:37:48Z', '2026-10-15T21:31:31Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (12, '90010', 10, 2, 3, 3, 1, '07:00', NULL, 1, '2026-10-15T21:32:24Z', NULL, '2026-10-15T21:32:24Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (13, '90012', 12, 2, 2, 3, 1, '06:00', NULL, 1, '2026-10-15T21:36:20Z', NULL, '2026-10-15T21:36:20Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (14, '90005', 5, 1, 5, 2, 1, '08:15', NULL, 1, '2026-10-15T21:37:15Z', NULL, '2026-10-15T21:37:15Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (15, '90011', 11, 2, 1, 2, 1, '05:30', NULL, 1, '2026-10-15T21:37:48Z', NULL, '2026-10-15T21:37:48Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (16, '90013', 13, 2, 5, 2, 1, NULL, NULL, 1, '2026-10-15T21:39:12Z', NULL, '2026-10-15T21:39:12Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (17, '90014', 14, 1, 5, 5, 1, '08:00', NULL, 1, '2026-10-15T21:43:34Z', NULL, '2026-10-15T21:43:34Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (18, '90015', 15, 2, 5, 6, 1, NULL, NULL, 0, '2026-10-15T21:47:55Z', '2026-10-29T14:24:16Z', '2026-10-15T21:47:55Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (19, '90016', 16, 1, 1, NULL, 4, NULL, NULL, 1, '2026-10-15T21:55:15Z', NULL, '2026-10-15T21:55:15Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (20, '90017', 17, 3, 4, NULL, 4, '05:00', NULL, 0, '2026-10-15T21:55:23Z', '2026-10-15T21:56:10Z', '2026-10-15T21:55:23Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (21, '90017', 17, 3, 4, 6, 4, '05:00', NULL, 1, '2026-10-15T21:56:10Z', NULL, '2026-10-15T21:56:10Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (22, '90018', 18, 1, 1, 2, 1, '05:00', NULL, 1, '2026-10-16T02:39:34Z', NULL, '2026-10-16T02:39:34Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (23, '90019', 19, 1, 5, 1, 5, '04:45', NULL, 1, '2026-10-16T06:40:55Z', NULL, '2026-10-16T06:40:55Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (24, '90020', 20, 3, 2, NULL, 1, '05:45', NULL, 0, '2026-10-16T14:40:25Z', '2026-10-16T14:40:46Z', '2026-10-16T14:40:25Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (25, '90020', 20, 3, 2, 1, 1, '05:45', NULL, 1, '2026-10-16T14:40:46Z', NULL, '2026-10-16T14:40:46Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (26, '90021', 21, 1, 5, 3, 1, '08:15', NULL, 1, '2026-10-20T16:39:18Z', NULL, '2026-10-20T16:39:18Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (27, '90022', 22, 3, 4, 1, 1, '07:00', NULL, 1, '2026-10-25T01:11:44Z', NULL, '2026-10-25T01:11:44Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (28, '90023', 23, 3, 5, 6, 1, '08:30', NULL, 1, '2026-10-26T16:56:45Z', NULL, '2026-10-26T16:56:45Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (29, '90024', 24, 1, 4, 2, 1, NULL, NULL, 1, '2026-10-28T19:52:45Z', NULL, '2026-10-28T19:52:45Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (30, '90001', 1, 2, 1, 3, 1, '05:30', NULL, 0, '2026-10-29T05:58:13Z', '2026-10-29T05:58:27Z', '2026-10-29T05:58:13Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (31, '90001', 1, 2, 1, 3, 1, '05:30', NULL, 0, '2026-10-29T05:58:27Z', '2026-10-29T05:58:53Z', '2026-10-29T05:58:27Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (32, '90001', 1, 2, 1, 3, 1, '05:30', NULL, 0, '2026-10-29T05:58:53Z', '2026-10-30T16:51:11Z', '2026-10-29T05:58:53Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (33, '90025', 25, 2, 1, 2, 1, '05:00', NULL, 1, '2026-10-29T14:03:30Z', NULL, '2026-10-29T14:03:30Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (34, '90015', 15, 2, 5, 6, 1, '08:00', NULL, 1, '2026-10-29T14:24:16Z', NULL, '2026-10-29T14:24:16Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (35, '90026', 26, 2, 4, 3, 1, '07:15', NULL, 0, '2026-10-29T14:26:45Z', '2026-10-29T14:27:06Z', '2026-10-29T14:26:45Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (36, '90026', 26, 2, 4, 3, 1, '07:15', NULL, 0, '2026-10-29T14:27:06Z', '2026-10-29T14:27:17Z', '2026-10-29T14:27:06Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (37, '90026', 26, 2, 4, 3, 1, '07:15', NULL, 0, '2026-10-29T14:27:17Z', '2026-10-29T14:27:41Z', '2026-10-29T14:27:17Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (38, '90027', 27, 2, 1, 2, 1, '05:30', NULL, 1, '2026-10-29T14:39:12Z', NULL, '2026-10-29T14:39:12Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (39, '90028', 28, 3, 4, 4, 5, '08:00', NULL, 1, '2026-10-29T14:44:46Z', NULL, '2026-10-29T14:44:46Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (40, '90029', 29, 3, 5, 5, 1, '08:30', NULL, 1, '2026-10-29T14:46:33Z', NULL, '2026-10-29T14:46:33Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (41, '90030', 30, 2, 1, 1, 1, '05:00', NULL, 1, '2026-10-29T14:55:21Z', NULL, '2026-10-29T14:55:21Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (42, '90031', 31, 1, 1, 3, 4, '05:30', NULL, 1, '2026-10-29T15:20:04Z', NULL, '2026-10-29T15:20:04Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (43, '90032', 32, 3, 5, 3, NULL, NULL, NULL, 0, '2026-10-29T15:23:36Z', '2026-10-29T15:24:37Z', '2026-10-29T15:23:36Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (44, '90032', 32, 3, 5, 3, NULL, NULL, NULL, 1, '2026-10-29T15:24:37Z', NULL, '2026-10-29T15:24:37Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (45, '90033', 33, 3, 1, 3, 1, '05:30', NULL, 1, '2026-10-29T15:27:06Z', NULL, '2026-10-29T15:27:06Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (46, '90034', 34, 2, 4, 2, 1, '07:15', NULL, 1, '2026-10-29T15:33:12Z', NULL, '2026-10-29T15:33:12Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (47, '90035', 35, 1, 1, 3, 2, NULL, NULL, 0, '2026-10-29T15:34:29Z', '2026-10-29T15:36:41Z', '2026-10-29T15:34:29Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (48, '90036', 36, 1, 3, 4, 1, '06:45', NULL, 1, '2026-10-29T15:34:59Z', NULL, '2026-10-29T15:34:59Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (49, '90037', 37, 3, 1, 2, 7, '06:30', NULL, 1, '2026-10-29T15:35:04Z', NULL, '2026-10-29T15:35:04Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (50, '90035', 35, 1, 1, 3, 2, '05:00', NULL, 1, '2026-10-29T15:36:41Z', NULL, '2026-10-29T15:36:41Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (51, '90038', 38, 1, 5, 1, 1, '08:15', NULL, 1, '2026-10-29T15:41:33Z', NULL, '2026-10-29T15:41:33Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (52, '90039', 39, 3, 5, 1, 1, '05:00', NULL, 0, '2026-10-29T15:57:53Z', '2026-10-29T15:59:52Z', '2026-10-29T15:57:53Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (53, '90039', 39, 3, 4, 1, 1, '05:00', NULL, 0, '2026-10-29T15:59:52Z', '2026-10-29T16:00:14Z', '2026-10-29T15:59:52Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (54, '90039', 39, 3, 4, 1, 1, '05:00', NULL, 0, '2026-10-29T16:00:14Z', '2026-10-29T16:00:22Z', '2026-10-29T16:00:14Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (55, '90039', 39, 3, 4, 1, 1, '05:00', NULL, 1, '2026-10-29T16:00:22Z', NULL, '2026-10-29T16:00:22Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (56, '90040', 40, 2, 3, 2, 1, '06:30', NULL, 1, '2026-10-29T16:02:57Z', NULL, '2026-10-29T16:02:57Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (57, NULL, 41, NULL, NULL, NULL, NULL, NULL, NULL, 0, '2026-10-29T16:04:26Z', '2026-10-29T16:06:28Z', '2026-10-29T16:04:26Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (58, '90042', 42, 2, 5, 4, 1, '08:30', NULL, 1, '2026-10-29T16:04:51Z', NULL, '2026-10-29T16:04:51Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (59, NULL, 41, NULL, NULL, NULL, NULL, NULL, NULL, 1, '2026-10-29T16:06:28Z', NULL, '2026-10-29T16:06:28Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (60, '90043', 43, 1, 2, 5, 1, '06:15', NULL, 1, '2026-10-29T16:08:40Z', NULL, '2026-10-29T16:08:40Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (61, '90044', 44, 1, 1, 3, 1, '05:00', NULL, 1, '2026-10-29T16:29:40Z', NULL, '2026-10-29T16:29:40Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (62, '90045', 45, 3, 5, 2, 1, '08:15', NULL, 1, '2026-10-29T16:47:38Z', NULL, '2026-10-29T16:47:38Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (63, '90046', 46, 1, 1, 3, 2, '05:00', NULL, 1, '2026-10-29T17:18:24Z', NULL, '2026-10-29T17:18:24Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (64, '90047', 47, 1, 1, 2, 4, '05:30', NULL, 0, '2026-10-29T17:58:37Z', '2026-10-29T17:59:07Z', '2026-10-29T17:58:37Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (65, '90047', 47, 1, 1, 2, 4, '05:30', NULL, 1, '2026-10-29T17:59:07Z', NULL, '2026-10-29T17:59:07Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (66, NULL, 48, NULL, NULL, NULL, NULL, NULL, NULL, 1, '2026-10-29T18:03:30Z', NULL, '2026-10-29T18:03:30Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (67, '90049', 49, NULL, NULL, NULL, NULL, NULL, NULL, 0, '2026-10-29T18:19:53Z', '2026-10-29T18:20:32Z', '2026-10-29T18:19:53Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (68, '90049', 49, NULL, NULL, NULL, NULL, NULL, NULL, 0, '2026-10-29T18:20:32Z', '2026-10-29T18:21:02Z', '2026-10-29T18:20:32Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (69, '90050', 50, 3, 1, 5, 1, '05:45', NULL, 1, '2026-10-29T19:12:53Z', NULL, '2026-10-29T19:12:53Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (70, '90051', 51, NULL, 1, 2, 2, NULL, NULL, 0, '2026-10-29T20:18:55Z', '2026-10-29T20:20:19Z', '2026-10-29T20:18:55Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (71, '90051', 51, 1, 1, 2, 2, '05:30', NULL, 1, '2026-10-29T20:20:19Z', NULL, '2026-10-29T20:20:19Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (72, NULL, 52, 1, NULL, NULL, NULL, NULL, NULL, 1, '2026-10-29T21:40:00Z', NULL, '2026-10-29T21:40:00Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (73, '90053', 53, 3, 5, 2, 1, '08:15', NULL, 0, '2026-10-29T23:08:24Z', '2026-10-29T23:09:11Z', '2026-10-29T23:08:24Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (74, '90053', 53, 2, 5, 3, 1, '08:15', NULL, 1, '2026-10-29T23:09:11Z', NULL, '2026-10-29T23:09:11Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (75, '90054', 54, 1, 1, 3, 1, NULL, NULL, 1, '2026-10-29T23:16:58Z', NULL, '2026-10-29T23:16:58Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (76, '90055', 55, 2, 5, 3, 1, '08:30', NULL, 1, '2026-10-29T23:17:45Z', NULL, '2026-10-29T23:17:45Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (77, '90056', 56, 2, 4, 5, 1, '07:30', NULL, 1, '2026-10-29T23:30:37Z', NULL, '2026-10-29T23:30:37Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (78, '90057', 57, 1, 1, 2, 1, '05:00', NULL, 0, '2026-10-30T01:53:32Z', '2026-10-30T01:54:01Z', '2026-10-30T01:53:32Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (79, '90057', 57, 1, 1, 2, 1, '05:00', NULL, 1, '2026-10-30T01:54:01Z', NULL, '2026-10-30T01:54:01Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (80, '90058', 58, 3, 1, 5, 4, '05:15', NULL, 1, '2026-10-30T02:37:37Z', NULL, '2026-10-30T02:37:37Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (81, '90059', 59, 1, 1, 2, 5, '05:00', NULL, 1, '2026-10-30T02:52:02Z', NULL, '2026-10-30T02:52:02Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (82, '90060', 60, 1, 4, 4, 1, '07:30', NULL, 0, '2026-10-30T03:19:00Z', '2026-10-30T03:21:01Z', '2026-10-30T03:19:00Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (83, '90060', 60, 1, 4, 4, 1, '07:30', NULL, 1, '2026-10-30T03:21:01Z', NULL, '2026-10-30T03:21:01Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (84, NULL, 61, 1, 1, 2, 1, NULL, NULL, 1, '2026-10-30T05:39:24Z', NULL, '2026-10-30T05:39:24Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (85, '90062', 62, 3, 5, 5, NULL, NULL, NULL, 1, '2026-10-30T12:33:34Z', NULL, '2026-10-30T12:33:34Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (86, '90063', 63, 3, 4, 2, 1, '07:15', NULL, 1, '2026-10-30T13:03:20Z', NULL, '2026-10-30T13:03:20Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (87, '90064', 64, 1, 3, 5, 4, '05:30', NULL, 1, '2026-10-30T15:35:04Z', NULL, '2026-10-30T15:35:04Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (88, '90001', 1, 2, 1, 3, 1, '05:30', NULL, 0, '2026-10-30T16:51:11Z', '2026-11-01T10:10:49Z', '2026-10-30T16:51:11Z', 'runner', 12600, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (89, '90065', 65, 1, 5, 3, 1, '08:15', NULL, 1, '2026-10-30T16:51:54Z', NULL, '2026-10-30T16:51:54Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (90, '90066', 66, 3, 3, 5, 1, '06:45', NULL, 1, '2026-10-31T02:34:47Z', NULL, '2026-10-31T02:34:47Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (91, '90067', 67, 2, 1, 1, 1, '05:00', NULL, 1, '2026-10-31T02:37:53Z', NULL, '2026-10-31T02:37:53Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (92, '90068', 68, 1, 5, 5, 1, NULL, NULL, 1, '2026-10-31T14:41:58Z', NULL, '2026-10-31T14:41:58Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (93, NULL, 69, NULL, NULL, NULL, NULL, NULL, NULL, 1, '2026-11-01T01:00:52Z', NULL, '2026-11-01T01:00:52Z', 'spectator', NULL, 1, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (94, '90070', 70, 2, 2, 1, 1, '06:30', NULL, 1, '2026-11-01T01:50:02Z', NULL, '2026-11-01T01:50:02Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (95, '90001', 1, 2, 1, 3, 1, '05:30', NULL, 1, '2026-11-01T10:10:49Z', NULL, '2026-11-01T10:10:49Z', 'runner', 12600, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (96, NULL, 71, 1, 2, 4, 1, '07:15', NULL, 1, '2026-11-01T11:30:52Z', NULL, '2026-11-01T11:30:52Z', 'runner', NULL, 0, 0);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (97, NULL, 72, NULL, NULL, NULL, NULL, NULL, NULL, 1, '2026-11-01T13:19:24Z', NULL, '2026-11-01T13:19:24Z', 'spectator', NULL, 0, 1);
INSERT INTO "fct_runner_start" ("runner_start_key", "bib_number", "runner_key", "color_key", "wave_key", "corral_key", "transport_key", "depart_time_local", "meetup_note", "is_current", "valid_from_utc", "valid_to_utc", "created_at_utc", "participant_role", "goal_time_seconds", "has_sign", "has_support") VALUES (98, '90073', 73, 1, 2, 6, 1, NULL, NULL, 1, '2026-11-01T13:32:29Z', NULL, '2026-11-01T13:32:29Z', 'runner', NULL, 0, 0);

-- fct_runner_saved: 50 rows
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (2, 6, 4, '2026-10-15T21:07:26Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (3, 6, 5, '2026-10-15T21:07:34Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (4, 6, 1, '2026-10-15T21:07:35Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (8, 25, 2, '2026-10-29T14:03:52Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (9, 25, 1, '2026-10-29T14:03:59Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (10, 6, 8, '2026-10-29T14:45:02Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (12, 29, 10, '2026-10-29T14:47:23Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (13, 32, 12, '2026-10-29T15:24:01Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (14, 33, 2, '2026-10-29T15:27:17Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (17, 36, 9, '2026-10-29T15:35:26Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (18, 36, 10, '2026-10-29T15:35:30Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (19, 36, 16, '2026-10-29T15:35:50Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (20, 36, 1, '2026-10-29T15:35:54Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (21, 36, 20, '2026-10-29T15:36:01Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (22, 36, 12, '2026-10-29T15:36:04Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (23, 36, 22, '2026-10-29T15:36:08Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (25, 36, 24, '2026-10-29T15:36:15Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (26, 36, 34, '2026-10-29T15:36:17Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (27, 36, 17, '2026-10-29T15:36:20Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (28, 36, 19, '2026-10-29T15:36:21Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (29, 36, 13, '2026-10-29T15:36:26Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (30, 36, 29, '2026-10-29T15:36:32Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (31, 1, 2, '2026-10-29T17:42:57Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (32, 1, 11, '2026-10-29T17:43:02Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (33, 1, 27, '2026-10-29T17:43:04Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (34, 1, 33, '2026-10-29T17:43:12Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (35, 1, 25, '2026-10-29T17:43:15Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (36, 1, 44, '2026-10-29T17:43:17Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (37, 52, 44, '2026-10-29T21:40:10Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (38, 52, 1, '2026-10-29T21:40:26Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (39, 58, 25, '2026-10-30T02:38:13Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (40, 58, 6, '2026-10-30T02:38:48Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (41, 58, 43, '2026-10-30T02:38:50Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (42, 58, 46, '2026-10-30T02:40:30Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (44, 1, 30, '2026-10-30T03:44:15Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (46, 18, 59, '2026-10-31T02:34:52Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (47, 66, 18, '2026-10-31T02:35:04Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (48, 18, 66, '2026-10-31T02:35:20Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (49, 18, 22, '2026-10-31T02:37:19Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (50, 18, 17, '2026-10-31T02:37:26Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (51, 18, 19, '2026-10-31T02:37:27Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (52, 18, 15, '2026-10-31T02:37:37Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (53, 1, 67, '2026-10-31T17:40:17Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (55, 48, 2, '2026-10-31T22:58:27Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (57, 48, 1, '2026-10-31T22:58:33Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (58, 48, 54, '2026-10-31T22:58:47Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (59, 48, 8, '2026-10-31T22:59:30Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (60, 48, 40, '2026-10-31T22:59:36Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (61, 48, 32, '2026-10-31T23:00:00Z');
INSERT INTO "fct_runner_saved" ("saved_key", "runner_key", "saved_runner_key", "created_at_utc") VALUES (63, 69, 1, '2026-11-01T01:01:35Z');

-- fct_spectator_mile: 3 rows
INSERT INTO "fct_spectator_mile" ("runner_start_key", "mile_marker") VALUES (93, 14);
INSERT INTO "fct_spectator_mile" ("runner_start_key", "mile_marker") VALUES (97, 13);
INSERT INTO "fct_spectator_mile" ("runner_start_key", "mile_marker") VALUES (97, 20);

CREATE INDEX idx_dim_runner_display ON dim_runner (display_name);
CREATE INDEX idx_fct_current     ON fct_runner_start (is_current);
CREATE UNIQUE INDEX idx_fct_current_bib
  ON fct_runner_start (bib_number) WHERE is_current = 1 AND bib_number IS NOT NULL;
CREATE UNIQUE INDEX idx_fct_current_runner
  ON fct_runner_start (runner_key) WHERE is_current = 1;
CREATE INDEX idx_fct_meetup      ON fct_runner_start (transport_key, depart_time_local) WHERE is_current = 1;
CREATE INDEX idx_fct_start_group ON fct_runner_start (color_key, wave_key, corral_key)  WHERE is_current = 1;
CREATE INDEX idx_saved_by   ON fct_runner_saved (runner_key);
CREATE INDEX idx_saved_whom ON fct_runner_saved (saved_runner_key);
CREATE INDEX idx_spectator_mile_marker ON fct_spectator_mile (mile_marker);

CREATE VIEW v_meetup_corral AS
SELECT
  color_key,
  color_name,
  color_hex,
  wave_num,
  start_time_local,
  corral_letter,
  COUNT(*)                         AS runner_count,
  GROUP_CONCAT(display_name, ', ') AS runners
FROM v_runner_start
WHERE color_key     IS NOT NULL
  AND wave_num      IS NOT NULL
  AND corral_letter IS NOT NULL
GROUP BY color_key, color_name, color_hex, wave_num, start_time_local, corral_letter
HAVING COUNT(*) >= 2;
CREATE VIEW v_meetup_transport AS
SELECT
  transport_key,
  transport_label,
  transport_icon,
  transport_origin,
  depart_time_local,
  COUNT(*)                         AS runner_count,
  GROUP_CONCAT(display_name, ', ') AS runners
FROM v_runner_start
WHERE transport_key          IS NOT NULL
  AND depart_time_local      IS NOT NULL
  AND transport_is_matchable = 1
GROUP BY transport_key, transport_label, transport_icon, transport_origin, depart_time_local
HAVING COUNT(*) >= 2;
CREATE VIEW v_meetup_vehicle AS
SELECT
  transport_key,
  transport_label,
  transport_icon,
  transport_origin,
  COUNT(*)                   AS runner_count,
  COUNT(depart_time_local)   AS with_times,
  GROUP_CONCAT(
    display_name || CASE WHEN depart_time_local IS NOT NULL
                         THEN ' (' || depart_time_local || ')' ELSE '' END,
    ', '
  )                          AS runners
FROM v_runner_start
WHERE transport_key          IS NOT NULL
  AND transport_is_matchable = 1
GROUP BY transport_key, transport_label, transport_icon, transport_origin
HAVING COUNT(*) >= 2;
CREATE VIEW v_meetup_wave AS
SELECT
  color_key,
  color_name,
  color_hex,
  wave_num,
  start_time_local,
  village_name,
  COUNT(*)                                        AS runner_count,
  COUNT(DISTINCT corral_letter)                   AS distinct_corrals,
  GROUP_CONCAT(display_name || ' (' || COALESCE(corral_letter, '?') || ')', ', ') AS runners
FROM v_runner_start
WHERE color_key IS NOT NULL
  AND wave_num  IS NOT NULL
GROUP BY color_key, color_name, color_hex, wave_num, start_time_local, village_name
HAVING COUNT(*) >= 2;
CREATE VIEW v_roster_gaps AS
SELECT
  display_name,
  bib_number,
  TRIM(
    CASE WHEN participant_role = 'spectator' THEN
      CASE WHEN spectator_miles IS NULL THEN 'a mile, ' ELSE '' END
    ELSE
      CASE WHEN bib_number    IS NULL THEN 'bib, '    ELSE '' END ||
      CASE WHEN color_key     IS NULL THEN 'color, '  ELSE '' END ||
      CASE WHEN wave_key      IS NULL THEN 'wave, '   ELSE '' END ||
      CASE WHEN corral_key    IS NULL THEN 'corral, ' ELSE '' END ||
      CASE WHEN transport_key IS NULL THEN 'transport, ' ELSE '' END
    END,
    ', '
  ) AS missing
FROM v_runner_start
-- A spectator is listed only when they are genuinely incomplete, which
-- for them means having no mile. The old clause ORed in
-- "transport_key IS NULL", which pulled back in every spectator it had
-- just stopped describing.
WHERE CASE WHEN participant_role = 'spectator'
           THEN is_complete = 0
           ELSE is_complete = 0 OR transport_key IS NULL
      END;
CREATE VIEW v_runner_start AS
SELECT
  f.runner_start_key,
  f.bib_number,
  r.runner_key,
  r.display_name,
  r.first_name,
  r.last_name,
  r.instagram,
  f.participant_role,
  f.goal_time_seconds,
  f.has_sign,
  f.has_support,
  -- Comma-separated rather than a join, because every consumer wants
  -- "this person's miles" as one value attached to the person, and the
  -- alternative is fanning every roster row out per mile and
  -- regrouping it in JavaScript.
  (SELECT group_concat(m.mile_marker)
     FROM fct_spectator_mile m
    WHERE m.runner_start_key = f.runner_start_key) AS spectator_miles,
  c.color_key,
  c.color_name,
  c.color_hex,
  c.village_name,
  c.bridge_level,
  c.route_note,
  w.wave_key,
  w.wave_num,
  w.start_time_local,
  w.corral_open,
  w.corral_close,
  w.wave_label,
  cr.corral_key,
  cr.corral_letter,
  t.transport_key,
  t.transport_label,
  t.method          AS transport_method,
  t.origin_name     AS transport_origin,
  t.origin_borough  AS transport_borough,
  t.icon_id         AS transport_icon,
  t.is_matchable    AS transport_is_matchable,
  f.depart_time_local,
  f.meetup_note,
  -- "Complete" now means different things for the two roles, which is
  -- the whole reason the role exists. A runner needs a bib and a start
  -- assignment. A spectator needs somewhere to be -- asking them for a
  -- corral is what made them look broken.
  CASE
    WHEN f.participant_role = 'spectator' THEN
      CASE WHEN EXISTS (SELECT 1 FROM fct_spectator_mile m
                         WHERE m.runner_start_key = f.runner_start_key)
           THEN 1 ELSE 0 END
    ELSE
      CASE WHEN f.bib_number IS NOT NULL
            AND f.color_key  IS NOT NULL
            AND f.wave_key   IS NOT NULL
            AND f.corral_key IS NOT NULL
           THEN 1 ELSE 0 END
  END AS is_complete,
  f.valid_from_utc,
  f.created_at_utc
FROM fct_runner_start f
  JOIN      dim_runner    r  ON r.runner_key    = f.runner_key
  LEFT JOIN dim_color     c  ON c.color_key     = f.color_key
  LEFT JOIN dim_wave      w  ON w.wave_key      = f.wave_key
  LEFT JOIN dim_corral    cr ON cr.corral_key   = f.corral_key
  LEFT JOIN dim_transport t  ON t.transport_key = f.transport_key
WHERE f.is_current = 1;
CREATE VIEW v_saved_overlap AS
SELECT
  s.runner_key,
  s.saved_runner_key,
  s.created_at_utc           AS saved_at_utc,
  them.display_name,
  them.bib_number,
  them.color_name,
  them.color_hex,
  them.wave_num,
  them.corral_letter,
  them.start_time_local,
  them.village_name,
  them.bridge_level,
  them.transport_label,
  them.transport_icon,
  them.depart_time_local,
  them.meetup_note,
  them.is_complete,
  them.participant_role,
  -- Only exposed through this view, which is the "I follow them" view.
  -- A goal time is a performance disclosure sitting next to a name, a
  -- bib and in 27 cases an Instagram handle, on a roster behind a
  -- passcode ~423 people have now seen (§29). Following somebody is a
  -- relationship; the roster is not. So v_runner_start does carry the
  -- column for the owner's own row, and this is where somebody else
  -- gets to read it.
  them.goal_time_seconds,
  them.spectator_miles,
  them.has_sign,
  them.has_support,
  CASE WHEN me.transport_key     IS NOT NULL AND them.transport_key     IS NOT NULL
        AND me.depart_time_local IS NOT NULL AND them.depart_time_local IS NOT NULL
        AND me.transport_key      = them.transport_key
        AND me.depart_time_local  = them.depart_time_local
        AND me.transport_is_matchable = 1
       THEN 1 ELSE 0 END AS same_slot,
  CASE WHEN me.color_key  IS NOT NULL AND them.color_key  IS NOT NULL
        AND me.wave_key   IS NOT NULL AND them.wave_key   IS NOT NULL
        AND me.corral_key IS NOT NULL AND them.corral_key IS NOT NULL
        AND me.color_key   = them.color_key
        AND me.wave_key    = them.wave_key
        AND me.corral_key  = them.corral_key
       THEN 1 ELSE 0 END AS same_corral,
  CASE WHEN me.color_key IS NOT NULL AND them.color_key IS NOT NULL
        AND me.wave_key  IS NOT NULL AND them.wave_key  IS NOT NULL
        AND me.color_key  = them.color_key
        AND me.wave_key   = them.wave_key
       THEN 1 ELSE 0 END AS same_wave,
  CASE WHEN me.color_key IS NOT NULL AND them.color_key IS NOT NULL
        AND me.color_key  = them.color_key
       THEN 1 ELSE 0 END AS same_village,
  CASE WHEN me.transport_key IS NOT NULL AND them.transport_key IS NOT NULL
        AND me.transport_key  = them.transport_key
        AND me.transport_is_matchable = 1
       THEN 1 ELSE 0 END AS same_vehicle
FROM fct_runner_saved s
  JOIN v_runner_start me   ON me.runner_key   = s.runner_key
  JOIN v_runner_start them ON them.runner_key = s.saved_runner_key;
CREATE VIEW v_start_assignment AS
SELECT
  c.color_key,
  c.color_name,
  w.wave_key,
  w.wave_num,
  w.start_time_local,
  cr.corral_key,
  cr.corral_letter,
  c.color_name || ' - Wave ' || w.wave_num || ' - Corral ' || cr.corral_letter AS assignment_label
FROM dim_color c
  CROSS JOIN dim_wave w
  CROSS JOIN dim_corral cr;
CREATE VIEW v_unclaimed_runner AS
SELECT r.runner_key, r.display_name, v.bib_number, v.color_name, v.wave_num, v.corral_letter
FROM dim_runner r
  LEFT JOIN v_runner_start v ON v.runner_key = r.runner_key
WHERE r.pin_hash IS NULL;

COMMIT;
