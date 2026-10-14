// GET  /api/runners  -> the whole roster
// POST /api/runners  -> create or update one entry
//
// GET returns everything in one shot and the search page filters client
// side. With a roster this size that is one request instead of one per
// keystroke, and it works offline once loaded -- which matters at 5am in
// a field on Staten Island with 50,000 people on the same cell tower.

import { type Env, requireAuth } from '../../lib/auth';
import { err, json } from '../../lib/http';
import { parseRunner, type RunnerInput } from '../../lib/validate';

const NOW = `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`;

const ROSTER_SQL = `
  SELECT * FROM v_runner_start
  ORDER BY wave_num NULLS LAST, corral_letter NULLS LAST, display_name
`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const blocked = await requireAuth(request, env);
  if (blocked) return blocked;

  const { results } = await env.DB.prepare(ROSTER_SQL).all();
  return json({ runners: results });
};

/** Translates SQLite constraint text into something a person can act on. */
function friendlyDbError(message: string, input: RunnerInput): string {
  if (message.includes('fct_runner_start.bib_number')) {
    return `bib ${input.bib_number} is already on the roster for someone else`;
  }
  if (message.includes('FOREIGN KEY')) {
    return 'unknown color, wave, corral or transport option';
  }
  if (message.includes('depart_time_local')) {
    return 'departure time must look like 05:30 (24-hour)';
  }
  if (message.includes('bib_number')) {
    return 'bib number cannot be blank -- leave it out entirely if unknown';
  }
  return 'could not save that entry';
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const blocked = await requireAuth(request, env);
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err('expected a JSON body');
  }

  const { value, errors } = parseRunner(body);
  if (!value) return json({ errors }, 400);

  const factCols = [
    value.bib_number, value.color_key, value.wave_key, value.corral_key,
    value.transport_key, value.depart_time_local, value.meetup_note,
  ];

  const insertFact = (runnerKeyExpr: string) => `
    INSERT INTO fct_runner_start
      (runner_key, bib_number, color_key, wave_key, corral_key, transport_key, depart_time_local, meetup_note)
    VALUES (${runnerKeyExpr}, ?, ?, ?, ?, ?, ?, ?)
  `;

  let runnerKey = value.runner_key;

  try {
    if (runnerKey === null) {
      // New entry. last_insert_rowid() resolves against the statement
      // before it, and a D1 batch runs sequentially on one connection,
      // so the runner and their assignment land together or not at all.
      await env.DB.batch([
        env.DB.prepare('INSERT INTO dim_runner (display_name) VALUES (?)').bind(value.display_name),
        env.DB.prepare(insertFact('last_insert_rowid()')).bind(...factCols),
      ]);
      const row = await env.DB.prepare(
        'SELECT runner_key FROM dim_runner ORDER BY runner_key DESC LIMIT 1',
      ).first<{ runner_key: number }>();
      runnerKey = row?.runner_key ?? null;
    } else {
      const exists = await env.DB.prepare('SELECT 1 FROM dim_runner WHERE runner_key = ?')
        .bind(runnerKey).first();
      if (!exists) return err('no such runner', 404);

      // Insert-only: supersede the live row, then add the new one, so
      // the snapshot keeps a record of who moved wave and when.
      await env.DB.batch([
        env.DB.prepare('UPDATE dim_runner SET display_name = ? WHERE runner_key = ?')
          .bind(value.display_name, runnerKey),
        env.DB.prepare(
          `UPDATE fct_runner_start SET is_current = 0, valid_to_utc = ${NOW}
            WHERE runner_key = ? AND is_current = 1`,
        ).bind(runnerKey),
        env.DB.prepare(insertFact('?')).bind(runnerKey, ...factCols),
      ]);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(friendlyDbError(message, value), 409);
  }

  const saved = await env.DB.prepare('SELECT * FROM v_runner_start WHERE runner_key = ?')
    .bind(runnerKey).first();
  return json({ runner: saved }, value.runner_key === null ? 201 : 200);
};
