// Two-layer access, matching how people actually use the app.
//
//   GROUP TOKEN   - you know the shared password, so you are in the group.
//                   Enough to see the onboarding form and sign in.
//   PROFILE TOKEN - you are a specific runner. Required to browse the
//                   roster, edit your own entry, or save people.
//
// A profile token is only ever issued after group auth, so it implies
// group membership and satisfies both checks. Both are HMAC-signed
// expiry stamps, so there is no session table to clean up at teardown.
//
// Shapes:
//   g.<exp>.<sig>
//   p.<exp>.<runner_key>.<sig>

import { err } from './http';
import { hmac, timingSafeEqual } from './crypto';

export interface Env {
  DB: D1Database;
  GROUP_PASSCODE: string;
  TOKEN_SECRET: string;
  /** "1" turns the live site into a read-only demo. See demoMode(). */
  DEMO_MODE?: string;
}

/**
 * The post-race posture.
 *
 * The race was 1 November. 0010 took the identities out of the database
 * and this takes the locks off what is left, because once there is
 * nothing to protect a passcode is just a wall between an employer and
 * a working app -- the same wall §29 measured costing 8.5% conversion.
 *
 * It also closes a hole 0010 opened. Nulling every pin_hash means every
 * runner now matches v_unclaimed_runner's definition of "claimable", so
 * the claim screen would hand a stranger an identity to edit. In demo
 * mode nothing can be written at all, so there is nothing to claim.
 */
export const demoMode = (env: Env): boolean => env.DEMO_MODE === '1';

/**
 * The runner a demo visitor looks around as.
 *
 * The one with the most people followed, among those with a complete
 * profile. Picking the lowest key instead -- the obvious version -- put
 * visitors on a runner who had followed nobody, so "Your people" was
 * empty and told them to tap a star that demo mode had just removed.
 * The whole point of the roster is the overlap between people, so the
 * demo has to open on somebody who has some.
 */
export async function demoViewerKey(env: Env): Promise<number | null> {
  const row = await env.DB.prepare(`
    SELECT v.runner_key,
           (SELECT COUNT(*) FROM fct_runner_saved s WHERE s.runner_key = v.runner_key) AS follows
      FROM v_runner_start v
     WHERE v.is_complete = 1
     ORDER BY follows DESC, v.runner_key
     LIMIT 1
  `).first<{ runner_key: number }>();
  return row?.runner_key ?? null;
}

/** 403 for anything that writes, while the demo is on. */
export function demoBlocked(env: Env): Response | null {
  return demoMode(env)
    ? err('this is a read-only demo of a finished race -- nothing can be changed', 403)
    : null;
}

// Race day is weeks out and these are friends, not customers. Making
// someone re-enter a passcode at 4am is the real risk here.
const TTL_SECONDS = 60 * 60 * 24 * 30;

const nowSec = () => Math.floor(Date.now() / 1000);
const expiry = () => String(nowSec() + TTL_SECONDS);

export function passcodeMatches(given: string, env: Env): boolean {
  return timingSafeEqual(given, env.GROUP_PASSCODE);
}

export async function mintGroupToken(env: Env): Promise<string> {
  const payload = `g.${expiry()}`;
  return `${payload}.${await hmac(payload, env.TOKEN_SECRET)}`;
}

export async function mintProfileToken(runnerKey: number, env: Env): Promise<string> {
  const payload = `p.${expiry()}.${runnerKey}`;
  return `${payload}.${await hmac(payload, env.TOKEN_SECRET)}`;
}

type Claims = { kind: 'g' } | { kind: 'p'; runnerKey: number };

async function readToken(token: string, env: Env): Promise<Claims | null> {
  const cut = token.lastIndexOf('.');
  if (cut <= 0) return null;

  const payload = token.slice(cut + 1 === token.length ? -1 : 0, cut);
  const signature = token.slice(cut + 1);
  if (!timingSafeEqual(signature, await hmac(payload, env.TOKEN_SECRET))) return null;

  const parts = payload.split('.');
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp <= nowSec()) return null;

  if (parts[0] === 'g' && parts.length === 2) return { kind: 'g' };
  if (parts[0] === 'p' && parts.length === 3) {
    const runnerKey = Number(parts[2]);
    if (Number.isInteger(runnerKey) && runnerKey > 0) return { kind: 'p', runnerKey };
  }
  return null;
}

function bearer(request: Request): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '');
  return m ? m[1] : null;
}

function configProblem(env: Env): Response | null {
  return (!env.GROUP_PASSCODE || !env.TOKEN_SECRET)
    ? err('server is missing GROUP_PASSCODE or TOKEN_SECRET', 500)
    : null;
}

/** Group membership. A profile token also satisfies this. */
export async function requireGroup(request: Request, env: Env): Promise<Response | null> {
  if (demoMode(env)) return null;
  const bad = configProblem(env);
  if (bad) return bad;
  const token = bearer(request);
  if (!token) return err('enter the group password', 401);
  return (await readToken(token, env)) ? null : err('session expired -- enter the group password again', 401);
}

/** A specific runner. Returns their key, or the response to send instead. */
export async function requireProfile(
  request: Request, env: Env,
): Promise<{ runnerKey: number } | Response> {
  // No token, no PIN, no passcode: a demo visitor is signed in as the
  // viewer the moment they arrive. Reads only -- every mutating handler
  // calls demoBlocked() before it touches anything.
  if (demoMode(env)) {
    const key = await demoViewerKey(env);
    return key ? { runnerKey: key } : err('the demo roster is empty', 503);
  }
  const bad = configProblem(env);
  if (bad) return bad;
  const token = bearer(request);
  if (!token) return err('sign in to your profile first', 401);
  const claims = await readToken(token, env);
  if (!claims) return err('session expired -- sign in again', 401);
  if (claims.kind !== 'p') return err('sign in to your profile first', 403);

  // The token is signed and unexpired, but the runner it points at may
  // have been deleted -- by a PIN reset, a wiped database, or a fresh
  // deploy. Without this check you are "signed in" as a ghost: no card,
  // no edit link, and nothing to do but sign out.
  const exists = await env.DB.prepare('SELECT 1 FROM dim_runner WHERE runner_key = ?')
    .bind(claims.runnerKey).first();
  if (!exists) return err('that profile no longer exists -- sign in again', 401);

  return { runnerKey: claims.runnerKey };
}
