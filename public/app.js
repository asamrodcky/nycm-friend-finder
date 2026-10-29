// Shared client helpers: token storage, API calls, icons, formatting.
//
// Two tokens live in localStorage -- the group token (you know the
// password) and the profile token (you are a specific runner). The group
// PASSWORD and the PIN are never stored, only what they exchange for.

const KEY = { group: 'nycm.group', profile: 'nycm.profile', me: 'nycm.me' };

export const store = {
  get:   k => { try { return localStorage.getItem(k); } catch { return null; } },
  set:   (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  clear: () => { try { Object.values(KEY).forEach(k => localStorage.removeItem(k)); } catch {} },
};
export { KEY };

/** Calls the API with the strongest token we hold. */
export async function api(path, { method = 'GET', body } = {}) {
  const token = store.get(KEY.profile) || store.get(KEY.group);
  const res = await fetch(path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }

  if (!res.ok) {
    // The API returns {error} for one problem and {errors:[]} for a
    // failed form, so flatten both into something throwable.
    const message = data.errors?.join('. ') || data.error || `request failed (${res.status})`;
    throw Object.assign(new Error(message), { status: res.status });
  }
  return data;
}

// ---------- formatting ----------

/** '09:45' -> '9:45 AM'. Times are stored 24-hour and shown 12-hour. */
export function clock(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export const dash = v => (v === null || v === undefined || v === '' ? '—' : v);

/**
 * The start assignment as three discrete facts: colour, wave, corral.
 *
 * This used to be one dot-separated sentence -- "Orange · Wave 1 · Corral
 * C · 9:10 AM" -- which is the hardest possible shape to read at a
 * glance. These are the exact values you match on, so the card renders
 * each as its own badge: the eye pattern-matches three small blocks down
 * a column of cards without reading any of them as words.
 *
 * All three slots come back whether they are known or not, so the badges
 * line up vertically across cards and a gap is a gap in a fixed position
 * rather than a row of different length. `key` names the slot for the
 * unknown case; `label` is null when nobody has filled it in.
 */
export function startFacts(r) {
  return [
    { key: 'Colour', label: r.color_name || null, hex: r.color_hex || null },
    { key: 'Wave',   label: r.wave_num ? `Wave ${r.wave_num}` : null },
    { key: 'Corral', label: r.corral_letter ? `Corral ${r.corral_letter}` : null },
  ];
}

// ---------- icons ----------
// Inline SVG only: no icon library, no dependency, no payload.

const PATHS = {
  ferry:   '<path d="M3 14l1.5-5h15L21 14"/><path d="M2 14c0 4 3 6 10 6s10-2 10-6"/><path d="M12 4v5"/>',
  bus:     '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M3 11h18M7 17v2M17 17v2"/>',
  car:     '<path d="M3 13l2-5h14l2 5v4H3z"/><circle cx="7.5" cy="17" r="1.5"/><circle cx="16.5" cy="17" r="1.5"/>',
  walk:    '<circle cx="13" cy="4.5" r="1.8"/><path d="M12 8l-2 5 3 2 1 6M10 13L7 20M14 10l4 2"/>',
  unknown: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3V14"/><path d="M12 17.5v.01"/>',
  star:    '<path d="M12 3.5l2.6 5.5 5.9.8-4.3 4.2 1 5.9L12 17.1l-5.2 2.8 1-5.9L3.5 9.8l5.9-.8z"/>',
  edit:    '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
};

export function icon(name, { filled = false } = {}) {
  const d = PATHS[name] || PATHS.unknown;
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"${filled ? ' fill="currentColor"' : ''}>${d}</svg>`;
}

export const transportIcon = r => icon(r.transport_icon || 'unknown');

/** Avoids injecting roster text, which people type, straight into HTML. */
export const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- new deploys ----------

/**
 * Reloads the page when a newer build is live.
 *
 * Cache headers fix the next visit; they do nothing for a tab that is
 * already open, and on a phone the roster tab stays open for days. The
 * deploy script stamps version.json, so comparing it when the tab comes
 * back into view is enough to pick up a fix without anyone being told to
 * refresh.
 *
 * safe() is the veto: a half-typed form or an active search is worth
 * more than being on the newest build, so the page reloads at the next
 * opportunity instead.
 */
export function watchForUpdates(safe = () => true) {
  const read = async () => {
    try {
      const res = await fetch('version.json', { cache: 'no-store' });
      return res.ok ? (await res.json()).build : null;
    } catch { return null; }   // offline: try again next time
  };

  read().then(booted => {
    if (!booted) return;       // never stamped, nothing to compare against
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible' || !safe()) return;
      const live = await read();
      if (live && live !== booted) location.reload();
    });
  });
}
