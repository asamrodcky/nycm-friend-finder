// The entry form, shared by onboarding and by editing your own info.
//
// Only the name is required. Four of nineteen real roster entries are
// missing a colour, wave or corral and one has nothing but "Ferry", so a
// form that demands everything would make those people invent data or
// give up. Blank is a legitimate answer and stays blank.

import { clock, esc, icon, goalLabel, parseGoal } from './app.js';

export function entryFields(meta, cur = {}) {
  const chips = meta.colors.map(c => `
    <button type="button" class="chip" data-color="${c.color_key}"
            aria-pressed="${cur.color_key === c.color_key}"
            style="--chip:${c.color_hex};border-color:${c.color_hex}">${esc(c.color_name)}</button>`).join('');

  const opts = (rows, valueKey, labelFn, selected) =>
    `<option value="">— not sure yet —</option>` +
    rows.map(r => `<option value="${r[valueKey]}"${String(r[valueKey]) === String(selected) ? ' selected' : ''}>${esc(labelFn(r))}</option>`).join('');

  const role = cur.participant_role === 'spectator' ? 'spectator' : 'runner';
  const onMiles = new Set(
    String(cur.spectator_miles || '').split(',').filter(Boolean).map(Number));

  // 1..26. Mile 26 rather than 26.2 because a spectator standing at the
  // finish is standing at mile 26 as far as finding each other goes,
  // and a fractional chip would be the only odd one in the row.
  const mileChips = Array.from({ length: 26 }, (_, i) => i + 1).map(m => `
    <button type="button" class="chip mile" data-mile="${m}"
            aria-pressed="${onMiles.has(m)}">${m}</button>`).join('');

  return `
    <label id="f-role-label">Are you running or spectating?</label>
    <div class="chips" id="f-role" role="group" aria-labelledby="f-role-label">
      <button type="button" class="chip" data-role="runner"
              aria-pressed="${role === 'runner'}">I'm running</button>
      <button type="button" class="chip" data-role="spectator"
              aria-pressed="${role === 'spectator'}">I'm spectating</button>
    </div>

    <label for="f-name">Name <span class="hint">how the group knows you</span></label>
    <input id="f-name" maxlength="60" value="${esc(cur.display_name || '')}" autocomplete="name">

    <div id="f-runner-only">
    <label for="f-bib">Bib number <span class="hint">leave blank if you don't have it yet</span></label>
    <input id="f-bib" inputmode="numeric" maxlength="20" value="${esc(cur.bib_number || '')}">

    <label id="f-colors-label">Start colour</label>
    <div class="chips" id="f-colors" role="group" aria-labelledby="f-colors-label">${chips}</div>

    <label for="f-wave">Wave</label>
    <select id="f-wave">${opts(meta.waves, 'wave_key', w => `Wave ${w.wave_num} — ${clock(w.start_time_local)}`, cur.wave_key)}</select>

    <label for="f-corral">Corral</label>
    <select id="f-corral">${opts(meta.corrals, 'corral_key', c => `Corral ${c.corral_letter}`, cur.corral_key)}</select>

    <div class="derived" id="f-derived" role="status" aria-live="polite"></div>

    <label for="f-goal">Goal finish time <span class="hint">optional — h:mm, like 3:45</span></label>
    <input id="f-goal" inputmode="numeric" maxlength="8" placeholder="3:45"
           aria-describedby="f-goal-hint" value="${esc(goalLabel(cur.goal_time_seconds) || '')}">
    <div class="hint" id="f-goal-hint">Only people who follow you can see this. It is what
      your projected mile times are built from.</div>
    </div>

    <div id="f-spectator-only" hidden>
      <label id="f-miles-label">Which miles will you be at?
        <span class="hint">pick up to 8 — tap again to remove</span></label>
      <div class="chips miles" id="f-miles" role="group" aria-labelledby="f-miles-label">${mileChips}</div>

      <label id="f-bring-label">Bringing anything?</label>
      <div class="chips" id="f-bring" role="group" aria-labelledby="f-bring-label">
        <button type="button" class="chip" data-bring="sign"
                aria-pressed="${cur.has_sign ? 'true' : 'false'}">Sign / cowbell</button>
        <button type="button" class="chip" data-bring="support"
                aria-pressed="${cur.has_support ? 'true' : 'false'}">Gels / hydration</button>
      </div>
    </div>

    <!-- RUNNERS ONLY, and it took a spectator reading it to see why. Every
         option in here is a way to reach the Staten Island start: the
         ferry, the Verrazzano buses, a charity coach. A spectator going to
         mile 18 in Manhattan is not "getting to the start" and has no
         departure time, so asking was the same mistake as asking them for
         a corral. Wrapped so paintRole can hide the pair together. -->
    <div id="f-getting-there">
      <label for="f-transport">Getting to the start</label>
      <select id="f-transport">${opts(meta.transports, 'transport_key', t => t.transport_label, cur.transport_key)}</select>

      <label for="f-departs">Departure time</label>
      <select id="f-departs" aria-describedby="f-departs-hint">${opts(meta.departure_slots, 'value', s => s.label, cur.depart_time_local)}</select>
      <div class="hint" id="f-departs-hint"></div>
    </div>

    <label for="f-note">What you'll be wearing <span class="hint">optional — throwaway layers too</span></label>
    <input id="f-note" maxlength="140" placeholder="grey puffy over orange singlet, neon shoes"
           value="${esc(cur.meetup_note || '')}">

    <label for="f-insta">Instagram <span class="hint">optional — easier than describing yourself</span></label>
    <input id="f-insta" maxlength="120" autocapitalize="none" autocorrect="off" spellcheck="false"
           placeholder="@yourhandle" aria-describedby="f-insta-hint"
           value="${cur.instagram ? '@' + esc(cur.instagram) : ''}">
    <div class="hint" id="f-insta-hint">Everyone who can see the roster can see this.</div>`;
}

