-- 0002_fact.sql
--
-- fct_runner_start is a FACTLESS FACT TABLE. There are no additive
-- measures here: the table exists purely to record the co-occurrence of
-- a runner with a color, a wave, a corral and a transport plan. That is
-- Kimball's "coverage / event" pattern, and it is exactly what this app
-- is -- a record that an assignment exists, not a measurement of it.
--
-- GRAIN: one row per runner per assignment VERSION.
--
-- The table is insert-only (type-2 style). An edit supersedes the prior
-- row rather than updating it, because NYRR explicitly allows moving to
-- a later wave, and the committed snapshot is then a full history of who
-- moved and when. Reads go through v_runner_start, which hides the
-- is_current filter from the API entirely.
--
-- NULLABILITY: everything except the runner is optional. Real sign-up
-- data is partial -- people know their wave before their corral, and
-- know they are taking the ferry before they know anything else. A
-- half-filled row is still useful, so the schema accepts it and
-- v_runner_start reports is_complete instead of dropping the row.

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
  created_at_utc    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

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

-- At most one live row per KNOWN bib. Partial unique index, so
-- superseded history rows are exempt, and NULL bibs are each distinct.
CREATE UNIQUE INDEX idx_fct_current_bib
  ON fct_runner_start (bib_number) WHERE is_current = 1 AND bib_number IS NOT NULL;

-- One live row per runner, which is what actually bounds the roster
-- when bibs are still unknown.
CREATE UNIQUE INDEX idx_fct_current_runner
  ON fct_runner_start (runner_key) WHERE is_current = 1;

CREATE INDEX idx_fct_current     ON fct_runner_start (is_current);
CREATE INDEX idx_fct_meetup      ON fct_runner_start (transport_key, depart_time_local) WHERE is_current = 1;
CREATE INDEX idx_fct_start_group ON fct_runner_start (color_key, wave_key, corral_key)  WHERE is_current = 1;
