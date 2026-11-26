// A project update as a card of the block kit (#1755, docs/api.md "Consolidated project updates"): the head, the
// status pills, then only the sections that have something, and one faint line for the rest. The server hands the
// update as data (`update` beside the message's `text`); this draws it in the Project Manager's chat and the Chief's.
// Nothing a bot wrote is markup: a row's text is Markdown drawn as a reply's preview is (mdPreview), every name
// and number is escaped, and a level or a ratio is held to what the block kit knows.
const ProjectUpdate = (() => {
  const LEVELS = ['ok', 'warn', 'err', 'info', 'plan'];
  const level = (l) => (LEVELS.includes(l) ? l : 'ok');
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  const str = (v) => (typeof v === 'string' ? v : v == null || typeof v === 'object' ? '' : String(v));
  const ICON = {
    board: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19h16M7 16v-5M12 16V7M17 16v-8"/></svg>',
    tick: '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    chev: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
    fold: '<svg class="pu-fold" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  };
  // A card starts folded to its head and pills; the ones the owner unfolded stay so while the page is open, by the update's key.
  const unfolded = new Set();
  const unfold = (key, on) => { if (on) unfolded.add(key); else unfolded.delete(key); };
  // The update a message carries, or null: a record from before the feature has none and shows its text.
  const of = (m) => { const u = m?.update; return u && typeof u === 'object' && !Array.isArray(u) && u.project && typeof u.project === 'object' ? u : null; };
  // What the list says for a Project Manager or a Chief chat whose newest message is an update: the outcome.
  const preview = (m) => (m && (m.kind === 'project-update' || m.projectUpdate) && of(m) && str(m.update.summary).trim() ? str(m.update.summary).trim() : null);
  // Where a row opens: the chat of its bot, its group or the Chief's chat. A to-do of nobody opens nothing.
  const target = (x) => (x.groupId ? ` data-pu-group="${esc(str(x.groupId))}"` : x.chatId ? ` data-pu-chief="${esc(str(x.chatId))}"` : x.botId ? ` data-pu-bot="${esc(str(x.botId))}"` : '');
  const text = (t) => mdPreview(str(t));
  const section = (title, body, n) => `<section class="pu-sec"><h3>${title}${n != null ? ` <span class="n">${n}</span>` : ''}</h3>${body}</section>`;
  // A button that opens nothing is no button: a row with no card, bot, group or chat to go to has none.
  const callout = (x, tone, title, button, card = '') => `<div class="kit-callout ${tone}"><b class="pu-name">${title}</b><p class="pu-call">${text(x.text)}</p>${card || target(x) ? `<button type="button" class="btn${tone === 'warn' ? ' primary' : ''}"${card}${target(x)}>${button}</button>` : ''}</div>`;
  const head = (x) => (x.chatId || x.botId || x.groupId ? ProjectOverview.head(x) : '<span class="pu-none" aria-hidden="true"></span>');
  const who = (x, when = '') => `<span class="pu-who-line"><button type="button" class="pu-who">${esc(str(x.name))}</button>${when ? `<span class="pu-when">${esc(when)}</span>` : ''}</span>`;
  const rowPill = { working: ['info', tr('Working')], planned: ['plan', tr('To-do')], asks: ['warn', tr('Asks')] };
  function html(u, key = '') {
    const p = u.project || {};
    const pills = list(u.pills).map((x) => `<span class="kit-pill ${level(x.level)}">${esc(str(x.text))}</span>`).join('');
    const needs = list(u.needs), blockers = list(u.blockers), goals = list(u.goals), done = list(u.done), work = list(u.work), decisions = list(u.decisions), replies = list(u.replies);
    const sec = [];
    if (needs.length) sec.push(section(tr('Needs you'), needs.map((x) => callout(x, 'warn', tr('{name} asks', { name: esc(str(x.name)) }), x.cardId ? tr('Open card') : tr('Open chat'), x.cardId ? ` data-pu-card="${esc(str(x.cardId))}"` : '')).join('')));
    if (blockers.length) sec.push(section(tr('Blockers'), blockers.map((x) => callout(x, 'err', tr('{name} failed', { name: esc(str(x.name)) }), tr('Open chat'))).join('')));
    if (goals.length) sec.push(section(tr('Goals'), `<div class="pu-goals">${goals.map((g) => {
      const pct = typeof g.ratio === 'number' && Number.isFinite(g.ratio) ? Math.round(Math.min(1, Math.max(0, g.ratio)) * 100) : null;
      const c = { ok: 'var(--ok)', warn: 'var(--warn)', err: 'var(--err)' }[level(g.level)] || 'var(--ok)';
      return `<div class="pu-goal"><div class="pu-goal-top"><span>${esc(str(g.name))}</span><span class="pu-value">${esc(str(g.value))}${str(g.of) ? `<small>${esc(str(g.of))}</small>` : ''}</span></div>${pct == null ? '' : `<div class="kit-bar"><i style="width:${pct}%;--c:${c}"></i></div>`}</div>`;
    }).join('')}</div>`));
    if (done.length) sec.push(section(tr('Done'), `<ul class="pu-done">${done.map((x) => `<li><span class="pu-tick">${ICON.tick}</span><span class="pu-what">${text(x.text)}</span></li>`).join('')}</ul>`, done.length));
    if (work.length) sec.push(section(tr('In progress'), `<div class="pu-rows">${work.map((x) => {
      const [tone, label] = rowPill[x.state] || rowPill.working;
      return `<div class="pu-row"${target(x)}>${head(x)}<div class="pu-main">${who(x)}<p class="pu-what">${x.text ? text(x.text) : esc(label)}</p></div><span class="kit-pill ${tone}">${esc(label)}</span></div>`;
    }).join('')}</div>`, work.length));
    if (decisions.length) sec.push(section(tr('Decisions'), `<div class="pu-rows">${decisions.map((x) => `<p class="pu-what pu-plain">${text(x.text)}</p>`).join('')}</div>`));
    if (replies.length) sec.push(section(tr('Latest replies'), `<div class="pu-rows">${replies.map((x) => `<div class="pu-row"${target(x)}>${head(x)}<div class="pu-main">${who(x, x.at ? msgTime(x.at) : '')}<p class="pu-what">${text(x.text)}</p></div><span class="pu-chev" aria-hidden="true">${ICON.chev}</span></div>`).join('')}</div>`, replies.length));
    const notes = (Array.isArray(u.notes) ? u.notes : []).map((n) => str(n)).filter((n) => n.trim());
    const body = sec.join('') + (str(u.quiet) ? `<p class="pu-quiet">${esc(str(u.quiet))}</p>` : '') + notes.map((n) => `<p class="pu-quiet pu-note">${esc(n)}</p>`).join('');
    const open = !!body && !!key && unfolded.has(key);
    const lead = `<span class="pu-icon">${ICON.board}</span><span class="pu-heading"><span class="pu-title">${esc(str(p.name))}</span><span class="pu-sub">${u.since ? tr('Update since {when}', { when: esc(msgTime(str(u.since))) }) : tr('Project update')}</span></span>`;
    return `<article class="pu-card${open ? ' open' : ''}" data-pu data-pu-key="${esc(key)}">
      <div class="pu-top">${body ? `<button type="button" class="pu-toggle" data-pu-toggle aria-expanded="${open}">${lead}${ICON.fold}</button>` : `<div class="pu-lead">${lead}</div>`}
        ${p.id ? `<button type="button" class="btn ghost sm pu-board" data-pu-project="${esc(str(p.id))}">${tr('Board')}${ICON.chev}</button>` : ''}</div>
      ${pills ? `<div class="pu-pills">${pills}</div>` : ''}${body ? `<div class="pu-body"${open ? '' : ' hidden'}>${body}</div>` : ''}</article>`;
  }
  // A card holds links, so a row is no <button>: its name is the button, a tap anywhere else in it opens the chat as
  // well, and a link opens only itself.
  function wire(root) {
    root.querySelectorAll('[data-pu-project]').forEach((b) => { b.onclick = () => Company.enter(b.dataset.puProject); });
    root.querySelectorAll('[data-pu-toggle]').forEach((b) => {
      b.onclick = () => {
        const card = b.closest('[data-pu]');
        const on = b.getAttribute('aria-expanded') !== 'true';
        b.setAttribute('aria-expanded', String(on));
        card.classList.toggle('open', on);
        card.querySelector('.pu-body').hidden = !on;
        unfold(card.dataset.puKey, on);
      };
    });
    root.querySelectorAll('[data-pu] [data-pu-card], [data-pu] [data-pu-bot], [data-pu] [data-pu-group], [data-pu] [data-pu-chief]').forEach((b) => {
      b.onclick = (e) => {
        if (e.target.closest('a')) return;
        if (b.dataset.puCard) return setView('needs');
        if (b.dataset.puGroup) return setView('group', b.dataset.puGroup);
        if (b.dataset.puChief) return Dock.openChief(b.dataset.puChief);
        if (b.dataset.puBot) setView('bot', b.dataset.puBot);
      };
    });
  }
  return { html, wire, of, preview, unfold };
})();
