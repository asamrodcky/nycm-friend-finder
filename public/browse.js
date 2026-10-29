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
//
// The ladder below was tightened a second time: see the note on
// sameRide. A shared vehicle no longer counts without a shared
// departure time, and sharing a village across different WAVES does not
// count at all. Both were producing confident-looking matches between
// people who would never see each other. Sharing a wave across
// different villages does still count -- see sameWave.

import { api, store, KEY, esc, icon, clock, startFacts, transportIcon, watchForUpdates } from './app.js';
import { ensureAccess } from './gate.js';

const app = document.querySelector('#app');
let roster = [], saved = [], gaps = [], me = null;
const savedKeys = () => new Set(saved.map(s => s.saved_runner_key));

// ---------- overlap ----------
//
// The question this answers is narrow on purpose: could you and this
// person actually run into each other on race morning? There are only
// two occasions where that can happen -- the journey to Staten Island,
// and the start village once you are there -- so a match has to be one
// of those. Anything else is a coincidence that looks like a lead.
//
// Every test checks both sides for null first: in JS `null === null` is
// true, so without that guard two people who both have no corral would
// read as sharing one -- the same trap the SQL views guard against.

const both = (a, b) => a !== null && a !== undefined && a === b;

/**
 * Same wave: the same start time, whatever village you are in.
 *
 * Village is deliberately NOT required. The three start villages at
 * Fort Wadsworth are walkable -- Sam visited friends in another colour's
 * village on race morning last year -- so same wave across colours is
 * the same half-hour in the same venue, a short walk apart. It is a
 * weaker match than sharing a village, not a false one.
 *
 * This is the same principle that threw out the old colour-only rung:
 * what makes two people findable is being there at the same TIME. That
 * rung spanned different waves and could be two hours apart. This one
 * cannot be apart at all.
 */
const sameWave = (m, t) => both(m.wave_key, t.wave_key);

/** Same village at the same time: no walk between villages needed. */
const sameStart = (m, t) => both(m.color_key, t.color_key) && sameWave(m, t);

/**
 * ...and the same corral, so you are penned in together.
 *
 * Built on sameStart, not sameWave, and that is load-bearing: corral
 * letters only mean anything inside a colour. Orange C and Blue C are
 * different pens in different villages, so matching on the letter alone
 * would send two people to opposite ends of Fort Wadsworth to look for
 * each other.
 */
const sameCorral = (m, t) => sameStart(m, t) && both(m.corral_key, t.corral_key);

/**
 * The same vehicle at the same departure time.
 *
 * The time is required, not a bonus. "We are both on the ferry" was the
 * single worst signal in the old ladder: the slots run 04:00 to 08:30,
 * so two ferry riders can be four and a half hours apart and were still
 * being called a match. A shared vehicle with no shared time is not a
 * meetup, it is a coincidence of transport mode.
 *
 * transport_is_matchable excludes the vague answers -- "Bus, not sure
 * which", "Still deciding" -- and "Have My Own Transportation", where
 * two people leaving at the same minute are still in separate cars.
 * Checked on both sides even though a shared transport_key means a
 * shared dim_transport row and therefore the same flag: the rest of
 * this file earns its correctness by never assuming that, and the
 * assumption is the kind that stops holding quietly.
 */
const sameRide = (m, t) =>
  !!m.transport_is_matchable && !!t.transport_is_matchable &&
  both(m.transport_key, t.transport_key) &&
  both(m.depart_time_local, t.depart_time_local);

// Closest first, where "close" means how much of the morning you
// actually spend within reach of each other. Travelling together and
// starting together is all of it. A shared village beats a shared ride,
// because the village is where you stand around for half an hour and
// the ride is where you are herded. A shared wave alone is last: same
// time, different village, one walk away.
//
// First match wins, so each person gets exactly one reason.
const LADDER = [
  ['same ride + corral',  (m, t) => sameRide(m, t) && sameCorral(m, t)],
  ['same ride + wave',    (m, t) => sameRide(m, t) && sameWave(m, t)],
  ['same corral',         (m, t) => sameCorral(m, t)],
  ['same village + wave', (m, t) => sameStart(m, t)],
  ['same ride',           (m, t) => sameRide(m, t)],
  ['same wave',           (m, t) => sameWave(m, t)],
];

/** Returns { rank, label } or null when you could not run into them. */
function overlap(mine, them) {
  if (!mine) return null;
  const rung = LADDER.findIndex(([, test]) => test(mine, them));
  return rung === -1 ? null : { rank: rung, label: LADDER[rung][0] };
}

