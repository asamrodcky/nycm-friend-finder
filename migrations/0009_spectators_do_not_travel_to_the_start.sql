-- Spectators are not going to the start, so stop counting transport
-- against them.
--
-- 0008 got the roles right everywhere except here. It said, in its own
-- comment, "Transport stays a gap for both, because everybody has to get
-- there" -- which is true of getting somewhere and false of getting to
-- the start. Every row in dim_transport is a way to reach Staten Island:
-- the ferry, the Verrazzano buses, the charity coaches. A spectator
-- standing at mile 18 in Manhattan is not taking any of them.
--
-- The visible damage was the same shape as the bug 0008 was written to
-- fix: a spectator who had filled in everything asked of them still
-- appeared under "still missing info", now being told they were missing
-- transport. Being asked for things that do not apply to you is exactly
-- what made the bibless-runner workaround feel broken.
--
-- Only the WHERE clause and the spectator branch change. Runners are
-- untouched: transport is still a gap for them, because they do have to
-- get there.

DROP VIEW v_roster_gaps;

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

-- Any spectator who set a transport before this shipped was answering a
-- question that should not have been put to them. Nothing in the app
-- reads it for them any more, so clear it rather than leave a journey to
-- Staten Island attached to somebody watching at mile 18.
UPDATE fct_runner_start
   SET transport_key = NULL, depart_time_local = NULL
 WHERE participant_role = 'spectator';