/** Wires colour chips, the derived start time, and the departure guard. */
export function wireEntryFields(root, meta) {
  const $ = id => root.querySelector('#' + id);
  let colorKey = Number(root.querySelector('#f-colors .chip[aria-pressed="true"]')?.dataset.color) || null;
  let role = root.querySelector('#f-role .chip[aria-pressed="true"]')?.dataset.role || 'runner';

  const pressed = sel => [...root.querySelectorAll(sel)].filter(b => b.getAttribute('aria-pressed') === 'true');
  const toggle  = btn => btn.setAttribute('aria-pressed',
    String(btn.getAttribute('aria-pressed') !== 'true'));

  // Swapping role swaps which half of the form exists. Doing it by
  // hiding rather than rebuilding keeps anything already typed in the
  // shared fields -- name, transport, what you are wearing -- which
  // someone who picks the wrong chip first would otherwise lose.
  function paintRole() {
    root.querySelector('#f-runner-only').hidden    = role !== 'runner';
    root.querySelector('#f-spectator-only').hidden = role !== 'spectator';
    root.querySelectorAll('#f-role .chip').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.role === role)));
    // The colour/wave/corral block belongs to runners too, but it sits
    // outside f-runner-only because the derived start-time box is wired
    // to it. Hide the labels and controls together so a spectator is
    // never asked for a corral -- being asked was the whole problem.
    for (const id of ['f-colors-label', 'f-colors', 'f-wave', 'f-corral', 'f-derived',
                      'f-getting-there']) {
      const el = root.querySelector('#' + id);
      if (el) el.hidden = role !== 'runner';
      const lab = root.querySelector(`label[for="${id}"]`);
      if (lab) lab.hidden = role !== 'runner';
    }
  }

  root.querySelector('#f-role').addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    role = btn.dataset.role;
    paintRole();
  });

  root.querySelector('#f-miles').addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    if (btn.getAttribute('aria-pressed') !== 'true' && pressed('#f-miles .chip').length >= 8) return;
    toggle(btn);
  });

  root.querySelector('#f-bring').addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (btn) toggle(btn);
  });

  $('f-colors').addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    colorKey = Number(btn.dataset.color);
    // Scoped to this group. It used to clear every .chip on the form,
    // which with mile and role chips now present would wipe them too.
    root.querySelectorAll('#f-colors .chip').forEach(b =>
      b.setAttribute('aria-pressed', String(b === btn)));
    paint();
  });

  // A departure time with no vehicle is a time for nothing, and the API
  // rejects it -- so say so here instead of letting the save fail.
  function guardDeparture() {
    const hasTransport = !!$('f-transport').value;
    $('f-departs').disabled = !hasTransport;
    if (!hasTransport) $('f-departs').value = '';
    $('f-departs-hint').textContent = hasTransport
      ? 'The time printed on your ferry or bus confirmation.'
      : 'Pick how you are getting there first.';
  }

  function paint() {
    const wave  = meta.waves.find(w => String(w.wave_key) === $('f-wave').value);
    const color = meta.colors.find(c => c.color_key === colorKey);
    const bits = [];
    if (wave)  bits.push(`<strong>You start at ${clock(wave.start_time_local)}</strong>`);
    if (color) bits.push(`${esc(color.village_name)}${color.bridge_level ? ' · ' + esc(color.bridge_level.toLowerCase()) : ''}`);
    if (wave)  bits.push(`Corrals open ${clock(wave.corral_open)}, close ${clock(wave.corral_close)}`);
    $('f-derived').innerHTML = bits.length
      ? bits.join('<br>')
      : 'Pick a colour and wave and your start time shows up here.';
    guardDeparture();
  }

  $('f-wave').addEventListener('change', paint);
  $('f-transport').addEventListener('change', guardDeparture);
  paint();
  paintRole();

  return () => ({
    participant_role:  role,
    goal_time_seconds: role === 'runner' ? parseGoal($('f-goal').value) : null,
    spectator_miles:   role === 'spectator'
      ? pressed('#f-miles .chip').map(b => Number(b.dataset.mile)) : [],
    has_sign:    role === 'spectator' && !!pressed('#f-bring .chip[data-bring="sign"]').length ? 1 : 0,
    has_support: role === 'spectator' && !!pressed('#f-bring .chip[data-bring="support"]').length ? 1 : 0,
    display_name:      $('f-name').value.trim(),
    bib_number:        $('f-bib').value.trim() || null,
    color_key:         colorKey,
    wave_key:          Number($('f-wave').value) || null,
    corral_key:        Number($('f-corral').value) || null,
    transport_key:     Number($('f-transport').value) || null,
    depart_time_local: $('f-departs').value || null,
    meetup_note:       $('f-note').value.trim() || null,
    instagram:         $('f-insta').value.trim() || null,
  });
}

/** PIN + confirmation. Only shown when a PIN is being CREATED. */
export function pinFields() {
  return `
    <label for="f-pin">Choose a PIN</label>
    <input id="f-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"
           aria-describedby="f-pin-hint">
    <div class="hint" id="f-pin-hint">6 digits. Don't reuse a PIN you use anywhere else, and avoid 123456.</div>

    <label for="f-pin2">Confirm PIN</label>
    <input id="f-pin2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password">`;
}

/** Returns the PIN, or throws the reason it is not usable. */
export function readPin(root) {
  const pin  = root.querySelector('#f-pin').value.trim();
  const pin2 = root.querySelector('#f-pin2').value.trim();
  // Mirrors pinLooksValid so the length is caught before a round trip.
  // The server owns the rule; the "too obvious" half is checked only
  // there, so there is one copy of the interesting logic, not two.
  if (!/^\d{6}$/.test(pin)) throw new Error('PIN must be 6 digits');
  // Caught here rather than server-side: a typo at creation locks you
  // out of your own entry permanently, and there is no email to recover
  // through -- Sam has to clear it by hand.
  if (pin !== pin2) throw new Error('Those PINs do not match');
  return pin;
}
