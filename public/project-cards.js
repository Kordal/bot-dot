// Cards made by Claude on a project's board (#775, ADR 123), at the top of the floor. A dashed "New card" turns in
// place into the ask field; the Chief's questions follow in the same place (dashes for how far, earlier answers as
// chips, ready answers and an Other field); while a run builds the card it shows the card's title, a shimmer, one live
// line and a bar; a card built a moment ago has a green outline. Each card: refresh, and a menu Change, Refresh,
// Remove. Everything on a card is the Chief's or the owner's text, drawn as text. company-home.js puts the row on the
// floor (Company.cards.html) and wires it (Company.cards.wire).
(() => {
  const ICON = {
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    go: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>',
    pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  };
  // The ask field that is open: 'new', a card's id (Change), or null. The card whose menu is open.
  let open = null;
  let menu = null;
  // Cards seen building, and those built a moment ago (a green outline for a few seconds).
  const wasBuilding = new Set();
  const fresh = new Set();
  const FRESH_MS = 4000;

  const on = () => (state.features || []).includes('project-cards');
  const tone = (t) => (t === 'ok' || t === 'bad' || t === 'muted' ? ` ${t}` : '');
  const wide = (c) => (c.state === 'asking' || c.body?.show === 'table' ? ' wide' : c.body?.show === 'list' ? ' tall' : '');

  // ---------- a card ----------
  function bars(list) {
    const hi = Math.max(...list.map((b) => b.value), 1);
    return `<div class="pc-bars">${list.map((b, i) => `<span class="pc-bar${i === list.length - 1 ? ' last' : ''}"><i style="height:${Math.max(4, Math.round((b.value / hi) * 100))}%"></i><small>${esc(b.label)}</small></span>`).join('')}</div>`;
  }
  function list(items) {
    return `<ul class="pc-list">${items.map((x) => {
      const inner = `${x.ref ? `<span class="pc-ref">${esc(x.ref)}</span>` : ''}<span class="pc-text">${esc(x.text)}</span>${x.tag ? `<span class="kit-pill ${x.level ? kitLevel(x.level) : 'info'}">${esc(x.tag)}</span>` : ''}`;
      return `<li>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner}</li>`;
    }).join('')}</ul>`;
  }
  function table(rows) {
    return `<table class="pc-table"><tbody>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="num">${esc(r.value)}</td><td class="num pc-sub${tone(r.tone)}">${r.change ? esc(r.change) : ''}</td></tr>`).join('')}</tbody></table>`;
  }
  function bodyHTML(b) {
    const big = `<div class="pc-big"><b>${esc(b.value)}</b>${b.sub ? `<span class="pc-sub${tone(b.tone)}">${esc(b.sub)}</span>` : ''}</div>`;
    const more = b.show === 'spark' ? kitSpark(b.points, b.tone === 'bad' ? 'var(--err)' : 'var(--ok)')
      : b.show === 'bars' ? bars(b.bars) : b.show === 'list' ? list(b.list) : b.show === 'table' ? table(b.rows) : '';
    return big + more;
  }
  const stepText = (s) => (!s ? tr('Starting') : s.kind === 'search' ? (s.what ? tr('Searching {what}', { what: s.what }) : tr('Searching the web')) : s.what ? tr('Reading {what}', { what: s.what }) : tr('Reading'));
  function menuHTML(c) {
    return `<div class="pc-menu" role="menu">
      <button type="button" role="menuitem" data-pc-change="${esc(c.id)}">${ICON.pen}${tr('Change')}</button>
      <button type="button" role="menuitem" data-pc-refresh="${esc(c.id)}">${ICON.refresh}${tr('Refresh')}</button>
      <button type="button" role="menuitem" class="danger" data-pc-remove="${esc(c.id)}">${ICON.trash}${tr('Remove')}</button>
    </div>`;
  }
  function cardHTML(c) {
    const busy = c.state === 'building';
    const head = `<div class="pc-head"><span class="pc-title">${esc(c.title || c.ask)}</span>
      <button type="button" class="icon-btn pc-icon${busy ? ' spin' : ''}" data-pc-refresh="${esc(c.id)}" aria-label="${tr('Refresh')}" title="${tr('Refresh')}"${busy ? ' disabled' : ''}>${ICON.refresh}</button>
      <button type="button" class="icon-btn pc-icon" data-pc-menu="${esc(c.id)}" aria-label="${tr('More')}" aria-expanded="${menu === c.id}">${ICON.more}</button>
      ${menu === c.id ? menuHTML(c) : ''}</div>`;
    if (busy && !c.body) {
      const width = Math.min(92, 12 + (c.steps || 0) * 14);
      return `<div class="pc-card building" data-pc-card="${esc(c.id)}">${head}
        <div class="pc-shimmer"><i class="w1"></i><i class="w2"></i><i class="w3"></i></div>
        <div class="pc-step">${chiefFigure('sm')}<span>${esc(stepText(c.step))}</span></div>
        <div class="pc-progress"><i style="width:${width}%"></i></div></div>`;
    }
    const failed = c.state === 'failed' ? `<div class="pc-failed${c.body ? ' quiet' : ''}" title="${esc(c.error || '')}">${esc(c.error || tr('Could not build it'))}</div>` : '';
    return `<div class="pc-card${wide(c)}${fresh.has(c.id) ? ' fresh' : ''}${c.state === 'failed' ? ' failed' : ''}" data-pc-card="${esc(c.id)}">${head}${c.body ? bodyHTML(c.body) : ''}${failed}</div>`;
  }

  // ---------- the ask and the questions ----------
  function askHTML(value, cid = '') {
    return `<form class="pc-ask wide" id="pc-ask" data-pc-for="${esc(cid)}">${chiefFigure()}
      <input name="ask" autocomplete="off" maxlength="200" value="${esc(value)}" aria-label="${tr('New card')}" />
      <button type="submit" class="pc-go" aria-label="${tr('Send')}">${ICON.go}</button>
      <button type="button" class="icon-btn" data-pc-close aria-label="${tr('Close')}">${ICON.x}</button></form>`;
  }
  function questionsHTML(c) {
    const qs = c.questions || [];
    const q = qs[c.answers.length];
    const dashes = qs.length > 1 ? `<span class="pc-dashes">${qs.map((_, i) => `<i class="${i < c.answers.length ? 'done' : i === c.answers.length ? 'now' : ''}"></i>`).join('')}</span>` : '';
    const said = [`<span class="pc-said"><span class="co-chip on">${esc(c.ask)}</span></span>`, ...c.answers.map((a) => `<span class="pc-said">${esc(a.q)}<span class="co-chip on">${esc(a.a)}</span></span>`)].join('');
    const now = !q ? `<div class="pc-wait"><i></i><i></i><i></i></div>`
      : `<div class="pc-q">${esc(q.q)}</div>
        <div class="pc-choices">${q.choices.map((x) => `<button type="button" class="co-chip" data-pc-pick="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <form class="pc-other" id="pc-other"><input name="other" autocomplete="off" maxlength="120" placeholder="${tr('Other')}" aria-label="${tr('Other')}" /><button type="submit" class="pc-go" aria-label="${tr('Send')}">${ICON.go}</button></form>`;
    return `<div class="pc-questions wide" data-pc-asking="${esc(c.id)}">
      <div class="pc-qhead">${chiefFigure('sm')}<b>${esc(c.title || c.ask)}</b>${dashes}<button type="button" class="icon-btn" data-pc-cancel="${esc(c.id)}" aria-label="${tr('Close')}">${ICON.x}</button></div>
      <div class="pc-saids">${said}</div>${now}</div>`;
  }

  // ---------- the row ----------
  function html(c) {
    if (!on() || c.phase !== 'running') return '';
    const cards = c.cards || [];
    for (const k of cards) {
      if (k.state === 'building') wasBuilding.add(k.id);
      else if (wasBuilding.delete(k.id) && k.state === 'ready') { fresh.add(k.id); setTimeout(() => { fresh.delete(k.id); Company.redraw(); }, FRESH_MS); }
    }
    if (menu && !cards.some((k) => k.id === menu)) menu = null;
    if (open && open !== 'new' && !cards.some((k) => k.id === open)) open = null;
    const items = cards.map((k) => (open === k.id ? askHTML(k.title || k.ask, k.id) : k.state === 'asking' ? questionsHTML(k) : cardHTML(k)));
    const full = cards.length >= 12;
    const tail = open === 'new' ? askHTML('') : full ? '' : `<button type="button" class="pc-new" data-pc-new>${ICON.plus}${tr('New card')}</button>`;
    return `<div class="pc-row">${items.join('')}${tail}</div>`;
  }

  // A change to a card: the answer is the project as it is now. What the server refuses is said in its words.
  async function send(path, method, body) {
    try { Company.changed({ company: await api(Company.at(path), { method, body }) }); return true; } catch (e) { toast(e.message, true); Company.redraw(); return false; }
  }
  const at = (cid, tail = '') => `/company/cards/${encodeURIComponent(cid)}${tail}`;
  function close() { open = null; Company.redraw(); }

  function wire(root) {
    if (!$('.pc-row', root)) return;
    $('[data-pc-new]', root)?.addEventListener('click', () => { open = 'new'; menu = null; Company.redraw(); $('#pc-ask input')?.focus(); });
    $('[data-pc-close]', root)?.addEventListener('click', close);
    const ask = $('#pc-ask', root);
    if (ask) {
      ask.ask.onkeydown = (e) => { if (e.key === 'Escape') close(); };
      ask.onsubmit = async (e) => {
        e.preventDefault();
        const text = ask.ask.value.trim();
        const button = ask.querySelector('.pc-go');
        if (!text || button.disabled) return;
        button.disabled = true;
        const cid = ask.dataset.pcFor;
        const was = open;
        open = null;
        if (!(await send(cid ? at(cid) : '/company/cards', cid ? 'PUT' : 'POST', { ask: text }))) { open = was; Company.redraw(); const now = $('#pc-ask input'); if (now) now.value = text; }
      };
    }
    const answer = (cid, text) => send(at(cid, '/answer'), 'POST', { text });
    $$('[data-pc-pick]', root).forEach((b) => (b.onclick = () => { b.disabled = true; answer(b.closest('[data-pc-asking]').dataset.pcAsking, b.dataset.pcPick); }));
    const other = $('#pc-other', root);
    if (other) other.onsubmit = (e) => {
      e.preventDefault();
      const text = other.other.value.trim();
      if (!text) return;
      other.other.value = '';
      answer(other.closest('[data-pc-asking]').dataset.pcAsking, text);
    };
    $$('[data-pc-cancel]', root).forEach((b) => (b.onclick = () => send(at(b.dataset.pcCancel, '/cancel'), 'POST', {})));
    $$('[data-pc-menu]', root).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); menu = menu === b.dataset.pcMenu ? null : b.dataset.pcMenu; Company.redraw(); }));
    $$('[data-pc-refresh]', root).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); menu = null; b.disabled = true; send(at(b.dataset.pcRefresh, '/refresh'), 'POST', {}); }));
    $$('[data-pc-change]', root).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); menu = null; open = b.dataset.pcChange; Company.redraw(); const input = $('#pc-ask input'); if (input) { input.focus(); input.select(); } }));
    $$('[data-pc-remove]', root).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); menu = null; send(at(b.dataset.pcRemove), 'DELETE'); }));
    if (menu) document.addEventListener('click', () => { if (menu) { menu = null; Company.redraw(); } }, { once: true });
  }

  // The fields the floor keeps when it is drawn again.
  const FIELDS = ['#pc-ask input', '#pc-other input'];
  window.ProjectCards = { html, wire, FIELDS };
})();
