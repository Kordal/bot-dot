// The pencil on a board tile (ADR 273). Each tile that has a title of its own (Current work, Blockers, Latest replies,
// Calendar, To-do, Files, a card made by Claude) has a pencil beside it. Pressing it opens the project's own chat, the
// project manager's, with a chip above the message box that names the tile, the box focused and a ring on the tile.
// The owner says what to change and sends; the message carries the tile (`card`, with the project) to the server, which
// checks it against the board and tells the manager which tile is meant. Taking the chip off sends a plain message.
// Sending clears the chip and the ring. Drawn only when the server says `card-edit` (docs/api.md).
(() => {
  const PEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>';
  const X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const on = () => (state.features || []).includes('card-edit');

  // The tile the pencil points at now: { project, id, label }, until it is sent, taken off, or its tile is gone.
  let target = null;

  // Where each pointable tile is in the drawn board, and the title it has: `tile` is the element that gets the ring,
  // `head` the one the pencil stands in (a card's head) or, with none, the tile's top right corner.
  const TILES = [
    { sel: '[data-cf-ov="work"], [data-cf-ov="blockers"], [data-cf-ov="replies"]', id: (el) => el.dataset.cfOv, title: (el) => $('h2', el) },
    { sel: '[data-cf-cal]', id: () => 'calendar', title: (el) => $('.cf-room-head', el) },
    { sel: '[data-cf-files]', id: () => 'files', title: (el) => $('.cf-room-head', el) },
    { sel: '[data-cf-todo-head]', id: () => 'todo', title: (el) => $('h2', el), tile: (el) => el.closest('.cf-panel') },
    { sel: '[data-pc-card]', id: (el) => `card:${el.dataset.pcCard}`, title: (el) => $('.pc-title', el), inHead: true },
  ];

  // Whether the board still has the tile the chip names: a card removed, a piece taken off.
  const stillThere = (c, t) => {
    if (t.id.startsWith('card:')) return (c.cards || []).some((k) => `card:${k.id}` === t.id);
    return Company.onBoard(c, t.id);
  };

  function ring(root = document) {
    for (const el of $$('[data-be-ring]', root)) el.removeAttribute('data-be-ring');
    if (target) for (const el of $$(`[data-be-tile="${CSS.escape(target.id)}"]`, root)) el.dataset.beRing = '';
  }

  // The pencils of a drawn board (company-home.js, after the tiles stand where they are), and the ring.
  function apply(root, c) {
    if (target && (target.project !== c.id || !stillThere(c, target))) { target = null; sync(); }
    if (!on() || c.phase !== 'running' || !Dock.defaultChat()) return;
    for (const t of TILES) {
      for (const mark of $$(t.sel, root)) {
        const tile = t.tile ? t.tile(mark) : mark;
        const id = t.id(mark);
        const title = t.title(mark);
        if (!tile || !title || $('.be-pencil', tile)) continue;
        const label = title.textContent.trim();
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `be-pencil${t.inHead ? '' : ' be-abs'}`;
        btn.innerHTML = PEN;
        btn.setAttribute('aria-label', tr('Edit {name}', { name: label }));
        btn.title = tr('Edit');
        btn.onclick = (e) => { e.stopPropagation(); pick(c, id, label); };
        // A pointer press on the pencil is no drag of the tile (board-canvas-view.js).
        btn.onpointerdown = (e) => e.stopPropagation();
        tile.dataset.beTile = id;
        if (t.inHead) title.after(btn); else { tile.classList.add('be-has'); tile.append(btn); }
      }
    }
    ring(root);
  }

  // The pencil was pressed: the chat opens beside the board, the chip stands above its box, and the box has the focus.
  async function pick(c, id, label) {
    target = { project: c.id, id, label };
    ring();
    sync();
    await Dock.openDefault();
    sync();
    const box = composer()?.text;
    if (box) box.focus({ preventScroll: true });
  }

  // The message box of the project's own chat when it is the one open: the manager's, as Dock chooses it.
  function composer() {
    const c = state.company;
    const d = c && Dock.defaultChat();
    if (!d || !Dock.docked()) return null;
    const shown = d.kind === 'bot' ? state.view === 'bot' && state.botId === d.id : d.kind === 'chief' && state.view === 'chief' && !!c.chiefChat && state.chatId === c.chiefChat;
    return shown ? $('#chat-row .view:not(.hidden) form.composer') : null;
  }

  // The chip above the message box of the project's chat, and none in any other box.
  function sync() {
    const mine = target && state.company?.id === target.project ? composer() : null;
    for (const chip of $$('.card-chip')) if (!mine || !mine.contains(chip)) chip.remove();
    if (!mine) return;
    let chip = $('.card-chip', mine);
    if (!chip) {
      chip = document.createElement('div');
      chip.className = 'card-chip';
      chip.setAttribute('role', 'group');
      $('.composer-box', mine).before(chip);
    }
    const sig = `${target.id}\n${target.label}`;
    if (chip.dataset.sig === sig) return;
    chip.dataset.sig = sig;
    chip.setAttribute('aria-label', tr('About {name}', { name: target.label }));
    chip.innerHTML = `<span class="card-chip-name">${esc(target.label)}</span><button type="button" aria-label="${esc(tr('Remove {name} from this message', { name: target.label }))}" title="${esc(tr('Remove'))}">${X}</button>`;
    $('button', chip).onclick = () => { clear(); mine.text?.focus(); };
  }

  function clear() {
    target = null;
    ring();
    sync();
  }

  // What a message sent from the open chat carries: the tile and its project, or null (a plain message). kind: 'bot' or
  // 'chief'; id: the bot's id, or the Chief chat's.
  function cardFor(kind, id) {
    const c = state.company;
    const d = on() && target && c?.id === target.project ? Dock.defaultChat() : null;
    if (!d || d.kind !== kind || (kind === 'bot' ? d.id !== id : c.chiefChat !== id)) return null;
    return { card: target.id, project: target.project, label: target.label };
  }
  // The message with the tile went: the chip and the ring are done.
  const sent = (card) => { if (card && target?.id === card.card && target.project === card.project) clear(); };

  // The tile's name above the owner's message that was about it (a run's, a Chief chat's, a waiting one's). The server
  // stores a fixed piece's name in English (lib/project-board-note.js), so a piece is drawn by its id in the owner's
  // language, as the chip was; only a card made by Claude has a name of its own, which is its title.
  const PIECES = ['work', 'blockers', 'replies', 'calendar', 'todo', 'files'];
  const nameOf = (card) => (PIECES.includes(card.id) ? Company.pieceLabel(card.id) || card.label : card.label);
  const aboutHTML = (card) => (card && typeof card.label === 'string' && card.label ? `<span class="card-about">${esc(nameOf(card))}</span>` : '');

  window.BoardEdit = { apply, sync, clear, cardFor, sent, aboutHTML };
})();
