// The chat on the Projects screen. A wide window (#825) holds one chat as a fixed column on the right of the board,
// like the bot view (ADR 029). Below that (#839, ADR 132) a chat opened on a project, from a key, a team's name, the
// bottom field or Esc, is full screen, and Back is the project again: one chat at a time, no row of docked chats.
// The chat is the bot's, the team's or the Chief's own view: the chat's row stays where it is, and the stylesheet puts
// it beside the board or over it.
// A chat is { kind, id }: `kinds` says how each kind is opened: a bot's chat, a team's (#697), which is the group
// chat of that team (groups.js), or the Chief's (#819).
const Dock = (() => {
  const ICON = {
    side: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M14.5 4.5v15"/></svg>',
  };

  const kinds = {
    bot: { open: (id) => setView('bot', id) },
    team: { open: (id) => setView('group', id) },
    // The Chief's chat (#819), on the chat it shows (a goal's change ask opens a new one there). Beside the project
    // only when opened from it (openChief), not whenever the Chief's view is up, as it is while the page starts.
    chief: { open: () => openChief() },
  };

  const shows = () => typeof Company !== 'undefined' && (state.features || []).includes('company') && Company.place() === 'company';
  let chiefHere = false; // the Chief's view up was opened on the Projects screen
  function openChief(chatId) {
    chiefHere = true;
    if (chatId === undefined) setView('chief'); else openChiefChat(chatId);
  }
  // The Projects screen shows a bot, a team's chat or the Chief's: that chat is the one beside it.
  const openKind = () => (state.view === 'bot' && botById(state.botId) ? 'bot' : state.view === 'group' && groupById(state.groupId)?.team ? 'team' : state.view === 'chief' && chiefHere ? 'chief' : null);
  const docked = () => shows() && !!openKind();
  const WIDE = '(min-width: 1001px)';
  const column = () => shows() && matchMedia(WIDE).matches;

  function draw() {
    if (!$('#chat-row')) return;
    if (state.view !== 'chief' || !shows()) chiefHere = false;
    if (drawColumn()) return;
    drawFull();
  }

  // ---------- below a wide window: the chat full screen (#839) ----------
  // The project's page is hidden under the chat (setView hides it), and the chat's Back is the project again.
  function drawFull() {
    const app = $('#app');
    const open = docked();
    app.classList.remove('proj-chat', 'proj-hidden', 'docked');
    app.classList.toggle('proj-full', open);
    showBtn?.classList.add('hidden');
    syncHead(false);
  }
  // Back in a chat opened on a project: the project, not the list (boot.js's Back), before that one hears it.
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('#chat-row [data-back]') || !$('#app').classList.contains('proj-full')) return;
    e.stopPropagation();
    setView('company');
  }, true);

  // ---------- the chat column of a wide window (#825) ----------
  // Hidden by its head's button: the board takes the whole width until a chat is opened or Show is pressed. Kept per
  // device.
  const HKEY = 'botdot.projectChat';
  let hidden = (() => { try { return localStorage.getItem(HKEY) === 'hidden'; } catch { return false; } })();
  const setHidden = (on) => { hidden = on; try { if (on) localStorage.setItem(HKEY, 'hidden'); else localStorage.removeItem(HKEY); } catch { /* private mode */ } };
  let showBtn = null; // #project-chat-show: the column back, at the top right of the board
  let opening = false; // the default chat is being opened
  // The chat a project opens on (#825): its team's chat, where a message without @ goes to the lead (ADR 119); the
  // Chief's for a project with no team chat yet. A project in its setup opens none: the setup keeps the width.
  function defaultChat() {
    const c = state.company;
    if (!c || c.phase !== 'running') return null;
    const g = (c.teams || []).map((t) => (state.groups || []).find((x) => x.team === t.id)).find(Boolean);
    if (g) return { kind: 'team', id: g.id };
    if (!state.groupsKnown) return null; // its team chat may not be loaded yet
    return { kind: 'chief', id: 'chief' };
  }
  // The project's default chat, opened: the bottom field below a wide window (#839).
  function openDefault() {
    const d = defaultChat() || { kind: 'chief' };
    kinds[d.kind].open(d.id);
  }
  // Draws the Projects screen of a wide window; false below it.
  function drawColumn() {
    if (!column()) return false;
    const app = $('#app');
    const open = docked();
    if (open && hidden) setHidden(false); // a chat opened from a key or the board shows the column again
    app.classList.remove('proj-full');
    app.classList.toggle('docked', open);
    app.classList.toggle('proj-chat', open);
    if (open) $('#view-company')?.classList.remove('hidden');
    syncHead(open);
    const bare = state.view === 'company';
    if (bare && !hidden && !opening) {
      const d = defaultChat();
      // Opened after this drawing: opening it draws the screen again.
      if (d) { opening = true; queueMicrotask(() => { opening = false; if (state.view === 'company' && column() && !hidden) kinds[d.kind].open(d.id); }); }
    }
    if (!showBtn) {
      showBtn = document.createElement('button');
      showBtn.type = 'button';
      showBtn.id = 'project-chat-show';
      showBtn.className = 'icon-btn project-chat-show hidden';
      showBtn.innerHTML = ICON.side;
      showBtn.onclick = () => { setHidden(false); draw(); };
      $('.main').appendChild(showBtn);
    }
    const canShow = bare && hidden && !!defaultChat();
    app.classList.toggle('proj-hidden', canShow);
    showBtn.classList.toggle('hidden', !canShow);
    showBtn.setAttribute('aria-label', tr('Show chat'));
    showBtn.title = tr('Show chat');
    return true;
  }
  // The column's head button: the board takes the whole width.
  function hide() {
    setHidden(true);
    setView('company');
  }
  // The open chat's head carries Hide while it is the column of a wide window.
  function syncHead(on) {
    const v = { bot: 'bot', team: 'group', chief: 'chief' }[openKind()];
    for (const ctl of $$('.chat-head .dock-ctl')) if (!on || !ctl.closest(`#view-${v}`)) ctl.remove();
    const right = on && $(`#view-${v} .chat-head .actions-right`);
    if (!right || $('.dock-ctl', right)) return;
    right.insertAdjacentHTML('beforeend', `<span class="dock-ctl col"><button type="button" class="icon-btn" data-dock-hide aria-label="${tr('Hide chat')}" title="${tr('Hide chat')}">${ICON.side}</button></span>`);
    $('[data-dock-hide]', right).onclick = hide;
  }

  let frame = 0;
  addEventListener('resize', () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); });

  return { draw, docked, kinds, openChief, openDefault, defaultChat, hide, column };
})();
// On globalThis too: the chats' code (bot-chat.js, replies.js, needs.js, feed.js) asks for it where it may be missing.
globalThis.Dock = Dock;
