// A project's board as a free canvas (#783, ADR 124), drawn: the home (company-home.js) draws its tiles as always,
// and here they are taken out of that flow and stood where the project's `layout` puts them, on a canvas
// BoardCanvas.W wide scaled to the window's width. A project never arranged keeps the flow until its first drop.
// There is no Arrange mode (#821, ADR 130): with a mouse a tile drags by its body once the pointer has moved a few
// pixels (a click without a move still clicks) and resizes from its edges and corners; on a touch screen a long press
// picks it up, then it drags; the focused tile moves with the arrows and resizes with Shift and the arrows. A tile it
// would cover slides down. Each drop is saved at once; the first starts from where the tiles stood in the flow.
(() => {
  const B = window.BoardCanvas;
  const STEP = 8;
  const SLOP = 6; // pixels a mouse moves before a press is a drag, not a click
  const TOUCH_SLOP = 10; // pixels a finger moves before the long press is a scroll instead
  const HOLD = 450; // ms of a long press
  const EDGE = { mouse: 10, touch: 24 }; // pixels from a tile's side that resize it
  const CURSOR = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
  // What a press inside never drags: the fields keep their own selecting and typing.
  const FIELD = 'input, textarea, select, option, [contenteditable=""], [contenteditable="true"]';
  // The press now, before it is a drag: { id, x, y, edge, c, home, el, touch, held, timer }; the drag: { ...press, from }.
  let press = null;
  let drag = null;
  let shown = null;
  let saving = null;
  let observer = null;
  let swallow = false;

  const on = () => (state.features || []).includes('project-layout');

  // Each tile of the drawn home and its elements, by tile id.
  const TILES = [
    ['.cf-home > .cf-line, .cf-home > .cf-checkin', () => 'days'],
    ['[data-cf-goal].cf-goal', (el) => `goal:${el.dataset.cfGoal}`],
    ['.cf-room[data-cf-team]', (el) => `room:${el.dataset.cfTeam}`],
    ['.cf-chief', () => 'chief'],
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

  // The tiles of the drawn home stood on the canvas when the project has a layout; either way they can be picked up.
  function apply(root, c) {
    const home = $('.cf-home', root);
    if (!on() || !home) return;
    shown = null;
    if (c.layout) build(home, c, B.complete(c.layout, [...tiles(home).keys()]));
    home.onpointerdown = (e) => down(e, home, c);
    home.onpointermove = (e) => hover(e, home);
    home.addEventListener('touchstart', (e) => touchDown(e, home, c), { passive: true });
    home.addEventListener('touchmove', touchMove, { passive: false });
    home.addEventListener('touchend', touchUp, { passive: false });
    home.addEventListener('touchcancel', touchUp);
    home.oncontextmenu = (e) => { if (press?.held || drag) e.preventDefault(); };
    home.ondragstart = (e) => { if (tileAt(e.target, home)) e.preventDefault(); };
  }

  // The canvas built from the home's tiles, in `layout`.
  function build(home, c, layout) {
    const groups = tiles(home);
    shown = { id: c.id, layout };
    const wrap = document.createElement('div');
    wrap.className = 'bc-wrap';
    const canvas = document.createElement('div');
    canvas.className = 'bc-canvas';
    canvas.style.width = `${B.W}px`;
    wrap.append(canvas);
    for (const [id, els] of groups) {
      const t = document.createElement('div');
      t.className = 'bc-tile';
      t.dataset.tile = id;
      t.tabIndex = 0;
      t.append(...els);
      t.onkeydown = (e) => key(e, t, c);
      canvas.append(t);
    }
    for (const ch of [...home.children]) if (!ch.matches('.cf-top')) ch.remove();
    home.append(wrap);
    place(wrap);
    observer?.disconnect();
    observer = new ResizeObserver(() => place(wrap));
    observer.observe(wrap);
    return wrap;
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

  // The tile a press at `target` picks up, and its element on the canvas or in the flow; none in a field or the title.
  function tileAt(target, home) {
    if (!(target instanceof Element) || target.closest(FIELD) || target.closest('.cf-top')) return null;
    const t = target.closest('.bc-tile');
    if (t && home.contains(t)) return { id: t.dataset.tile, el: t };
    if (shown) return null;
    for (const [id, els] of tiles(home)) { const el = els.find((x) => x.contains(target)); if (el) return { id, el }; }
    return null;
  }
  // The side a point is near, on the canvas only: 'se' for the bottom right corner, null in the body.
  function edgeAt(el, x, y, near) {
    if (!el.classList.contains('bc-tile')) return null;
    const r = el.getBoundingClientRect();
    let edge = '';
    if (y < r.top + near) edge += 'n'; else if (y > r.bottom - near) edge += 's';
    if (x < r.left + near) edge += 'w'; else if (x > r.right - near) edge += 'e';
    return edge || null;
  }

  // ---------- a mouse or a pen ----------
  function down(e, home, c) {
    if (e.pointerType === 'touch' || e.button !== 0 || drag) return;
    const hit = tileAt(e.target, home);
    if (!hit) return;
    // A press on a tile's own scrollbar scrolls it.
    if (e.target === hit.el && (e.offsetX > hit.el.clientWidth || e.offsetY > hit.el.clientHeight)) return;
    press = { ...hit, x: e.clientX, y: e.clientY, edge: edgeAt(hit.el, e.clientX, e.clientY, EDGE.mouse), c, home };
  }
  function hover(e, home) {
    if (e.pointerType === 'touch' || e.buttons || drag) return;
    const t = e.target instanceof Element && e.target.closest('.bc-tile');
    for (const x of $$('.bc-tile[style*="cursor"]', home)) if (x !== t) x.style.cursor = '';
    if (t) t.style.cursor = CURSOR[edgeAt(t, e.clientX, e.clientY, EDGE.mouse)] || '';
  }
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    if (press && !drag && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) begin();
    if (drag) move(e.clientX, e.clientY);
  });
  window.addEventListener('pointerup', (e) => { if (e.pointerType !== 'touch') end(); });
  window.addEventListener('pointercancel', (e) => { if (e.pointerType !== 'touch') end(); });
  // The click that ends a drag clicks nothing.
  window.addEventListener('click', (e) => { if (swallow) { e.preventDefault(); e.stopPropagation(); swallow = false; } }, true);

  // ---------- a finger: a long press, then a drag ----------
  function touchDown(e, home, c) {
    if (e.touches.length !== 1 || drag) { cancelPress(); return; }
    const p = e.touches[0];
    const hit = tileAt(e.target, home);
    if (!hit) return;
    press = { ...hit, x: p.clientX, y: p.clientY, edge: edgeAt(hit.el, p.clientX, p.clientY, EDGE.touch), c, home, touch: true };
    press.timer = setTimeout(() => {
      if (!press) return;
      press.held = true;
      press.el.classList.add('bc-held');
      navigator.vibrate?.(10);
    }, HOLD);
  }
  function touchMove(e) {
    if (!press?.touch) return;
    const p = e.touches[0];
    if (!press.held) {
      if (e.touches.length > 1 || Math.hypot(p.clientX - press.x, p.clientY - press.y) > TOUCH_SLOP) cancelPress();
      return;
    }
    e.preventDefault(); // held: the finger moves the tile, not the page
    if (!drag) begin();
    move(p.clientX, p.clientY);
  }
  function touchUp(e) {
    if (!press?.touch) return;
    if (press.held && e.cancelable) e.preventDefault(); // a long press opens nothing
    end();
  }
  function cancelPress() {
    if (!press) return;
    clearTimeout(press.timer);
    press.el?.classList.remove('bc-held');
    press = null;
  }

  // ---------- the drag ----------
  function begin() {
    const p = press;
    // The first drag of a project never arranged: the canvas starts from where the tiles stand in the flow.
    if (!shown) {
      const groups = tiles(p.home);
      const wrap = build(p.home, p.c, B.complete(B.measured(rects(groups, p.home), p.home.clientWidth), [...groups.keys()]));
      p.el = $(`.bc-tile[data-tile="${CSS.escape(p.id)}"]`, wrap) || p.el;
    }
    drag = { ...p, from: shown.layout };
    p.el.classList.remove('bc-held');
    p.el.classList.add('moving');
    document.body.classList.add('bc-dragging');
    window.getSelection?.()?.removeAllRanges();
  }
  function move(x, y) {
    const wrap = drag.el.closest('.bc-wrap');
    if (!wrap) return;
    const s = scaleOf(wrap);
    shown.layout = B.drag(drag.from, drag.id, drag.edge, (x - drag.x) / s, (y - drag.y) / s);
    place(wrap);
  }
  function end() {
    cancelPress();
    if (!drag) return;
    const d = drag;
    drag = null;
    d.el.classList.remove('moving');
    document.body.classList.remove('bc-dragging');
    swallow = !d.touch;
    setTimeout(() => { swallow = false; });
    if (shown.layout !== d.from || !d.c.layout) save(d.c, shown.layout);
  }

  function key(e, t, c) {
    const d = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] }[e.key];
    if (!d || e.target !== t) return;
    e.preventDefault();
    shown.layout = B.drag(shown.layout, t.dataset.tile, e.shiftKey ? 'se' : null, d[0], d[1]);
    place(t.closest('.bc-wrap'));
    clearTimeout(saving);
    saving = setTimeout(() => save(c, shown.layout), 400);
  }

  // The layout kept on the project at once (the page draws it as it is), then sent; botdot's answer is drawn.
  async function save(c, layout) {
    clearTimeout(saving);
    Company.put({ ...c, layout });
    try { Company.changed({ company: await api(Company.at('/company/layout'), { method: 'PUT', body: { layout } }) }); } catch (e) { toast(e.message, true); Company.redraw(); }
  }

  // While a tile is dragged the home is not drawn again: that would drop it.
  const busy = () => !!drag;

  window.BoardView = { apply, busy, sig: () => [on()] };
})();
