// GET /api/runners -> the whole roster.
//
// Returns everything in one shot and the page filters client side. With
// a roster this size that is one request instead of one per keystroke,
// and it keeps working once loaded -- which matters at 5am in a field
// with 50,000 people on the same cell tower.
//
// Needs a profile, not just the group password: you tell the app who you
// are before you get the roster.

import { type Env, requireProfile } from '../../lib/auth';
import { json } from '../../lib/http';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const who = await requireProfile(request, env);
  if (who instanceof Response) return who;

  const { results } = await env.DB.prepare(`
    SELECT * FROM v_runner_start
    ORDER BY wave_num NULLS LAST, corral_letter NULLS LAST, display_name
  `).all();

  return json({ runners: results, me: who.runnerKey });
};
