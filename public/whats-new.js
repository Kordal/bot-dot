// ---------- what's new ----------
// After an update (#219): the notes of the releases this person has not seen, newest first, once, in a small pop-up
// with one button. Closing it any way (the button, ✕, Escape) counts as seen, here and in the Android app. Asked once
// when the page loads, only from a server that has `whats-new`; it waits while another dialog is open.

const WHATS_NEW_WAIT_MS = 2000;
// Every note since the last one seen comes (#380), so one update can bring twenty: the newest few show in full, the
// rest as titles that open on a tap, under a line that counts them.
const WHATS_NEW_OPEN = 3;

// The notes as text, newest first: also under Settings → Updates while a version waits (#303, settings.js).
function whatsNewNotesHTML(entries) {
  const note = (e, i) => {
    const points = `<ul>${(Array.isArray(e.points) ? e.points : []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
    return i < WHATS_NEW_OPEN ? `
      <section><h3>${esc(e.title)}</h3>${points}</section>`
      : `
      <details><summary>${esc(e.title)}</summary>${points}</details>`;
  };
  const count = entries.length > WHATS_NEW_OPEN ? `<p class="whats-new-count">${entries.length} changes, newest first. Tap a title for more.</p>` : '';
  return count + entries.map(note).join('');
}

async function showWhatsNew() {
  if (!state.features.includes('whats-new')) return; // an older server: nothing to ask
  const r = await api('/whats-new').catch(() => null);
  const entries = Array.isArray(r?.entries) ? r.entries.filter((e) => e && typeof e.id === 'string') : [];
  if (entries.length) openWhatsNew(entries);
}

// Never over another dialog (a card, a login request): it waits until that one is closed.
function openWhatsNew(entries) {
  if ($('#modal').open) { setTimeout(() => openWhatsNew(entries), WHATS_NEW_WAIT_MS); return null; }
  const m = openModal(`
    <div class="modal-head"><h2>What's new</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
    <div class="modal-body whats-new">${whatsNewNotesHTML(entries)}
    </div>
    <div class="modal-foot"><button type="button" class="btn primary" data-dismiss>Got it</button></div>`);
  m.addEventListener('close', () => { api('/whats-new/seen', { method: 'POST', body: { id: entries[0].id } }).catch(() => {}); }, { once: true });
  return m;
}
