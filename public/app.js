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

/** "Orange · Wave 1 · Corral C · 9:10 AM", skipping what is unknown. */
export function startLine(r) {
  const parts = [];
  if (r.color_name)    parts.push(r.color_name);
  if (r.wave_num)      parts.push(`Wave ${r.wave_num}`);
  if (r.corral_letter) parts.push(`Corral ${r.corral_letter}`);
  if (r.start_time_local) parts.push(clock(r.start_time_local));
  return parts.length ? parts.join(' · ') : 'start info not set yet';
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