// How many people "near you" is worth having. Walk the ladder from the
// top and stop once you have this many -- so a crowded wave shows only
// its strongest matches, and a lonely one keeps descending until it
// finds somebody.
//
// The number is load-bearing and was measured, not guessed. Seeding 200
// production-shaped runners locally put the median list at 44 people
// and one of them at 7,268px, about ten phone screens before you reach
// "Everyone". That is a second roster, not a shortlist.
//
// The obvious version of this -- "fall back to the weak rungs only if
// you have NO strong ones" -- is worse than doing nothing. On the real
// 22-person roster most people do have one strong match, so the weak
// rungs get suppressed and the median person drops from 5 matches to 2.
// It would have made the live app worse on race day to fix a problem
// that only exists at 200. Counting to 6 instead of to 1 is a no-op at
// 22 and takes 200 from a median of 44 down to 13.
const NEAR_TARGET = 6;

// ...and a ceiling, because the rung that crosses the target is taken
// whole. One seeded runner had no strong matches and 36 people in their
// wave; cutting a category off in the middle is arbitrary, so take it
// all and cap what gets drawn. Anyone past the cap is still one filter
// away in Everyone.
const NEAR_MAX = 20;

/**
 * The people worth showing you, strongest first.
 *
 * Returns { shown, hidden }. Anyone already starred is excluded --
 * suggesting someone you have already chosen is suggesting what you
 * already did.
 */
function peopleNearMe(mine, excluded) {
  if (!mine) return { shown: [], hidden: 0 };

  const buckets = LADDER.map(() => []);
  for (const r of roster) {
    if (r.runner_key === me || excluded.has(r.runner_key)) continue;
    const rung = LADDER.findIndex(([, test]) => test(mine, r));
    if (rung >= 0) buckets[rung].push({ r, hit: { rank: rung, label: LADDER[rung][0] } });
  }

  const picked = [];
  for (const bucket of buckets) {
    if (picked.length >= NEAR_TARGET) break;
    bucket.sort((a, b) => a.r.display_name.localeCompare(b.r.display_name));
    picked.push(...bucket);
  }
  return { shown: picked.slice(0, NEAR_MAX), hidden: Math.max(0, picked.length - NEAR_MAX) };
}

/**
 * Why the "people near you" list is empty, which is now a normal state
 * rather than a sign of a small roster -- the ladder above rejects the
 * loose matches that used to keep it populated. An empty section with
 * no explanation reads as the app having nothing to say.
 */
function whyNobodyNear(mine) {
  const canMatchStart = !!mine.wave_key;
  const canMatchRide  = mine.transport_is_matchable && mine.depart_time_local;
  return canMatchStart || canMatchRide
    ? 'Nobody shares your wave, or your ride at your departure time, yet. Everyone else is below.'
    : 'Add your start colour and wave — and your departure time, if you have one — and the people you could actually run into will show up here.';
}

// ---------- cards ----------

// A badge. `hex` fills it with the start colour; without one it is the
// neutral pill. The fill is darkened by the same ~15% as the form's
// colour chips, which is what gets white text over the seeded orange to
// clear AA -- see the note on .pill.solid in app.css.
const pill = (label, hex) => hex
  ? `<span class="pill solid" style="--pill:${hex}">${esc(label)}</span>`
  : `<span class="pill">${esc(label)}</span>`;

// An unanswered slot. Dashed and muted, never red: four of nineteen real
// entries genuinely do not know their corral yet, and the form tells
// everyone "blank is fine" (§19). It holds the badge's position so the
// row still lines up with the cards above and below it.
//
// The em dash is hidden from assistive tech, which would read it as
// nothing or as "dash"; "Wave not set" is spoken instead.
const openPill = key =>
  `<span class="pill open">${esc(key)} <span aria-hidden="true">—</span><span class="sr-only">not set</span></span>`;

// A time, right-aligned so the times form a scannable column down the
// page. The key word is what keeps row 2's start time from reading as
// row 3's departure time -- and it is the only thing a screen reader
// gets, which otherwise hears two bare clock times per card.
const when = (key, hhmm) =>
  `<span class="when"><span class="when-k">${key}</span> ${clock(hhmm)}</span>`;

