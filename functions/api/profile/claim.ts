// POST /api/profile/claim  { runner_key, pin }
//
// Claims an imported roster row and sets its PIN. Only rows that have no
// PIN yet can be claimed, so this cannot be used to take over someone
// who already set one.

import { type Env, requireGroup, mintProfileToken, demoBlocked } from '../../../lib/auth';
import { err, json } from '../../../lib/http';
import { PIN_RULE, PIN_TOO_OBVIOUS, hashPin, pinIsTooObvious, pinLooksValid } from '../../../lib/pin';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const demo = demoBlocked(env);
  if (demo) return demo;

  const blocked = await requireGroup(request, env);
  if (blocked) return blocked;

  let runnerKey = 0;
  let pin = '';
  try {
    const b = await request.json<{ runner_key?: number; pin?: string }>();
    runnerKey = Number(b?.runner_key);
    pin = typeof b?.pin === 'string' ? b.pin.trim() : '';
  } catch { return err('expected a JSON body'); }

  if (!Number.isInteger(runnerKey) || runnerKey < 1) return err('pick who you are');
  if (!pinLooksValid(pin)) return err(PIN_RULE);
  // Checked here and not in the browser: one rule, one place. The
  // forms already surface whatever the server says.
  if (pinIsTooObvious(pin)) return err(PIN_TOO_OBVIOUS);

  const row = await env.DB.prepare(
    'SELECT runner_key, display_name, pin_hash FROM dim_runner WHERE runner_key = ?',
  ).bind(runnerKey).first<{ runner_key: number; display_name: string; pin_hash: string | null }>();

  if (!row) return err('no such person on the roster', 404);
  if (row.pin_hash) {
    return err(`${row.display_name} already set a PIN -- sign in instead`, 409);
  }

  const { hash, salt } = await hashPin(pin);
  await env.DB.prepare(
    `UPDATE dim_runner
        SET pin_hash = ?, pin_salt = ?, claimed_at_utc = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE runner_key = ? AND pin_hash IS NULL`,
  ).bind(hash, salt, runnerKey).run();

  const me = await env.DB.prepare('SELECT * FROM v_runner_start WHERE runner_key = ?')
    .bind(runnerKey).first();

  return json({ token: await mintProfileToken(runnerKey, env), runner: me });
};
