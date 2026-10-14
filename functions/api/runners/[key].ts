// DELETE /api/runners/:runner_key
//
// A soft delete: the live row is superseded, not removed. The person
// drops off the roster but the history stays in the snapshot, which is
// the whole reason the fact table is insert-only.

import { type Env, requireAuth } from '../../../lib/auth';
import { err, json } from '../../../lib/http';

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const blocked = await requireAuth(request, env);
  if (blocked) return blocked;

  const runnerKey = Number(params.key);
  if (!Number.isInteger(runnerKey) || runnerKey < 1) return err('bad runner key');

  const result = await env.DB.prepare(
    `UPDATE fct_runner_start
        SET is_current = 0, valid_to_utc = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE runner_key = ? AND is_current = 1`,
  ).bind(runnerKey).run();

  if (!result.meta.changes) return err('no such runner on the roster', 404);
  return json({ removed: runnerKey });
};
