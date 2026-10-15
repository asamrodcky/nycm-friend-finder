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
  const bad = configProblem(env);
  if (bad) return bad;
  const token = bearer(request);
  if (!token) return err('sign in to your profile first', 401);
  const claims = await readToken(token, env);
  if (!claims) return err('session expired -- sign in again', 401);
  if (claims.kind !== 'p') return err('sign in to your profile first', 403);
  return { runnerKey: claims.runnerKey };
}
