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
  `).all<Record<string, unknown>>();

  // A goal time is followers-only, and this endpoint is SELECT * over a
  // view that now carries one. The view has to expose it -- /me reads
  // through the same view to fill in your own edit form -- so the
  // narrowing happens here, on the one path that hands the whole roster
  // to somebody else.
  //
  // Stripped rather than never selected, so adding a column to the view
  // can never silently widen this endpoint again: anything
  // follower-only has to be listed below or it does not ship.
  const PRIVATE_TO_FOLLOWERS = ['goal_time_seconds'];
  const runners = results.map(r => {
    if (r.runner_key === who.runnerKey) return r;
    const copy = { ...r };
    for (const col of PRIVATE_TO_FOLLOWERS) copy[col] = null;
    return copy;
  });

  return json({ runners, me: who.runnerKey });
};
