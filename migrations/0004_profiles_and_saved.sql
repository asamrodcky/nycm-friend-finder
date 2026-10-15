-- 0004_profiles_and_saved.sql
--
-- Adds two things: a PIN so a person can re-attach a second device to
-- their own row, and a saved-people list so each person can plan who
-- they actually want to find on race morning.

-- ---------------------------------------------------------------------------
-- PIN on dim_runner.
--
-- The PIN is an IDENTITY mechanism, not a security one: it answers "this
-- is my new phone, re-attach me to my row". A 4-digit PIN behind a
-- shared group password is not meaningfully secret, and everyone in the
-- group can already see the whole roster -- that is the point of the app.
--
-- Still hashed rather than stored plainly, for two reasons: the roster
-- gets exported to snapshots/ and committed, and people reuse PINs
-- elsewhere. PBKDF2-SHA256 with a per-runner salt, done in the Worker.
--
-- Nullable: the 19 imported runners have no PIN until they claim their
-- row, and claiming is how they set one.
-- ---------------------------------------------------------------------------
ALTER TABLE dim_runner ADD COLUMN pin_hash TEXT;
ALTER TABLE dim_runner ADD COLUMN pin_salt TEXT;
ALTER TABLE dim_runner ADD COLUMN claimed_at_utc TEXT;

-- ---------------------------------------------------------------------------
-- fct_runner_saved : the people you want to meet up with.
--
-- This is the model's SECOND factless fact table, and a bridge: a
-- many-to-many between dim_runner and itself, with no measures. It
-- records only that one person wants to find another.
--
-- GRAIN: one row per (saver, saved) pair.
--
-- Unlike fct_runner_start this is NOT insert-only. Unsaving someone is
-- not history worth keeping -- it is a correction, and keeping it would
-- make the snapshot a record of who changed their mind about whom.
-- ---------------------------------------------------------------------------
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

CREATE INDEX idx_saved_by   ON fct_runner_saved (runner_key);
CREATE INDEX idx_saved_whom ON fct_runner_saved (saved_runner_key);

-- ---------------------------------------------------------------------------
-- v_saved_overlap : the actual feature. For each (me, person I saved)
-- pair, HOW do we line up?
--
-- Every comparison is NULL-guarded. In SQL `NULL = NULL` is NULL, not
-- true, so two people who both have no corral must not read as sharing
-- one -- the same trap that would have made every half-filled entry
-- look like a crowd of strangers in v_meetup_corral.
--
-- A view cannot take a parameter, so this holds every pair and the API
-- filters it by runner_key.
-- ---------------------------------------------------------------------------
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

  -- strongest first: same vehicle at the same minute
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

-- ---------------------------------------------------------------------------
-- v_unclaimed_runner : imported people who have not set a PIN yet, for
-- the "already on the roster?" picker on a fresh device.
-- ---------------------------------------------------------------------------
CREATE VIEW v_unclaimed_runner AS
SELECT r.runner_key, r.display_name, v.bib_number, v.color_name, v.wave_num, v.corral_letter
FROM dim_runner r
  LEFT JOIN v_runner_start v ON v.runner_key = r.runner_key
WHERE r.pin_hash IS NULL;
