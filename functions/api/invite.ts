// Mints the shareable link, password included.
//
// WHY THIS EXISTS. gate.js strips ?k= from the address bar the instant
// it is redeemed (§27), so that a screenshot, a bookmark, the back
// button and any outbound Referer cannot carry the password onward.
// That is right, and it stays.
//
// What it also does, which nobody drew out until people started asking
// Sam for the password by hand (§29/§30): it means FORWARDING FROM THE
// ADDRESS BAR LOSES THE PASSWORD. Alice opens the shared link, her URL
// becomes a bare domain a moment later, she taps Share, and Bob gets a
// link that asks him for a password he does not have.
//
// So the app has to be able to hand back a correct link on request.
// Doing it here rather than remembering the key in localStorage is
// deliberate: the password stays server-side and is never written to
// any device, which is the whole posture §27 set up. The only thing
// that changes is that somebody already inside can produce an invite
// without going to find the original message.
//
// Nothing is given away by this. The caller already holds a valid group
// token, which means they are already in and could forward their own
// link anyway -- this just makes the link they forward the right one.

import { type Env, requireGroup } from '../../lib/auth';
import { json } from '../../lib/http';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const blocked = await requireGroup(request, env);
  if (blocked) return blocked;

  // Built from the request's own origin rather than a hard-coded host,
  // so this is correct on the custom domain, on *.pages.dev and on a
  // local dev server without a config entry to keep in step.
  const origin = new URL(request.url).origin;
  const url = `${origin}/?k=${encodeURIComponent(env.GROUP_PASSCODE)}`;

  return json({ url });
};
