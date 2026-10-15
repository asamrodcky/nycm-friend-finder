// The roster page.
//
// Order: the people you chose, then the people who overlap with YOU,
// then everyone. Every one of those is a real card with a star, so you
// can act on a suggestion where you read it rather than scrolling off to
// hunt for the same name in the full list.
//
// Overlap is computed here rather than fetched. The browser already has
// the whole roster and knows who you are, so the only thing the server
// could add is a round trip -- and doing it locally means each match is
// a real runner object with a key, which is what makes it starrable.
//
// This deliberately replaced the old group-wide tiers. v_meetup_corral
// and friends find clusters anywhere in the roster, not clusters
// containing you, so "Same corral" was heading a list of corrals you
// were not in. Those views still exist for analysis in sql/.

import { api, store, KEY, esc, icon, clock, startLine, transportIcon } from './app.js';
import { ensureAccess } from './gate.js';

const app = document.querySelector('#app');
let roster = [], saved = [], gaps = [], me = null;
const savedKeys = () => new Set(saved.map(s => s.saved_runner_key));

// ---------- overlap ----------
// Mirrors v_saved_overlap. Note every test checks both sides for null
// first: in JS `null === null` is true, so without that guard two people
// who both have no corral would read as sharing one -- the same trap the
// SQL views guard against.

const both = (a, b) => a !== null && a !== undefined && a === b;

// Strongest first within each family. Reporting one from each avoids
// "same corral + wave + village", which are all the same fact.
const START_FAMILY = [
  ['corral',  'corral',  (m, t) => both(m.color_key, t.color_key) && both(m.wave_key, t.wave_key) && both(m.corral_key, t.corral_key)],
  ['wave',    'wave',    (m, t) => both(m.color_key, t.color_key) && both(m.wave_key, t.wave_key)],
  ['village', 'village', (m, t) => both(m.color_key, t.color_key)],
];
const RIDE_FAMILY = [
  ['slot', 'ride + time', (m, t) => m.transport_is_matchable && both(m.transport_key, t.transport_key) && both(m.depart_time_local, t.depart_time_local)],
  ['ride', 'ride',        (m, t) => m.transport_is_matchable && both(m.transport_key, t.transport_key)],
];

// How likely each overlap makes an actual meetup, strongest first. This
// is one combined ladder rather than two family scores: sharing a
// village AND a wave puts you in the same place at the same time, which
// beats sharing a village with someone on a different wave even if you
// are both on ferries. But sharing a vehicle at the same minute beats
// both, because you are literally on the same boat.
const LADDER = [
  (m, t) => RIDE_FAMILY[0][2](m, t),   // same ride + time
  (m, t) => START_FAMILY[0][2](m, t),  // same corral
  (m, t) => START_FAMILY[1][2](m, t),  // same village + wave
  (m, t) => RIDE_FAMILY[1][2](m, t),   // same ride, time unknown
  (m, t) => START_FAMILY[2][2](m, t),  // same village
];

/** Returns { rank, label } or null when nothing is shared. */
function overlap(mine, them) {
  if (!mine) return null;
  const start = START_FAMILY.find(([, , test]) => test(mine, them));
  const ride  = RIDE_FAMILY.find(([, , test]) => test(mine, them));
  if (!start && !ride) return null;

  // Sort on the ladder rung first, then break ties by how much ELSE is
  // shared: someone on your ferry who is also in your village beats
  // someone on your ferry and nothing more.
  const rung      = LADDER.findIndex(test => test(mine, them));
  const startTier = start ? START_FAMILY.indexOf(start) : 9;
  const rideTier  = ride ? RIDE_FAMILY.indexOf(ride) : 9;

  return {
    rank: rung * 100 + startTier * 10 + rideTier,
    label: 'same ' + [start?.[1], ride?.[1]].filter(Boolean).join(' + '),
  };
}

// ---------- cards ----------

