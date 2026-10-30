// The access flow. Runs before either page shows anything.
//
//   no group token   -> ask for the group password
//   no profile token -> claim your imported row, sign in, or start fresh
//   both present     -> straight through, nothing typed
//
// That last line is the whole point: a device you have used before goes
// directly to the roster.

import { api, store, KEY, esc } from './app.js';
import { entryFields, wireEntryFields, pinFields, readPin } from './form.js';

const h = (el, html) => { el.innerHTML = html; return el; };

// role="alert" so a rejected password or a mismatched PIN is spoken when
// it appears. Without it the only feedback is visual, and the failure
// shows up below the button you just pressed.
function fail(root, message) {
  const box = root.querySelector('.error') || Object.assign(document.createElement('div'), { className: 'error' });
  box.setAttribute('role', 'alert');
  box.textContent = message;
  root.querySelector('form')?.append(box);
}

// The query parameter that carries the group password in a shared link,
// so one URL can be pasted into a group chat instead of a link plus a
// password people then have to find again.
//
// BE CLEAR ABOUT WHAT THIS IS. Once a link is in a few group chats the
// password is not a secret -- it is forwarded, screenshotted and pasted
// onward. This buys "unlisted, not private": crawlers, scrapers and
// anyone who simply types the domain get nothing, while anybody who was
// sent the link walks in. That is the Google-Doc "anyone with the link"
// posture, and it is the right size of boundary for a running club and
// the wrong one for the open internet.
//
// What makes it safe to regret: group tokens are HMAC'd with
// TOKEN_SECRET, not with the password, so changing GROUP_PASSCODE kills
// old links without signing out a single person who is already in.
const LINK_KEY = 'k';

/**
 * Trades a password from the URL for a token, then takes it out of the
 * URL.
 *
 * Stripping is the point of doing it here rather than prefilling the
 * form. After the first moment the address bar is clean, so a
 * screenshot, a bookmark, the back button and any outbound Referer do
 * not carry the password onward.
 *
 * A wrong or rotated key is stripped too and falls through to the normal
 * password screen -- a dead link should ask, not look broken.
 *
 * A FAILURE IS NOT THE SAME AS A DEAD KEY, and this used to treat them
 * alike: any throw stripped the key. So a dropped connection on the
 * subway, a 429 or a 5xx destroyed a perfectly good link, the refresh
 * had nothing left to retry with, and the only way back was to find the
 * original message again. Now only a 401 -- the server actually saying
 * "that passcode is not right" -- strips. Anything else leaves the key
 * in the URL so that pulling to refresh does the obvious thing.
 */
async function redeemLinkKey() {
  const url = new URL(location.href);
  const key = url.searchParams.get(LINK_KEY);
  if (!key) return;

  let keyIsDead = false;
  try {
    const { token } = await api('/api/auth', { method: 'POST', body: { passcode: key } });
    store.set(KEY.group, token);
  } catch (err) {
    // 401 is the server's considered answer: this key is wrong or
    // rotated. Everything else -- offline, 429, 5xx -- is this moment
    // failing, not this link.
    keyIsDead = err?.status === 401;
    if (!keyIsDead) return;
  }

  url.searchParams.delete(LINK_KEY);
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

/** Resolves to the runner_key once we have a profile. */
export function ensureAccess(root) {
  return new Promise(resolve => {
    const next = () => {
      const me = Number(store.get(KEY.me));
      if (store.get(KEY.profile) && me) return resolve(me);
      if (!store.get(KEY.group)) return askPassword(root, next);
      return askRole(root, next);
    };
    // Redeemed before anything renders, so somebody arriving on a shared
    // link never sees a password screen flash up and disappear.
    redeemLinkKey().then(next);
  });
}

// ---------- 1. group password ----------

function askPassword(root, next) {
  h(root, `
    <h2>Group password</h2>
    <form class="card stack">
      <p class="meta">If you were sent a link, open that instead — it signs you in.
         Otherwise ask Sam for the password.</p>
      <label for="g-pass">Password</label>
      <input id="g-pass" type="password" autocomplete="current-password">
      <button type="submit">Continue</button>
    </form>`);

  root.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const { token } = await api('/api/auth', {
        method: 'POST', body: { passcode: root.querySelector('#g-pass').value },
      });
      store.set(KEY.group, token);
      next();
    } catch (err) { fail(root, err.message); }
  });
}

// ---------- 2. why you are here, then who you are ----------

