// GET    /api/saved          -> people I saved, and how we overlap
// POST   /api/saved          -> { saved_runner_key } save someone
// DELETE /api/saved?key=N    -> unsave someone
//
// Private by design: the list is only ever read for the caller's own
// runner key, taken from the profile token. Nobody can see who saved
// them, or how many people did.

import { type Env, requireProfile } from '../../lib/auth';
import { err, json } from '../../lib/http';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const who = await requireProfile(request, env);
  if (who instanceof Response) return who;

  // Strongest overlap first, so the person you are most likely to
  // actually run into is at the top.
  const { results } = await env.DB.prepare(`
    SELECT * FROM v_saved_overlap
     WHERE runner_key = ?
     ORDER BY same_slot DESC, same_corral DESC, same_wave DESC,
              same_vehicle DESC, same_village DESC, display_name
  `).bind(who.runnerKey).all();

  return json({ saved: results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const who = await requireProfile(request, env);
  if (who instanceof Response) return who;

  let target = 0;
  try {
    const b = await request.json<{ saved_runner_key?: number }>();
    target = Number(b?.saved_runner_key);
  } catch { return err('expected a JSON body'); }

  if (!Number.isInteger(target) || target < 1) return err('pick someone to save');
  if (target === who.runnerKey) return err('you are already going to find yourself');

  try {
    // Saving twice is a no-op rather than an error: the button is a
    // toggle and a double tap should not read as a failure.
    await env.DB.prepare(
      `INSERT INTO fct_runner_saved (runner_key, saved_runner_key)
       VALUES (?, ?) ON CONFLICT DO NOTHING`,
    ).bind(who.runnerKey, target).run();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('FOREIGN KEY')) return err('no such person on the roster', 404);
    return err('could not save that person', 409);
  }

  return json({ saved_runner_key: target });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const who = await requireProfile(request, env);
  if (who instanceof Response) return who;

  const target = Number(new URL(request.url).searchParams.get('key'));
  if (!Number.isInteger(target) || target < 1) return err('pick someone to unsave');

  const result = await env.DB.prepare(
    'DELETE FROM fct_runner_saved WHERE runner_key = ? AND saved_runner_key = ?',
  ).bind(who.runnerKey, target).run();

  if (!result.meta.changes) return err('they were not on your list', 404);
  return json({ unsaved: target });
};
