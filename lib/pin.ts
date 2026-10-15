// PIN hashing.
//
// ITERATION COUNT IS A DELIBERATE COMPROMISE. The Workers free plan
// allows 10ms of CPU per request, which rules out a password-grade KDF:
// 100k PBKDF2 iterations would blow the budget and the request would be
// killed. 10k fits with room to spare.
//
// That is defensible only because of what a PIN here actually protects.
// It is an identity mechanism -- "this is my new phone, re-attach me to
// my row" -- sitting behind a shared group password, guarding the
// ability to edit your own marathon corral among friends who can already
// see the entire roster.
//
// The real risk is PIN REUSE: someone typing their bank PIN. Hashing
// means a leaked snapshot does not hand that over in plaintext, and the
// onboarding UI says not to reuse one. At 4 digits a determined attacker
// with the snapshot wins regardless of iteration count, so the honest
// mitigations are the warning and scrubbing pin_hash before committing a
// snapshot -- not a number that cannot fit in the CPU budget anyway.

import { b64url, fromB64url, enc, timingSafeEqual } from './crypto';

const ITERATIONS = 10_000;

export const pinLooksValid = (pin: string): boolean => /^\d{4,6}$/.test(pin);

async function derive(pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    key, 256,
  );
  return b64url(bits);
}

export async function hashPin(pin: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  return { hash: await derive(pin, saltBytes), salt: b64url(saltBytes) };
}

export async function pinMatches(pin: string, hash: string, salt: string): Promise<boolean> {
  return timingSafeEqual(await derive(pin, fromB64url(salt)), hash);
}