/**
 * Screen one: the reason, then what kind of race morning you are having.
 *
 * WHY THE COPY IS HERE AT ALL. §29 measured the funnel: 423 unique
 * visitors, 36 signups, 8.5%. /api/runners is requireProfile, so this is
 * the wall -- roughly 390 people were asked to invent a PIN before being
 * shown a single reason to. They never learned 56 people were already
 * inside. This is Sam's own explanation, trimmed to a phone screen, put
 * in front of the ask instead of behind it.
 *
 * WHY ROLE COMES BEFORE new/returning. Running and spectating are two
 * different race mornings, and asking which one first means the screen
 * after it, and the form after that, can be about one of them instead of
 * hedging between both. It also puts a question anybody can answer ahead
 * of the one that needs a decision about accounts.
 *
 * "Running", not "racing": it matches the form's own chips word for word,
 * and "racing" quietly writes off the charity runners and the
 * first-timers who are here to finish, who are a real part of this
 * roster.
 */
function askRole(root, next) {
  h(root, `
    <h2 class="lede">Nobody should feel alone on race morning.</h2>
    <div class="card why">
      <p>NYC has some of the most complicated logistics of any race. Someone you
         know could be on the same ferry, the same wave, even the same colour
         &mdash; and you&rsquo;d have no idea until you&rsquo;re toeing the line
         next to them.</p>
      <p>There&rsquo;s so much going on during race week that it&rsquo;s easy to
         lose track. You plan to meet someone race morning, then forget who to
         text.</p>
      <p>And unlike live tracking, you can&rsquo;t see anyone&rsquo;s start
         information unless they tell you directly or post it.</p>
      <p class="why-last">So this is a simple, no-frills site that matches you
         with other runners who might have overlapping race mornings.</p>
    </div>
    <h2 id="role-q">Which are you?</h2>
    <div class="stack" role="group" aria-labelledby="role-q">
      <button id="r-runner" class="ghost">I'm running</button>
      <button id="r-spectator" class="ghost">I'm spectating</button>
    </div>
    <p class="hint">Spectating counts &mdash; tell people which mile you&rsquo;ll be at
       and they can look for you.</p>`);

  root.querySelector('#r-runner').onclick    = () => askNewOrReturning(root, next, 'runner');
  root.querySelector('#r-spectator').onclick = () => askNewOrReturning(root, next, 'spectator');
}

/**
 * Screen two: new here, or back again.
 *
 * Two entrances and nothing else, so neither is the one you squint at.
 *
 * Claiming is the exception and it is conditional for a reason. It only
 * works on rows somebody else created and nobody has PINned yet -- a
 * spreadsheet import. Self-serve onboarding always sets a PIN, so on a
 * roster like this one that list is permanently empty and the button is a
 * dead end; worse, it is the one a returning person reaches for, because
 * they ARE already on the list. It appears only when it can actually do
 * something, and it sits here rather than on the role screen because
 * somebody already on the list is a returning person, not a new one.
 */
async function askNewOrReturning(root, next, role) {
  const spectating = role === 'spectator';

  let claimable = 0;
  try { claimable = (await api('/api/profile/unclaimed')).unclaimed.length; }
  catch { /* fall through to the two-button form */ }

  h(root, `
    <h2>${spectating ? 'Spectating' : 'Running'} &mdash; have you been here before?</h2>
    <div class="stack">
      <button id="w-new" class="ghost">I'm new &mdash; add me</button>
      <button id="w-signin" class="ghost">I've been here before</button>
      ${claimable ? `<button id="w-claim" class="mini">Someone already added me</button>` : ''}
    </div>
    <p class="hint">Signing in again takes your ${spectating ? '' : 'bib number and '}PIN.</p>
    <button type="button" id="w-back" class="ghost">&larr; Back</button>`);

  root.querySelector('#w-new').onclick    = () => onboardScreen(root, next, role);
  root.querySelector('#w-signin').onclick = () => signinScreen(root, next, role);
  root.querySelector('#w-back').onclick   = () => askRole(root, next);
  if (claimable) root.querySelector('#w-claim').onclick = () => claimScreen(root, next, role);
}

function land(data, next) {
  store.set(KEY.profile, data.token);
  store.set(KEY.me, String(data.runner?.runner_key ?? ''));
  next();
}

// ---------- 2a. claim an imported row ----------

