-- The roster, as the search page sees it.
-- Note this touches no base tables and has no is_current filter:
-- the view owns both.
SELECT display_name, bib_number, color_name, wave_num, corral_letter,
       start_time_local, transport_label, depart_time_local, meetup_note
FROM v_runner_start
ORDER BY start_time_local, color_name, corral_letter;
