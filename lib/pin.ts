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
// onboarding UI says not to reuse one. A determined attacker holding the
// snapshot still wins regardless of iteration count -- a million
// PBKDF2-10k hashes is minutes offline -- so the honest mitigations are
// the warning and scrubbing pin_hash before committing a snapshot, not a
// number that cannot fit in the CPU budget anyway.
//
// ONLINE is the attack this file can actually do something about, and
// the length rule is where it is won. See pinLooksValid.

import { b64url, fromB64url, enc, timingSafeEqual } from './crypto';

const ITERATIONS = 10_000;

/**
 * Six digits exactly. This used to be four-to-six, and almost everyone
 * picks the shortest thing a form allows.
 *
 * Four digits is 10,000 combinations. Six is 1,000,000 -- a hundredfold
 * for one keystroke, and the single cheapest security change available
 * here. Paired with the signin throttle (8 failures per 15 minutes,
 * ~770 guesses a day) it moves a full sweep from about thirteen days to
 * roughly three and a half years. The app lives for three weeks.
 *
 * Deliberately NOT enforced on sign-in: signin.ts goes straight to
 * pinMatches, so everyone who already set a four-digit PIN keeps using
 * it. This binds new PINs only, which is exactly the growing half of
 * the roster. Anyone who resets picks a six-digit one on the way back
 * in.
 */
export const pinLooksValid = (pin: string): boolean => /^\d{6}$/.test(pin);

/**
 * Rejects the few six-digit PINs that are not worth a million guesses.
 *
 * The 1,000,000 above is only true if people choose from it. 123456 and
 * 111111 are perennially the two most common PINs in every breach
 * corpus, and at ~770 guesses a day a throttled attacker still reaches
 * them within minutes. Roughly 130 values are blocked out of a million,
 * so the cost to someone choosing honestly is nil.
 *
 * Rules rather than a word list: one repeated digit, a run of +1 or -1,
 * or a two- or three-digit block repeated (121212, 123123).
 */
export function pinIsTooObvious(pin: string): boolean {
  const d = [...pin].map(Number);
  const run = (step: number) => d.every((n, i) => i === 0 || n === d[i - 1] + step);
  const repeatsEvery = (size: number) => [...pin].every((c, i) => c === pin[i % size]);
  return repeatsEvery(1) || run(1) || run(-1) || repeatsEvery(2) || repeatsEvery(3);
}

/** One wording, so both creation routes say the same thing. */
export const PIN_RULE = 'PIN must be 6 digits';
export const PIN_TOO_OBVIOUS =
  'pick a less guessable PIN — not a repeat like 111111 or a run like 123456';

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