async function claimScreen(root, next, role) {
  h(root, '<p class="empty">Loading the list…</p>');
  let unclaimed;
  try { ({ unclaimed } = await api('/api/profile/unclaimed')); }
  catch (err) { return h(root, `<div class="error" role="alert">${esc(err.message)}</div>`); }

  // Two different situations land here and the copy has to fit both: a
  // fresh database with nobody imported at all (which is how production
  // starts), and an imported list where everyone has already claimed.
  if (!unclaimed.length) {
    h(root, `
      <h2>Nobody to claim</h2>
      <div class="card stack">
        <p class="meta">There's no one waiting to be claimed — either nobody was
        imported from a spreadsheet, or everyone already set a PIN.</p>
        <button id="b-new" class="ghost">Add me instead</button>
        <button id="b-back" class="ghost">Back</button>
      </div>`);
    root.querySelector('#b-new').onclick  = () => onboardScreen(root, next, role);
    root.querySelector('#b-back').onclick = () => askNewOrReturning(root, next, role);
    return;
  }

  h(root, `
    <h2>Find yourself</h2>
    <form class="card stack">
      <label for="c-who">You are</label>
      <select id="c-who">${unclaimed.map(u => `
        <option value="${u.runner_key}">${esc(u.display_name)}${u.bib_number ? ` · ${esc(u.bib_number)}` : ''}</option>`).join('')}</select>
      ${pinFields()}
      <button type="submit">That's me</button>
      <button type="button" id="c-back" class="ghost">Back</button>
    </form>`);

  root.querySelector('#c-back').onclick = () => askNewOrReturning(root, next, role);
  root.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const pin = readPin(root);
      land(await api('/api/profile/claim', {
        method: 'POST',
        body: { runner_key: Number(root.querySelector('#c-who').value), pin },
      }), next);
    } catch (err) { fail(root, err.message); }
  });
}

// ---------- 2b. sign in ----------

function signinScreen(root, next, role) {
  // Bib only, by default. The API accepts a name too, but offering both
  // in one field invites people to type a name that does not match what
  // they entered the first time -- "Sam" vs "Samuel" -- and get a
  // rejection they cannot diagnose.
  //
  // The fallback stays reachable because a bib is optional at
  // onboarding and NYRR has not given everyone one yet. Without it,
  // anyone who signed up before their bib arrived could never reach a
  // second device, and the only recovery is Sam clearing their PIN.
  h(root, `
    <h2>Welcome back</h2>
    <form class="card stack">
      <div id="s-by-bib">
        <label for="s-who">Bib number</label>
        <input id="s-who" inputmode="numeric" autocomplete="username" required>
      </div>
      <label for="s-pin">PIN</label>
      <input id="s-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
      <button type="button" id="s-noBib" class="mini">I don't have a bib number</button>
      <button type="button" id="s-back" class="ghost">Back</button>
      <p class="hint">Forgotten your PIN? Ask Sam to reset it, then set a new one.</p>
    </form>`);

  root.querySelector('#s-noBib').onclick = e => {
    root.querySelector('#s-by-bib').innerHTML = `
      <label for="s-who">Your name</label>
      <input id="s-who" autocomplete="username" required aria-describedby="s-who-hint">
      <div class="hint" id="s-who-hint">Exactly as you typed it when you signed up.</div>`;
    e.target.remove();
    root.querySelector('#s-who').focus();
  };

  root.querySelector('#s-back').onclick = () => askNewOrReturning(root, next, role);
  root.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      land(await api('/api/profile/signin', {
        method: 'POST',
        body: { who: root.querySelector('#s-who').value, pin: root.querySelector('#s-pin').value },
      }), next);
    } catch (err) { fail(root, err.message); }
  });
}

// ---------- 2c. brand new person ----------

async function onboardScreen(root, next, role) {
  h(root, '<p class="empty">Loading…</p>');
  let meta;
  try { meta = await api('/api/meta'); }
  catch (err) { return h(root, `<div class="error" role="alert">${esc(err.message)}</div>`); }

  h(root, `
    <h2>Add yourself</h2>
    <form class="card">
      ${entryFields(meta, { participant_role: role })}
      ${pinFields()}
      <button type="submit">Save my info</button>
      <button type="button" id="o-back" class="ghost">Back</button>
    </form>`);

  const form = root.querySelector('form');
  const read = wireEntryFields(form, meta);
  root.querySelector('#o-back').onclick = () => askNewOrReturning(root, next, role);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const pin = readPin(root);
      land(await api('/api/profile/onboard', { method: 'POST', body: { ...read(), pin } }), next);
    } catch (err) { fail(root, err.message); }
  });
}
