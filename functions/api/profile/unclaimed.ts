// GET /api/profile/unclaimed
//
// The "already on the roster?" picker for a fresh device. Nineteen
// people were imported from a spreadsheet and have no PIN yet; this is
// how they find their own row instead of re-typing what Sam already
// collected.

import { type Env, requireGroup } from '../../../lib/auth';
import { json } from '../../../lib/http';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const blocked = await requireGroup(request, env);
  if (blocked) return blocked;

  const { results } = await env.DB.prepare(
    'SELECT * FROM v_unclaimed_runner ORDER BY display_name',
  ).all();
  return json({ unclaimed: results });
};
