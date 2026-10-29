// The About step of a company's setup (#670, docs/api.md "The Company"): Company.steps.about. botdot first asks the
// Chief to read the company (POST /api/company/read): a site gets its About cards and the questions the Chief could
// not answer; an idea its name and chips for five questions, one per screen, then "I want my <who> to…" stories,
// then the review with the SWOT. Every answer is saved with PATCH /api/company as it is given, so a reload goes on
// where it was. Everything the Chief wrote is text, drawn with esc() (AGENTS.md rule 6).
(() => {
  if (typeof Company === 'undefined') return;
  const ICON = {
    ...Company.ICON,
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>',
  };
  // The questions of a new idea, as lib/company-chief.js IDEA asks them, and the line each answer shows on.
  const IDEA = [
    ['who', () => tr('Who is it for?'), () => tr('Who')],
    ['today', () => tr('What do they do today?'), () => tr('Today')],
    ['why', () => tr('Why you?'), () => tr('Why you')],
    ['signal', () => tr('What would show it works in 90 days?'), () => tr('90 days')],
    ['test', () => tr('What can you test this week?'), () => tr('First step')],
  ];
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
  const ui = { screen: null, reading: false, readFailed: false, asking: new Set(), swotting: false, who: null, chooseWho: false, ideas: {}, missing: '', own: {}, writing: null, editing: null, typed: {}, focus: null };
  const SEP = '; ';

  const save = async (fields) => {
    Object.assign(state.company, fields);
    Company.redraw();
    try { Company.put(await api(Company.at('/company'), { method: 'PATCH', body: fields })); } catch (e) { toast(e.message, true); await Company.load(); }
    Company.redraw();
  };
  // The Chief's call: its answer arrives as the company (or, for stories, as suggestions); a failure leaves no chips.
  async function ask(path, body, key) {
    if (ui.asking.has(key)) return null;
    ui.asking.add(key);
    try { return await api(Company.at(path), { method: 'POST', body }); } catch (e) { console.warn(e.message); return null; } finally { ui.asking.delete(key); }
  }
  async function suggest(key) {
    const c = await ask('/company/suggest', { key }, `suggest:${key}`);
    if (c && c.id) { Company.put(c); Company.redraw(); }
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
  // Where a new idea stands: the first question not answered nor skipped, then the stories, then the review.
  function startScreen(c) {
    if (c.kind === 'site') return 'review';
    const i = IDEA.findIndex(([k]) => card(c, k)?.open);
    if (i >= 0) return i;
    return c.swot ? 'review' : 'stories';
  }

  function draw(body, c) {
    if (ui.id !== c.id) { // another company: nothing of the last one's screens
      Object.assign(ui, { id: c.id, screen: null, readFailed: false, swotting: false, who: null, chooseWho: false, ideas: {}, missing: '', own: {}, writing: null, editing: null, typed: {}, focus: null, tried: {} });
      for (const k of Object.keys(local)) delete local[k];
    }
    if (!c.about.length) return drawReading(body, c);
    if (ui.screen === null) ui.screen = startScreen(c);
    if (c.kind === 'site') ui.screen = 'review';
    if (typeof ui.screen === 'number') drawQuestion(body, c, ui.screen);
    else if (ui.screen === 'stories') drawStories(body, c);
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

  const progress = (at) => `<div class="co-progress">${[...IDEA.map(([k]) => k), 'stories'].map((k, i) => `<span class="${i < at ? 'done' : i === at ? 'on' : ''}"></span>`).join('')}</div>`;
  const foot = (left, right) => `<div class="co-foot">${left}<span class="co-foot-gap"></span>${right}</div>`;
  const backBtn = (disabled = false) => `<button type="button" class="co-text-btn" data-co-back${disabled ? ' disabled' : ''}>${ICON.back}${tr('Back')}</button>`;

  // A chip question: the Chief's chips and the owner's own, picked by a tap; "Write your own" turns into a field
  // where Enter adds a chip. multi: several may be picked. The answer is the picked chips, joined.
  function chipsHTML(id, chips, picked, { plus = false, label = (t) => t } = {}) {
    const all = [...new Set([...chips, ...picked, ...(ui.own[id] || [])])];
    const writing = ui.writing === id;
    return `<div class="co-chips" data-chips="${esc(id)}">${all.map((t) => `<button type="button" class="co-chip${picked.includes(t) ? ' on' : ' dashed'}" data-chip="${esc(t)}">${picked.includes(t) ? ICON.check : plus ? ICON.plus : ''}${esc(label(t))}</button>`).join('')}${writing
      ? `<form class="co-ask small co-own" data-own="${esc(id)}"><input name="own" autocomplete="off" maxlength="120" aria-label="${tr('Write your own')}" /><button type="submit" class="co-go">${tr('Add')}</button></form>`
      : `<button type="button" class="co-chip dashed" data-write="${esc(id)}">${ICON.pen}${tr('Write your own')}</button>`}</div>`;
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

  // One of the five questions of a new idea.
  const local = {}; // what is picked on a question screen before Done, by key
  function drawQuestion(body, c, i) {
    const [key, question] = IDEA[i];
    const a = card(c, key) || { key, chips: [], answer: '' };
    if (!a.chips?.length && !ui.asking.has(`suggest:${key}`) && !ui.tried?.[key]) { ui.tried = { ...ui.tried, [key]: true }; suggest(key); }
    const picked = local[key] || split(a.answer);
    const answered = IDEA.filter(([k]) => card(c, k)?.answer && k !== key);
    body.innerHTML = `<div class="co-q">${progress(i)}<h1>${question()}</h1>
      ${chipsHTML(key, a.chips || [], picked)}
      ${answered.length ? `<ul class="co-answered">${answered.map(([k, , label]) => `<li>${ICON.check}<span class="co-answered-k">${label()}</span><span>${esc(card(c, k).answer)}</span></li>`).join('')}</ul>` : ''}
    </div>${foot(backBtn(i === 0), `<button type="button" class="co-text-btn" data-skip>${tr('Skip')}</button><button type="button" class="co-go" data-done${picked.length ? '' : ' disabled'}>${tr('Done')} ${ICON.go}</button>`)}`;
    wireChips(body, key, picked, (list) => { local[key] = list; Company.redraw(); }, { multi: true });
    const answer = (text) => {
      delete local[key];
      const next = c.about.some((x) => x.key === key) ? c.about.map((x) => (x.key === key ? { ...x, answer: text, open: false } : x)) : [...c.about, { key, question: a.question || question(), answer: text }];
      ui.screen = i + 1 < IDEA.length ? i + 1 : 'stories';
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
    body.innerHTML = `<div class="co-q">${progress(IDEA.length)}
      <h1>${tr('I want my')} <button type="button" class="co-who" data-who aria-expanded="${ui.chooseWho}">${esc(whoWord(who))}${ICON.down}</button> ${tr('to…')}</h1>
      ${ui.chooseWho ? whoChooser(words) : ''}
      <form class="co-ask" id="co-story"><input name="story" autocomplete="off" maxlength="200" aria-label="${esc(`${tr('I want my')} ${whoWord(who)} ${tr('to…')}`)}" /><button type="submit" class="co-go" disabled>${tr('Add')}</button></form>
      ${ideas.length ? `<div class="co-chips">${ideas.map((t) => `<button type="button" class="co-chip dashed" data-idea="${esc(t)}">${ICON.plus}${esc(t)}</button>`).join('')}</div>` : ''}
      ${c.stories.map((g, gi) => `<section class="co-group"><header>${esc(whoWord(g.who))}</header><ol>${g.items.map((s, si) => `<li><span class="co-n">${si + 1}</span><span class="co-story-text">${esc(s.text)}</span><button type="button" class="co-pill${s.start ? ' on' : ''}" data-start="${gi}:${si}">${s.start ? tr('Start') : tr('Later')}</button><button type="button" class="icon-btn" data-unstory="${gi}:${si}" aria-label="${tr('Remove')}">${ICON.x}</button></li>`).join('')}</ol></section>`).join('')}
      ${ui.chooseWho ? '' : `<div><button type="button" class="co-chip" data-more>${ICON.plus}${tr('I want my…')}</button></div>`}
    </div>${foot(backBtn(), `<button type="button" class="co-go" data-next>${tr('Done')} ${ICON.go}</button>`)}`;
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
    $('[data-co-back]', body).onclick = () => { ui.screen = IDEA.length - 1; Company.redraw(); };
    $('[data-next]', body).onclick = () => { ui.screen = 'review'; if (!state.company.swot) swot(); else Company.redraw(); };
  }
  const whoChooser = (words) => chipsHTML('who', words, [], { label: whoWord });

  // The review: the SWOT, the 90-day goal, what the team never does without asking, time, the Chief's open questions
  // and the answered cards; beside them, what the Chief knows. "Build my team" goes on to Team.
  function drawReview(body, c) {
    const s = c.suggestions || { goal: [], never: [], time: [] };
    const open = c.about.filter((a) => !a.answer);
    const done = c.about.filter((a) => a.answer);
    const chipCard = (id, question, chips, picked, highlighted = false) => `<section class="co-card${highlighted ? ' open' : ''}"><div class="co-card-q">${esc(question)}</div>${chipsHTML(id, chips, picked, { plus: true })}</section>`;
    body.innerHTML = `<div class="co-review"><div class="co-review-main">
      ${c.kind === 'idea' ? swotHTML(c) : ''}
      ${chipCard('goal', tr('What is the main goal for the next 90 days?'), s.goal, c.goal ? [c.goal] : [], c.kind === 'site' && !c.goal)}
      ${chipCard('never', tr('What should the team never do without asking?'), s.never, c.never, c.kind === 'site' && !c.never.length)}
      ${c.kind === 'idea' ? chipCard('time', tr('How much time can you give it?'), s.time, c.time ? [c.time] : []) : ''}
      ${open.map((a) => chipCard(`about:${a.key}`, questionOf(c, a), a.chips || [], [], !!a.open)).join('')}
      ${done.map((a) => answeredHTML(c, a)).join('')}
    </div>${knowsHTML(c)}</div>${foot(c.kind === 'idea' ? backBtn() : '', `<button type="button" class="co-go" data-build>${tr('Build my team')} ${ICON.go}</button>`)}`;
    wireChips(body, 'goal', c.goal ? [c.goal] : [], (list) => save({ goal: list[0] || '' }));
    wireChips(body, 'never', c.never, (list) => save({ never: list }), { multi: true });
    wireChips(body, 'time', c.time ? [c.time] : [], (list) => save({ time: list[0] || '' }));
    const answer = (key, text) => save({ about: state.company.about.map((x) => (x.key === key ? { ...x, answer: text, open: false } : x)) });
    for (const a of open) wireChips(body, `about:${a.key}`, [], (list) => { if (list[0]) answer(a.key, list[0]); });
    $$('[data-edit]', body).forEach((el) => (el.onclick = () => { ui.editing = el.dataset.edit; ui.typed[`edit:${ui.editing}`] = card(c, ui.editing)?.answer || ''; ui.focus = `edit:${ui.editing}`; Company.redraw(); }));
    const edit = $('#co-edit', body);
    if (edit) {
      const key = ui.editing;
      keep(edit.answer, `edit:${key}`);
      const close = () => { ui.editing = null; clear(`edit:${key}`); };
      edit.answer.onkeydown = (e) => { if (e.key === 'Escape') { close(); Company.redraw(); } };
      edit.onsubmit = (e) => { e.preventDefault(); const t = edit.answer.value.replace(/\s+/g, ' ').trim(); close(); if (t) answer(key, t); else Company.redraw(); };
    }
    const back = $('[data-co-back]', body);
    if (back) back.onclick = () => { ui.screen = 'stories'; Company.redraw(); };
    $('[data-build]', body).onclick = () => Company.go('team');
    if (!c.suggestions && !ui.tried?.review) { ui.tried = { ...ui.tried, review: true }; suggest('goal'); suggest('never'); if (c.kind === 'idea') suggest('time'); }
  }
  function answeredHTML(c, a) {
    if (ui.editing === a.key) return `<section class="co-card"><div class="co-card-q">${esc(questionOf(c, a))}</div><form class="co-ask small" id="co-edit"><input name="answer" autocomplete="off" maxlength="300" aria-label="${esc(questionOf(c, a))}" /><button type="submit" class="co-go">${tr('Save')}</button></form></section>`;
    return `<button type="button" class="co-card co-answer" data-edit="${esc(a.key)}"><span class="co-card-q">${esc(questionOf(c, a))}${ICON.pen}</span><span class="co-card-a">${esc(a.answer)}</span></button>`;
  }
  function swotHTML(c) {
    if (!c.swot) return ui.swotting ? '<section class="co-swot loading" aria-busy="true"><div></div><div></div><div></div><div></div></section>' : '';
    const cell = (letter, label, list, cls) => `<div class="co-swot-cell ${cls}"><div class="co-swot-h"><b>${letter}</b>${label}</div>${list.map((t) => `<p>${esc(t)}</p>`).join('')}</div>`;
    return `<section class="co-swot">${cell('S', tr('Strengths'), c.swot.strengths, 's')}${cell('W', tr('Weaknesses'), c.swot.weaknesses, 'w')}${cell('O', tr('Opportunities'), c.swot.opportunities, 'o')}${cell('T', tr('Threats'), c.swot.threats, 't')}${c.swot.firstTest ? `<div class="co-swot-test">${ICON.play}<span>${esc(c.swot.firstTest)}</span></div>` : ''}</section>`;
  }
  // What the Chief knows so far, beside the review.
  function knowsHTML(c) {
    const rows = [
      ...c.about.filter((a) => a.answer).map((a) => a.answer),
      ...(c.sources.length ? [trn(c.sources.length, 'Read {n} source', 'Read {n} sources')] : []),
      ...c.stories.filter((g) => g.items.some((x) => x.start)).map((g) => `${tr('I want my')} ${whoWord(g.who)} ${tr('to…')} ${g.items.filter((x) => x.start).map((x) => x.text).join(SEP)}`),
      ...(c.swot?.firstTest ? [`${tr('First test')}: ${c.swot.firstTest}`] : []),
      ...(c.goal ? [c.goal] : []),
      ...(c.never.length ? [`${tr('Asks before')}: ${c.never.join(', ')}`] : []),
      ...(c.time ? [`${tr('Time')}: ${c.time}`] : []),
    ];
    return `<aside class="co-knows"><div class="co-knows-h">${esc(c.name || c.start)}</div><ul>${rows.map((t) => `<li>${ICON.check}<span>${esc(t)}</span></li>`).join('')}</ul></aside>`;
  }

  Company.steps.about = draw;
})();
