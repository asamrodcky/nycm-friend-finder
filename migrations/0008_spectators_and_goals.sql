-- Spectators, goal times and projected mile splits.
--
-- Prompted by the group chat: "what if I am here to spectate" (Kat C).
-- The answer until now was Runner D's -- "just fill it out without a bib" --
-- which puts a spectator on the roster as a card with no colour, no
-- wave and no corral. §29 found three of exactly those and they match
-- nobody and are matched by nobody. A spectator is not a runner with
-- missing fields; they are a different kind of person on race morning.
--
-- ON THE FACT TABLE, NOT THE DIM, and that is the same call §27 made
-- for meetup_note vs instagram. Spectating is a fact about THIS RACE --
-- you can run New York one year and cheer it the next -- so it is
-- versioned along with wave and corral and shows up in the history.
-- A handle is about the person and stays on dim_runner.

ALTER TABLE fct_runner_start ADD COLUMN participant_role TEXT NOT NULL DEFAULT 'runner'
  CHECK (participant_role IN ('runner', 'spectator'));

-- Goal finish, in seconds. Bounded on both ends so a typo cannot
-- produce a projection that reads as authoritative: 1500 is a 25-minute
-- marathon, 46800 is thirteen hours, and both are wrong rather than
-- surprising. NULL is always allowed -- plenty of people do not have a
-- goal, or do not want to say.
ALTER TABLE fct_runner_start ADD COLUMN goal_time_seconds INTEGER
  CHECK (goal_time_seconds IS NULL OR (goal_time_seconds BETWEEN 1500 AND 46800));

-- Runner H, in the same thread: "if you have a sign, cowbell, some
-- other cheer stuff" and "if you are passing out runner support (gels,
-- nerd gummy clusters, hydration)". Two flags rather than free text,
-- because the whole point is to be able to FIND the person handing out
-- gels at mile 18, and you cannot filter on a sentence.
ALTER TABLE fct_runner_start ADD COLUMN has_sign    INTEGER NOT NULL DEFAULT 0 CHECK (has_sign    IN (0, 1));
ALTER TABLE fct_runner_start ADD COLUMN has_support INTEGER NOT NULL DEFAULT 0 CHECK (has_support IN (0, 1));

-- A TABLE, not a column, because Runner H asked for the thing that makes
-- it a table: "option to enter multiple miles if moving around the
-- course". One row per mile somebody plans to be at.
--
-- Keyed on runner_start_key, so it is versioned with the rest of the
-- assignment -- edit your miles and the old set stays attached to the
-- superseded row, same as a wave change.
CREATE TABLE fct_spectator_mile (
  runner_start_key INTEGER NOT NULL REFERENCES fct_runner_start (runner_start_key),
  mile_marker      INTEGER NOT NULL CHECK (mile_marker BETWEEN 1 AND 26),
  PRIMARY KEY (runner_start_key, mile_marker)
) WITHOUT ROWID;

CREATE INDEX idx_spectator_mile_marker ON fct_spectator_mile (mile_marker);

-- SQLite has no ALTER VIEW, so every view touching these columns is
-- dropped and rebuilt. §27 hit this with instagram; the list of
-- dependents has not changed since.
DROP VIEW IF EXISTS v_saved_overlap;
DROP VIEW IF EXISTS v_unclaimed_runner;
DROP VIEW IF EXISTS v_roster_gaps;
DROP VIEW v_runner_start;

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

-- Rebuilt unchanged apart from sitting on the new v_runner_start.
CREATE VIEW v_unclaimed_runner AS
SELECT r.runner_key, r.display_name, v.bib_number, v.color_name, v.wave_num, v.corral_letter
FROM dim_runner r
  LEFT JOIN v_runner_start v ON v.runner_key = r.runner_key
WHERE r.pin_hash IS NULL;

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

-- v_roster_gaps has to learn about roles too, and this is the bug that
-- only showed up on screen: a spectator with both their miles set came
-- out complete in v_runner_start and was STILL listed under "still
-- missing info", because this view asks "is_complete = 0 OR no
-- transport" and then names bib/colour/wave/corral as what is missing.
-- For somebody who is never going to have a bib that is both wrong and
-- discouraging -- the exact tone problem spectators were added to fix.
--
-- So the gap list is now per role: a runner is missing the things a
-- runner needs, a spectator is missing a mile or nothing at all.
-- Transport stays a gap for both, because everybody has to get there.
CREATE VIEW v_roster_gaps AS
SELECT
  display_name,
  bib_number,
  TRIM(
    CASE WHEN participant_role = 'spectator' THEN
      CASE WHEN spectator_miles IS NULL THEN 'a mile, ' ELSE '' END ||
      CASE WHEN transport_key   IS NULL THEN 'transport, ' ELSE '' END
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
WHERE is_complete = 0 OR transport_key IS NULL;
