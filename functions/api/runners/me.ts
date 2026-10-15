// POST   /api/runners/me -> update my own entry
// DELETE /api/runners/me -> take myself off the roster
//
// There is no route for editing someone ELSE's entry. Identity comes
// from the profile token, so the runner key is never taken from the
// request body -- otherwise the PIN would be guarding nothing.

import { type Env, requireProfile } from '../../../lib/auth';
import { err, json } from '../../../lib/http';
import { parseRunner, type RunnerInput } from '../../../lib/validate';

const NOW = `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`;

function friendlyDbError(message: string, input: RunnerInput): string {
  if (message.includes('fct_runner_start.bib_number')) {
    return `bib ${input.bib_number} is already on the roster for someone else`;
  }
  if (message.includes('FOREIGN KEY')) return 'unknown color, wave, corral or transport option';
  if (message.includes('depart_time_local')) return 'departure time must look like 05:30 (24-hour)';
  if (message.includes('bib_number')) return 'bib number cannot be blank -- leave it out entirely if unknown';
  return 'could not save that entry';
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const who = await requireProfile(request, env);
  if (who instanceof Response) return who;

  let body: unknown;
  try { body = await request.json(); } catch { return err('expected a JSON body'); }

  const { value, errors } = parseRunner(body);
  if (!value) return json({ errors }, 400);

  try {
    // Insert-only: supersede the live row, then add the new one, so the
    // snapshot keeps a record of who moved wave and when.
    await env.DB.batch([
      env.DB.prepare('UPDATE dim_runner SET display_name = ? WHERE runner_key = ?')
        .bind(value.display_name, who.runnerKey),
      env.DB.prepare(
        `UPDATE fct_runner_start SET is_current = 0, valid_to_utc = ${NOW}
          WHERE runner_key = ? AND is_current = 1`,
      ).bind(who.runnerKey),
      env.DB.prepare(`
        INSERT INTO fct_runner_start
          (runner_key, bib_number, color_key, wave_key, corral_key, transport_key, depart_time_local, meetup_note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        who.runnerKey, value.bib_number, value.color_key, value.wave_key,
        value.corral_key, value.transport_key, value.depart_time_local, value.meetup_note,
      ),
    ]);
  } catch (e) {
    return err(friendlyDbError(e instanceof Error ? e.message : String(e), value), 409);
  }

  const saved = await env.DB.prepare('SELECT * FROM v_runner_start WHERE runner_key = ?')
    .bind(who.runnerKey).first();
  return json({ runner: saved });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const who = await requireProfile(request, env);
  if (who instanceof Response) return who;

  const result = await env.DB.prepare(
    `UPDATE fct_runner_start SET is_current = 0, valid_to_utc = ${NOW}
      WHERE runner_key = ? AND is_current = 1`,
  ).bind(who.runnerKey).run();

  if (!result.meta.changes) return err('you are not on the roster', 404);
  return json({ removed: who.runnerKey });
};
