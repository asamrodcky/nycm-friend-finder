-- 0001_dims.sql
-- Conformed dimensions for the NYCM Friend Finder star schema.
-- Every dimension here except dim_runner is static seed data: the race
-- structure is fixed by NYRR, so these are known at build time.
--
-- Race: TCS New York City Marathon, Sunday 2026-11-01, Fort Wadsworth, Staten Island.

-- ---------------------------------------------------------------------------
-- dim_color : start village + which deck of the Verrazzano you run on
-- ---------------------------------------------------------------------------
-- NOTE: For 2026 the colors are BLUE, ORANGE, PINK. Green was retired.
-- Bridge decks are corroborated across multiple 2026 course guides
-- (blue + orange upper, pink lower) but NOT from NYRR directly -- their
-- site sits behind a queue during race week. Correct here if your bib
-- or confirmation email disagrees; nothing downstream depends on it.
CREATE TABLE dim_color (
  color_key    INTEGER PRIMARY KEY,
  color_name   TEXT NOT NULL UNIQUE,
  color_hex    TEXT NOT NULL,
  village_name TEXT NOT NULL,
  bridge_level TEXT,
  route_note   TEXT
);

INSERT INTO dim_color (color_key, color_name, color_hex, village_name, bridge_level, route_note) VALUES
  (1, 'Blue',   '#2563eb', 'Blue Start Village',   'Upper level', 'Right-hand lanes, exits 92nd St onto 4th Ave'),
  (2, 'Orange', '#ea580c', 'Orange Start Village', 'Upper level', 'Left-hand lanes of the upper deck'),
  (3, 'Pink',   '#db2777', 'Pink Start Village',   'Lower level', 'No view, but no wind either');

-- ---------------------------------------------------------------------------
-- dim_wave : THE reason start time is not a user input.
-- Start time is fully determined by wave, so it lives here once.
-- ---------------------------------------------------------------------------
CREATE TABLE dim_wave (
  wave_key         INTEGER PRIMARY KEY,
  wave_num         INTEGER NOT NULL UNIQUE,
  start_time_local TEXT NOT NULL,
  corral_open      TEXT NOT NULL,
  corral_close     TEXT NOT NULL,
  wave_label       TEXT NOT NULL
);

INSERT INTO dim_wave (wave_key, wave_num, start_time_local, corral_open, corral_close, wave_label) VALUES
  (1, 1, '09:10', '08:10', '08:45', 'Wave 1 - 9:10 AM'),
  (2, 2, '09:45', '09:05', '09:25', 'Wave 2 - 9:45 AM'),
  (3, 3, '10:20', '09:45', '10:00', 'Wave 3 - 10:20 AM'),
  (4, 4, '10:55', '10:25', '10:40', 'Wave 4 - 10:55 AM'),
  (5, 5, '11:30', '11:00', '11:15', 'Wave 5 - 11:30 AM');

-- ---------------------------------------------------------------------------
-- dim_corral : six corrals per wave
-- ---------------------------------------------------------------------------
CREATE TABLE dim_corral (
  corral_key    INTEGER PRIMARY KEY,
  corral_letter TEXT NOT NULL UNIQUE
);

INSERT INTO dim_corral (corral_key, corral_letter) VALUES
  (1, 'A'), (2, 'B'), (3, 'C'), (4, 'D'), (5, 'E'), (6, 'F');

-- ---------------------------------------------------------------------------
-- dim_transport : how you physically get to Fort Wadsworth
-- ---------------------------------------------------------------------------
-- NOTE: This list is the standard set of options, seeded from secondary
-- sources for the same queue reason as above. Add/remove rows to match
-- what NYRR actually offers you -- the input form builds its dropdown
-- from this table via /api/meta, so edits here need no code change.
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

INSERT INTO dim_transport (transport_key, transport_label, method, origin_name, origin_borough, icon_id, sort_order, is_matchable) VALUES
  (1, 'Staten Island Ferry',     'Ferry', 'Whitehall Terminal',       'Manhattan',     'ferry',   1, 1),
  (2, 'Bus from NY Public Library', 'Bus', '5th Ave & 42nd St',       'Manhattan',     'bus',     2, 1),
  (3, 'Bus from New Jersey',     'Bus',   'New Jersey pickup',        'New Jersey',    'bus',     3, 1),
  (4, 'Charity / team bus',      'Bus',   'Varies by team',           NULL,            'bus',     4, 1),
  (5, 'Own transport / dropoff', 'Own',   'Car or rideshare',         NULL,            'car',     5, 1),
  (6, 'Walking / local',         'Own',   'Staten Island resident',   'Staten Island', 'walk',    6, 1),
  -- partial knowledge, kept honest rather than guessed into precision
  (7, 'Bus - not sure which',    'Bus',   NULL,                       NULL,            'bus',     7, 0),
  (8, 'Still deciding',          'Unknown', NULL,                     NULL,            'unknown', 8, 0);

-- ---------------------------------------------------------------------------
-- dim_runner : the only dimension that grows at runtime.
-- 1:1 with the fact for a single race, but kept separate so it can be
-- conformed across future years (and is where an SCD2 would live).
--
-- display_name is the STORED primary field, not a generated first||last.
-- Most people in a run club are known by one name -- a first name, a
-- nickname, a first name plus an initial -- and there is no last name to
-- split out. first/last stay optional for anyone who wants to give both.
-- ---------------------------------------------------------------------------
CREATE TABLE dim_runner (
  runner_key   INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  first_name   TEXT,
  last_name    TEXT,
  CHECK (length(trim(display_name)) > 0)
);

CREATE INDEX idx_dim_runner_display ON dim_runner (display_name);
