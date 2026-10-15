// GET /api/meetups -> the match tiers, strongest first.
//
// Ordered by how much confidence each tier deserves, which is NOT the
// order you would guess. On real roster data the exact tier (same
// vehicle AND same departure slot) usually returns nothing, because
// almost nobody knows their slot yet, while same-village-and-wave
// catches most of the group. The page leads with whatever has rows.

import { type Env, requireProfile } from '../../lib/auth';
import { json } from '../../lib/http';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const who = await requireProfile(request, env);
  if (who instanceof Response) return who;

  const [corral, wave, vehicle, exact, gaps] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM v_meetup_corral ORDER BY start_time_local, color_name, corral_letter'),
    env.DB.prepare('SELECT * FROM v_meetup_wave   ORDER BY start_time_local, color_name'),
    env.DB.prepare('SELECT * FROM v_meetup_vehicle ORDER BY runner_count DESC'),
    env.DB.prepare('SELECT * FROM v_meetup_transport ORDER BY depart_time_local'),
    env.DB.prepare('SELECT * FROM v_roster_gaps ORDER BY display_name'),
  ]);

  return json({
    // strongest: same vehicle at the same minute
    exact_transport: exact.results,
    // same pen, same moment
    same_corral: corral.results,
    // same village and wave, different corral
    same_wave: wave.results,
    // same vehicle, slot unknown -- a prompt to compare notes
    same_vehicle: vehicle.results,
    // who still needs to fill something in
    gaps: gaps.results,
  });
};
