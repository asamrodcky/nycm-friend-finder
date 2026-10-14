// Shared-passcode auth.
//
// The group passcode is never stored in the browser. A successful
// /api/auth exchange returns an HMAC-signed expiry stamp, and that token
// is what lives in localStorage. Stateless: no session table, nothing to
// clean up at teardown.

import { err } from './http';

export interface Env {
  DB: D1Database;
  GROUP_PASSCODE: string;
  TOKEN_SECRET: string;
}

// Race day is weeks out and these are friends, not customers. Making
// people re-enter a passcode at 4am is the real risk here.
const TTL_SECONDS = 60 * 60 * 24 * 30;

const enc = new TextEncoder();

/** Compares without leaking where the mismatch is, or the length. */
function timingSafeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

function b64url(buf: ArrayBuffer): string {
  let s = '';
  for (const byte of new Uint8Array(buf)) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}

export function passcodeMatches(given: string, env: Env): boolean {
  return timingSafeEqual(given, env.GROUP_PASSCODE);
}

export async function mintToken(env: Env): Promise<string> {
  const exp = String(Math.floor(Date.now() / 1000) + TTL_SECONDS);
  return `${exp}.${await sign(exp, env.TOKEN_SECRET)}`;
}

async function tokenIsValid(token: string, env: Env): Promise<boolean> {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  if (!await sign(payload, env.TOKEN_SECRET).then(s => timingSafeEqual(token.slice(dot + 1), s))) {
    return false;
  }
  const exp = Number(payload);
  return Number.isFinite(exp) && exp > Math.floor(Date.now() / 1000);
}

/** Returns null when the caller is allowed through, else the 401/500 to send. */
export async function requireAuth(request: Request, env: Env): Promise<Response | null> {
  if (!env.GROUP_PASSCODE || !env.TOKEN_SECRET) {
    return err('server is missing GROUP_PASSCODE or TOKEN_SECRET', 500);
  }
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '');
  if (!m) return err('missing passcode', 401);
  return (await tokenIsValid(m[1], env)) ? null : err('passcode expired or invalid', 401);
}
