// Editing your own entry.
//
// There is no route for editing anyone else, so this page never takes a
// runner key -- the server reads it from the signed profile token. Saving
// supersedes the previous row rather than overwriting it, so moving to a
// later wave stays visible in the snapshot.

import { api, store, KEY, esc } from './app.js';
import { ensureAccess } from './gate.js';
import { entryFields, wireEntryFields } from './form.js';

const app = document.querySelector('#app');

(async () => {
  await ensureAccess(app);

  let meta, mine;
  try {
    const [m, r] = await Promise.all([api('/api/meta'), api('/api/runners')]);
    meta = m;
    mine = r.runners.find(x => x.runner_key === r.me);
  } catch (err) {
    if (err.status === 401 || err.status === 403) { store.clear(); return location.reload(); }
    return app.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }

  if (!mine) return app.innerHTML = '<div class="error">You are not on the roster.</div>';

  app.innerHTML = `
    <form class="card">
      ${entryFields(meta, mine)}
      <button type="submit">Save</button>
    </form>
    <button class="ghost" id="remove">Take me off the roster</button>
    <p class="hint">Removing you keeps your history in the snapshot, it just hides you from the roster.</p>`;

  const form = app.querySelector('form');
  const read = wireEntryFields(form, meta);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      await api('/api/runners/me', { method: 'POST', body: read() });
      location.href = 'index.html';
    } catch (err) {
      button.disabled = false;
      button.textContent = 'Save';
      const box = form.querySelector('.error') || Object.assign(document.createElement('div'), { className: 'error' });
      box.textContent = err.message;
      form.append(box);
    }
  });

  app.querySelector('#remove').onclick = async () => {
    if (!confirm('Take yourself off the roster? Your info stays saved and you can add yourself back.')) return;
    try {
      await api('/api/runners/me', { method: 'DELETE' });
      location.href = 'index.html';
    } catch (err) { alert(err.message); }
  };
})();
