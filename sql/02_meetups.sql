-- Who will physically run into whom.
-- Same vehicle + same departure slot:
SELECT transport_label, depart_time_local, runner_count, runners
FROM v_meetup_transport
ORDER BY depart_time_local;

-- Same pen at the same moment:
SELECT color_name, wave_num, corral_letter, start_time_local, runner_count, runners
FROM v_meetup_corral
ORDER BY start_time_local;
