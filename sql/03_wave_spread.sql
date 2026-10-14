-- How the group is spread across the start. Factless fact tables are
-- counted, never summed -- COUNT(*) is the only measure available, which
-- is the whole point of the pattern.
SELECT c.color_name, w.wave_num, w.start_time_local,
       COUNT(f.runner_start_key) AS runners
FROM dim_color c
  CROSS JOIN dim_wave w
  LEFT JOIN fct_runner_start f
         ON f.color_key = c.color_key
        AND f.wave_key  = w.wave_key
        AND f.is_current = 1
GROUP BY c.color_name, w.wave_num, w.start_time_local
HAVING runners > 0
ORDER BY w.wave_num, c.color_name;
