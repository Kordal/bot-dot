// The Company (#669, ADR 110; docs/api.md, "The Company"): a place of its own beside the bots, behind the switch
// "Bots | Company" at the top of the left column, from a server with `company`. The owner says what they are working
// on (a site, or an idea in one sentence) with its sources (files, links); the setup and the company's home follow
// (the About, Team and Start steps, the office floor), each drawn by its own part: Company.steps (the Team and Start
// steps: company-team.js).
const Company = (() => {
  const ICON = {
    building: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4h10v17 M15 9h4v12 M3 21h18 M8 8h1 M11 8h1 M8 12h1 M11 12h1 M9 21v-4h2v4"/></svg>',
    link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z M14 3v5h5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    go: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };
  const KEY = 'botdot.place';
  const shows = () => (state.features || []).includes('company');
  // Bots or Company, as this device last had it.
  let place = (() => { try { return localStorage.getItem(KEY) === 'company' ? 'company' : 'bots'; } catch { return 'bots'; } })();
  const keep = () => { try { localStorage.setItem(KEY, place); } catch { /* private mode */ } };
  let loaded = false;
  // What the start screen holds before Go: the sources picked so far.
  const draft = { sources: [] };
  // The steps of the setup, then the home. Each later part puts its own drawing here: (root, company) => void.
  const steps = {};
  const STEPS = [['about', () => tr('About')], ['team', () => tr('Team')], ['start', () => tr('Start')]];

  const company = () => state.company || null;
  async function load() {
    if (!shows()) return null;
    try { state.company = (await api('/company')).company; loaded = true; } catch (e) { console.warn(e.message); }
    return state.company;
  }

  // ---------- the switch and the left column ----------
  const switchHTML = (on) => `<button type="button" role="tab" data-place="bots" aria-selected="${!on}">${tr('Bots')}</button><button type="button" role="tab" data-place="company" aria-selected="${on}">${ICON.building}${tr('Projects')}</button>`;
  const wireSwitch = (root) => $$('[data-place]', root).forEach((b) => (b.onclick = () => choose(b.dataset.place)));
  function drawSwitch() {
    const sw = $('#place-switch');
    if (!sw) return;
    sw.classList.toggle('hidden', !shows());
    const on = shows() && place === 'company';
    $('#app').classList.toggle('place-company', on);
    sw.innerHTML = switchHTML(on);
    wireSwitch(sw);
  }
  // A phone shows the company without the left column: the switch is on top of it.
  function phoneSwitch(root) {
    root.insertAdjacentHTML('afterbegin', `<div class="place-switch co-phone-switch" role="tablist" aria-label="${tr('Place')}">${switchHTML(true)}</div>`);
    wireSwitch(root.firstElementChild);
  }
  function choose(p) {
    place = p === 'company' ? 'company' : 'bots';
    keep();
    drawSwitch();
    if (place === 'company') { drawSide(); setView('company'); } else if (state.view === 'company') { setView('chief'); showList(); renderContacts(); }
  }

  function drawSide() {
    const side = $('#company-side');
    if (!side || !shows()) return;
    const c = company();
    const here = state.view === 'company' || (typeof Dock !== 'undefined' && Dock.docked());
    side.innerHTML = `<div class="co-label">${tr('Projects')}</div>
      <button type="button" class="co-row${here ? ' here' : ''}" data-open-company>${ICON.building}<span>${esc(c?.phase === 'running' && c.name ? c.name : tr('Setting up'))}</span></button>
      <button type="button" class="co-row co-chief${state.view === 'chief' ? ' here' : ''}" data-open-chief>${chiefFigure('sm')}<span>${esc(chiefTitle())}</span></button>`;
    $('[data-open-company]', side).onclick = () => setView('company');
    $('[data-open-chief]', side).onclick = () => setView('chief');
  }

  // ---------- the main area ----------
  function render() {
    const root = $('#view-company');
    if (!root) return;
    if (place !== 'company') { place = 'company'; keep(); drawSwitch(); } // opened from its address
    drawSide();
    if (!loaded) { load().then(() => { if (loaded) render(); }); return; }
    const c = company();
    // Drawn again only when something it shows changed: a refresh would take a half-typed answer and the focus.
    // A part that shows more than the company (the bots' states on the home) adds it with steps.sig.
    const sig = JSON.stringify([c, current, steps.sig ? steps.sig(c) : null]);
    if (root.dataset.sig === sig && root.firstElementChild) return;
    root.dataset.sig = sig;
    if (!c) drawStart(root);
    else if (c.phase === 'running' && steps.home && current !== 'start') steps.home(root, c);
    else {
      const at = stepOf(c);
      root.innerHTML = `${stepBar(at)}<div class="co-body" id="co-body"></div>`;
      const body = $('#co-body', root);
      if (steps[at]) steps[at](body, c); else drawGiven(body, c);
      // While setting up, About and Team on the bar open their step; Start is Create's.
      if (c.phase !== 'running') $$('.co-steps [data-step]:not([data-step="start"])', root).forEach((li) => (li.onclick = () => go(li.dataset.step)));
    }
    phoneSwitch(root);
  }
  // Where the setup stands: the step its part last said (Company.go), else About.
  let current = null;
  const stepOf = (c) => (c.phase === 'running' ? 'start' : current && STEPS.some(([k]) => k === current) ? current : 'about');
  function go(step) { current = step; render(); }
  // Draw again now, also when nothing it shows changed (a part's own state did).
  function redraw() { const root = $('#view-company'); if (root) delete root.dataset.sig; render(); }
  const stepBar = (at) => {
    const i = STEPS.findIndex(([k]) => k === at);
    return `<ol class="co-steps">${STEPS.map(([k, label], n) => `<li class="${n < i ? 'done' : n === i ? 'on' : ''}" data-step="${k}">${label()}</li>`).join('')}</ol>`;
  };
  // What the owner gave, as the About step shows it until the Chief's part draws it.
  function drawGiven(body, c) {
    body.innerHTML = `<div class="co-start"><h1>${esc(c.name || c.start)}</h1>${c.name ? `<p class="co-given">${esc(c.start)}</p>` : ''}${sourcesHTML(c.sources, false)}</div>`;
  }

  // "What are you working on?": one field, two examples, and the sources.
  const EXAMPLES = [['link', 'fernhill.app'], ['plus', 'A meal-planning app for busy parents']];
  function drawStart(root) {
    const typed = $('#co-what', root)?.value || '';
    root.innerHTML = `<div class="co-start">
      <h1>${tr('What are you working on?')}</h1>
      <form class="co-ask" id="co-ask"><input id="co-what" name="what" autocomplete="off" maxlength="500" placeholder="${tr('Your site, or your idea in one sentence')}" aria-label="${tr('What are you working on?')}" /><button type="submit" class="co-go" disabled>${tr('Go')} ${ICON.go}</button></form>
      <div class="co-chips">${EXAMPLES.map(([icon, text]) => `<button type="button" class="co-chip dashed" data-example="${esc(text)}">${ICON[icon]}${esc(text)}</button>`).join('')}</div>
      <div class="co-add"><button type="button" class="btn" data-add-files>${ICON.file}${tr('Add files')}</button><button type="button" class="btn" data-add-link>${ICON.link}${tr('Add a link')}</button><input type="file" multiple hidden id="co-files" /></div>
      <div id="co-sources">${sourcesHTML(draft.sources, true)}</div>
    </div>`;
    const form = $('#co-ask', root);
    const input = form.what;
    input.value = typed;
    const ready = () => { form.querySelector('.co-go').disabled = !input.value.trim(); };
    input.oninput = ready;
    ready();
    $$('[data-example]', root).forEach((b) => (b.onclick = () => { input.value = b.dataset.example; ready(); input.focus(); }));
    form.onsubmit = (e) => { e.preventDefault(); begin(input.value, form.querySelector('.co-go')); };
    const files = $('#co-files', root);
    $('[data-add-files]', root).onclick = () => files.click();
    files.onchange = () => { addFiles([...files.files]); files.value = ''; };
    $('[data-add-link]', root).onclick = () => addLink();
    wireSources(root);
    if (state.view === 'company' && !typed) input.focus();
  }

  const sizeOf = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);
  const sourcesHTML = (list, removable) => (list.length ? `<ul class="co-sources">${list.map((s) => `<li class="${s.status === 'failed' ? 'failed' : ''}">${s.kind === 'link' ? ICON.link : ICON.file}<span class="co-src-name">${esc(s.name)}</span><span class="co-src-size">${s.status === 'uploading' ? '…' : s.kind === 'link' ? tr('page') : s.size ? sizeOf(s.size) : ''}</span>${removable ? `<button type="button" class="icon-btn" data-unsource="${esc(s.id)}" aria-label="${tr('Remove')}">${ICON.x}</button>` : ''}</li>`).join('')}</ul>` : '');
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
    box.insertAdjacentHTML('afterbegin', `<form class="co-ask small" id="co-link"><input name="url" autocomplete="off" maxlength="1000" placeholder="https://" aria-label="${tr('Add a link')}" /><button type="submit" class="co-go">${tr('Add')}</button></form>`);
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
    if (button.disabled) return;
    button.disabled = true;
    try {
      state.company = await api('/company', { method: 'POST', body: { start, sources } });
      draft.sources = [];
      current = 'about';
      render();
    } catch (e) { toast(e.message, true); button.disabled = false; }
  }

  // The feed's `company` event: the company as it is now (or null), from any app or the Chief's tools.
  function changed(d) {
    if (!d || !('company' in d)) return;
    state.company = d.company;
    loaded = true;
    drawSide();
    if (state.view === 'company' || (typeof Dock !== 'undefined' && Dock.docked())) render();
  }

  function init() {
    drawSwitch();
    if (shows()) load().then(() => { drawSide(); if (place === 'company' && state.view !== 'company' && !location.hash.slice(1)) setView('company'); });
  }

  return { init, render, redraw, drawSide, changed, load, choose, go, steps, ICON, place: () => place, stepBar, sourcesHTML };
})();
