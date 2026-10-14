-- The payoff for the insert-only fact table: who changed their
-- assignment, and what they changed it to. Impossible to answer if the
-- app had done UPDATE in place.
SELECT r.display_name,
       f.bib_number,
       c.color_name,
       w.wave_num,
       cr.corral_letter,
       w.start_time_local,
       f.valid_from_utc,
       COALESCE(f.valid_to_utc, 'current') AS valid_to
FROM fct_runner_start f
  JOIN dim_runner  r  ON r.runner_key  = f.runner_key
  JOIN dim_color   c  ON c.color_key   = f.color_key
  JOIN dim_wave    w  ON w.wave_key    = f.wave_key
  JOIN dim_corral  cr ON cr.corral_key = f.corral_key
WHERE f.bib_number IN (
  SELECT bib_number FROM fct_runner_start GROUP BY bib_number HAVING COUNT(*) > 1
)
ORDER BY f.bib_number, f.valid_from_utc;
