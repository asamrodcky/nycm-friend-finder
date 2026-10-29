// POST /api/profile/onboard  { display_name, pin, ...entry fields }
//
// A brand-new person: creates their runner row, their PIN and their
// first assignment together.
//
// Every field except the name and PIN is optional. Four of the nineteen
// real entries are missing a color, wave or corral, and one has nothing
// but "Ferry" -- demanding a complete form would make those people
// either invent data or give up.

import { type Env, requireGroup, mintProfileToken } from '../../../lib/auth';
import { err, json } from '../../../lib/http';
import { PIN_RULE, PIN_TOO_OBVIOUS, hashPin, pinIsTooObvious, pinLooksValid } from '../../../lib/pin';
import { parseRunner } from '../../../lib/validate';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const blocked = await requireGroup(request, env);
  if (blocked) return blocked;

  let body: Record<string, unknown> = {};
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return err('expected a JSON body'); }

  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
  if (!pinLooksValid(pin)) return err(PIN_RULE);
  // Checked here and not in the browser: one rule, one place. The
  // forms already surface whatever the server says.
  if (pinIsTooObvious(pin)) return err(PIN_TOO_OBVIOUS);

  const { value, errors } = parseRunner(body);
  if (!value) return json({ errors }, 400);

  const { hash, salt } = await hashPin(pin);
  let runnerKey: number | null = null;

  try {
    // last_insert_rowid() resolves against the statement before it, and
    // a D1 batch runs sequentially on one connection, so the runner and
    // their assignment land together or not at all.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO dim_runner (display_name, pin_hash, pin_salt, claimed_at_utc)
         VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
      ).bind(value.display_name, hash, salt),
      env.DB.prepare(`
        INSERT INTO fct_runner_start
          (runner_key, bib_number, color_key, wave_key, corral_key, transport_key, depart_time_local, meetup_note)
        VALUES (last_insert_rowid(), ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        value.bib_number, value.color_key, value.wave_key, value.corral_key,
        value.transport_key, value.depart_time_local, value.meetup_note,
      ),
    ]);
    const row = await env.DB.prepare(
      'SELECT runner_key FROM dim_runner ORDER BY runner_key DESC LIMIT 1',
    ).first<{ runner_key: number }>();
    runnerKey = row?.runner_key ?? null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('fct_runner_start.bib_number')) {
      return err(`bib ${value.bib_number} is already on the roster -- are you already in here?`, 409);
    }
    return err('could not create that entry', 409);
  }

  if (!runnerKey) return err('could not create that entry', 500);
  const me = await env.DB.prepare('SELECT * FROM v_runner_start WHERE runner_key = ?')
    .bind(runnerKey).first();

  return json({ token: await mintProfileToken(runnerKey, env), runner: me }, 201);
};
