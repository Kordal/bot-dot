// The Chief's note of a new version as a card of the block kit (#1759, docs/api.md "A new version in the Chief's chat"):
// the head, the line saying when the account moves to it, the What's new titles, and a button to the card in Needs you.
// The server hands it as data (`versionUpdate` beside the message's `text`) in the owner's language; this draws it in the
// Chief's chat, in the look of the project update card (public/project-update.js). Nothing is markup: every word is escaped
// and a title is plain text.
const VersionUpdate = (() => {
  const str = (v) => (typeof v === 'string' ? v : v == null || typeof v === 'object' ? '' : String(v));
  const ICON = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V6M6 11.5 12 5.5l6 6"/></svg>';
  // The data a message carries, or null: a note from before the feature has none and shows its text.
  const of = (m) => { const v = m?.versionUpdate; return v && typeof v === 'object' && !Array.isArray(v) && str(v.head).trim() ? v : null; };
  // What the list says for the Chief's chat whose newest message is the note: the head (`preview` of the chat already says it).
  const preview = (m) => (of(m) ? str(m.versionUpdate.head).trim() : null);
  const cardId = (v) => (/^[0-9a-f]{8}$/i.test(str(v.cardId)) ? str(v.cardId) : '');
  function html(v) {
    const titles = (Array.isArray(v.notes) ? v.notes : []).map((n) => str(n?.title).trim()).filter(Boolean);
    const card = cardId(v);
    return `<article class="pu-card vu-card" data-vu>
      <div class="pu-top"><div class="pu-lead"><span class="pu-icon">${ICON}</span><span class="pu-heading"><span class="pu-title">${esc(str(v.head))}</span>${str(v.version).trim() ? `<span class="pu-sub">${esc(str(v.version).trim())}</span>` : ''}</span></div></div>
      ${str(v.body).trim() ? `<p class="vu-line">${esc(str(v.body))}</p>` : ''}
      ${titles.length ? `<section class="pu-sec"><h3>${esc(str(v.heading))}</h3><ul class="vu-notes">${titles.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>` : ''}
      ${card ? `<div class="pu-sec vu-act"><button type="button" class="btn" data-vu-card="${esc(card)}">${tr('Open card')}</button></div>` : ''}</article>`;
  }
  function wire(root) {
    root.querySelectorAll('[data-vu] [data-vu-card]').forEach((b) => { b.onclick = () => setView('needs'); });
  }
  return { html, wire, of, preview };
})();
