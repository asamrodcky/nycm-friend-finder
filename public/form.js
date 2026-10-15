// The entry form, shared by onboarding and by editing your own info.
//
// Only the name is required. Four of nineteen real roster entries are
// missing a colour, wave or corral and one has nothing but "Ferry", so a
// form that demands everything would make those people invent data or
// give up. Blank is a legitimate answer and stays blank.

import { clock, esc, icon } from './app.js';

export function entryFields(meta, cur = {}) {
  const chips = meta.colors.map(c => `
    <button type="button" class="chip" data-color="${c.color_key}"
            aria-pressed="${cur.color_key === c.color_key}"
            style="border-color:${c.color_hex}">${esc(c.color_name)}</button>`).join('');

  const opts = (rows, valueKey, labelFn, selected) =>
    `<option value="">— not sure yet —</option>` +
    rows.map(r => `<option value="${r[valueKey]}"${String(r[valueKey]) === String(selected) ? ' selected' : ''}>${esc(labelFn(r))}</option>`).join('');

  return `
    <label for="f-name">Name <span class="hint">how the group knows you</span></label>
    <input id="f-name" maxlength="60" value="${esc(cur.display_name || '')}" autocomplete="name">

    <label for="f-bib">Bib number <span class="hint">leave blank if you don't have it yet</span></label>
    <input id="f-bib" inputmode="numeric" maxlength="20" value="${esc(cur.bib_number || '')}">

    <label>Start colour</label>
    <div class="chips" id="f-colors">${chips}</div>

    <label for="f-wave">Wave</label>
    <select id="f-wave">${opts(meta.waves, 'wave_key', w => `Wave ${w.wave_num} — ${clock(w.start_time_local)}`, cur.wave_key)}</select>

    <label for="f-corral">Corral</label>
    <select id="f-corral">${opts(meta.corrals, 'corral_key', c => `Corral ${c.corral_letter}`, cur.corral_key)}</select>

    <div class="derived" id="f-derived"></div>

    <label for="f-transport">Getting to the start</label>
    <select id="f-transport">${opts(meta.transports, 'transport_key', t => t.transport_label, cur.transport_key)}</select>

    <label for="f-departs">Departure time</label>
    <select id="f-departs">${opts(meta.departure_slots, 'value', s => s.label, cur.depart_time_local)}</select>
    <div class="hint" id="f-departs-hint"></div>

    <label for="f-note">Note <span class="hint">optional — what to look for</span></label>
    <input id="f-note" maxlength="140" placeholder="orange poncho, by the Starbucks"
           value="${esc(cur.meetup_note || '')}">`;
}

/** Wires colour chips, the derived start time, and the departure guard. */
export function wireEntryFields(root, meta) {
  const $ = id => root.querySelector('#' + id);
  let colorKey = Number(root.querySelector('.chip[aria-pressed="true"]')?.dataset.color) || null;

  $('f-colors').addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    colorKey = Number(btn.dataset.color);
    root.querySelectorAll('.chip').forEach(b =>
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

  return () => ({
    display_name:      $('f-name').value.trim(),
    bib_number:        $('f-bib').value.trim() || null,
    color_key:         colorKey,
    wave_key:          Number($('f-wave').value) || null,
    corral_key:        Number($('f-corral').value) || null,
    transport_key:     Number($('f-transport').value) || null,
    depart_time_local: $('f-departs').value || null,
    meetup_note:       $('f-note').value.trim() || null,
  });
}

/** PIN + confirmation. Only shown when a PIN is being CREATED. */
export function pinFields() {
  return `
    <label for="f-pin">Choose a PIN</label>
    <input id="f-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password">
    <div class="hint">4–6 digits. Six is safer. Don't reuse a PIN you use anywhere else.</div>

    <label for="f-pin2">Confirm PIN</label>
    <input id="f-pin2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password">`;
}

/** Returns the PIN, or throws the reason it is not usable. */
export function readPin(root) {
  const pin  = root.querySelector('#f-pin').value.trim();
  const pin2 = root.querySelector('#f-pin2').value.trim();
  if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN must be 4 to 6 digits');
  // Caught here rather than server-side: a typo at creation locks you
  // out of your own entry permanently, and there is no email to recover
  // through -- Sam has to clear it by hand.
  if (pin !== pin2) throw new Error('Those PINs do not match');
  return pin;
}