function card(r, { mine = false, tag = null } = {}) {
  const isSaved = savedKeys().has(r.runner_key);
  const facts = startFacts(r);
  const anyStart = facts.some(f => f.label);

  // is_complete is bib + colour + wave + corral. The start facts now
  // show their own gaps as dashed slots, so a card with all three slots
  // filled and a "needs info" badge looks like it is complaining about
  // nothing -- the only thing left it can mean is the bib. Say which.
  const needs = facts.every(f => f.label) ? 'needs bib' : 'needs info';
  return `
    <div class="card${mine ? ' me' : ''}">
      <div class="row">
        <span class="dot" style="background:${r.color_hex || 'var(--line)'}"></span>
        <div class="grow">
          <span class="name">${esc(r.display_name)}</span>
          ${mine ? ' <span class="tag">you</span>' : ''}
          ${r.bib_number ? ` <span class="bib">#${esc(r.bib_number)}</span>` : ''}
        </div>
        ${tag ? `<span class="tag match">${esc(tag)}</span>` : ''}
        ${r.is_complete || tag ? '' : `<span class="badge">${needs}</span>`}
        ${mine ? '' : `<button class="star${isSaved ? ' on' : ''}" data-save="${r.runner_key}"
             aria-label="${isSaved ? `Remove ${esc(r.display_name)} from my people` : `Save ${esc(r.display_name)}`}"
             aria-pressed="${isSaved}">${icon('star', { filled: isSaved })}</button>`}
      </div>

      <div class="facts">
        ${anyStart
          // Joined on a space, not nothing. Flex ignores whitespace between
          // items so the layout is unchanged, but it stops assistive tech
          // that flattens adjacent inline text from reading "OrangeWave 2".
          ? facts.map(f => (f.label ? pill(f.label, f.hex) : openPill(f.key))).join(' ') +
            (r.start_time_local ? ' ' + when('starts', r.start_time_local) : '')
          : openPill('Start info')}
      </div>

      ${r.transport_label ? `<div class="facts">
        <span class="pill">${transportIcon(r)}${esc(r.transport_label)}</span>
        ${r.depart_time_local ? when('leaves', r.depart_time_local) : ''}
      </div>` : ''}

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
  // aria-pressed, not just the .on class: which filter is active was
  // carried by background colour alone, so a screen reader user had no
  // way to know what the list in front of them was already narrowed to.
  // data-v has to round-trip back to the value, and esc(null) is "",
  // which reads back as the empty string, not null. The "All" chip is
  // the only null, and it was the one losing its pressed state: state
  // used to be baked in at build time, so nothing ever read it back.
  const btn = (type, value, label, style = '') =>
    `<button class="mini${filter[type] === value ? ' on' : ''}" data-f="${type}"
             data-v="${value === null ? 'null' : esc(value)}"
             aria-pressed="${filter[type] === value}" ${style}>${esc(label)}</button>`;

  return `
    <div class="filters" role="group" aria-label="Filter by start colour">
      ${btn('color', null, 'All')}
      ${colors.map(([name, hex]) => btn('color', name, name, `style="border-color:${hex}"`)).join('')}
    </div>
    <div class="filters" role="group" aria-label="Filter by wave or transport">
      ${waves.map(w => btn('wave', w, `Wave ${w}`)).join('')}
      ${transports.map(t => btn('transport', t, t.length > 18 ? t.slice(0, 17) + '…' : t)).join('')}
    </div>`;
}

const matches = r => {
  const q = filter.q.trim().toLowerCase();
  return (!filter.color     || r.color_name === filter.color)
      && (!filter.wave      || r.wave_num === filter.wave)
      && (!filter.transport || r.transport_label === filter.transport)
      && (!q || r.display_name.toLowerCase().includes(q) || (r.bib_number || '').includes(q));
};

// Everyone's cards, built once and then shown or hidden. Rebuilt only
// when the DATA changes -- a star, a fresh fetch -- never when the
// filter does.
let everyoneCards = [];

/**
 * Rebuilds the Everyone list. Costly, so it is called when the roster
 * or the saved set changes, not on a keystroke.
 */
function paintEveryone() {
  const host = document.querySelector('#everyone');
  if (!host) return;
  const list = roster.filter(r => r.runner_key !== me);
  host.innerHTML = list.map(r => card(r)).join('');
  everyoneCards = [...host.children].map((el, i) => ({ el, r: list[i] }));
  applyFilter();
}

/**
 * Narrows the list without rebuilding it.
 *
 * This used to be a full `render()` -- every card on the page thrown
 * away and reparsed from a string on every keystroke, plus refocusing
 * the search box and restoring the caret by hand afterwards, because
 * the box being typed into was one of the things destroyed.
 *
 * Measured at 200 seeded runners: 111-178ms per keystroke on a Mac,
 * 256 cards and 5,739 nodes rebuilt each time. The target is a cold
 * phone at 5am, which is several times slower again. §21 expected this
 * to bite at 1000; it bites at 200.
 *
 * Toggling `hidden` on cards that already exist costs no parsing and no
 * reflow beyond the rows that actually changed -- and because the input
 * is never replaced, focus and the caret look after themselves.
 */
