// ---------- Upload from phone (ADR 165) ----------
// The paperclip's "From phone" and Files' "From phone": botdot makes a code for the place (POST /api/drops), the card
// shows its QR code, and the files the phone sends are listed under it as they arrive, each handed on (onFile) once
// saved: into the message box, or the folder shown again. Ten minutes later the code is spent: New code makes another.
// Not on a phone's width: there the phone is the one in hand.
const PhoneDrop = (() => {
  const PHONE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/></svg>';
  const CLIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.8 1.8 0 0 1-2.5-2.5l7.9-7.9"/></svg>';
  const POLL_MS = 1500;
  const can = () => (state.features || []).includes('phone-upload') && !globalThis.matchMedia?.('(max-width: 479px)').matches;

  // A small menu at a button, above it when there is no room below: items of { icon, label, run }.
  function menu(btn, items) {
    $('.ct-menu')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="fx-menu ct-menu pd-menu" role="menu">${items.map((it, i) => `<button type="button" role="menuitem" class="fx-mi" data-mi="${i}">${it.icon}<span>${esc(it.label)}</span></button>`).join('')}</div>`);
    const m = $('.ct-menu');
    const r = btn.getBoundingClientRect();
    m.style.left = `${Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8))}px`;
    m.style.top = `${r.bottom + 4 + m.offsetHeight > innerHeight - 8 ? r.top - 4 - m.offsetHeight : r.bottom + 4}px`;
    const close = () => { m.remove(); document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key, true); };
    const away = (e) => { if (!m.contains(e.target) && !btn.contains(e.target)) close(); };
    const key = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key, true);
    $$('[data-mi]', m).forEach((b) => (b.onclick = () => { close(); items[Number(b.dataset.mi)].run(); }));
    m.querySelector('button').focus();
  }
  // The paperclip's choice: files of this computer, or from the phone.
  const attachMenu = (btn, pick, phone) => menu(btn, [{ icon: CLIP, label: tr('Files'), run: pick }, { icon: PHONE, label: tr('From phone'), run: phone }]);

  // A card for the place `to` (the upload address of the owner's page), put in `slot` by place(card). One per slot:
  // opening it again starts over. alive(): whether its view is still open; float: in a corner, over the view (Files).
  // Returns close().
  function open(slot, { to, onFile, place = (card) => slot.prepend(card), alive = null, float = false }) {
    slot.querySelector(':scope > .pd-card')?._close?.();
    const card = document.createElement('div');
    card.className = `pd-card${float ? ' pd-float' : ''}`;
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', tr('From phone'));
    place(card);
    let d = null; let error = null; let timer = 0; let closed = false;
    const handed = new Set();
    const row = (f) => `<div class="pd-row"><span class="pd-name">${esc(f.name)}</span>${
      f.status === 'saved' ? `<span class="pd-size">${fmtSize(f.size)}</span><span class="pd-ok" aria-label="${tr('Done')}">✓</span>`
        : f.status === 'failed' ? `<span class="pd-err">${esc(f.error || tr('failed'))}</span>`
          : '<i class="plan-spin"></i>'}</div>`;
    const draw = () => {
      if (closed) return;
      let html;
      const head = `<div class="pd-head"><b>${tr('From phone')}</b><button type="button" class="icon-btn pd-x" data-pd-close aria-label="${tr('Close')}" title="${tr('Close')}">×</button></div>`;
      if (error || (d && !d.reachable)) {
        html = `<div class="pd-side">${head}<p class="pd-line">${esc(error || tr("Your phone can't reach botdot yet."))}</p></div>`;
      } else if (!d) {
        html = `<div class="pd-qr pd-wait"></div><div class="pd-side">${head}</div>`;
      } else {
        html = `<div class="pd-qr${d.open ? '' : ' spent'}" title="${esc(d.url)}">${d.qr}${d.open ? '' : `<button type="button" class="btn primary sm" data-pd-again>${tr('New code')}</button>`}</div>
          <div class="pd-side">${head}<div class="pd-rows">${d.files.map(row).join('')}</div></div>`;
      }
      if (html === card._html) return; // the same: an arriving file's spinner keeps turning
      card._html = html;
      card.innerHTML = html;
      $('[data-pd-close]', card).onclick = close;
      const again = $('[data-pd-again]', card);
      if (again) again.onclick = start;
    };
    const look = async () => {
      timer = 0;
      if (!(alive ? alive() : card.isConnected)) return close(); // its chat or Files was left
      if (closed || !d?.open) return;
      try {
        Object.assign(d, await api(`/drops/${d.token}`));
        for (const f of d.files) if (f.status === 'saved' && !handed.has(f.id)) { handed.add(f.id); try { onFile?.(f.saved, f); } catch (e) { console.error(e); } }
      } catch { /* looked at again in a moment */ }
      draw();
      if (d.open && !closed) timer = setTimeout(look, POLL_MS);
    };
    async function start() {
      if (d?.token) api(`/drops/${d.token}`, { method: 'DELETE' }).catch(() => {});
      clearTimeout(timer);
      d = null; error = null; handed.clear();
      draw();
      try { d = await api('/drops', { method: 'POST', body: { to } }); } catch (e) { error = e.message; }
      if (closed) { if (d?.token) api(`/drops/${d.token}`, { method: 'DELETE' }).catch(() => {}); return; }
      draw();
      if (d?.reachable) timer = setTimeout(look, POLL_MS);
    }
    function close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if (d?.token && d.open) api(`/drops/${d.token}`, { method: 'DELETE' }).catch(() => {});
      card.remove();
    }
    card._close = close;
    start();
    return close;
  }

  return { can, attachMenu, open, PHONE };
})();
