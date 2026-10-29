-- 0007_instagram.sql
--
-- An optional Instagram handle, as an alternative to describing an
-- outfit in words. "Here is my handle, that is what I look like" is a
-- fair answer for someone who would rather not write a sentence, and it
-- costs nothing to store.
--
-- This is the cheap half of the photo question (§26): no uploads, no R2
-- bucket, no EXIF to strip, no moderation path, no second teardown
-- surface. The hosting is somebody else's problem and so is the content.
--
-- It lives on dim_runner, not on the fact table. A handle is an
-- attribute of the PERSON -- it does not change when they move wave --
-- where meetup_note is about this race's meetup and correctly sits on
-- the fact. dim_runner.display_name is already UPDATEd on edit, so this
-- follows a path that exists.
--
-- NOTE ON EXPOSURE, because this is sharper than it looks: a handle is a
-- much stronger identifier than a bib. A bib is a number that expires
-- with the race; a handle is a durable link to somebody's real social
-- identity, sitting next to where they will physically be and when. It
-- is fine behind the group passcode. If the passcode is ever removed it
-- is the single most exposing column in the database.
ALTER TABLE dim_runner ADD COLUMN instagram TEXT;

-- v_runner_start is rebuilt rather than patched: SQLite has no ALTER
-- VIEW. The seven views that read from it reference named columns that
-- all still exist, so they are unaffected by the extra one.
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
