// The roster page.
//
// Order is deliberate: the people you chose to care about, then the
// groups that might be worth caring about, then everyone. On real data
// the exact tier (same vehicle AND same minute) is usually empty because
// almost nobody knows their slot yet -- so empty tiers are hidden rather
// than shown as a row of zeros.

import { api, store, KEY, esc, icon, clock, startLine, transportIcon } from './app.js';
import { ensureAccess } from './gate.js';

const app = document.querySelector('#app');
let roster = [], saved = [], meetups = {}, me = null;
const savedKeys = () => new Set(saved.map(s => s.saved_runner_key));

// ---------- cards ----------

function card(r, { mine = false } = {}) {
  const isSaved = savedKeys().has(r.runner_key);
  const transport = r.transport_label
    ? `<div class="row meta">${transportIcon(r)}<span>${esc(r.transport_label)}${r.depart_time_local ? ' · ' + clock(r.depart_time_local) : ''}</span></div>`
    : '';
  return `
    <div class="card${mine ? ' me' : ''}">
      <div class="row">
        ${r.color_hex ? `<span class="dot" style="background:${r.color_hex}"></span>` : '<span class="dot" style="background:var(--line)"></span>'}
        <div class="grow">
          <span class="name">${esc(r.display_name)}</span>
          ${mine ? ' <span class="tag">you</span>' : ''}
          ${r.bib_number ? ` <span class="bib">#${esc(r.bib_number)}</span>` : ''}
        </div>
        ${r.is_complete ? '' : '<span class="badge">needs info</span>'}
        ${mine ? '' : `<button class="star${isSaved ? ' on' : ''}" data-save="${r.runner_key}"
             aria-label="${isSaved ? 'Remove from my people' : 'Save this person'}"
             aria-pressed="${isSaved}">${icon('star', { filled: isSaved })}</button>`}
      </div>
      <div class="row meta">${esc(startLine(r))}</div>
      ${transport}
      ${r.meetup_note ? `<div class="note">“${esc(r.meetup_note)}”</div>` : ''}
    </div>`;
}

const OVERLAP = [
  ['same_slot',    'same vehicle, same time'],
  ['same_corral',  'same corral'],
  ['same_wave',    'same village + wave'],
  ['same_vehicle', 'same vehicle'],
  ['same_village', 'same village'],
];

function savedCard(s) {
  const hit = OVERLAP.find(([k]) => s[k]);
  return `
    <div class="card">
      <div class="row">
        ${s.color_hex ? `<span class="dot" style="background:${s.color_hex}"></span>` : '<span class="dot" style="background:var(--line)"></span>'}
        <div class="grow"><span class="name">${esc(s.display_name)}</span>
          ${s.bib_number ? ` <span class="bib">#${esc(s.bib_number)}</span>` : ''}</div>
        <span class="tag">${hit ? esc(hit[1]) : 'no overlap yet'}</span>
        <button class="star on" data-save="${s.saved_runner_key}"
                aria-label="Remove from my people" aria-pressed="true">${icon('star', { filled: true })}</button>
      </div>
      <div class="row meta">${esc(startLine(s))}</div>
      ${s.transport_label ? `<div class="row meta">${transportIcon(s)}<span>${esc(s.transport_label)}${s.depart_time_local ? ' · ' + clock(s.depart_time_local) : ''}</span></div>` : ''}
      ${s.meetup_note ? `<div class="note">“${esc(s.meetup_note)}”</div>` : ''}
    </div>`;
}

// ---------- discovery tiers ----------

function tier(title, rows, line) {
  if (!rows?.length) return '';
  return `<h2>${esc(title)}</h2>` + rows.map(r => `
    <div class="card"><div class="row">
      <div class="grow"><span class="name">${esc(line(r))}</span></div>
      <span class="tag">${r.runner_count}</span>
    </div><div class="row meta">${esc(r.runners)}</div></div>`).join('');
}

function tiers() {
  return [
    tier('Same vehicle, same time', meetups.exact_transport,
      r => `${r.transport_label} · ${clock(r.depart_time_local)}`),
    tier('Same corral', meetups.same_corral,
      r => `${r.color_name} · Wave ${r.wave_num} · Corral ${r.corral_letter}`),
    tier('Same village and wave', meetups.same_wave,
      r => `${r.color_name} · Wave ${r.wave_num} · ${clock(r.start_time_local)}`),
    tier('On the same transport', meetups.same_vehicle,
      r => `${r.transport_label}${r.with_times < r.runner_count ? ` · only ${r.with_times} said when` : ''}`),
  ].join('');
}

// ---------- filters ----------

const filter = { color: null, wave: null, transport: null, q: '' };

function filterBar() {
  const colors = [...new Map(roster.filter(r => r.color_name)
    .map(r => [r.color_name, r.color_hex])).entries()];
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
  const others = visible().filter(r => r.runner_key !== me);
  const gaps = meetups.gaps?.length ?? 0;

  app.innerHTML = `
    ${mine
      ? `<h2>You</h2>${card(mine, { mine: true })}`
      : `<h2>You</h2><div class="card"><div class="meta">You're signed in but not on the roster right now.</div>
         <a href="me.html"><button class="ghost">Add me back</button></a></div>`}

    <h2>Your people ${saved.length ? `(${saved.length})` : ''}</h2>
    ${saved.length
      ? saved.map(savedCard).join('')
      : '<p class="empty">Tap the star on anyone below to add them here, with how you line up.</p>'}

    ${tiers()}

    <h2>Everyone (${others.length}${others.length !== roster.length - (mine ? 1 : 0) ? ` of ${roster.length - (mine ? 1 : 0)}` : ''})</h2>
    ${filterBar()}
    ${others.length ? others.map(r => card(r)).join('') : '<p class="empty">Nobody matches that.</p>'}

    ${gaps ? `<h2>Still missing info</h2><p class="empty">${gaps} ${gaps === 1 ? 'person' : 'people'} haven't filled everything in — ${esc(meetups.gaps.map(g => g.display_name).join(', '))}.</p>` : ''}

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
    try {
      if (on) await api(`/api/saved?key=${key}`, { method: 'DELETE' });
      else    await api('/api/saved', { method: 'POST', body: { saved_runner_key: key } });
      ({ saved } = await api('/api/saved'));
      render();
    } catch (err) { alert(err.message); }
    return;
  }

  const f = e.target.closest('[data-f]');
  if (f) {
    const value = f.dataset.v === 'null' ? null : f.dataset.v;
    const typed = f.dataset.f === 'wave' ? Number(value) : value;
    filter[f.dataset.f] = filter[f.dataset.f] === typed ? null : typed;
    if (f.dataset.f === 'color' && value === null) { filter.color = null; }
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
    roster = a.runners; me = a.me ?? me; saved = b.saved; meetups = c;
    render();
  } catch (err) {
    // An expired or revoked token should send you back to the gate, not
    // leave you staring at an error you cannot act on.
    if (err.status === 401 || err.status === 403) { store.clear(); return location.reload(); }
    app.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
})();