function applyFilter() {
  let shown = 0;
  for (const { el, r } of everyoneCards) {
    const ok = matches(r);
    if (el.hidden === ok) el.hidden = !ok;   // only write when it changes
    if (ok) shown++;
  }

  const total = everyoneCards.length;
  const head = document.querySelector('#everyone-head');
  if (head) head.textContent = `Everyone (${shown}${shown !== total ? ` of ${total}` : ''})`;

  const none = document.querySelector('#no-match');
  if (none) none.hidden = shown > 0;

  const status = document.querySelector('#status');
  if (status) {
    const narrowed = filter.q || filter.color || filter.wave || filter.transport;
    status.textContent = narrowed ? `${shown} of ${total} people match` : `${total} people on the roster`;
  }
}

/** Filter buttons carry state in a class and aria-pressed; set both in place. */
function paintFilterStates() {
  for (const b of document.querySelectorAll('#filters [data-f]')) {
    const raw = b.dataset.v === 'null' ? null : b.dataset.v;
    const value = b.dataset.f === 'wave' ? Number(raw) : raw;
    const on = filter[b.dataset.f] === value;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
}

// ---------- render ----------

function render() {
  const mine = roster.find(r => r.runner_key === me);
  const already = savedKeys();

  const near = peopleNearMe(mine, already);

  app.innerHTML = `
    ${mine
      ? `<h2>You</h2>${card(mine, { mine: true })}`
      : `<h2>You</h2><div class="card"><div class="meta">You're signed in but not on the roster right now.</div>
         <a href="me.html" class="btn">Add me back</a></div>`}

    <h2>Your people ${saved.length ? `(${saved.length})` : ''}</h2>
    ${saved.length
      ? saved.map(s => savedCard(s, mine)).join('')
      : `<p class="empty">Nobody yet. Tap a star to add someone you want to find on race morning.</p>`}

    ${mine ? `<h2>People near you ${near.shown.length ? `(${near.shown.length})` : ''}</h2>
      ${near.shown.length
        ? near.shown.map(x => card(x.r, { tag: x.hit.label })).join('') +
          (near.hidden ? `<p class="empty">${near.hidden} more share your wave — filter Everyone below to see them.</p>` : '')
        : `<p class="empty">${esc(whyNobodyNear(mine))}</p>`}` : ''}

    <h2 id="everyone-head"></h2>
    <div id="filters">${filterBar()}</div>
    <input class="search" id="q" aria-label="Search name or bib"
           placeholder="Search name or bib" value="${esc(filter.q)}">
    <div id="everyone"></div>
    <p class="empty" id="no-match" hidden>Nobody matches that.</p>

    ${gaps.length ? `<h2>Still missing info</h2>
      <p class="empty">${gaps.length} ${gaps.length === 1 ? 'person hasn\'t' : 'people haven\'t'} filled everything in — ${esc(gaps.map(g => g.display_name).join(', '))}.</p>` : ''}

    <button class="ghost" id="signout">Sign out of this device</button>`;

  // Fills #everyone, then applyFilter() sets the heading, the no-match
  // line and the live region. That live region lives in the page shell,
  // never inside #app: #app is replaced wholesale here, and a live
  // region that gets replaced does not reliably announce.
  paintEveryone();

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
    paintFilterStates();
    applyFilter();
    return;
  }

  if (e.target.id === 'signout') { store.clear(); location.reload(); }
});

// No render() here, and so no refocusing and no caret arithmetic: the
// box being typed into is not one of the things that gets replaced any
// more. That hand-restoration only ever existed to paper over the
// rebuild.
app.addEventListener('input', e => {
  if (e.target.id !== 'q') return;
  filter.q = e.target.value;
  applyFilter();
});

// ---------- boot ----------

(async () => {
  me = await ensureAccess(app);

  // Not while a filter is up: reloading would drop what they narrowed to.
  watchForUpdates(() => !filter.q && !filter.color && !filter.wave && !filter.transport);

  try {
    const [a, b, c] = await Promise.all([api('/api/runners'), api('/api/saved'), api('/api/meetups')]);
    roster = a.runners; me = a.me ?? me; saved = b.saved; gaps = c.gaps ?? [];
    render();
  } catch (err) {
    // An expired or revoked token should send you back to the gate, not
    // leave you staring at an error you cannot act on.
    if (err.status === 401 || err.status === 403) { store.clear(); return location.reload(); }
    app.innerHTML = `<div class="error" role="alert">${esc(err.message)}</div>`;
  }
})();
