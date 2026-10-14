-- "What time does Orange Wave 3 Corral B go off?"
-- All 90 possible assignments, no runners required.
SELECT assignment_label, start_time_local
FROM v_start_assignment
WHERE color_name = 'Orange' AND wave_num = 3
ORDER BY corral_letter;
