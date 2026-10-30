// The About step of a company's setup (#670, docs/api.md "The Company"): Company.steps.about. botdot first asks the
// Chief to read the company (POST /api/company/read): a site gets its About rows and the questions the Chief could
// not answer; an idea its name and the screens the server sends (#805): the questions the Chief picked for it, one
// per screen, "I want my <who> to…" stories where they apply, the delivery date, then the review: the SWOT where it
// applies and one list of rows, each changed in place (#801). Every answer is saved with PATCH /api/company as it is given, so a reload goes on
// where it was. Everything the Chief wrote is text, drawn with esc() (AGENTS.md rule 6).
(() => {
  if (typeof Company === 'undefined') return;
  const ICON = {
    ...Company.ICON,
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4"/></svg>',
    inf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12c-2-2.7-3.7-4-5.5-4a4 4 0 0 0 0 8c1.8 0 3.5-1.3 5.5-4zm0 0c2 2.7 3.7 4 5.5 4a4 4 0 0 0 0-8c-1.8 0-3.5 1.3-5.5 4z"/></svg>',
  };
  // A new idea's screens from a server before #805: the five questions it asked every idea (lib/company-chief.js
  // IDEA), each with the line its answer shows on, then the stories, the delivery date and the review with the SWOT.
  const IDEA = [['who', 'Who is it for?', 'Who'], ['today', 'What do they do today?', 'Today'], ['why', 'Why you?', 'Why you'],
    ['signal', 'What would show it works in 90 days?', '90 days'], ['test', 'What can you test this week?', 'First step']];
  const screensOf = (c) => c.screens || (c.kind === 'site' ? [{ screen: 'review', swot: false }]
    : [...IDEA.map(([key, question, label]) => ({ screen: 'question', key, question, label })), { screen: 'stories' }, { screen: 'delivery' }, { screen: 'review', swot: true }]);
  // The catalogue's questions and the lines their answers show on, in this page's language (lib/company-chief.js
  // CATALOGUE); a question this page does not know shows as the server wrote it.
  const SAID = {
    who: () => [tr('Who is it for?'), tr('Who')], today: () => [tr('What do they do today?'), tr('Today')], why: () => [tr('Why you?'), tr('Why you')],
    signal: () => [tr('What would show it works in 90 days?'), tr('90 days')], test: () => [tr('What can you test this week?'), tr('First step')],
    runs: () => [tr('What do you run?'), tr('Runs')], care: () => [tr('What breaks or needs care?'), tr('Needs care')], reach: () => [tr('How do the bots reach it?'), tr('Access')],
    watch: () => [tr('What should be watched?'), tr('Watch')], done: () => [tr('What does done look like?'), tr('Finish line')], now: () => [tr('Where are you now?'), tr('Now')],
    blocks: () => [tr('What is in the way?'), tr('In the way')], help: () => [tr('Where do you want help?'), tr('Help')], first: () => [tr('What first?'), tr('First step')],
  };
  const said = (x) => (SAID[x.key] ? SAID[x.key]() : [x.question, x.label]);
  // The questions botdot itself asks; a question the Chief wrote is drawn as it wrote it.
  const ASKED = {
    who: () => tr('Who is it for?'), today: () => tr('What do they do today?'), why: () => tr('Why you?'),
    signal: () => tr('What would show it works in 90 days?'), test: () => tr('What can you test this week?'),
    about: () => tr('What is your project about?'), serves: () => tr('Who do you serve?'),
  };
  const questionOf = (c, a) => (ASKED[a.key] && !(c.kind === 'site' && a.key === 'today') ? ASKED[a.key]() : a.key === 'today' ? tr('How do you work today?') : a.question);
  const WHO = ['users', 'customers', 'clients', 'members', 'students', 'team', 'partners'];
  const whoWord = (w) => ({ users: tr('users'), customers: tr('customers'), clients: tr('clients'), members: tr('members'), students: tr('students'), team: tr('team'), partners: tr('partners') }[w] || w);

  // What this window holds besides the company: where it is, what it waits for, and what was typed.
  const ui = { screen: null, reading: false, readFailed: false, saving: 0, asking: new Set(), swotting: false, who: null, chooseWho: false, ideas: {}, missing: '', own: {}, writing: null, editing: null, typed: {}, focus: null };
  const SEP = '; ';

  const save = async (fields) => {
    Object.assign(state.company, fields);
    ui.saving++;
    Company.redraw();
    try { Company.put(await api(Company.at('/company'), { method: 'PATCH', body: fields })); } catch (e) { toast(e.message, true); await Company.load(); }
    ui.saving--;
    Company.redraw();
  };
  // What a question's chips are made from (#787): the basis its screen carries (#805), or, from a server before it,
  // as lib/company-chief.js `basis` hashes it: the answers before it (the review's: all five). Chips of another basis
  // are asked for again once the answers are saved.
  function basisOf(c, key) {
    const own = screensOf(c).find((x) => (x.screen === 'question' ? x.key === key : x.screen === 'review' && !questionKeys(c).includes(key)));
    if (own?.basis) return own.basis;
    const i = IDEA.findIndex(([k]) => k === key);
    const text = IDEA.slice(0, i < 0 ? IDEA.length : i).map(([k]) => card(c, k)?.answer || '').join('\n');
    let h = 5381;
    for (let n = 0; n < text.length; n++) h = ((h * 33) ^ text.charCodeAt(n)) >>> 0;
    return h.toString(16);
  }
  // Asks once per basis; true while fresh chips are on their way (the old ones are not shown meanwhile).
  function refresh(key, stale, basis) {
    const at = `${key}:${basis}`;
    if (stale && !ui.saving && !ui.asking.has(`suggest:${key}`) && !ui.tried?.[at]) { ui.tried = { ...ui.tried, [at]: true }; suggest(key); }
    return ui.asking.has(`suggest:${key}`) || (stale && ui.saving > 0 && !ui.tried?.[at]);
  }
  // The Chief's call: its answer arrives as the company (or, for stories, as suggestions); a failure leaves no chips.
  async function ask(path, body, key) {
    if (ui.asking.has(key)) return null;
    ui.asking.add(key);
    try { return await api(Company.at(path), { method: 'POST', body }); } catch (e) { console.warn(e.message); return null; } finally { ui.asking.delete(key); }
  }
  async function suggest(key) {
    const c = await ask('/company/suggest', { key }, `suggest:${key}`);
    if (c && c.id) Company.put(c);
    Company.redraw(); // a failure shows the chips drafted at the start
  }
  async function read() {
    ui.reading = true;
    try { Company.put(await api(Company.at('/company/read'), { method: 'POST' })); ui.readFailed = false; } catch (e) { toast(e.message, true); ui.readFailed = true; }
    ui.reading = false;
    Company.redraw();
  }
  async function swot() {
    ui.swotting = true;
    Company.redraw();
    const c = await ask('/company/swot', {}, 'swot');
    ui.swotting = false;
    if (c && c.id) Company.put(c);
    Company.redraw();
  }
  async function storyIdeas(who) {
    const r = await ask('/company/stories/suggest', { who }, `stories:${who}`);
    if (!r) return;
    ui.ideas[who] = r.stories || [];
    if (r.group) ui.missing = r.group;
    Company.redraw();
  }

  // An input keeps what was typed and its focus through a redraw (a chip that arrives, a save's echo).
  function keep(input, id) {
    if (!input) return;
    if (ui.typed[id] !== undefined) input.value = ui.typed[id];
    input.oninput = () => { ui.typed[id] = input.value; input.dispatchEvent(new Event('typed')); };
    input.onfocus = () => { ui.focus = id; };
    input.onblur = () => { if (ui.focus === id) ui.focus = null; };
    if (ui.focus === id) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }
  const clear = (id) => { delete ui.typed[id]; if (ui.focus === id) ui.focus = null; };

  // ---------- the screens ----------
  const card = (c, key) => c.about.find((a) => a.key === key);
  const questionKeys = (c) => screensOf(c).filter((x) => x.screen === 'question').map((x) => x.key);
  const indexOf = (c, name) => screensOf(c).findIndex((x) => x.screen === name);
  // Where a new idea stands, as an index of its screens: the first question not answered nor skipped; then the
  // review once the SWOT is written (or the delivery is set, in a setup without one); else the screen after the
  // questions.
  function startScreen(c) {
    const list = screensOf(c);
    const i = list.findIndex((x) => x.screen === 'question' && card(c, x.key)?.open);
    if (i >= 0) return i;
    const review = list.at(-1);
    if (review.swot ? c.swot : c.deliverBy) return list.length - 1;
    return Math.min(questionKeys(c).length, list.length - 1);
  }
  // The About step's ticks under the step bar: one per screen of a new idea, the one shown lit.
  Company.steps.ticks = { ...Company.steps.ticks, about: (c) => (c.kind === 'idea' && c.about.length ? [screensOf(c).length, ui.id === c.id && ui.screen !== null ? ui.screen : startScreen(c)] : null) };

  function draw(body, c) {
    if (ui.id !== c.id) { // another company: nothing of the last one's screens
      Object.assign(ui, { id: c.id, screen: null, readFailed: false, swotting: false, who: null, chooseWho: false, ideas: {}, missing: '', own: {}, writing: null, editing: null, typed: {}, focus: null, tried: {}, cal: false, month: null });
      for (const k of Object.keys(local)) delete local[k];
    }
    if (!c.about.length) return drawReading(body, c);
    const list = screensOf(c);
    if (ui.screen === null || ui.screen < 0 || ui.screen >= list.length) ui.screen = startScreen(c);
    if (c.kind === 'site') ui.screen = list.length - 1;
    const at = list[ui.screen];
    if (at.screen === 'question') drawQuestion(body, c, ui.screen);
    else if (at.screen === 'stories') drawStories(body, c);
    else if (at.screen === 'delivery') drawDelivery(body, c);
    else drawReview(body, c);
  }

  // The Chief reads the site, or names the idea: what the owner gave, until it has.
  function drawReading(body, c) {
    if (!ui.reading && !ui.readFailed) read();
    body.innerHTML = `<div class="co-start"><h1>${esc(c.name || c.start)}</h1>${c.name ? `<p class="co-given">${esc(c.start)}</p>` : ''}${Company.sourcesHTML(c.sources, false)}
      ${ui.readFailed ? `<div><button type="button" class="co-go" data-again>${tr('Try again')}</button></div>` : `<div class="co-reading" aria-busy="true"><span></span><span></span><span></span></div>`}</div>`;
    const again = $('[data-again]', body);
    if (again) again.onclick = () => { ui.readFailed = false; read(); Company.redraw(); };
  }

  const foot = (left, right) => `<div class="co-foot">${left}<span class="co-foot-gap"></span>${right}</div>`;
  const backBtn = (disabled = false) => `<button type="button" class="co-text-btn" data-co-back${disabled ? ' disabled' : ''}>${ICON.back}${tr('Back')}</button>`;
  const nextBtns = (ready, label = tr('Next'), attr = 'data-done') => `<button type="button" class="co-text-btn" data-skip>${tr('Skip')}</button><button type="button" class="co-go" ${attr}${ready ? '' : ' disabled'}>${label} ${ICON.go}</button>`;
  // While the chips are asked again (#787): grey chips where they will be.
  const skeletonHTML = '<span class="co-chip sk" aria-hidden="true" style="--w:200px"></span><span class="co-chip sk" aria-hidden="true" style="--w:150px"></span><span class="co-chip sk" aria-hidden="true" style="--w:180px"></span>';

  // A chip question: the Chief's chips and the owner's own, picked by a tap; "Write your own" turns into a field
  // where Enter adds a chip. multi: several may be picked. The answer is the picked chips, joined.
  function chipsHTML(id, chips, picked, { plus = false, label = (t) => t, waiting = false } = {}) {
    const all = [...new Set([...(waiting ? [] : chips), ...picked, ...(ui.own[id] || [])])];
    const writing = ui.writing === id;
    return `<div class="co-chips" data-chips="${esc(id)}"${waiting ? ' aria-busy="true"' : ''}>${all.map((t) => `<button type="button" class="co-chip${picked.includes(t) ? ' on' : ''}" data-chip="${esc(t)}">${picked.includes(t) ? ICON.check : plus ? ICON.plus : ''}${esc(label(t))}</button>`).join('')}${waiting ? skeletonHTML : ''}${writing
      ? `<form class="co-ask small co-own" data-own="${esc(id)}"><input name="own" autocomplete="off" maxlength="120" aria-label="${tr('Write your own')}" /><button type="submit" class="co-go">${tr('Add')}</button></form>`
      : `<button type="button" class="co-chip ghost" data-write="${esc(id)}">${ICON.pen}${tr('Write your own')}</button>`}</div>`;
  }
  // Wires one chip question: pick(list) is called with the chips picked after each tap or Enter.
  function wireChips(root, id, picked, pick, { multi = false } = {}) {
    const box = $(`[data-chips="${CSS.escape(id)}"]`, root);
    if (!box) return;
    $$('[data-chip]', box).forEach((b) => (b.onclick = () => {
      const t = b.dataset.chip;
      pick(picked.includes(t) ? picked.filter((x) => x !== t) : multi ? [...picked, t] : [t]);
    }));
    const write = $('[data-write]', box);
    if (write) write.onclick = () => { ui.writing = id; ui.focus = `own:${id}`; Company.redraw(); };
    const form = $('[data-own]', box);
    if (form) {
      keep(form.own, `own:${id}`);
      form.own.onkeydown = (e) => { if (e.key === 'Escape') { ui.writing = null; clear(`own:${id}`); Company.redraw(); } };
      form.onsubmit = (e) => {
        e.preventDefault();
        const t = form.own.value.replace(/\s+/g, ' ').trim();
        if (!t) return;
        ui.own[id] = [...new Set([...(ui.own[id] || []), t])];
        ui.writing = null;
        clear(`own:${id}`);
        pick(multi ? [...new Set([...picked, t])] : [t]);
      };
    }
  }
  const split = (answer) => (answer ? answer.split(SEP).map((x) => x.trim()).filter(Boolean) : []);

  // One of a new idea's questions; the answer before it as a small chip over it, since its chips build on it.
  const local = {}; // what is picked on a question screen before Next, by key
  function drawQuestion(body, c, i) {
    const list = screensOf(c);
    const { key, question } = list[i];
    const a = card(c, key) || { key, chips: [], answer: '' };
    const basis = basisOf(c, key);
    const waiting = refresh(key, a.basis !== basis, basis);
    const picked = local[key] || split(a.answer);
    const before = i > 0 && list[i - 1].screen === 'question' ? card(c, list[i - 1].key)?.answer : '';
    body.innerHTML = `<div class="co-q">${before ? `<div class="co-chips"><span class="co-chip co-prev">${ICON.check}<span>${esc(before)}</span></span></div>` : ''}<h1>${esc(said(list[i])[0])}</h1>
      ${chipsHTML(key, a.chips || [], picked, { waiting })}
    </div>${foot(backBtn(i === 0), nextBtns(picked.length))}`;
    wireChips(body, key, picked, (list) => { local[key] = list; Company.redraw(); }, { multi: true });
    const answer = (text) => {
      delete local[key];
      const next = c.about.some((x) => x.key === key) ? c.about.map((x) => (x.key === key ? { ...x, answer: text, open: false } : x)) : [...c.about, { key, question: a.question || question, answer: text }];
      ui.screen = i + 1;
      save({ about: next });
    };
    $('[data-done]', body).onclick = () => { const list = local[key] || picked; if (list.length) answer(list.join(SEP)); };
    $('[data-skip]', body).onclick = () => answer('');
    $('[data-co-back]', body).onclick = () => { if (i > 0) { ui.screen = i - 1; Company.redraw(); } };
  }

  // "I want my <who> to…": the stories, by group.
  function drawStories(body, c) {
    const who = ui.who || c.stories[0]?.who || 'users';
    ui.who = who;
    if (!(who in ui.ideas) && !ui.asking.has(`stories:${who}`)) { ui.ideas[who] = []; storyIdeas(who); }
    const have = new Set(c.stories.flatMap((g) => g.items.map((s) => `${g.who}\n${s.text.toLowerCase()}`)));
    const ideas = (ui.ideas[who] || []).filter((t) => !have.has(`${who}\n${t.toLowerCase()}`));
    const used = new Set(c.stories.map((g) => g.who));
    const words = [...new Set([...(ui.missing && ui.missing !== who ? [ui.missing] : []), ...WHO])].filter((w) => w !== who && !(used.has(w) && w !== ui.missing));
    body.innerHTML = `<div class="co-q">
      <h1>${tr('I want my')} <button type="button" class="co-who" data-who aria-expanded="${ui.chooseWho}">${esc(whoWord(who))}${ICON.down}</button> ${tr('to…')}</h1>
      ${ui.chooseWho ? whoChooser(words) : ''}
      <form class="co-ask" id="co-story"><input name="story" autocomplete="off" maxlength="200" aria-label="${esc(`${tr('I want my')} ${whoWord(who)} ${tr('to…')}`)}" /><button type="submit" class="co-go" disabled>${tr('Add')}</button></form>
      ${ideas.length ? `<div class="co-chips">${ideas.map((t) => `<button type="button" class="co-chip" data-idea="${esc(t)}">${ICON.plus}${esc(t)}</button>`).join('')}</div>` : ''}
      ${c.stories.map((g, gi) => `<section class="co-group"><header>${esc(whoWord(g.who))}</header><ol>${g.items.map((s, si) => `<li><span class="co-n">${si + 1}</span><span class="co-story-text">${esc(s.text)}</span><button type="button" class="co-pill${s.start ? ' on' : ''}" data-start="${gi}:${si}">${s.start ? tr('Start') : tr('Later')}</button><button type="button" class="icon-btn" data-unstory="${gi}:${si}" aria-label="${tr('Remove')}">${ICON.x}</button></li>`).join('')}</ol></section>`).join('')}
      ${ui.chooseWho ? '' : `<div><button type="button" class="co-chip ghost" data-more>${ICON.plus}${tr('I want my…')}</button></div>`}
    </div>${foot(backBtn(), `<button type="button" class="co-go" data-next>${tr('Next')} ${ICON.go}</button>`)}`;
    const form = $('#co-story', body);
    const ready = () => { form.querySelector('.co-go').disabled = !form.story.value.trim(); };
    keep(form.story, `story:${who}`);
    form.story.addEventListener('typed', ready);
    ready();
    const add = (text) => {
      const t = text.replace(/\s+/g, ' ').trim();
      if (!t) return;
      const groups = c.stories.map((g) => ({ ...g, items: [...g.items] }));
      let g = groups.find((x) => x.who === who);
      if (!g) { g = { who, items: [] }; groups.push(g); }
      if (g.items.some((s) => s.text.toLowerCase() === t.toLowerCase())) return;
      g.items.push({ text: t, start: g.items.length < 3 }); // the first three Start
      save({ stories: groups });
    };
    form.onsubmit = (e) => { e.preventDefault(); add(form.story.value); clear(`story:${who}`); ui.focus = `story:${who}`; };
    $$('[data-idea]', body).forEach((b) => (b.onclick = () => add(b.dataset.idea)));
    const at = (v) => v.split(':').map(Number);
    $$('[data-start]', body).forEach((b) => (b.onclick = () => {
      const [gi, si] = at(b.dataset.start);
      save({ stories: c.stories.map((g, x) => (x !== gi ? g : { ...g, items: g.items.map((s, y) => (y === si ? { ...s, start: !s.start } : s)) })) });
    }));
    $$('[data-unstory]', body).forEach((b) => (b.onclick = () => {
      const [gi, si] = at(b.dataset.unstory);
      save({ stories: c.stories.map((g, x) => (x !== gi ? g : { ...g, items: g.items.filter((_, y) => y !== si) })).filter((g) => g.items.length) });
    }));
    $('[data-who]', body).onclick = () => { ui.chooseWho = !ui.chooseWho; Company.redraw(); };
    const more = $('[data-more]', body);
    if (more) more.onclick = () => { ui.chooseWho = true; Company.redraw(); };
    if (ui.chooseWho) wireChips(body, 'who', [], (list) => { if (list[0]) { ui.who = list[0]; ui.chooseWho = false; Company.redraw(); } });
    $('[data-co-back]', body).onclick = () => { ui.screen = indexOf(c, 'stories') - 1; Company.redraw(); };
    $('[data-next]', body).onclick = () => { ui.screen = indexOf(c, 'stories') + 1; Company.redraw(); };
  }
  const whoChooser = (words) => chipsHTML('who', words, [], { label: whoWord });

  // ---------- the delivery date (#792, #801) ----------
  // A day as the server keeps it (YYYY-MM-DD), in this device's calendar; the presets are days counted from today.
  const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
  const pad = (n) => String(n).padStart(2, '0');
  const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const monthsOn = (n) => { const t = new Date(); const d = new Date(t.getFullYear(), t.getMonth() + n, 1); d.setDate(Math.min(t.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); return dayOf(d); };
  const presets = () => [['m1', tr('In 1 month'), monthsOn(1)], ['m3', tr('In 3 months'), monthsOn(3)], ['eoy', tr('End of year'), `${new Date().getFullYear()}-12-31`]];
  const dayText = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(I18n.locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const deliveryText = (c) => (c.deliverBy === 'none' ? tr('Indefinite') : isDay(c.deliverBy) ? dayText(c.deliverBy) : '');
  // The presets, a day picked on a calendar of its own, or Indefinite ("none", an open-ended project).
  function deliveryHTML(c) {
    const v = c.deliverBy || '';
    const preset = presets().find(([, , d]) => d === v);
    const dated = isDay(v) && !preset;
    return `<div class="co-chips" data-delivery-chips>${presets().map(([k, label, d]) => `<button type="button" class="co-chip${d === v ? ' on' : ''}" data-deliver="${d}" data-preset="${k}">${d === v ? ICON.check : ''}${label}</button>`).join('')}
      <button type="button" class="co-chip${dated || ui.cal ? ' on' : ''}" data-pick-day aria-expanded="${ui.cal}">${ICON.cal}${dated ? esc(dayText(v)) : tr('Pick a date')}</button>
      <button type="button" class="co-chip${v === 'none' ? ' on' : ''}" data-delivery-none>${ICON.inf}${tr('Indefinite')}</button></div>
      ${ui.cal ? calendarHTML(v) : ''}`;
  }
  function calendarHTML(v) {
    const today = dayOf(new Date());
    const [y, m] = (ui.month || (isDay(v) ? v : today)).split('-').map(Number);
    ui.month = `${y}-${pad(m)}`;
    const first = new Date(y, m - 1, 1);
    const lead = (first.getDay() + 6) % 7; // Monday first
    const days = new Date(y, m, 0).getDate();
    const names = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(I18n.locale, { weekday: 'narrow' }));
    const cells = [...Array(lead).fill(''), ...Array.from({ length: days }, (_, i) => `${y}-${pad(m)}-${pad(i + 1)}`)];
    return `<div class="co-cal" role="group" aria-label="${esc(first.toLocaleDateString(I18n.locale, { month: 'long', year: 'numeric' }))}">
      <div class="co-cal-head"><b>${esc(first.toLocaleDateString(I18n.locale, { month: 'long', year: 'numeric' }))}</b><button type="button" class="icon-btn" data-cal-move="-1" aria-label="${tr('Previous')}">${ICON.back}</button><button type="button" class="icon-btn" data-cal-move="1" aria-label="${tr('Next')}">${ICON.fold}</button></div>
      <div class="co-cal-grid">${names.map((n) => `<span class="co-cal-n">${esc(n)}</span>`).join('')}${cells.map((d) => (d ? `<button type="button" class="co-cal-d${d === v ? ' on' : ''}${d === today ? ' today' : ''}" data-cal-day="${d}"${d < today ? ' disabled' : ''}>${Number(d.slice(8))}</button>` : '<span></span>')).join('')}</div></div>`;
  }
  // Wires the delivery chips and calendar; then() after a day or Indefinite is picked.
  function wireDelivery(root, c, then = () => {}) {
    const set = (v) => { save({ deliverBy: v }); then(v); };
    $$('[data-deliver]', root).forEach((b) => (b.onclick = () => { ui.cal = false; set(c.deliverBy === b.dataset.deliver ? '' : b.dataset.deliver); }));
    const none = $('[data-delivery-none]', root);
    if (none) none.onclick = () => { ui.cal = false; set(c.deliverBy === 'none' ? '' : 'none'); };
    const pick = $('[data-pick-day]', root);
    if (pick) pick.onclick = () => { ui.cal = !ui.cal; ui.month = null; Company.redraw(); };
    $$('[data-cal-move]', root).forEach((b) => (b.onclick = () => {
      const [y, m] = ui.month.split('-').map(Number);
      const d = new Date(y, m - 1 + Number(b.dataset.calMove), 1);
      ui.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      Company.redraw();
    }));
    $$('[data-cal-day]', root).forEach((b) => (b.onclick = () => set(b.dataset.calDay)));
  }
  function drawDelivery(body, c) {
    body.innerHTML = `<div class="co-q"><h1>${tr('When should it be delivered?')}</h1>${deliveryHTML(c)}</div>${foot(backBtn(), nextBtns(!!c.deliverBy))}`;
    wireDelivery(body, c);
    const on = () => { ui.cal = false; ui.screen = indexOf(c, 'review'); if (screensOf(c).at(-1).swot && !state.company.swot) swot(); else Company.redraw(); };
    $('[data-done]', body).onclick = on;
    $('[data-skip]', body).onclick = () => { if (c.deliverBy) save({ deliverBy: '' }); on(); };
    $('[data-co-back]', body).onclick = () => { ui.cal = false; ui.screen = indexOf(c, 'delivery') - 1; Company.redraw(); };
  }

  // ---------- the review ----------
  // The SWOT and one list: a label and a value a row, each changed in place. A row the Chief has chips for and that
  // has no answer yet shows them open; "Build my team" goes on to Team.
  function drawReview(body, c) {
    const s = c.suggestions || { goal: [], never: [], time: [] };
    // A new idea's review chips build on all five answers (#787); a site's come with its read.
    const basis = basisOf(c, 'goal');
    const stale = c.kind === 'idea' ? s.basis !== basis : !c.suggestions;
    const waiting = Object.fromEntries(['goal', 'never', ...(c.kind === 'idea' ? ['time'] : [])].map((k) => [k, refresh(k, stale, basis)]));
    const idea = c.kind === 'idea';
    const withSwot = idea && screensOf(c).at(-1).swot;
    const answers = idea ? screensOf(c).filter((x) => x.screen === 'question').map((x) => ({ key: x.key, label: said(x)[1], a: card(c, x.key) || { key: x.key, answer: '' } })) : c.about.map((a) => ({ key: a.key, label: questionOf(c, a), a }));
    const rows = [
      ...answers.map(({ key, label, a }) => (a.answer || idea
        ? textRow(key, label, a.answer)
        : chipRow(`about:${key}`, label, '', () => chipsHTML(`about:${key}`, a.chips || [], []), true))),
      ...(idea && c.stories.length && indexOf(c, 'stories') >= 0 ? [linkRow('stories', tr('Stories'), c.stories.map((g) => `${whoWord(g.who)}: ${g.items.map((x) => x.text).join(' · ')}`))] : []),
      ...(c.swot?.firstTest ? [textRow('firstTest', tr('First test'), c.swot.firstTest)] : []),
      chipRow('goal', tr('Goal'), c.goal, () => chipsHTML('goal', s.goal, c.goal ? [c.goal] : [], { plus: true, waiting: waiting.goal })),
      chipRow('never', tr('Asks before'), c.never.join(' · '), () => chipsHTML('never', s.never, c.never, { plus: true, waiting: waiting.never })),
      ...(idea ? [chipRow('time', tr('Time'), c.time, () => chipsHTML('time', s.time, c.time ? [c.time] : [], { plus: true, waiting: waiting.time }))] : []),
      chipRow('delivery', tr('Delivery'), deliveryText(c), () => deliveryHTML(c)),
    ];
    body.innerHTML = `<div class="co-review">${withSwot ? swotHTML(c) : ''}<div class="co-list">${rows.join('')}</div></div>${foot(idea ? backBtn() : '', `<button type="button" class="co-go" data-build>${tr('Build my team')} ${ICON.go}</button>`)}`;
    const done = () => { ui.editing = null; };
    wireChips(body, 'goal', c.goal ? [c.goal] : [], (list) => { done(); save({ goal: list[0] || '' }); });
    wireChips(body, 'never', c.never, (list) => { ui.editing = 'never'; save({ never: list }); }, { multi: true });
    wireChips(body, 'time', c.time ? [c.time] : [], (list) => { done(); save({ time: list[0] || '' }); });
    const delivery = $('[data-row="delivery"]', body);
    if (delivery) wireDelivery(delivery, c, (v) => { if (v && !ui.cal) done(); });
    const answer = (key, text) => save(key === 'firstTest' ? { swot: { ...state.company.swot, firstTest: text } } : { about: state.company.about.map((x) => (x.key === key ? { ...x, answer: text, open: false } : x)) });
    for (const a of c.about.filter((x) => !x.answer)) wireChips(body, `about:${a.key}`, [], (list) => { if (list[0]) answer(a.key, list[0]); });
    $$('[data-edit]', body).forEach((el) => (el.onclick = () => {
      const key = el.dataset.edit;
      ui.editing = key;
      ui.cal = false;
      if (el.dataset.text !== undefined) { ui.typed[`edit:${key}`] = key === 'firstTest' ? c.swot?.firstTest || '' : card(c, key)?.answer || ''; ui.focus = `edit:${key}`; }
      Company.redraw();
    }));
    $$('[data-row-close]', body).forEach((el) => (el.onclick = () => { done(); ui.cal = false; Company.redraw(); }));
    $$('[data-goto]', body).forEach((el) => (el.onclick = () => { ui.screen = indexOf(c, el.dataset.goto); Company.redraw(); }));
    const edit = $('#co-edit', body);
    if (edit) {
      const key = ui.editing;
      keep(edit.answer, `edit:${key}`);
      const close = () => { ui.editing = null; clear(`edit:${key}`); };
      edit.answer.onkeydown = (e) => { if (e.key === 'Escape') { close(); Company.redraw(); } };
      edit.onsubmit = (e) => { e.preventDefault(); const t = edit.answer.value.replace(/\s+/g, ' ').trim(); close(); if (t) answer(key, t); else Company.redraw(); };
    }
    const back = $('[data-co-back]', body);
    if (back) back.onclick = () => { ui.editing = null; ui.screen = indexOf(c, 'review') - 1; Company.redraw(); };
    $('[data-build]', body).onclick = () => Company.go('team');
  }
  // A row: its label and value, a tap opens it in place.
  const rowHTML = (key, label, value, attrs) => `<button type="button" class="co-li" ${attrs}><span class="co-li-k">${esc(label)}</span><span class="co-li-v">${value}</span>${ICON.pen}</button>`;
  const openRowHTML = (key, label, inner, open = false) => `<div class="co-li edit${open ? ' open' : ''}" data-row="${esc(key)}"><button type="button" class="co-li-k" data-row-close>${esc(label)}</button><div class="co-li-v">${inner}</div></div>`;
  function textRow(key, label, value) {
    if (ui.editing === key) return openRowHTML(key, label, `<form class="co-ask small" id="co-edit"><input name="answer" autocomplete="off" maxlength="300" aria-label="${esc(label)}" /><button type="submit" class="co-go">${tr('Save')}</button></form>`);
    return rowHTML(key, label, esc(value || ''), `data-edit="${esc(key)}" data-text`);
  }
  // A row answered by chips (or the delivery's picker): open while it has no value, or once tapped.
  function chipRow(key, label, value, editor, highlighted = false) {
    if (ui.editing === key || !value) return openRowHTML(key, label, editor(), highlighted);
    return rowHTML(key, label, esc(value), `data-edit="${esc(key)}"`);
  }
  const linkRow = (screen, label, lines) => rowHTML(screen, label, lines.map((l) => `<span>${esc(l)}</span>`).join(''), `data-goto="${screen}"`);

  function swotHTML(c) {
    if (!c.swot) return ui.swotting ? '<section class="co-swot loading" aria-busy="true"><div></div><div></div><div></div><div></div></section>' : '';
    const cell = (label, list, cls) => `<div class="co-swot-cell ${cls}"><div class="co-swot-h">${label}</div>${list.map((t) => `<p>${esc(t)}</p>`).join('')}</div>`;
    return `<section class="co-swot">${cell(tr('Strengths'), c.swot.strengths, 's')}${cell(tr('Weaknesses'), c.swot.weaknesses, 'w')}${cell(tr('Opportunities'), c.swot.opportunities, 'o')}${cell(tr('Threats'), c.swot.threats, 't')}</section>`;
  }

  Company.steps.about = draw;
})();
