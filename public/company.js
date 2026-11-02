// The Company (#669, ADR 110; docs/api.md, "The Company"): a place of its own beside the bots, a space of the rail
// (ADR 132), from a server with `company`. The owner says what they are working
// on (a site, or an idea in one sentence) with its sources (files, links); the setup and the company's home follow
// (the About, Team and Start steps, the office floor), each drawn by its own part: Company.steps (the Team and Start
// steps: company-team.js).
// Several projects (#689, ADR 120), from a server with `projects-many`: the left column lists PROJECTS with "+", each
// a tree of its teams and their bots that folds; a click on a project shows it, the one last shown is remembered per
// device; on a phone the project's name over the screen picks another. Every call names the project (Company.at).
const Company = (() => {
  const ICON = {
    building: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4h10v17 M15 9h4v12 M3 21h18 M8 8h1 M11 8h1 M8 12h1 M11 12h1 M9 21v-4h2v4"/></svg>',
    link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z M14 3v5h5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    go: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    fold: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    crown: '<svg class="ct-crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17 3 7l5 4 4-6 4 6 5-4-1 10z"/></svg>',
    clip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  };
  // The space on screen, as this device last had it (#837, ADR 132): 'home', or the id of a project. Before the rail
  // it was the place, 'bots' or 'company' (the project then in botdot.project), and those are still read.
  const KEY = 'botdot.place';
  const shows = () => (state.features || []).includes('company');
  const stored = (() => { try { return localStorage.getItem(KEY) || 'home'; } catch { return 'home'; } })();
  // Home is the place 'bots'; a project is the place 'company', with that project shown.
  let place = stored === 'home' || stored === 'bots' ? 'bots' : 'company';
  // A project remembered by its id: shown, or Home again once it is known to be gone (init).
  const storedId = place === 'company' && stored !== 'company' ? stored : null;
  const keep = () => { try { localStorage.setItem(KEY, place === 'company' ? shownId || 'company' : 'home'); } catch { /* private mode */ } };
  let loaded = false;
  // What the start screen holds before Go: the sources picked so far.
  const draft = { sources: [] };
  // The steps of the setup, then the home. Each later part puts its own drawing here: (root, company) => void.
  const steps = {};
  const STEPS = [['about', () => tr('About')], ['team', () => tr('Team')], ['start', () => tr('Start')]];

  const company = () => state.company || null;
  const many = () => (state.features || []).includes('projects-many');
  // The project shown, as this device last had it; null while a new one is being started ("+").
  const PKEY = 'botdot.project';
  let shownId = storedId || (() => { try { return localStorage.getItem(PKEY) || null; } catch { return null; } })();
  let adding = false;
  const keepShown = () => { try { if (shownId) localStorage.setItem(PKEY, shownId); if (place === 'company' && shownId) localStorage.setItem(KEY, shownId); } catch { /* private mode */ } };
  // Every project, the one shown as the page has it now (its parts change state.company as they save).
  const projects = () => (state.projects || (state.company ? [state.company] : [])).map((p) => (p.id === state.company?.id ? state.company : p));
  // A route of the project shown: `?project=<id>` from a server with several.
  // The projects in the list: not the archived ones (#701), which fold under Archived at its end.
  const listed = () => projects().filter((p) => !p.archived);
  const archivedOnes = () => projects().filter((p) => p.archived);
  // The project to show when none is chosen: the first not archived.
  const firstShown = (list) => list.find((p) => !p.archived) || list[0] || null;
  const at = (path) => (many() && state.company?.id ? `${path}${path.includes('?') ? '&' : '?'}project=${encodeURIComponent(state.company.id)}` : path);
  async function load() {
    if (!shows()) return null;
    try {
      if (many()) {
        state.projects = (await api('/company/list')).projects || [];
        state.company = adding ? null : state.projects.find((p) => p.id === shownId) || firstShown(state.projects);
      } else state.company = (await api('/company')).company;
      loaded = true;
    } catch (e) { console.warn(e.message); }
    return state.company;
  }
  // A project as the server answered a change of it: shown when it is the one shown, else kept in the list (an
  // answer that comes back after the owner went to another project does not take them back).
  function put(c) {
    if (!c?.id || !many()) { state.company = c; return c; }
    state.projects = [...(state.projects || []).filter((p) => p.id !== c.id), c].sort((x, y) => order(x) - order(y));
    if (state.company?.id === c.id) state.company = c;
    return c;
  }
  const order = (c) => { const i = (state.projects || []).findIndex((p) => p.id === c.id); return i < 0 ? Infinity : i; };
  // Show one project: the floor, its setup or its start.
  function show(id) {
    const p = projects().find((x) => x.id === id);
    if (!p) return;
    adding = false;
    shownId = id;
    keepShown();
    state.company = p;
    drawRail();
    current = null;
    closeSettings(false);
    if (state.view === 'company') redraw(); else setView('company');
  }
  // "+": what are you working on, for a new project.
  function startNew() {
    closeSettings(false);
    adding = true;
    state.company = null;
    current = null;
    if (state.view === 'company') redraw(); else setView('company');
  }

  // ---------- the place on screen ----------
  // Home is the place 'bots', a project 'company': the page's class follows it, and the rail marks it.
  function drawPlace() {
    $('#app').classList.toggle('place-company', shows() && place === 'company');
    drawRail();
  }
  function choose(p) {
    // A project is up, or a chat docked on it (#757): asked before the place changes, as Dock asks the place.
    const onProjects = state.view === 'company' || (typeof Dock !== 'undefined' && Dock.docked());
    place = p === 'company' ? 'company' : 'bots';
    keep();
    drawPlace();
    if (place === 'company') { drawSide(); setView('company'); } else if (onProjects) { setView('chief'); showList(); renderContacts(); }
  }

  // ---------- the rail of spaces (#837, ADR 132) ----------
  // A wide window (from 1001 px) on a server with projects: a narrow rail on the left with Home (the logo), a square
  // per project with its asks, "+" for a new one, and the top bar's tools at its foot. With no project yet it holds
  // Home and "+", the way to the first one (#853): there is no "Bots | Projects" switch.
  const WIDE = '(min-width: 1001px)';
  const railOn = () => shows();
  // What waits for the owner in a project: its team bots' asks, as its tree row counts them.
  const asksIn = (p) => (p.teams || []).reduce((sum, t) => sum + (t.bots || []).reduce((k, id) => k + (botById(id) ? waits(id) : 0), 0), 0);
  const square = (p, on) => {
    const n = asksIn(p);
    return `<button type="button" class="rail-sq${p.archived ? ' old' : ''}${hereAttr(on)}" data-space="${esc(p.id)}" style="--c:${esc(p.color || '#8e7cff')}" title="${esc(nameOf(p))}" aria-label="${esc(nameOf(p))}${n ? ` (${n})` : ''}">${esc(nameOf(p).charAt(0).toUpperCase())}${n ? `<span class="rail-n">${n > 99 ? '99+' : n}</span>` : ''}</button>`;
  };
  function drawRail() {
    const rail = $('#rail');
    if (!rail) return;
    const on = railOn();
    $('#app').classList.toggle('has-rail', on);
    placeTools(on && matchMedia(WIDE).matches);
    if (!on) { rail.dataset.html = ''; return; }
    const home = place !== 'company';
    const inProject = (p) => !home && !adding && p.id === state.company?.id;
    const old = archivedOnes();
    // Drawn again only when it changed: a click on a square drawn again under the pointer is lost.
    const html = `<div class="rail-home${home ? ' here' : ''}" data-space="home"></div>
      <div class="rail-sep"></div>
      ${listed().map((p) => square(p, inProject(p))).join('')}
      ${old.length ? `<div class="rail-sep"></div>${old.map((p) => square(p, inProject(p))).join('')}` : ''}
      <button type="button" class="rail-add${!home && adding ? ' here' : ''}" data-rail-new aria-haspopup="menu" aria-label="${tr('New')}" title="${tr('New')}">${ICON.plus}</button>
      <div class="rail-foot"></div>`;
    if (rail.dataset.html !== html) {
      // The logo and the tools are moved out first: they are the page's own, with their handlers.
      placeTools(false);
      rail.dataset.html = html;
      rail.innerHTML = html;
      const add = $('[data-rail-new]', rail);
      add.onclick = () => { const r = add.getBoundingClientRect(); menuAt({ x: r.right + 8, y: r.top }, newItems()); };
      $$('.rail-sq', rail).forEach((b) => { b.onclick = () => enter(b.dataset.space); b.oncontextmenu = (e) => rowMenu(e, b.dataset.space); });
      placeTools(matchMedia(WIDE).matches);
    }
    $('.rail-home', rail).classList.toggle('here', home);
    $('.rail-home', rail).setAttribute('aria-current', String(home));
  }
  // The logo is the rail's Home, and the search, admin, feedback and Settings buttons stand at its foot; back in the
  // top bar where there is no rail.
  function placeTools(inRail) {
    const rail = $('#rail'), brand = $('#brand'), tools = $('.side-tools');
    if (!rail || !brand || !tools) return;
    const homeBox = $('.rail-home', rail), foot = $('.rail-foot', rail);
    if (inRail && homeBox && foot) {
      if (brand.parentNode !== homeBox) homeBox.appendChild(brand);
      if (tools.parentNode !== foot) foot.appendChild(tools);
      brand.setAttribute('role', 'button');
      brand.tabIndex = 0;
      brand.setAttribute('aria-label', tr('Home'));
      brand.title = tr('Home');
      return;
    }
    const head = $('.side-head');
    if (brand.parentNode !== head) head.prepend(brand);
    if (tools.parentNode !== head) head.appendChild(tools);
    brand.removeAttribute('title');
    // Below a wide window, Home's title: the logo with a chevron opens the spaces (#839).
    if (!$('.brand-chev', brand)) brand.insertAdjacentHTML('beforeend', `<span class="brand-chev">${ICON.down}</span>`);
    if (narrowSpaces()) {
      brand.setAttribute('role', 'button');
      brand.tabIndex = 0;
      brand.setAttribute('aria-haspopup', 'dialog');
      brand.setAttribute('aria-label', tr('Spaces'));
      return;
    }
    brand.removeAttribute('role');
    brand.removeAttribute('tabindex');
    brand.removeAttribute('aria-haspopup');
    brand.setAttribute('aria-label', 'botdot');
  }
  const narrowSpaces = () => railOn() && !matchMedia(WIDE).matches;
  // ---------- the spaces sheet below a wide window (#839, ADR 132) ----------
  // The title's chevron: Home, each project with what waits there, and New project; a sheet from the bottom on a
  // phone, a menu under the title on a wider screen. The space picked is kept as the rail keeps it.
  function openSpaces(at) {
    $('#spaces-sheet')?.remove();
    const home = place !== 'company';
    const row = (p) => {
      const n = asksIn(p);
      const here = !home && !adding && p.id === state.company?.id;
      return `<button type="button" class="sp-row${p.archived ? ' old' : ''}${hereAttr(here)}" data-space="${esc(p.id)}"><span class="ct-av" style="--c:${esc(p.color || '#8e7cff')}">${esc(nameOf(p).charAt(0).toUpperCase())}</span><span class="ct-name">${esc(nameOf(p))}</span>${badge(n)}</button>`;
    };
    document.body.insertAdjacentHTML('beforeend', `<dialog class="sp-sheet" id="spaces-sheet" aria-label="${tr('Spaces')}">
      <i class="sp-grip"></i>
      <button type="button" class="sp-row${hereAttr(home)}" data-space="home"><span class="sp-home-mark">bot<i class="brand-dot"></i></span><span class="ct-name">${tr('Home')}</span></button>
      ${listed().map(row).join('')}${archivedOnes().map(row).join('')}
      <button type="button" class="sp-row" data-new-bot><span class="sp-add">${ICON.plus}</span><span class="ct-name">${tr('New bot')}</span></button>
      <button type="button" class="sp-row" data-space=""><span class="sp-add">${ICON.plus}</span><span class="ct-name">${tr('New project')}</span></button>
    </dialog>`);
    const d = $('#spaces-sheet');
    if (!matchMedia(PHONE).matches && at?.getBoundingClientRect) {
      const r = at.getBoundingClientRect();
      d.style.left = `${Math.max(8, r.left)}px`;
      d.style.top = `${r.bottom + 6}px`;
    }
    d.addEventListener('close', () => { d.remove(); at?.focus?.(); });
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-space], [data-new-bot]');
      if (!b && e.target !== d) return;
      d.close();
      if (b?.hasAttribute('data-new-bot')) newBot();
      else if (b) enter(b.dataset.space || null);
    });
    d.showModal();
    ($('.sp-row.here', d) || $('.sp-row', d)).focus();
  }
  // "+" (#853): a new bot or a new project. A bot is made by the Chief (CONTEXT.md): Home, a new chat with the Chief,
  // its message box started for the owner to finish.
  const newItems = () => [{ label: tr('New bot'), attr: 'data-new-bot', run: newBot }, { label: tr('New project'), attr: 'data-new-project', run: () => enter(null) }];
  function newBot() {
    enter('home');
    state.chatNew = true;
    showChat(null);
    const box = $('#view-chief form')?.text;
    if (!box) return;
    box.value = tr('A new bot that ');
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }
  // A space from the rail: Home (id 'home'), a project, or a new one (null).
  function enter(id) {
    if (id === 'home') {
      choose('bots');
      if (state.view !== 'chief') { setView('chief'); showList(); } // Home opens on the Chief's chat
      return;
    }
    place = 'company';
    if (id === null) { keep(); drawPlace(); return startNew(); }
    shownId = id; // kept before show, which draws the rail with it
    keep();
    drawPlace();
    show(id);
  }
  function wireRail() {
    const brand = $('#brand');
    if (!brand || brand.dataset.wired) return;
    brand.dataset.wired = '1';
    // In the rail the logo is Home; below a wide window it is Home's title, and opens the spaces (#839).
    const home = () => { if (brand.closest('#rail')) enter('home'); else if (narrowSpaces()) openSpaces(brand); };
    brand.addEventListener('click', home);
    brand.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); home(); } });
    // Search finds bots and chats on Home: from a project it goes there first. Below a wide window Settings does too:
    // the pages it opens stand where Home's list is (#839).
    const toHome = (wide) => () => { if ($('#app').classList.contains('has-rail') && place === 'company' && (!wide || matchMedia(WIDE).matches)) choose('bots'); };
    $('#search-btn')?.addEventListener('click', toHome(false), true);
    $('#more-btn')?.addEventListener('click', () => { if (!matchMedia(WIDE).matches) toHome(false)(); }, true);
    matchMedia(WIDE).addEventListener?.('change', drawRail);
  }

  // The Chief's row opens its chat beside the project (#825; docked on a narrower screen, #819).
  const openChief = () => (typeof Dock !== 'undefined' ? Dock.openChief() : setView('chief'));
  // The chat on screen beside the project (#825): its row in the tree is highlighted.
  const onScreen = (kind, id) => typeof Dock !== 'undefined' && Dock.docked() && (kind === 'bot' ? state.view === 'bot' && state.botId === id : state.view === 'group' && groupById(state.groupId)?.team === id);
  const hereAttr = (on) => (on ? ' here" aria-current="true' : '');
  function drawSide() {
    drawRail();
    const side = $('#company-side');
    if (!side || !shows()) return;
    const here = state.view === 'company' || (typeof Dock !== 'undefined' && Dock.docked());
    const chief = `<button type="button" class="co-row co-chief${state.view === 'chief' ? ' here' : ''}"${state.view === 'chief' ? ' aria-current="true"' : ''} data-open-chief>${chiefFigure('sm')}<span>${esc(chiefTitle())}</span></button>`;
    if (!many()) {
      const c = company();
      side.innerHTML = `<div class="co-label">${tr('Projects')}</div>
        <button type="button" class="co-row${here ? ' here' : ''}" data-open-company>${ICON.building}<span>${esc(c?.phase === 'running' && c.name ? c.name : tr('Setting up'))}</span></button>${chief}`;
      $('[data-open-company]', side).onclick = () => setView('company');
      $('[data-open-chief]', side).onclick = openChief;
      return;
    } else {
      // Drawn again only when it changed: the left column is drawn at every tick of the page, and a click on a row
      // drawn again under the pointer is lost.
      const html = `<div class="co-label">${tr('Projects')}<button type="button" class="icon-btn ct-add-project" data-new-project aria-label="${tr('New project')}" title="${tr('New project')}">${ICON.plus}</button></div>
        <div class="ct-tree" role="tree" aria-label="${tr('Projects')}">${listed().map((p) => treeHTML(p, here && !adding && p.id === state.company?.id)).join('')}${archivedHTML(here)}</div>
        <div class="ct-sep"></div>${chief}`;
      if (side.dataset.html === html) return;
      side.dataset.html = html;
      side.innerHTML = html;
      $('[data-new-project]', side).onclick = startNew;
      $$('[data-project]', side).forEach((b) => { b.onclick = () => show(b.dataset.project); b.oncontextmenu = (e) => rowMenu(e, b.dataset.project); });
      $$('[data-fold]', side).forEach((b) => (b.onclick = () => { fold(b.dataset.fold); drawSide(); }));
      $$('[data-tree-bot]', side).forEach((b) => (b.onclick = () => setView('bot', b.dataset.treeBot)));
      $$('[data-tree-team]', side).forEach((b) => (b.onclick = () => openTeamChat(b.dataset.treeTeam)));
      $('[data-open-chief]', side).onclick = openChief;
      return;
    }
    delete side.dataset.html;
    $('[data-open-chief]', side).onclick = openChief;
  }

  // ---------- the tree: project > teams > bots ----------
  // What is folded, per device: a project is open while it is the one shown, unless folded; a team is open.
  const TKEY = 'botdot.tree';
  const folds = (() => { try { return JSON.parse(localStorage.getItem(TKEY)) || {}; } catch { return {}; } })();
  const isOpen = (key, byDefault) => (key in folds ? !folds[key] : byDefault);
  function fold(key) {
    const isProject = !key.includes(':');
    folds[key] = isOpen(key, isProject ? key === state.company?.id : true);
    try { localStorage.setItem(TKEY, JSON.stringify(folds)); } catch { /* private mode */ }
  }
  // What waits for the owner of a bot (company-home.js counts it as the floor does), and whether it works.
  const waits = (id) => (Company.asksOf ? Company.asksOf(id) : 0);
  const badge = (n) => (n ? `<span class="ct-count">${n}</span>` : '');
  const caret = (key, open, label) => `<button type="button" class="ct-caret${open ? ' open' : ''}" data-fold="${esc(key)}" aria-expanded="${open}" aria-label="${esc(label)}">${ICON.fold}</button>`;
  const nameOf = (p) => p.name || p.start || tr('New project');
  function treeHTML(p, here) {
    const teams = (p.teams || []).map((t) => ({ ...t, members: t.bots.map(botById).filter(Boolean) })).filter((t) => t.members.length);
    const open = isOpen(p.id, p.id === state.company?.id);
    const n = teams.reduce((sum, t) => sum + t.members.reduce((k, b) => k + waits(b.id), 0), 0);
    const head = `<div class="ct-node">${teams.length ? caret(p.id, open, nameOf(p)) : '<span class="ct-caret"></span>'}<button type="button" class="co-row${here ? ' here' : ''}" role="treeitem" data-project="${esc(p.id)}"${teams.length ? ` aria-expanded="${open}"` : ''}><span class="ct-av" style="--c:${esc(p.color || '#8e7cff')}">${esc(nameOf(p).charAt(0).toUpperCase())}</span><span class="ct-name">${esc(nameOf(p))}</span>${badge(n)}</button></div>`;
    if (!open || !teams.length) return `<div class="ct-branch">${head}</div>`;
    return `<div class="ct-branch">${head}<div class="ct-kids" role="group">${teams.map((t) => {
      const key = `${p.id}:${t.id}`;
      const tOpen = isOpen(key, true);
      const bots = tOpen ? `<div class="ct-kids" role="group">${t.members.map((b) => `<button type="button" class="co-row ct-bot${hereAttr(onScreen('bot', b.id))}" role="treeitem" data-tree-bot="${esc(b.id)}"><span class="ct-head">${botFigure(colorOf(b), b.state, 'sm', outfitOf(b))}${b.id === t.lead && t.members.length > 1 ? ICON.crown : ''}</span><span class="ct-name">${esc(b.name)}</span>${waits(b.id) ? badge(waits(b.id)) : `<i class="ct-state${b.running ? ' on' : ''}"></i>`}</button>`).join('')}</div>` : '';
      return `<div class="ct-node">${caret(key, tOpen, t.name)}<button type="button" class="ct-team${hereAttr(onScreen('team', t.id))}" data-tree-team="${esc(t.id)}" style="--c:${esc(t.color)}"><i class="ct-dot"></i><span class="ct-name">${esc(t.name)}</span><span class="ct-n">${t.members.length}</span></button></div>${bots}`;
    }).join('')}</div></div>`;
  }
  // The archived projects, folded under Archived at the tree's end; open, each a row that shows it.
  function archivedHTML(here) {
    const list = archivedOnes();
    if (!list.length) return '';
    const open = isOpen('archived', false);
    return `<div class="ct-branch ct-archived"><div class="ct-node">${caret('archived', open, tr('Archived'))}<button type="button" class="co-row" data-fold="archived" aria-expanded="${open}"><span class="ct-name">${tr('Archived')}</span><span class="ct-n">${list.length}</span></button></div>${open ? `<div class="ct-kids" role="group">${list.map((p) => `<button type="button" class="co-row${here && !adding && p.id === state.company?.id ? ' here' : ''}" role="treeitem" data-project="${esc(p.id)}"><span class="ct-av" style="--c:${esc(p.color || '#8e7cff')}">${esc(nameOf(p).charAt(0).toUpperCase())}</span><span class="ct-name">${esc(nameOf(p))}</span></button>`).join('')}</div>` : ''}</div>`;
  }
  // A project's name, its space's title (#839): below a wide window its square, the name and a chevron that opens the
  // spaces; in a wide window the name alone, the rail beside it.
  function pickHTML(name) {
    if (!many() || !railOn()) return esc(name);
    const c = !adding && state.company;
    const sq = c ? `<span class="ct-av" style="--c:${esc(c.color || '#8e7cff')}">${esc(nameOf(c).charAt(0).toUpperCase())}</span>` : '';
    return `<button type="button" class="co-pick" data-space-pick aria-haspopup="dialog">${sq}<span class="co-pick-name">${esc(name)}</span>${ICON.down}</button>`;
  }
  // Search and Settings at the top right of a project's page below a wide window (#839): the top bar's own.
  const toolsHTML = () => `<span class="sp-tools"><button type="button" class="icon-btn" data-sp-tool="search-btn" aria-label="${tr('Search')}" title="${tr('Search')}">${ICON.search}</button><button type="button" class="icon-btn" data-sp-tool="more-btn" aria-label="${tr('Settings')}" title="${tr('Settings')}">${ICON.gear}</button></span>`;
  // The gear beside a project's name: its settings (#701), from a server with `project-settings`.
  // The pieces on a project's board (#780), as lib/company.js keeps them: a project without `board` (made before) has
  // every one. `pieceLabel` is the name a pick and the settings give it.
  // The teams are no piece on the web since #838: each team is a row of keys under the board, always (ADR 132).
  const PIECES = ['days', 'goals', 'calendar', 'todo'];
  const onBoard = (c, k) => !Array.isArray(c?.board) || c.board.includes(k);
  const pieceLabel = (k) => ({ days: tr('90 days'), goals: tr('Goals'), teams: tr('Teams'), calendar: tr('Calendar'), todo: tr('To-do') })[k];
  // The pieces the owner can add: the ones not on it, from a server that has them.
  const missing = (c) => ((state.features || []).includes('project-board') && Array.isArray(c?.board) ? PIECES.filter((k) => !c.board.includes(k)) : []);
  const gearHTML = () => ((state.features || []).includes('project-settings') && state.company ? `<button type="button" class="icon-btn co-gear" data-project-settings aria-label="${tr('Project settings')}" title="${tr('Project settings')}">${ICON.gear}</button>` : '');
  function wirePick(root) {
    $$('[data-space-pick]', root).forEach((b) => (b.onclick = () => openSpaces(b)));
    $$('[data-sp-tool]', root).forEach((b) => (b.onclick = () => $(`#${b.dataset.spTool}`)?.click()));
    $$('[data-project-settings]', root).forEach((b) => (b.onclick = openSettings));
    $$('[data-project-more]', root).forEach((b) => (b.onclick = () => state.company && menuAt(b, projectItems(state.company))));
  }
  // ---------- the settings (company-settings.js) ----------
  let settingsOpen = false;
  // at: a row or section of the page to show, e.g. 'logins' (a card that needs a login, #804).
  function openSettings(at) {
    if (!state.company || !steps.settings) return;
    settingsOpen = true; redraw(); $('#view-company')?.scrollTo?.(0, 0);
    if (typeof at === 'string') $(`#ps-${at}`)?.scrollIntoView({ block: 'center' });
  }
  function closeSettings(draw = true) {
    if (!settingsOpen) return;
    settingsOpen = false;
    steps.settingsClosed?.();
    if (draw) redraw();
  }
  // A project deleted from its settings: the list without it, and the first one left shown.
  function removed(id) {
    closeSettings(false);
    state.projects = (state.projects || []).filter((p) => p.id !== id);
    state.company = many() ? firstShown(state.projects) : null;
    shownId = state.company?.id || null;
    keepShown();
    // Home is shown in its place (#837).
    if (place === 'company') return choose('bots');
    drawSide();
    redraw();
  }

  // Delete a project (#701; #791 from the left column and the setup too): asked first, and with a folder (#702)
  // whether the folder goes too; then gone from the list, and the first one left shown if it was.
  async function deleteProject(c) {
    const folder = await askDelete(c);
    if (!folder) return false;
    const path = many() ? `/company?project=${encodeURIComponent(c.id)}` : '/company';
    // Shown when asked: the feed's event of its delete can arrive before the answer and show another.
    const shown = !many() || state.company?.id === c.id;
    try { await api(folder === 'delete' ? `${path}${path.includes('?') ? '&' : '?'}folder=delete` : path, { method: 'DELETE' }); } catch (e) { toast(e.message, true); return false; }
    if (shown) removed(c.id);
    else { state.projects = (state.projects || []).filter((p) => p.id !== c.id); drawSide(); }
    return true;
  }
  // "Delete <name>?" (#801): Cancel or a red Delete; with a folder, a box says whether it goes too. 'keep', 'delete' or null.
  function askDelete(c) {
    return new Promise((resolve) => {
      const m = openModal(`
        <div class="modal-head"><h2>${tr('Delete {name}?', { name: esc(nameOf(c)) })}</h2></div>
        ${c.folder ? `<div class="modal-body"><label class="co-check"><input type="checkbox" data-folder-too /> ${tr('Delete its folder too')}</label></div>` : ''}
        <div class="modal-foot co-confirm">
          <button type="button" class="btn" data-dismiss>${tr('Cancel')}</button>
          <button type="button" class="btn red" data-confirm-delete>${tr('Delete')}</button>
        </div>`);
      m.classList.add('co-delete');
      let answer = null;
      $('[data-confirm-delete]', m).onclick = () => { answer = $('[data-folder-too]', m)?.checked ? 'delete' : 'keep'; m.close(); };
      m.addEventListener('close', () => { m.classList.remove('co-delete'); resolve(answer); }, { once: true });
    });
  }
  // A small menu under a button or at a point: items of { label, attr, run, danger }.
  function menuAt(at, items) {
    $('.ct-menu')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="fx-menu ct-menu" role="menu">${items.map((it, i) => `<button type="button" role="menuitem" class="fx-mi${it.danger ? ' danger' : ''}" data-mi="${i}" ${it.attr || ''}>${esc(it.label)}</button>`).join('')}</div>`);
    const m = $('.ct-menu');
    const r = at.getBoundingClientRect ? at.getBoundingClientRect() : { left: at.x, right: at.x, bottom: at.y };
    const x = at.getBoundingClientRect ? r.right - m.offsetWidth : r.left;
    m.style.left = `${Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 8))}px`;
    m.style.top = `${Math.min(r.bottom + (at.getBoundingClientRect ? 4 : 0), innerHeight - m.offsetHeight - 8)}px`;
    const close = () => { m.remove(); document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc_, true); };
    const away = (e) => { if (!m.contains(e.target) && e.target !== at && !at.contains?.(e.target)) close(); };
    const esc_ = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc_, true);
    $$('[data-mi]', m).forEach((b) => (b.onclick = () => { close(); items[Number(b.dataset.mi)].run(); }));
    m.querySelector('button').focus();
  }
  const projectItems = (p) => [
    ...((state.features || []).includes('project-settings') ? [{ label: tr('Project settings'), attr: 'data-ct-settings', run: () => { show(p.id); openSettings(); } }] : []),
    { label: tr('Delete project'), attr: 'data-ct-delete', run: () => deleteProject(p) },
  ];
  // A project row's right-click: its settings, or delete it.
  function rowMenu(ev, id) {
    const p = projects().find((x) => x.id === id);
    if (!p) return;
    ev.preventDefault();
    menuAt({ x: ev.clientX, y: ev.clientY }, projectItems(p));
  }
  // The ⋯ in the setup's header (#801): the same, for the project being set up.
  const moreHTML = () => (state.company ? `<button type="button" class="icon-btn co-more" data-project-more aria-label="${tr('More')}" title="${tr('More')}" aria-haspopup="menu">${ICON.more}</button>` : '');

  // ---------- the main area ----------
  function render() {
    const root = $('#view-company');
    if (!root) return;
    if (place !== 'company') { place = 'company'; keep(); drawPlace(); } // opened from its address
    drawSide();
    if (!loaded) { load().then(() => { if (loaded) render(); }); return; }
    const c = company();
    if (c && many()) { shownId = c.id; keepShown(); }
    // Drawn again only when something it shows changed: a refresh would take a half-typed answer and the focus.
    // A part that shows more than the company (the bots' states on the home) adds it with steps.sig.
    if (!c) settingsOpen = false;
    const sig = JSON.stringify([c, current, adding, settingsOpen, many() ? projects().map((p) => [p.id, nameOf(p), !!p.archived]) : null, settingsOpen ? state.bots.map((b) => [b.id, b.name, colorOf(b), b.state]) : steps.sig ? steps.sig(c) : null]);
    if (root.dataset.sig === sig && root.firstElementChild) return;
    root.dataset.sig = sig;
    root.classList.remove('sp-has-field');
    if (settingsOpen) { steps.settings(root, c); return; }
    if (!c) drawStart(root);
    else if (c.phase === 'running' && steps.home && current !== 'start') steps.home(root, c);
    else {
      const at = stepOf(c);
      // The ⋯ at the bar's end: its settings and its delete, while setting up too (#791, #801).
      root.innerHTML = `<div class="co-steps-line">${stepBar(at, c)}${moreHTML()}</div><div class="co-body" id="co-body"></div>`;
      const body = $('#co-body', root);
      if (steps[at]) steps[at](body, c); else drawGiven(body, c);
      // While setting up, About and Team on the bar open their step; Start is Create's.
      if (c.phase !== 'running') $$('.co-steps [data-step]:not([data-step="start"])', root).forEach((li) => (li.onclick = () => go(li.dataset.step)));
    }
    // No left column: the project's name over the setup picks another space (the floor has it in its header), also
    // over the first project's start, which has none to pick but Home (#853).
    if (many() && !(c?.phase === 'running' && steps.home && current !== 'start')) root.insertAdjacentHTML('afterbegin', `<div class="co-pick-line">${pickHTML(c ? nameOf(c) : tr('New project'))}${c ? moreHTML() : ''}${railOn() ? toolsHTML() : ''}</div>`);
    wirePick(root);
    root.classList.toggle('sp-has-field', !!$('.sp-field', root)); // the field stands at the page's foot (#839)
  }
  // Where the setup stands: the step its part last said (Company.go), else About.
  let current = null;
  const stepOf = (c) => (c.phase === 'running' ? 'start' : current && STEPS.some(([k]) => k === current) ? current : 'about');
  function go(step) { current = step; render(); }
  // Draw again now, also when nothing it shows changed (a part's own state did).
  function redraw() { const root = $('#view-company'); if (root) delete root.dataset.sig; render(); }
  // The step bar; under the step shown, its own ticks when its part counts them (steps.ticks: [how many, at]).
  const stepBar = (at, c) => {
    const i = STEPS.findIndex(([k]) => k === at);
    const ticks = c && steps.ticks?.[at]?.(c);
    const tickHTML = ticks ? `<span class="co-ticks">${Array.from({ length: ticks[0] }, (_, n) => `<i class="${n < ticks[1] ? 'done' : n === ticks[1] ? 'on' : ''}"></i>`).join('')}</span>` : '';
    return `<ol class="co-steps">${STEPS.map(([k, label], n) => `<li class="${n < i ? 'done' : n === i ? 'on' : ''}" data-step="${k}">${label()}${n === i ? tickHTML : ''}</li>`).join('')}</ol>`;
  };
  // What the owner gave, as the About step shows it until the Chief's part draws it.
  function drawGiven(body, c) {
    body.innerHTML = `<div class="co-start"><h1>${esc(c.name || c.start)}</h1>${c.name ? `<p class="co-given">${esc(c.start)}</p>` : ''}${sourcesHTML(c.sources, false)}</div>`;
  }

  // A new project (#801): one field with a clip for its sources (files, links) inside, the sources as chips under it,
  // and "Start from scratch" right under them (#849).
  function drawStart(root) {
    const typed = $('#co-what', root)?.value || '';
    root.innerHTML = `<div class="co-start co-new">
      <h1>${tr("You know where. We'll work out how.")}</h1>
      <form class="co-ask" id="co-ask"><button type="button" class="icon-btn co-clip" data-attach aria-label="${tr('Attach')}" title="${tr('Attach')}" aria-haspopup="menu">${ICON.clip}</button><input id="co-what" name="what" autocomplete="off" maxlength="500" placeholder="${tr('Goal, site or idea')}" aria-label="${tr('Goal, site or idea')}" /><button type="submit" class="co-go co-go-icon" aria-label="${tr('Go')}" disabled>${ICON.go}</button><input type="file" multiple hidden id="co-files" /></form>
      <div id="co-sources">${sourcesHTML(draft.sources, true)}</div>
      ${(state.features || []).includes('project-empty') ? `<button type="button" class="co-text-btn co-empty" data-start-empty>${tr('Start from scratch')}</button>` : ''}
    </div>`;
    const form = $('#co-ask', root);
    const input = form.what;
    input.value = typed;
    const ready = () => { form.querySelector('.co-go').disabled = !input.value.trim(); };
    input.oninput = ready;
    ready();
    form.onsubmit = (e) => { e.preventDefault(); begin(input.value, form.querySelector('.co-go')); };
    const files = $('#co-files', root);
    const clip = $('[data-attach]', root);
    clip.onclick = () => menuAt(clip, [
      { label: tr('Files'), attr: 'data-add-files', run: () => files.click() },
      { label: tr('Link'), attr: 'data-add-link', run: () => addLink() },
    ]);
    files.onchange = () => { addFiles([...files.files]); files.value = ''; };
    const empty = $('[data-start-empty]', root);
    if (empty) empty.onclick = () => made({ empty: true, name: tr('New project') }, empty);
    wireSources(root);
    if (state.view === 'company' && !typed) input.focus();
  }

  // The sources as chips: a file or a link, removable on the new-project screen.
  const sourcesHTML = (list, removable) => (list.length ? `<ul class="co-sources">${list.map((s) => `<li class="co-src${s.status === 'failed' ? ' failed' : s.status === 'uploading' ? ' busy' : ''}">${s.kind === 'link' ? ICON.link : ICON.file}<span class="co-src-name">${esc(s.name)}</span>${removable ? `<button type="button" class="co-src-x" data-unsource="${esc(s.id)}" aria-label="${tr('Remove')}">${ICON.x}</button>` : ''}</li>`).join('')}</ul>` : '');
  function drawSources() {
    const box = $('#co-sources');
    if (!box) return;
    box.innerHTML = sourcesHTML(draft.sources, true);
    wireSources(box);
  }
  function wireSources(root) {
    $$('[data-unsource]', root).forEach((b) => (b.onclick = () => { draft.sources = draft.sources.filter((s) => s.id !== b.dataset.unsource); drawSources(); }));
  }
  const newId = () => Math.random().toString(36).slice(2, 10);
  function addFiles(files) {
    for (const file of files) {
      if (draft.sources.length >= 20) { toast(tr('Add at most 20 sources.'), true); break; }
      if (file.size > 25 * 1024 * 1024) { toast(tr('{name} is over 25 MB.', { name: file.name }), true); continue; }
      const s = { id: newId(), kind: 'file', name: file.name, size: file.size, status: 'uploading' };
      draft.sources.push(s);
      fetch('/api/uploads?to=chief', {
        method: 'POST',
        headers: { 'X-Bot-Dot': '1', 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' },
        body: file,
      }).then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || tr('Upload failed ({status})', { status: r.status }));
        Object.assign(s, { upload: d, status: 'ready' });
      }).catch((e) => { s.status = 'failed'; toast(`${file.name}: ${e.message}`, true); }).finally(drawSources);
    }
    drawSources();
  }
  function addLink() {
    const box = $('#co-sources');
    if (!box || $('#co-link', box)) return $('#co-link input')?.focus();
    box.insertAdjacentHTML('beforeend', `<form class="co-ask small" id="co-link"><input name="url" autocomplete="off" maxlength="1000" placeholder="https://" aria-label="${tr('Add a link')}" /><button type="submit" class="co-go">${tr('Add')}</button></form>`);
    const form = $('#co-link', box);
    form.url.focus();
    form.onsubmit = (e) => {
      e.preventDefault();
      const url = form.url.value.trim();
      if (!url) return;
      draft.sources.push({ id: newId(), kind: 'link', name: url.replace(/^https?:\/\//i, ''), url, status: 'ready' });
      drawSources();
    };
    form.url.onkeydown = (e) => { if (e.key === 'Escape') drawSources(); };
  }

  async function begin(text, button) {
    const start = String(text || '').trim();
    if (!start) return;
    if (draft.sources.some((s) => s.status === 'uploading')) return toast(tr('Wait for the files to finish uploading.'), true);
    const sources = draft.sources.filter((s) => s.status === 'ready').map((s) => (s.kind === 'link' ? { kind: 'link', url: s.url, name: s.name } : { kind: 'file', name: s.name, upload: s.upload }));
    made({ start, sources }, button, () => { draft.sources = []; current = 'about'; });
  }
  // A new project made and shown: from what the owner works on (its setup follows), or empty (#788: its blank board).
  async function made(body, button, then = () => { current = null; }) {
    if (button.disabled) return;
    button.disabled = true;
    try {
      state.company = await api('/company', { method: 'POST', body });
      if (many()) { state.projects = [...(state.projects || []).filter((p) => p.id !== state.company.id), state.company]; adding = false; shownId = state.company.id; keepShown(); drawSide(); }
      then();
      render();
    } catch (e) { toast(e.message, true); button.disabled = false; }
  }

  // The company as it is now (or null): an answer of the server, or the feed's `company` event (`feed`), which a
  // server with several projects sends for older apps only: the `project` event says the same of each.
  function changed(d, feed = false) {
    if (!d || !('company' in d)) return;
    if (many()) {
      if (feed) return;
      if (d.company) return projectChanged({ id: d.company.id, project: d.company });
    }
    state.company = d.company;
    loaded = true;
    drawSide();
    if (state.view === 'company' || (typeof Dock !== 'undefined' && Dock.docked())) render();
  }
  // The feed's `project` event: one project as it is now, or null once deleted.
  function projectChanged(d) {
    if (!many() || !d?.id) return;
    const list = (state.projects || []).filter((p) => p.id !== d.id || d.project);
    if (d.project) { const i = list.findIndex((p) => p.id === d.id); if (i >= 0) list[i] = d.project; else list.push(d.project); }
    state.projects = list;
    if (state.company?.id === d.id) state.company = d.project || firstShown(list);
    else if (!state.company && !adding) state.company = firstShown(list);
    if (!state.company) closeSettings(false);
    loaded = true;
    drawSide();
    if (state.view === 'company') render();
  }

  // A running project's page is up, beside its chat or alone, outside a phone (#838): its keys answer 1-9.
  const onProjectPage = () => shows() && place === 'company' && !adding && !settingsOpen && state.company?.phase === 'running' && !matchMedia(PHONE).matches && (state.view === 'company' || (typeof Dock !== 'undefined' && Dock.docked()));

  function init() {
    wireRail();
    drawPlace();
    // Opened without an address: the page shows the Chief meanwhile (boot.js), and the space remembered once loaded.
    const bare = !location.hash.slice(1);
    if (shows()) load().then(() => {
      // A remembered project that is gone: Home (#837).
      if (loaded && place === 'company' && (!projects().length || (storedId && !projects().some((p) => p.id === storedId)))) {
        place = 'bots';
        shownId = state.company?.id || null;
        keep();
        if (state.view === 'company') setView('chief'); // opened on the space before it was known to be gone
      }
      drawPlace();
      drawSide();
      if (place === 'company' && state.view !== 'company' && bare) setView('company');
    });
  }

  return { init, render, redraw, drawSide, drawRail, enter, railOn, projects, onProjectPage, changed, projectChanged, put, load, choose, go, steps, ICON, place: () => place, stepBar, sourcesHTML, at, pickHTML, toolsHTML, wirePick, show, startNew, gearHTML, openSettings, closeSettings, removed, deleteProject, PIECES, onBoard, pieceLabel, missing };
})();
