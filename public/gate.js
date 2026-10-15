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

function fail(root, message) {
  const box = root.querySelector('.error') || Object.assign(document.createElement('div'), { className: 'error' });
  box.textContent = message;
  root.querySelector('form')?.append(box);
}

/** Resolves to the runner_key once we have a profile. */
export function ensureAccess(root) {
  return new Promise(resolve => {
    const next = () => {
      const me = Number(store.get(KEY.me));
      if (store.get(KEY.profile) && me) return resolve(me);
      if (!store.get(KEY.group)) return askPassword(root, next);
      return askWhoYouAre(root, next);
    };
    next();
  });
}

// ---------- 1. group password ----------

function askPassword(root, next) {
  h(root, `
    <h2>Group password</h2>
    <form class="card stack">
      <p class="meta">Ask Sam for the password if you don't have it.</p>
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

// ---------- 2. who are you ----------

async function askWhoYouAre(root, next) {
  // Claiming only works on rows somebody else created and nobody has
  // PINned yet -- a spreadsheet import. Onboarding always sets a PIN, so
  // on a self-serve setup that list is permanently empty and the button
  // is a dead end. Worse, it is the one a returning person reaches for,
  // because they ARE already on the list. So only offer it when it can
  // actually do something; it comes back by itself if a roster is
  // imported later.
  let claimable = 0;
  try { claimable = (await api('/api/profile/unclaimed')).unclaimed.length; }
  catch { /* fall through to the two-button form */ }

  h(root, `
    <h2>Who are you?</h2>
    <div class="stack">
      ${claimable ? `<button id="w-claim" class="ghost">Someone already added me</button>` : ''}
      <button id="w-signin" class="ghost">I've been here before</button>
      <button id="w-new" class="ghost">I'm new — add me</button>
    </div>
    <p class="hint">${claimable
      ? 'Pick "someone already added me" if your name was entered for you.'
      : 'Been here before? Sign in with your bib number and PIN.'}</p>`);

  if (claimable) root.querySelector('#w-claim').onclick = () => claimScreen(root, next);
  root.querySelector('#w-signin').onclick = () => signinScreen(root, next);
  root.querySelector('#w-new').onclick    = () => onboardScreen(root, next);
}

function land(data, next) {
  store.set(KEY.profile, data.token);
  store.set(KEY.me, String(data.runner?.runner_key ?? ''));
  next();
}

// ---------- 2a. claim an imported row ----------

async function claimScreen(root, next) {
  h(root, '<p class="empty">Loading the list…</p>');
  let unclaimed;
  try { ({ unclaimed } = await api('/api/profile/unclaimed')); }
  catch (err) { return h(root, `<div class="error">${esc(err.message)}</div>`); }

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
    root.querySelector('#b-new').onclick  = () => onboardScreen(root, next);
    root.querySelector('#b-back').onclick = () => askWhoYouAre(root, next);
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

  root.querySelector('#c-back').onclick = () => askWhoYouAre(root, next);
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

function signinScreen(root, next) {
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
      <input id="s-who" autocomplete="username" required>
      <div class="hint">Exactly as you typed it when you signed up.</div>`;
    e.target.remove();
    root.querySelector('#s-who').focus();
  };

  root.querySelector('#s-back').onclick = () => askWhoYouAre(root, next);
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

async function onboardScreen(root, next) {
  h(root, '<p class="empty">Loading…</p>');
  let meta;
  try { meta = await api('/api/meta'); }
  catch (err) { return h(root, `<div class="error">${esc(err.message)}</div>`); }

  h(root, `
    <h2>Add yourself</h2>
    <form class="card">
      ${entryFields(meta)}
      ${pinFields()}
      <button type="submit">Save my info</button>
      <button type="button" id="o-back" class="ghost">Back</button>
    </form>`);

  const form = root.querySelector('form');
  const read = wireEntryFields(form, meta);
  root.querySelector('#o-back').onclick = () => askWhoYouAre(root, next);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const pin = readPin(root);
      land(await api('/api/profile/onboard', { method: 'POST', body: { ...read(), pin } }), next);
    } catch (err) { fail(root, err.message); }
  });
}
