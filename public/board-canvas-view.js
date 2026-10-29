// A project's board as a free canvas (#783, ADR 124), drawn: the home (company-home.js) draws its tiles as always,
// and here they are taken out of that flow and stood where the project's `layout` puts them, on a canvas
// BoardCanvas.W wide scaled to the window's width. A project never arranged keeps the flow. Arrange (beside the gear)
// lets the owner drag a tile by its body and resize it by its edges and corners, or move the focused one with the
// arrows and resize it with Shift and the arrows; a tile it would cover slides down. Each change is saved at once.
// The first Arrange starts from where the tiles stand in the flow.
(() => {
  const B = window.BoardCanvas;
  const MOVE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>';
  const EDGES = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'];
  const STEP = 8;
  let arranging = false;
  // The tile dragged now: { id, edge, x, y, from }; the layout shown, and the project it is of.
  let drag = null;
  let shown = null;
  let saving = null;
  let observer = null;

  const on = () => (state.features || []).includes('project-layout');

  // Each tile of the drawn home and its elements, by tile id.
  const TILES = [
    ['.cf-home > .cf-line, .cf-home > .cf-checkin', () => 'days'],
    ['[data-cf-goal].cf-goal', (el) => `goal:${el.dataset.cfGoal}`],
    ['.cf-room[data-cf-team]', (el) => `room:${el.dataset.cfTeam}`],
    ['.cf-chief', () => 'chief'],
    ['.cf-loose', (el) => `bot:${$('[data-cf-bot]', el)?.dataset.cfBot}`],
    ['.cf-suggest', () => 'suggest'],
    ['.cf-new', () => 'new-team'],
    ['.cf-cal', () => 'calendar'],
    ['.cf-panel', () => 'todo'],
    ['[data-pc-card], [data-pc-asking]', (el) => `card:${el.dataset.pcCard || el.dataset.pcAsking}`],
    ['form.pc-ask', (el) => (el.dataset.pcFor ? `card:${el.dataset.pcFor}` : 'new-card')],
    ['.pc-new, .pc-picks', () => 'new-card'],
  ];
  function tiles(home) {
    const out = new Map();
    for (const [sel, idOf] of TILES) {
      for (const el of $$(sel, home)) {
        const id = idOf(el);
        if (!B.kindOf(id)) continue;
        if (!out.has(id)) out.set(id, []);
        out.get(id).push(el);
      }
    }
    return out;
  }

  // Where each tile stands in the flow, in pixels from the top left of the first.
  function rects(groups, home) {
    const box = home.getBoundingClientRect();
    const all = {};
    for (const [id, els] of groups) {
      const rs = els.map((el) => el.getBoundingClientRect()).filter((r) => r.width || r.height);
      if (!rs.length) continue;
      const l = Math.min(...rs.map((r) => r.left)); const t = Math.min(...rs.map((r) => r.top));
      all[id] = [l - box.left, t, Math.max(...rs.map((r) => r.right)) - l, Math.max(...rs.map((r) => r.bottom)) - t];
    }
    const top = Math.min(...Object.values(all).map((r) => r[1]));
    for (const r of Object.values(all)) r[1] -= top;
    return all;
  }

  function buttonHTML() {
    if (!on()) return '';
    const label = arranging ? tr('Done') : tr('Arrange');
    return `<button type="button" class="icon-btn bc-arrange" data-bc-arrange aria-pressed="${arranging}" aria-label="${label}" title="${label}">${MOVE}</button>`;
  }

  // The tiles of the drawn home stood on the canvas, when the project has a layout or is being arranged.
  function apply(root, c) {
    const home = $('.cf-home', root);
    if (!on() || !home) return;
    $('[data-bc-arrange]', home)?.addEventListener('click', () => toggle(c));
    if (!arranging && !c.layout) { shown = null; return; }
    const groups = tiles(home);
    const ids = [...groups.keys()];
    const layout = B.complete(c.layout || B.measured(rects(groups, home), home.clientWidth), ids);
    shown = { id: c.id, layout };
    const wrap = document.createElement('div');
    wrap.className = `bc-wrap${arranging ? ' arranging' : ''}`;
    const canvas = document.createElement('div');
    canvas.className = 'bc-canvas';
    canvas.style.width = `${B.W}px`;
    wrap.append(canvas);
    for (const [id, els] of groups) {
      const t = document.createElement('div');
      t.className = 'bc-tile';
      t.dataset.tile = id;
      t.append(...els);
      if (arranging) {
        t.tabIndex = 0;
        t.setAttribute('aria-label', id);
        t.insertAdjacentHTML('beforeend', `<i class="bc-cover"></i>${EDGES.map((e) => `<i class="bc-h" data-edge="${e}"></i>`).join('')}`);
      }
      canvas.append(t);
    }
    for (const ch of [...home.children]) if (!ch.matches('.cf-top')) ch.remove();
    home.append(wrap);
    place(wrap);
    observer?.disconnect();
    observer = new ResizeObserver(() => place(wrap));
    observer.observe(wrap);
    if (arranging) wire(wrap, c);
    // A first Arrange keeps where the tiles stood: saved at once, so every window shows the same.
    if (arranging && !c.layout) save(c, layout);
  }

  const scaleOf = (wrap) => wrap.clientWidth / B.W;
  function place(wrap, layout = shown?.layout) {
    if (!layout) return;
    const s = scaleOf(wrap);
    const canvas = $('.bc-canvas', wrap);
    canvas.style.transform = `scale(${s})`;
    wrap.style.height = `${B.height(layout) * s}px`;
    for (const t of $$('.bc-tile', canvas)) {
      const r = layout[t.dataset.tile];
      if (!r) continue;
      Object.assign(t.style, { left: `${r[0]}px`, top: `${r[1]}px`, width: `${r[2]}px`, height: `${r[3]}px` });
    }
  }

  function wire(wrap, c) {
    for (const t of $$('.bc-tile', wrap)) {
      t.onpointerdown = (e) => {
        if (e.button !== 0) return;
        const edge = e.target.dataset?.edge || null;
        if (!edge && !e.target.classList.contains('bc-cover')) return;
        e.preventDefault();
        t.focus({ preventScroll: true });
        t.setPointerCapture(e.pointerId);
        drag = { id: t.dataset.tile, edge, x: e.clientX, y: e.clientY, from: shown.layout };
        t.classList.add('moving');
      };
      t.onpointermove = (e) => {
        if (!drag || drag.id !== t.dataset.tile) return;
        const s = scaleOf(wrap);
        shown.layout = B.drag(drag.from, drag.id, drag.edge, (e.clientX - drag.x) / s, (e.clientY - drag.y) / s);
        place(wrap);
      };
      t.onpointerup = t.onpointercancel = () => {
        if (!drag) return;
        const moved = shown.layout !== drag.from;
        drag = null;
        t.classList.remove('moving');
        if (moved) save(c, shown.layout);
      };
      t.onkeydown = (e) => {
        const d = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] }[e.key];
        if (!d || e.target !== t) return;
        e.preventDefault();
        shown.layout = B.drag(shown.layout, t.dataset.tile, e.shiftKey ? 'se' : null, d[0], d[1]);
        place(wrap);
        clearTimeout(saving);
        saving = setTimeout(() => save(c, shown.layout), 400);
      };
    }
  }

  // The layout kept on the project at once (the page draws it as it is), then sent; botdot's answer is drawn.
  async function save(c, layout) {
    clearTimeout(saving);
    Company.put({ ...c, layout });
    try { Company.changed({ company: await api(Company.at('/company/layout'), { method: 'PUT', body: { layout } }) }); } catch (e) { toast(e.message, true); Company.redraw(); }
  }

  function toggle() {
    arranging = !arranging;
    Company.redraw();
  }

  // While a tile is dragged the home is not drawn again: that would drop it.
  const busy = () => !!drag;
  // Another project shown ends arranging.
  function leave(c) { if (arranging && shown && c?.id !== shown.id) arranging = false; }

  window.BoardView = { apply, buttonHTML, busy, leave, sig: () => [arranging, on()] };
})();
