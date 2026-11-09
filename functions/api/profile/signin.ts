// POST /api/profile/signin  { who, pin }
//
// `who` accepts a bib number OR a name. Bib is the fast path, but three
// of the nineteen have no bib, and someone who guessed theirs wrong and
// corrected it would otherwise lock themselves out -- so name works too.

import { type Env, requireGroup, mintProfileToken, demoBlocked } from '../../../lib/auth';
import { err, json } from '../../../lib/http';
import { pinMatches } from '../../../lib/pin';
import { LOCKED_OUT, SIGNIN, clearFailures, isLockedOut, noteFailure } from '../../../lib/throttle';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const demo = demoBlocked(env);
  if (demo) return demo;

  const blocked = await requireGroup(request, env);
  if (blocked) return blocked;

  let who = '';
  let pin = '';
  try {
    const b = await request.json<{ who?: string; pin?: string }>();
    who = typeof b?.who === 'string' ? b.who.trim() : '';
    pin = typeof b?.pin === 'string' ? b.pin.trim() : '';
  } catch { return err('expected a JSON body'); }

  if (!who) return err('enter your bib number or your name');
  if (!pin) return err('enter your PIN');

  // Keyed on the target, lowercased so it matches the NOCASE lookup
  // below -- otherwise "Alex" and "alex" would get a fresh budget
  // each. Checked before the row is even fetched, so a locked-out
  // caller cannot use timing to learn whether a bib exists.
  const target = who.toLowerCase();
  if (await isLockedOut(env, SIGNIN, target)) return err(LOCKED_OUT, 429);

  // Bib lives on the fact table, name on the dimension, so look in both.
  // NOCASE so "alex" finds "Alex".
  const row = await env.DB.prepare(`
    SELECT r.runner_key, r.pin_hash, r.pin_salt
      FROM dim_runner r
      LEFT JOIN fct_runner_start f
             ON f.runner_key = r.runner_key AND f.is_current = 1
     WHERE f.bib_number = ?1 COLLATE NOCASE
        OR r.display_name = ?1 COLLATE NOCASE
     LIMIT 1
  `).bind(who).first<{ runner_key: number; pin_hash: string | null; pin_salt: string | null }>();

  // One message for every failure: no confirming which bibs or names
  // exist, and no telling an unclaimed row apart from a wrong PIN.
  const nope = async () => {
    await noteFailure(env, SIGNIN, target);
    return err('that bib or name and PIN do not match', 401);
  };
  if (!row?.pin_hash || !row.pin_salt) return nope();
  if (!await pinMatches(pin, row.pin_hash, row.pin_salt)) return nope();

  await clearFailures(env, SIGNIN, target);

  const me = await env.DB.prepare('SELECT * FROM v_runner_start WHERE runner_key = ?')
    .bind(row.runner_key).first();

  return json({ token: await mintProfileToken(row.runner_key, env), runner: me });
};
