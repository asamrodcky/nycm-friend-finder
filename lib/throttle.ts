// Rate limiting for the endpoints that take a secret.
//
// Counts FAILURES only, and a success clears the counter. Someone who
// signs in correctly on three devices is not an attacker, and locking
// them out would be the kind of security that costs more than it saves
// at 5am on Staten Island.
//
// See migrations/0006 for why this is D1 rather than the Workers rate
// limiting binding (Pages Functions do not support that binding, and
// its 10-or-60-second window could not express a useful PIN lockout
// anyway).

import type { Env } from './auth';

export interface Rule {
  scope: string;
  limit: number;          // failures allowed inside the window
  windowSeconds: number;
}

/**
 * The PIN lockout. Keyed on the bib or name being attempted -- the
 * TARGET, not the caller.
 *
 * That choice is deliberate and it cuts both ways in our favour. An
 * attacker can rotate IPs freely but cannot change whose PIN they are
 * attacking, so the target is the only key they cannot escape. And on
 * race morning thousands of people at Fort Wadsworth sit behind a
 * handful of carrier-NAT addresses, so an IP-keyed lockout would jam
 * legitimate sign-ins at the worst possible moment.
 *
 * 8 failures per 15 minutes is 32/hour, so a 4-digit PIN would take
 * about 13 days of sustained attack. The app does not live that long.
 */
export const SIGNIN: Rule = { scope: 'signin', limit: 8, windowSeconds: 15 * 60 };

/**
 * The group passcode. Keyed on client IP, because there is no target to
 * key on -- everyone is guessing the same one secret.
 *
 * Looser than SIGNIN precisely because of the carrier-NAT problem
 * above: this is the endpoint a whole start village hits at once if
 * tokens ever expire together.
 */
export const GROUP: Rule = { scope: 'group', limit: 20, windowSeconds: 15 * 60 };

/** Cloudflare always sets this; the fallback only matters in local dev. */
export const clientIp = (request: Request): string =>
  request.headers.get('cf-connecting-ip') ?? 'local';

const cutoff = (rule: Rule) =>
  new Date(Date.now() - rule.windowSeconds * 1000).toISOString();

/** True when this key has already used up its attempts. */
export async function isLockedOut(env: Env, rule: Rule, key: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT attempts FROM auth_throttle
      WHERE scope = ?1 AND throttle_key = ?2 AND window_start_utc >= ?3`,
  ).bind(rule.scope, key, cutoff(rule)).first<{ attempts: number }>();
  return (row?.attempts ?? 0) >= rule.limit;
}

/**
 * Records one failure, starting a fresh window if the old one expired.
 *
 * The CASE is what makes a window expire in place: without it an old
 * row would keep incrementing forever and the first attacker to trip a
 * key would lock that person out permanently.
 */
export async function noteFailure(env: Env, rule: Rule, key: string): Promise<void> {
  const now = new Date().toISOString();
  const since = cutoff(rule);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO auth_throttle (scope, throttle_key, attempts, window_start_utc)
       VALUES (?1, ?2, 1, ?3)
       ON CONFLICT(scope, throttle_key) DO UPDATE SET
         attempts = CASE WHEN auth_throttle.window_start_utc < ?4
                         THEN 1 ELSE auth_throttle.attempts + 1 END,
         window_start_utc = CASE WHEN auth_throttle.window_start_utc < ?4
                                 THEN ?3 ELSE auth_throttle.window_start_utc END`,
    ).bind(rule.scope, key, now, since),
    // Opportunistic prune. Rows are bounded by distinct keys, which is
    // only unbounded if someone sprays, which is exactly when it needs
    // clearing out.
    env.DB.prepare('DELETE FROM auth_throttle WHERE window_start_utc < ?1').bind(since),
  ]);
}

/** A correct answer wipes the slate. */
export async function clearFailures(env: Env, rule: Rule, key: string): Promise<void> {
  await env.DB.prepare('DELETE FROM auth_throttle WHERE scope = ?1 AND throttle_key = ?2')
    .bind(rule.scope, key).run();
}

/** One wording for every lockout, so it never reveals which key tripped. */
export const LOCKED_OUT = 'too many attempts — wait fifteen minutes and try again';