function card(r, { mine = false, tag = null } = {}) {
  const isSaved = savedKeys().has(r.runner_key);
  const dot = r.color_hex
    ? `<span class="dot" style="background:${r.color_hex}"></span>`
    : '<span class="dot" style="background:var(--line)"></span>';
  return `
    <div class="card${mine ? ' me' : ''}">
      <div class="row">
        ${dot}
        <div class="grow">
          <span class="name">${esc(r.display_name)}</span>
          ${mine ? ' <span class="tag">you</span>' : ''}
          ${r.bib_number ? ` <span class="bib">#${esc(r.bib_number)}</span>` : ''}
        </div>
        ${tag ? `<span class="tag">${esc(tag)}</span>` : ''}
        ${r.is_complete || tag ? '' : '<span class="badge">needs info</span>'}
        ${mine ? '' : `<button class="star${isSaved ? ' on' : ''}" data-save="${r.runner_key}"
             aria-label="${isSaved ? `Remove ${esc(r.display_name)} from my people` : `Save ${esc(r.display_name)}`}"
             aria-pressed="${isSaved}">${icon('star', { filled: isSaved })}</button>`}
      </div>
      <div class="row meta">${esc(startLine(r))}</div>
      ${r.transport_label ? `<div class="row meta">${transportIcon(r)}<span>${esc(r.transport_label)}${r.depart_time_local ? ' · ' + clock(r.depart_time_local) : ''}</span></div>` : ''}
      ${r.meetup_note ? `<div class="note">“${esc(r.meetup_note)}”</div>` : ''}
    </div>`;
}

// Saved people are labelled by the SAME client-side overlap as everyone
// else. v_saved_overlap reports the same facts, but as separate boolean
// columns -- rendering those directly made a person's tag change the
// moment you starred them ("same wave + ride" becoming "same wave"),
// which looks like the app changed its mind. The roster row carries the
// dimension keys the overlap needs, so look them up there.
function savedCard(s, mine) {
  const live = roster.find(r => r.runner_key === s.saved_runner_key);
  const hit = live ? overlap(mine, live) : null;
  return card(live ?? { ...s, runner_key: s.saved_runner_key }, {
    tag: hit ? hit.label : (live ? 'no overlap yet' : 'not on the roster'),
  });
}

// ---------- filters ----------

const filter = { color: null, wave: null, transport: null, q: '' };

function filterBar() {
  const colors = [...new Map(roster.filter(r => r.color_name).map(r => [r.color_name, r.color_hex])).entries()];
  const waves = [...new Set(roster.filter(r => r.wave_num).map(r => r.wave_num))].sort();
  const transports = [...new Set(roster.filter(r => r.transport_label).map(r => r.transport_label))].sort();
  const btn = (type, value, label, style = '') =>
    `<button class="mini${filter[type] === value ? ' on' : ''}" data-f="${type}" data-v="${esc(value)}" ${style}>${esc(label)}</button>`;

  return `
    <div class="filters">
      ${btn('color', null, 'All')}
      ${colors.map(([name, hex]) => btn('color', name, name, `style="border-color:${hex}"`)).join('')}
    </div>
    <div class="filters">
      ${waves.map(w => btn('wave', w, `Wave ${w}`)).join('')}
      ${transports.map(t => btn('transport', t, t.length > 18 ? t.slice(0, 17) + '…' : t)).join('')}
    </div>
    <input class="search" id="q" placeholder="Search name or bib" value="${esc(filter.q)}">`;
}

function visible() {
  const q = filter.q.trim().toLowerCase();
  return roster.filter(r =>
    (!filter.color     || r.color_name === filter.color) &&
    (!filter.wave      || r.wave_num === filter.wave) &&
    (!filter.transport || r.transport_label === filter.transport) &&
    (!q || r.display_name.toLowerCase().includes(q) || (r.bib_number || '').includes(q)));
}

// ---------- render ----------

function render() {
  const mine = roster.find(r => r.runner_key === me);
  const already = savedKeys();

  // Anyone you have already saved is in "your people" -- showing them
  // again as a suggestion would be suggesting what you already did.
  const near = roster
    .filter(r => r.runner_key !== me && !already.has(r.runner_key))
    .map(r => ({ r, hit: overlap(mine, r) }))
    .filter(x => x.hit)
    .sort((a, b) => a.hit.rank - b.hit.rank || a.r.display_name.localeCompare(b.r.display_name));

  const others = visible().filter(r => r.runner_key !== me);
  const total = roster.length - (mine ? 1 : 0);

  app.innerHTML = `
    ${mine
      ? `<h2>You</h2>${card(mine, { mine: true })}`
      : `<h2>You</h2><div class="card"><div class="meta">You're signed in but not on the roster right now.</div>
         <a href="me.html"><button class="ghost">Add me back</button></a></div>`}

    <h2>Your people ${saved.length ? `(${saved.length})` : ''}</h2>
    ${saved.length
      ? saved.map(s => savedCard(s, mine)).join('')
      : `<p class="empty">Nobody yet. Tap a star to add someone you want to find on race morning.</p>`}

    ${near.length ? `<h2>People near you (${near.length})</h2>
      ${near.map(x => card(x.r, { tag: x.hit.label })).join('')}` : ''}

    <h2>Everyone (${others.length}${others.length !== total ? ` of ${total}` : ''})</h2>
    ${filterBar()}
    ${others.length ? others.map(r => card(r)).join('') : '<p class="empty">Nobody matches that.</p>'}

    ${gaps.length ? `<h2>Still missing info</h2>
      <p class="empty">${gaps.length} ${gaps.length === 1 ? 'person hasn\'t' : 'people haven\'t'} filled everything in — ${esc(gaps.map(g => g.display_name).join(', '))}.</p>` : ''}

    <button class="ghost" id="signout">Sign out of this device</button>`;

  const link = document.querySelector('#edit-link');
  link.hidden = false;
  link.textContent = mine ? 'Edit my info' : 'Add me back';
}

// ---------- events ----------

app.addEventListener('click', async e => {
  const star = e.target.closest('[data-save]');
  if (star) {
    const key = Number(star.dataset.save);
    const on = savedKeys().has(key);
    star.disabled = true;
    try {
      if (on) await api(`/api/saved?key=${key}`, { method: 'DELETE' });
      else    await api('/api/saved', { method: 'POST', body: { saved_runner_key: key } });
      ({ saved } = await api('/api/saved'));
      render();
    } catch (err) { star.disabled = false; alert(err.message); }
    return;
  }

  const f = e.target.closest('[data-f]');
  if (f) {
    const raw = f.dataset.v === 'null' ? null : f.dataset.v;
    const value = f.dataset.f === 'wave' ? Number(raw) : raw;
    filter[f.dataset.f] = filter[f.dataset.f] === value ? null : value;
    render();
    return;
  }

  if (e.target.id === 'signout') { store.clear(); location.reload(); }
});

app.addEventListener('input', e => {
  if (e.target.id !== 'q') return;
  filter.q = e.target.value;
  const at = e.target.selectionStart;
  render();
  const box = document.querySelector('#q');
  box.focus();
  box.setSelectionRange(at, at);
});

// ---------- boot ----------

(async () => {
  me = await ensureAccess(app);
  try {
    const [a, b, c] = await Promise.all([api('/api/runners'), api('/api/saved'), api('/api/meetups')]);
    roster = a.runners; me = a.me ?? me; saved = b.saved; gaps = c.gaps ?? [];
    render();
  } catch (err) {
    // An expired or revoked token should send you back to the gate, not
    // leave you staring at an error you cannot act on.
    if (err.status === 401 || err.status === 403) { store.clear(); return location.reload(); }
    app.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
})();
