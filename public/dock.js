// Chats docked to the bottom of the Projects screen (#691): a bot clicked there opens its chat as a panel at the
// bottom, beside the chats opened before it, the newest on the right, across the whole width
// of the screen. A bot's chat opened before stays expanded beside it (#714) until it is minimized; the others are bars
// with their unread count; those that don't fit wait under "+N" at the left end. A bar or a panel's head dragged
// sideways moves it in the row. A phone has the open chat as a sheet that slides up from the bottom, half or full
// height, and the rest as bars. The rules are DockRow's (dock-row.js); this file draws them.
// The open panel is the bot's chat itself (bot-chat.js): the chat's row is moved into the dock while the Projects
// screen shows a bot, so sending, blocks, cards and @file are the chat's own. Minimize is the Projects screen again.
// A bot's chat expanded beside it is the same chat drawn once more (renderBotChat in a root of its own), and is read
// as the open one is: this page reports it under an app id of its own (docs/api.md, "New replies").
// A panel is { kind, id }: `kinds` says how each kind is drawn and opened: a bot's chat, or a team's (#697), which is
// the group chat of that team (groups.js) and opens the same way, its row moved into the dock, or the Chief's (#819).
const Dock = (() => {
  const KEY = 'botdot.dock';
  const ICON = {
    min: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };
  let row = (() => { try { return DockRow.parse(localStorage.getItem(KEY)); } catch { return DockRow.parse(null); } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(row)); } catch { /* private mode */ } };

  const kinds = {
    bot: {
      exists: (id) => !!botById(id),
      name: (id) => botById(id)?.name || '',
      figure: (id) => { const b = botById(id); return b ? botFigure(b.color, b.state, 'sm', b.outfit) : ''; },
      unread: (id) => Unread.count(botById(id) || {}),
      look: (id) => { const b = botById(id); return b ? [b.name, b.color, b.state, b.outfit, Unread.count(b)] : null; },
      open: (id) => setView('bot', id),
      known: () => state.bots.length > 0,
    },
    team: {
      exists: (id) => !!groupById(id)?.team,
      name: (id) => groupById(id)?.name || '',
      figure: (id) => { const g = groupById(id); return g ? groupPicture(g, 'sm') : ''; },
      unread: (id) => Unread.count(groupById(id) || {}),
      look: (id) => { const g = groupById(id); return g ? [g.name, groupLook(g), Unread.count(g)] : null; },
      open: (id) => setView('group', id),
      known: () => !!state.groupsKnown,
    },
    // The Chief's chat (#819): one panel, on the chat it shows (a goal's change ask opens a new one there). Docked only
    // when opened from here (openChief), not whenever the Chief's view is up, as it is while the page starts.
    chief: {
      exists: () => true,
      name: () => chiefTitle(),
      figure: () => chiefFigure('sm'),
      unread: () => state.chiefUnread || 0,
      look: () => [chiefTitle(), state.chiefBusy, state.chiefUnread || 0],
      open: () => openChief(),
      known: () => true,
    },
  };

  const shows = () => typeof Company !== 'undefined' && (state.features || []).includes('company') && Company.place() === 'company';
  // The Projects screen shows a bot, or a team's chat: that chat is the open panel.
  let chiefHere = false; // the Chief's view up was opened on the Projects screen
  function openChief(chatId) {
    chiefHere = true;
    if (chatId === undefined) setView('chief'); else openChiefChat(chatId);
  }
  const openKind = () => (state.view === 'bot' && botById(state.botId) ? 'bot' : state.view === 'group' && groupById(state.groupId)?.team ? 'team' : state.view === 'chief' && chiefHere ? 'chief' : null);
  const docked = () => shows() && !!openKind();
  const ID_OF = { bot: () => state.botId, team: () => state.groupId, chief: () => 'chief' };
  const openOne = () => (docked() ? { kind: openKind(), id: ID_OF[openKind()]() } : null);
  const phone = () => matchMedia(PHONE).matches;
  // A panel drawn expanded beside the open one: a bot's chat that stays open, on a screen wider than a phone.
  const expanded = (p, open) => p.kind === 'bot' && p.open === true && !phone() && !(open && DockRow.same(p, open));

  // ---------- the row's elements ----------
  let dock = null; // #dock, in the main column
  let panel = null; // #dock-panel: the open chat's place in the row; the chat's row moves in and out of it
  let home = null; // where the chat's row stands when no chat is docked
  function build() {
    if (dock) return;
    const main = $('.main');
    dock = document.createElement('div');
    dock.id = 'dock';
    dock.className = 'dock hidden';
    dock.setAttribute('aria-label', tr('Chats'));
    dock.innerHTML = `<section id="dock-panel" class="dock-item dock-panel hidden"><button type="button" class="dock-grip" aria-label="${tr('Taller or lower')}"><i></i></button></section>`;
    main.appendChild(dock);
    panel = $('#dock-panel', dock);
    home = document.createComment('the chat row stands here when no chat is docked');
    $('#chat-row').before(home);
    wire();
  }

  // ---------- drawing ----------
  let drawn = '';
  const chatEls = new Map(); // "bot:<id>" -> its expanded chat's .dock-item, kept while it stays, with what is typed and its scroll
  function draw() {
    if (!$('#chat-row')) return;
    if (state.view !== 'chief' || !shows()) chiefHere = false;
    build();
    const on = shows() && (state.view === 'company' || docked());
    const open = on ? openOne() : null;
    if (open && !row.items.some((p) => DockRow.same(p, open))) { row.items = DockRow.add(row.items, open); save(); }
    // A bot's chat that is opened stays expanded once another one opens (#714).
    if (open?.kind === 'bot' && !row.items.find((p) => DockRow.same(p, open)).open) { row.items = DockRow.expand(row.items, open, true); save(); }
    // A bot or a team that is gone leaves the row, once they are known.
    const kept = row.items.filter((p) => !kinds[p.kind] || !kinds[p.kind].known() || kinds[p.kind].exists(p.id));
    if (kept.length !== row.items.length) { row.items = kept; save(); }
    const chatRow = $('#chat-row');
    const app = $('#app');
    const was = app.classList.contains('docked');
    if (open && chatRow.parentNode !== panel) panel.appendChild(chatRow);
    if (!open && chatRow.parentNode === panel) home.after(chatRow);
    app.classList.toggle('docked', !!open);
    if (open) $('#view-company')?.classList.remove('hidden');
    if (open && !was) { panel.classList.remove('dock-in'); void panel.offsetWidth; panel.classList.add('dock-in'); }
    syncHead(open);

    const items = on ? row.items.filter((p) => kinds[p.kind]?.exists(p.id)) : [];
    app.classList.toggle('dock-on', items.length > 0);
    dock.classList.toggle('hidden', !items.length);
    if (!items.length) { panel.classList.add('hidden'); drawn = ''; keepChats([]); readChats(); app.classList.remove('dock-tall'); return; }
    const width = place();
    const s = DockRow.split(items, DockRow.fit(items.length, width), open);
    if (s.items !== items) { row.items = s.items; save(); }
    panel.dataset.sheet = row.sheet;
    const wide = s.shown.filter((p) => expanded(p, open));
    keepChats(wide);
    app.classList.toggle('dock-tall', !!open || wide.length > 0); // the screen scrolls clear of the expanded chats
    const sig = JSON.stringify([s.shown.map(DockRow.keyOf), s.hidden.map(DockRow.keyOf), open && DockRow.keyOf(open), wide.map(DockRow.keyOf), items.map((p) => kinds[p.kind].look(p.id)), I18n.locale]);
    if (sig !== drawn) {
      drawn = sig;
      // Everything but the open panel and the expanded chats is drawn again around them: those keep their scroll and
      // what is typed.
      [...dock.children].forEach((el) => { if (el !== panel && !el.classList.contains('dock-chat')) el.remove(); });
      panel.classList.toggle('hidden', !open);
      const make = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
      const nodes = s.shown.map((p) => (open && DockRow.same(p, open) ? panel : chatEls.get(DockRow.keyOf(p)) || make(barHTML(p))));
      if (s.hidden.length) nodes.unshift(make(moreHTML(s.hidden)));
      // In their order, moving no element that already stands in it.
      let at = dock.firstElementChild;
      for (const el of nodes) {
        if (el === at) { at = at.nextElementSibling; continue; }
        dock.insertBefore(el, at);
      }
      panel.dataset.key = open ? DockRow.keyOf(open) : '';
    }
    for (const p of wide) drawChat(p.id);
    readChats();
  }

  // The expanded chats: those of `list` are made when new, the others go, with what was typed kept for the bot's chat.
  function keepChats(list) {
    const keys = new Set(list.map(DockRow.keyOf));
    for (const [key, el] of chatEls) {
      if (keys.has(key)) continue;
      const root = $('.dock-view', el);
      carry(root);
      for (const es of (root._streams || []).splice(0)) es.close();
      el.remove();
      chatEls.delete(key);
    }
    for (const p of list) {
      const key = DockRow.keyOf(p);
      if (chatEls.has(key)) continue;
      const el = document.createElement('section');
      el.className = 'dock-item dock-panel dock-chat dock-in';
      el.dataset.key = key;
      el.innerHTML = '<section class="bot-view dock-view"></section>';
      // Its "New" line stays above the reply that was new when it opened.
      const bot = botById(p.id);
      $('.dock-view', el)._line = Unread.count(bot || {}) ? bot.firstUnread ?? null : null;
      chatEls.set(key, el);
    }
  }
  // What was typed in a chat that leaves the dock: into the open view's box when that is the bot's now, else kept
  // for the bot's next chat (bot-chat.js `carried`).
  function carry(root) {
    const typed = $('textarea', root)?.value;
    const id = root?.dataset.bot;
    if (!typed || !id) return;
    const main = $('#view-bot');
    const ta = main?.dataset.bot === id && $('textarea', main);
    if (ta && !ta.value) { ta.value = typed; ta.dispatchEvent(new Event('input')); } else carried.set(id, typed);
  }
  // A bot's expanded chat, drawn again from what the page holds; its head carries Minimize and Close.
  function drawChat(id) {
    const el = chatEls.get(DockRow.keyOf({ kind: 'bot', id }));
    if (!el) return;
    const root = $('.dock-view', el);
    const p = { kind: 'bot', id };
    renderBotChat(root, id, { line: root._line, settings: () => setView('botsettings', id) });
    const right = $('.chat-head .actions-right', root);
    if (!right || $('.dock-ctl', right)) return;
    right.insertAdjacentHTML('beforeend', ctlHTML('data-dock-min-chat', 'data-dock-close-chat'));
    $('[data-dock-min-chat]', right).onclick = () => { row.items = DockRow.expand(row.items, p, false); save(); draw(); };
    $('[data-dock-close-chat]', right).onclick = () => close(p);
  }
  // The expanded chats on the page, each the root its chat is drawn in.
  const chats = () => [...chatEls.values()].filter((el) => el.isConnected).map((el) => $('.dock-view', el));
  const chatOf = (id) => chats().find((root) => root.dataset.bot === id) || null;

  // ---------- read ----------
  // Each expanded chat is read while the page is in front, as the open one is (replies.js syncRead): the server takes
  // one chat from each app, so each has an app id of its own (docs/api.md, "New replies").
  const APP = `${Unread.appId()}-dock`;
  let apps = 0;
  const readers = new Map(); // "bot:<id>" -> its reporter
  function readChats() {
    const front = !!state.features?.includes('unread') && inFront();
    for (const key of chatEls.keys()) {
      let r = readers.get(key);
      if (!r) readers.set(key, r = Unread.reporter({
        app: `${APP}${++apps}`,
        post: (body) => api('/read', { method: 'POST', body, keepalive: true }),
        onRead: (chat) => { if (r.shown() === chat) setUnread(chat, { unread: 0, firstUnread: null }); },
      }));
      if (front && r.shown() !== key) Push.clear(window, key); // its notifications on this device go (push.js)
      r.show(front ? key : null);
    }
    for (const [key, r] of readers) if (!chatEls.has(key)) { r.show(null); readers.delete(key); }
  }
  ['focus', 'blur', 'pageshow'].forEach((t) => addEventListener(t, readChats));
  document.addEventListener('visibilitychange', readChats);
  addEventListener('pagehide', () => { for (const r of readers.values()) r.show(null); });

  // The row's left and right ends: the main column's padding. It spans the whole column, over the bottom of the panel
  // on the right of a wide Projects screen, so as many chats as the screen holds stand side by side.
  function place() {
    const main = $('.main').getBoundingClientRect();
    const side = phone() ? 12 : 24;
    dock.style.setProperty('--dock-l', `${side}px`);
    dock.style.setProperty('--dock-r', `${side}px`);
    return Math.max(0, main.width - 2 * side);
  }

  const badge = (n) => (n ? `<span class="dock-n">${n > 99 ? '99+' : n}</span>` : '');
  function barHTML(p) {
    const k = kinds[p.kind];
    const name = k.name(p.id);
    return `<div class="dock-item dock-bar" data-key="${esc(DockRow.keyOf(p))}">
      <button type="button" class="dock-open" data-dock-open="${esc(DockRow.keyOf(p))}" title="${esc(name)}">${k.figure(p.id)}<span class="dock-name">${esc(name)}</span>${badge(k.unread(p.id))}</button>
      <button type="button" class="icon-btn dock-x" data-dock-close="${esc(DockRow.keyOf(p))}" aria-label="${tr('Close')}" title="${tr('Close')}">${ICON.x}</button>
    </div>`;
  }
  function moreHTML(hidden) {
    const unread = hidden.reduce((n, p) => n + kinds[p.kind].unread(p.id), 0);
    return `<div class="dock-more-wrap">
      <button type="button" class="dock-more${unread ? ' unread' : ''}" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(trn(hidden.length, '{n} more chat', '{n} more chats'))}">+${hidden.length}</button>
      <div class="dock-menu" role="menu" hidden>${hidden.map((p) => {
        const k = kinds[p.kind];
        return `<button type="button" role="menuitem" data-dock-open="${esc(DockRow.keyOf(p))}">${k.figure(p.id)}<span class="dock-name">${esc(k.name(p.id))}</span>${badge(k.unread(p.id))}</button>`;
      }).join('')}</div>
    </div>`;
  }

  const ctlHTML = (min, x) => `<span class="dock-ctl"><button type="button" class="icon-btn" ${min} aria-label="${tr('Minimize')}" title="${tr('Minimize')}">${ICON.min}</button><button type="button" class="icon-btn" ${x} aria-label="${tr('Close')}" title="${tr('Close')}">${ICON.x}</button></span>`;
  // The open chat's head carries Minimize and Close while it is docked.
  function syncHead(open) {
    const VIEW = { team: 'group', bot: 'bot', chief: 'chief' };
    for (const [kind, v] of Object.entries(VIEW)) if (open?.kind !== kind) $(`#view-${v} .chat-head .dock-ctl`)?.remove();
    const right = open && $(`#view-${VIEW[open.kind]} .chat-head .actions-right`);
    const ctl = right && $('.dock-ctl', right);
    if (!open) return;
    if (!right || ctl) return;
    right.insertAdjacentHTML('beforeend', ctlHTML('data-dock-min', 'data-dock-close-open'));
    $('[data-dock-min]', right).onclick = minimize;
    $('[data-dock-close-open]', right).onclick = () => close(openOne());
  }

  // ---------- what the row does ----------
  const byKey = (key) => row.items.find((p) => DockRow.keyOf(p) === key);
  function open(p, newest = false) {
    if (!p || !kinds[p.kind]) return;
    if (newest) { row.items = DockRow.add(DockRow.remove(row.items, p), p); save(); }
    kinds[p.kind].open(p.id);
  }
  // The open chat becomes a bar again; the chats expanded beside it stay.
  function minimize() {
    if (!docked()) return;
    row.items = DockRow.expand(row.items, openOne(), false);
    save();
    setView('company');
  }
  function close(p) {
    if (!p) return;
    row.items = DockRow.remove(row.items, p);
    save();
    const o = openOne();
    if (o && DockRow.same(o, p)) setView('company'); else { drawn = ''; draw(); }
  }

  let suppress = false; // a drag just ended: the click it ends with opens nothing
  function wire() {
    dock.addEventListener('click', (e) => {
      if (suppress) { suppress = false; e.preventDefault(); e.stopPropagation(); return; }
      const more = e.target.closest('.dock-more');
      if (more) {
        const menu = more.nextElementSibling;
        menu.hidden = !menu.hidden;
        more.setAttribute('aria-expanded', String(!menu.hidden));
        return;
      }
      const o = e.target.closest('[data-dock-open]');
      if (o) return open(byKey(o.dataset.dockOpen), !!o.closest('.dock-menu'));
      const x = e.target.closest('[data-dock-close]');
      if (x) close(byKey(x.dataset.dockClose));
    }, true);
    document.addEventListener('pointerdown', (e) => {
      const menu = $('.dock-menu', dock);
      if (menu && !menu.hidden && !e.target.closest('.dock-more-wrap')) { menu.hidden = true; $('.dock-more', dock)?.setAttribute('aria-expanded', 'false'); }
    });
    dock.addEventListener('keydown', (e) => {
      const menu = $('.dock-menu', dock);
      if (e.key === 'Escape' && menu && !menu.hidden) { menu.hidden = true; $('.dock-more', dock)?.focus(); }
    });
    dock.addEventListener('pointerdown', dragStart);
  }

  // A bar, or the open panel by its head, dragged sideways: it follows the pointer, and lands where its middle is.
  // A phone's sheet is dragged by its grip: up for full height, down for half, down from half to minimize.
  function dragStart(e) {
    if (e.button !== 0) return;
    if (e.target.closest('.dock-grip')) return sheetDrag(e);
    const item = e.target.closest('.dock-item');
    if (!item || phone() || (item.classList.contains('dock-panel') && !e.target.closest('.chat-head'))) return;
    const x0 = e.clientX;
    let moved = false;
    const move = (m) => {
      const dx = m.clientX - x0;
      if (!moved && Math.abs(dx) < 6) return;
      moved = true;
      item.classList.add('dragging');
      item.style.transform = `translateX(${dx}px)`;
    };
    const up = (u) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      if (!moved) return;
      suppress = u.type === 'pointerup';
      setTimeout(() => { suppress = false; }, 0); // a drag that ends outside the row is followed by no click
      const dx = u.clientX - x0;
      item.style.transform = '';
      item.classList.remove('dragging');
      const shown = $$('.dock-item:not(.hidden)', dock);
      const from = shown.indexOf(item);
      const middles = shown.map((el) => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; });
      const to = DockRow.dropAt(middles, from, middles[from] + dx);
      const hidden = row.items.length - shown.length;
      if (from !== -1 && to !== from) { row.items = DockRow.move(row.items, hidden + from, hidden + to); save(); }
      drawn = '';
      draw();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  }
  function sheetDrag(e) {
    const y0 = e.clientY;
    const up = (u) => {
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      const dy = u.clientY - y0;
      // A tap on the grip: the other height.
      const next = Math.abs(dy) < 6 ? (row.sheet === 'full' ? 'half' : 'full') : DockRow.sheetAfter(row.sheet, dy);
      if (next === 'closed') return minimize();
      row.sheet = next;
      save();
      panel.dataset.sheet = next;
    };
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  }

  let frame = 0;
  addEventListener('resize', () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { drawn = ''; if (dock) draw(); }); });

  return { draw, docked, kinds, open, openChief, close, minimize, chats, chatOf, drawChat };
})();
// On globalThis too: the chats' code (bot-chat.js, replies.js, needs.js, feed.js) asks for it where it may be missing.
globalThis.Dock = Dock;
