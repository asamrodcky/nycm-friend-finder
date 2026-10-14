-- 0003_views.sql
--
-- The API reads ONLY these views, never the base tables. All joins, all
-- is_current filtering, and all NULL handling live here, which keeps the
-- "who is with me" logic in SQL instead of JavaScript.

-- ---------------------------------------------------------------------------
-- v_runner_start : the denormalized roster. One row per current runner,
-- every dimension attribute flattened. The search page's only read.
--
-- LEFT JOINs throughout. With INNER JOINs anyone missing a color, wave
-- or corral would silently VANISH from the roster rather than show a
-- gap -- which is worse than useless, because the person most needing a
-- nudge to fill their info in is the one who disappears.
-- ---------------------------------------------------------------------------
CREATE VIEW v_runner_start AS
SELECT
  f.runner_start_key,
  f.bib_number,

  r.runner_key,
  r.display_name,
  r.first_name,
  r.last_name,

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

  -- drives the "needs info" badge on the card
  CASE
    WHEN f.bib_number IS NOT NULL
     AND f.color_key  IS NOT NULL
     AND f.wave_key   IS NOT NULL
     AND f.corral_key IS NOT NULL
    THEN 1 ELSE 0
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

-- ---------------------------------------------------------------------------
-- v_meetup_transport : same vehicle, same departure slot -> you can
-- actually find each other. Drives the top of the search page.
--
-- transport_is_matchable = 1 excludes 'Bus - not sure which' and
-- 'Still deciding'. Two people who both shrugged are not a meetup, and
-- claiming they are is the kind of false positive that makes someone
-- stand around at Whitehall for nothing.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- v_meetup_corral : same color + wave + corral, i.e. standing in the
-- same pen at the same time. All three must be known -- otherwise every
-- half-filled row groups together under NULL and reports itself as a
-- crowd of strangers who share nothing but ignorance.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- v_meetup_vehicle : the loosest net, and on real data the most useful
-- one. Same vehicle, ANY departure time. Seven people said "ferry" but
-- only two said when, so requiring a matching slot finds nobody while
-- this finds all seven. Not a precise meetup -- a prompt to compare
-- notes. with_times says how much of the group is actually pin-downable.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- v_meetup_wave : the looser net. Same color + wave but a different
-- corral still means the same village at the same time, which is a real
-- chance to meet even when corrals differ.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- v_roster_gaps : who still needs to fill something in. The nudge list.
-- ---------------------------------------------------------------------------
CREATE VIEW v_roster_gaps AS
SELECT
  display_name,
  bib_number,
  TRIM(
    CASE WHEN bib_number IS NULL THEN 'bib, '    ELSE '' END ||
    CASE WHEN color_key  IS NULL THEN 'color, '  ELSE '' END ||
    CASE WHEN wave_key   IS NULL THEN 'wave, '   ELSE '' END ||
    CASE WHEN corral_key IS NULL THEN 'corral, ' ELSE '' END ||
    CASE WHEN transport_key IS NULL THEN 'transport, ' ELSE '' END,
    ', '
  ) AS missing
FROM v_runner_start
WHERE is_complete = 0 OR transport_key IS NULL;

-- ---------------------------------------------------------------------------
-- v_start_assignment : the 3 x 5 x 6 = 90-row cross product of every
-- possible start assignment, with start time pre-joined. Not used by the
-- app -- it is the junk-dimension / outrigger pattern against a model
-- you already know, and a convenient lookup for "what time does Orange
-- Wave 3 Corral B go off".
-- ---------------------------------------------------------------------------
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
