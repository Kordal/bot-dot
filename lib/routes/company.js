// The Company (#669, lib/company.js, ADR 110): /api/company…. The owner sets it up and runs it; the Chief's tools may
// read it and change its teams, objectives and to-do (server.js CHIEF_ROUTES), never start, delete or reset it.
// Several projects (#689, ADR 120): every route takes `?project=<id>`; without it, the first project, as older apps
// had their one company. GET /api/company/list answers them all.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const feed = require('../events');
const companyLib = require('../company');
const chiefHelp = require('../company-chief');
const teamLib = require('../company-team');
const calendarLib = require('../project-calendar');

// The feed's events: `project`, the project that changed as GET answers it (null once deleted), for apps with
// `projects-many`; and `company`, the first project, for older apps, sent when the first one changed or another
// became the first. Each change also keeps the teams' chats in step with the teams of every project (#697).
let firstId = null;
const store = companyLib.create({ emit: ({ id, company }) => {
  B.syncTeamChats();
  feed.emit('project', { id, project: view(company) });
  const first = store.read();
  if (id === firstId || first?.id !== firstId || first?.id === id) feed.emit('company', { company: view(first) });
  firstId = first?.id || null;
} });
firstId = store.id();
const known = (id) => !!B.bots.get(id);
// The Chief's help with the setup (#670): made when first asked, as it reaches for Claude Code and the Chief's folder.
let helper = null;
// The project a request names (`?project=`), or the first: null when it names one that is not there.
const projectOf = (url) => {
  const pid = url.searchParams.get('project');
  if (!pid) return store;
  return store.list().some((c) => c.id === pid) ? store.of(pid) : null;
};
const help = () => helper || (helper = chiefHelp.create({ ask: require('../dresser').askClaude, workdir: require('../chief').WORKDIR }));
const reading = new Map(); // company id -> its read under way, so a second window waits for the same one

// Stop at a check-in: every job of the company's bots is switched off, as the owner switches one off. How many.
function pauseJobs(c) {
  let n = 0;
  for (const id of new Set(c.teams.flatMap((t) => t.bots))) {
    const bot = B.bots.get(id);
    const on = (bot?.jobs || []).filter((j) => j.enabled);
    if (!on.length) continue;
    B.bots.update(id, { ...bot, jobs: bot.jobs.map((j) => ({ ...j, enabled: false })) }, { by: 'you' });
    n += on.length;
  }
  return n;
}

// A turn of the Chief about the company, in the chat the owner last used: botdot's words, never the owner's.
function tellChief(prompt) {
  try { require('../chief').tell({ prompt: `botdot writes this, not the user: nobody typed it. ${prompt}`, title: 'Project' }); } catch (e) { console.error(`[company] ${e.message}`); }
}

// The projects botdot starts work for: not the archived ones (#701), which wait as they were until unarchived.
const live = () => store.list().filter((c) => !c.archived);

// Each Monday (or the first look after it) the Chief drafts the week's plan of each running project, once a week.
function draftPlan(at = new Date()) {
  let asked = false;
  for (const c of live()) {
    const one = store.of(c.id);
    const week = one.planDue(undefined, at);
    if (!week) continue;
    one.planAsked(week);
    tellChief(`It is a new week (from ${week}) for the project ${about(c)}. Draft this week's plan with set_company_plan: three items, each tied to one of the objectives and to the team that does it by their ids, the ones that move the objectives most; keep an item of the plan there is that is not done yet (such as the first test). Say in one line that the plan waits for the user's Approve in Projects.`);
    asked = true;
  }
  return asked;
}
// A project as the Chief is told of it: its name and the id its tools take.
const about = (c) => `${JSON.stringify(c.name || c.start)} (project: "${c.id}")`;
// ---------- the leads (#696) ----------
// What botdot starts a lead with, in botdot's words (never the owner's). A team's name is the owner's text: on one line.
const RHYTHM_WORDS = { daily: 'daily', 'twice-weekly': 'twice-a-week', weekly: 'weekly' };
const teamName = (t) => JSON.stringify(String(t.name).replace(/\s+/g, ' ').slice(0, 60));
const projectName = (c) => JSON.stringify(String(c.name || c.start).replace(/\s+/g, ' ').slice(0, 60));
const askPrompt = (c, t) => `You are now the lead of team ${teamName(t)} in the owner's project ${projectName(c)}. Ask the owner, in one short question and nothing else, how often you should send them the team's report, and end your reply with [[choices: Daily | Twice a week | Weekly]] in the language you write in. When they answer, call set_report_rhythm with daily, twice-weekly or weekly (project: ${projectName(c)}).`;
const reportPrompt = (c, t) => `It is time for the ${RHYTHM_WORDS[t.report]} report of team ${teamName(t)} of the project ${projectName(c)} to the owner. From what you know and what the members sent you, write it in 3 to 6 short lines: what is done, what is under way, what is blocked, and what needs the owner. Call post_team_report with it (project: ${projectName(c)}), then give the same report as your reply.`;
const planPrompt = (c, t, items) => `The owner approved this week's plan of the project ${projectName(c)}. Your team ${teamName(t)} does these items: ${items.map((x, i) => `${i + 1}. ${x.text}`).join(' ')} Lead them: hand each member its part with message_bot (priority: true), do your own part, and say in a few lines who does what.`;

// Each lead not asked yet is asked how often to report, and each report whose time came is started. A lead that is
// busy gets it after its runs (its work waits its turn).
function leads(at = new Date()) {
  for (const c of live()) {
    const one = store.of(c.id);
    for (const t of one.leadsToAsk()) {
      const said = B.startForProject(t.lead, { key: `ask:${t.id}`, prompt: askPrompt(c, t) });
      if (said !== 'full' && said !== 'failed') one.askedLead(t.id, t.lead);
    }
    for (const t of one.reportsDue(undefined, at)) {
      const said = B.startForProject(t.lead, { key: `report:${t.id}`, prompt: reportPrompt(c, t) });
      if (said !== 'full' && said !== 'failed') one.reportStarted(t.id);
    }
  }
}
// After a change of the teams, a while later: a new bot's first message (lib/hello.js) comes before its lead's
// question. BOT_DOT_LEAD_DELAY_MS: how long, in ms; "off" only at the regular look (the tests).
const LEAD_DELAY = process.env.BOT_DOT_LEAD_DELAY_MS === 'off' ? null : Number(process.env.BOT_DOT_LEAD_DELAY_MS ?? 60_000);
let leadTimer = null;
function leadsSoon() {
  if (LEAD_DELAY == null || !Number.isFinite(LEAD_DELAY)) return;
  clearTimeout(leadTimer);
  leadTimer = setTimeout(() => { try { leads(); } catch (e) { console.error(`[company] ${e.message}`); } }, LEAD_DELAY);
  leadTimer.unref?.();
}
setInterval(() => {
  try { draftPlan(); } catch (e) { console.error(`[company] ${e.message}`); }
  try { leads(); } catch (e) { console.error(`[company] ${e.message}`); }
}, Number(process.env.BOT_DOT_COMPANY_EVERY_MS) || 15 * 60_000).unref();

// Objectives that update themselves (#699, ADR 121): each source that is due is read by a run of the Chief's own
// (chief.js readSource), one at a time; its number becomes the objective's `current`. The first failure since the
// source last worked is said once, as botdot's line in the Chief's chat; later ones only show on the goal card.
let readingSources = false;
async function readSources(at = new Date()) {
  if (readingSources) return;
  readingSources = true;
  try {
    for (const c of store.list()) {
      const one = store.of(c.id);
      for (const o of one.sourcesDue(at)) {
        const chief = require('../chief');
        const got = await chief.readSource({ app: o.source.app, what: o.source.what, objective: o.name, project: c.name || c.start });
        if (!got) return; // another run of the Chief's is at work: the next round
        const now = one.read()?.objectives.find((x) => x.id === o.id);
        if (!now?.source || now.source.app !== o.source.app || now.source.what !== o.source.what) continue; // changed meanwhile
        const { told } = one.sourceRead(o.id, got);
        if (told) chief.post(`"${o.name}" in ${c.name || c.start} could not update from ${B.appName(o.source.app)}: ${got.error}. botdot tries again ${o.source.every === 'weekly' ? 'next week' : 'tomorrow'}.`);
      }
    }
  } finally { readingSources = false; }
}
const sourcesSoon = () => setTimeout(() => readSources().catch((e) => console.error(`[company] ${e.message}`)), 0).unref?.();
setInterval(sourcesSoon, Number(process.env.BOT_DOT_SOURCES_EVERY_MS) || 5 * 60_000).unref();

// The morning standup (#698, lib/company-standup.js): each lead's three lines, then one Chief message.
const quietHours = () => B.settings.get().quietHours;
// One per project, each with that project's store; the Chief is told which project it is.
const standups = new Map();
function standupOf(one) {
  const id = one.id();
  if (!standups.has(id)) {
    standups.set(id, require('../company-standup').create({
      store: one,
      ask: (prompt, opts) => require('../dresser').askClaude(prompt, opts),
      bots: {
        name: (id) => B.bots.get(id)?.name || id,
        // A bot's finished runs of its own chat since then: what it was asked, how it ended, the start of its reply.
        runs: (id, since) => B.listRuns({ botId: id, limit: 20 }).filter((r) => r.status !== 'running' && Date.parse(r.startedAt) >= since)
          .map((r) => ({ asked: r.prompt || '', status: r.status, reply: r.result || '', at: r.startedAt })),
      },
      tell: (prompt) => { const c = one.read(); tellChief(c ? prompt.replace('standup of the project.', `standup of the project ${about(c)}.`) : prompt); },
      quiet: (at) => require('../reporting').inQuietHours(at, quietHours()),
      timeZone: () => quietHours().timeZone,
    }));
  }
  return standups.get(id);
}
const standup = { tick: () => Promise.all(live().map((c) => standupOf(store.of(c.id)).tick())) };
setInterval(() => { standup.tick().catch((e) => console.error(`[standup] ${e.message}`)); }, Number(process.env.BOT_DOT_STANDUP_EVERY_MS) || 5 * 60_000).unref();

function create({ audit, changeJob }) {
  // The Team step (#671): the Chief's proposal, "Change the team…", Duplicate and Create. One per project.
  const teams = new Map();
  const teamOf = (one) => {
    const pid = one.id();
    if (!teams.has(pid)) teams.set(pid, teamLib.create({ store: store.of(pid), bots: B.bots,
    ask: (prompt, opts) => require('../dresser').askClaude(prompt, opts),
    addJob: (bot, job) => changeJob(bot, 'add', job, { by: 'chief' }),
    apps: async () => (B.connectors?.status().configured ? (await B.connectors.connections()).filter((x) => x.status === 'ACTIVE').map((x) => x.toolkit) : []),
    }));
    return teams.get(pid);
  };
  const logged = (action, details = {}) => { try { audit(`company.${action}`, 'you', details); } catch (e) { console.error(`[audit] ${e.message}`); } };
  const answer = (res, c, status = 200) => send(res, status, view(c));

  return async function routes(req, res, url, { parts, m, by, standing }) {
    if (parts[0] !== 'company') return NEXT;
    const owner = by === 'you';
    const ownersOnly = () => send(res, 403, { error: 'Only the owner can do that.' });
    try {
      if (parts[1] === 'list' && !parts[2] && m === 'GET') return send(res, 200, { projects: store.list().map(view) });
      const one = projectOf(url);
      if (!one) return send(res, 404, { error: 'That project is gone.', state: 'none' });
      if (!parts[1]) {
        if (m === 'GET') return send(res, 200, { company: view(one.read()) });
        if (!owner) return ownersOnly();
        if (m === 'POST') {
          const c = one.start((await readBody(req)) || {});
          logged('created', { kind: c.kind });
          return answer(res, c, 201);
        }
        if (m === 'PATCH') return answer(res, one.patch((await readBody(req)) || {}));
        if (m === 'DELETE') { one.remove(); logged('deleted'); return send(res, 200, { ok: true }); }
      }
      if (['read', 'suggest', 'swot', 'stories'].includes(parts[1]) && m === 'POST') {
        if (!owner) return ownersOnly();
        return await helped(req, res, parts, one);
      }
      const team = parts[1] === 'proposal' || parts[1] === 'start' ? teamOf(must(one)) : null;
      if (parts[1] === 'teams' && !parts[3]) {
        const body = m === 'DELETE' ? {} : (await readBody(req)) || {};
        if (!parts[2] && m === 'POST') { const c = one.addTeam(body, known); leadsSoon(); return answer(res, c); }
        if (parts[2] && m === 'PUT') { const c = one.setTeam(parts[2], body, known); leadsSoon(); return answer(res, c); }
        if (parts[2] && m === 'DELETE') { if (!owner) return ownersOnly(); return answer(res, one.removeTeam(parts[2])); }
      }
      if (parts[1] === 'proposal' && m === 'POST') {
        if (!owner) return ownersOnly();
        if (!parts[2]) return answer(res, await team.propose());
        if (parts[2] === 'chat' && !parts[3]) return answer(res, await team.chat(((await readBody(req)) || {}).text));
        if (parts[2] === 'undo' && !parts[3]) return answer(res, one.undoProposal());
        if (parts[2] === 'duplicate' && !parts[3]) return answer(res, team.duplicate(((await readBody(req)) || {}).bot));
      }
      if (parts[1] === 'start' && !parts[2] && m === 'POST') {
        if (!owner) return ownersOnly();
        const was = one.read()?.phase;
        const c = await team.start();
        if (was !== 'running') { logged('started', { bots: c.teams.reduce((n, t) => n + t.bots.length, 0) }); leadsSoon(); }
        return answer(res, c);
      }
      // The morning standup (#698): its switch and time, and `now` to run today's at once. The Chief's too.
      if (parts[1] === 'standup' && !parts[2] && m === 'PUT') {
        const body = (await readBody(req)) || {};
        const was = one.read();
        if (body.now === true && was && (was.phase !== 'running' || !was.teams.length)) return send(res, 409, { error: 'The project has no team yet.', state: 'no-team' });
        if (body.now === true && standupOf(one).busy()) return send(res, 409, { error: 'A standup is going already.', state: 'busy' });
        const c = one.setStandup({ on: body.on, time: body.time });
        if (body.now === true) standupOf(one).start();
        return answer(res, c);
      }
      if (parts[1] === 'objectives' && parts[2] && !parts[3] && m === 'PUT') {
        const body = (await readBody(req)) || {};
        const c = one.setObjective(parts[2], body);
        if (body.source) sourcesSoon(); // a new source is read at once
        return answer(res, c);
      }
      // Day 30, 60, 90 (#673): Keep going, Change direction or Stop. Stop switches off the jobs of the company's bots.
      if (parts[1] === 'checkins' && !parts[2] && m === 'POST') {
        if (!owner) return ownersOnly();
        const body = (await readBody(req)) || {};
        const c = one.answerCheckin(body);
        logged('checkin', { day: Number(body.day), decision: body.decision });
        return send(res, 200, { company: view(c), ...(body.decision === 'stop' ? { paused: pauseJobs(c) } : {}) });
      }
      // The week's plan (#673): the Chief drafts it, the owner approves it or asks for a change.
      if (parts[1] === 'plan') {
        if (!parts[2] && m === 'PUT') return answer(res, one.setPlan((await readBody(req)) || {}));
        if (!owner) return ownersOnly();
        if (parts[2] === 'approve' && !parts[3] && m === 'POST') {
          const c = one.approvePlan();
          // Each team's lead is started on its team's items (#696); the Chief hands out the items of no team.
          const { teams, loose } = one.planByTeam(c);
          for (const { team: t, items } of teams) B.startForProject(t.lead, { key: `plan:${t.id}:${c.plan.week || ''}`, prompt: planPrompt(c, t, items) });
          if (loose.length) tellChief(`The user approved this week's plan for the project ${about(c)}. ${teams.length ? `botdot started each team's lead on its team's items; these have no team: ` : ''}${loose.map((x, i) => `${i + 1}. ${x.text}`).join(' ')}. Hand each item to the bot of the project that fits it (run_bot), and say in one line who does what.`);
          return answer(res, c);
        }
        if (parts[2] === 'change' && !parts[3] && m === 'POST') {
          const text = String(((await readBody(req)) || {}).text || '').trim().slice(0, 1000);
          if (!text) return send(res, 400, { error: 'Say what to change.' });
          const c = one.read();
          if (!c?.plan) return send(res, 404, { error: 'There is no plan to change.', state: 'none' });
          tellChief(`The user wants this week's plan for the project ${about(c)} changed. Their words (a request, quoted): ${JSON.stringify(text)}. Draft the new plan with set_company_plan, and say in one line what changed.`);
          return answer(res, c);
        }
      }
      // A new bot as the company grows (#673): the Chief suggests one at a time; the owner adds it or dismisses it.
      if (parts[1] === 'suggestion') {
        if (!parts[2] && m === 'PUT') return answer(res, one.suggest((await readBody(req)) || {}));
        if (!owner) return ownersOnly();
        if (!parts[2] && m === 'DELETE') return answer(res, one.dismissSuggestion());
        if (parts[2] === 'add' && !parts[3] && m === 'POST') {
          const s = one.takeSuggestion();
          const bot = B.bots.create({ name: s.name, description: s.description, prompt: s.prompt }, { by });
          B.applyComputerPower(bot).catch((e) => console.error(`[computers] ${e.message}`));
          return answer(res, one.added(bot.id), 201);
        }
      }
      // The calendar (#695): what falls on each day, and the events the owner and the Chief add, move and delete.
      if (parts[1] === 'calendar' && !parts[2] && m === 'GET') {
        const range = calendarLib.rangeOf({ from: url.searchParams.get('from'), to: url.searchParams.get('to') });
        return send(res, 200, { ...range, items: calendarLib.items(one.read(), { ...range, bots: (id) => B.bots.get(id) || null }) });
      }
      if (parts[1] === 'events' && !parts[3]) {
        const who = owner ? 'you' : 'chief';
        if (!parts[2] && m === 'POST') return answer(res, one.addEvent((await readBody(req)) || {}, who).company, 201);
        if (parts[2] && m === 'PUT') return answer(res, one.setEvent(parts[2], (await readBody(req)) || {}).company);
        if (parts[2] && m === 'DELETE') return answer(res, one.removeEvent(parts[2]));
      }
      // The decisions log (#694): the owner writes one down here, or tells the Chief, whose tool writes it in a turn
      // the owner started; a check-in's answer is written by botdot. Only the owner removes one.
      if (parts[1] === 'decisions' && !parts[3]) {
        if (!parts[2] && m === 'POST') {
          if (!owner && standing?.()?.startedBy !== 'owner') return send(res, 403, { error: 'Not done: you log a decision of the owner only in a turn the user started by writing to you. Nothing was logged.' });
          const body = (await readBody(req)) || {};
          const { company, decision } = one.addDecision({ text: body.text, why: body.why, by: owner ? 'you' : 'chief' });
          logged('decision', { by: decision.by });
          return answer(res, company, 201);
        }
        if (parts[2] && m === 'DELETE') { if (!owner) return ownersOnly(); return answer(res, one.removeDecision(parts[2])); }
      }
      // The to-do (#692): the owner's, and the Chief's to add, assign, date and tick; only the owner deletes.
      if (parts[1] === 'todos' && !parts[3]) {
        const who = owner ? 'you' : 'chief';
        if (!parts[2] && m === 'POST') {
          const body = (await readBody(req)) || {};
          const bot = typeof body.bot === 'string' && body.bot ? body.bot : null;
          const { company, todo } = one.addTodo({ text: body.text, bot, due: body.due, repeat: body.repeat }, known, who);
          // "@Bot task" of the owner's, due by today: the bot gets the task as the owner's message, as from its own chat.
          if (bot && owner && (!todo.due || todo.due <= companyLib.today(new Date()))) B.askBot(B.bots.get(bot), { prompt: todo.text, text: todo.text, attachments: [], by, chat: true });
          return answer(res, company, 201);
        }
        if (parts[2] && m === 'PUT') return answer(res, one.setTodo(parts[2], (await readBody(req)) || {}, known).company);
        if (parts[2] && m === 'DELETE') { if (!owner) return ownersOnly(); return answer(res, one.removeTodo(parts[2])); }
      }
    } catch (e) {
      if (e.status) return send(res, e.status, { error: e.message, ...(e.state ? { state: e.state } : {}) });
      throw e;
    }
    return send(res, 405, { error: 'Not here' });
  };
}

// The Chief's help (#670, lib/company-chief.js). Each answers once the Chief did, or did not: a failed or late
// answer leaves the company as it was (the read: with its questions, without chips).
async function helped(req, res, parts, store) {
  const body = (await readBody(req)) || {};
  const c = store.read();
  if (!c) return send(res, 404, { error: 'There is no project yet.', state: 'none' });
  if (parts[1] === 'read' && !parts[2]) {
    if (c.about.length) return send(res, 200, view(c)); // read already: its answers stay
    if (!reading.has(c.id)) {
      reading.set(c.id, help().read(c).then((r) => {
        const now = store.read();
        if (!now || now.id !== c.id || now.about.length) return now;
        return store.patch({ about: r?.cards || chiefHelp.blankCards(c.kind), ...(r?.name ? { name: r.name } : {}), suggestions: r?.suggestions || null });
      }).finally(() => reading.delete(c.id)));
    }
    return send(res, 200, view(await reading.get(c.id)));
  }
  if (parts[1] === 'suggest' && !parts[2]) {
    const key = typeof body.key === 'string' ? body.key.slice(0, 40) : '';
    const review = ['goal', 'never', 'time'].includes(key);
    if (!key || (!review && !c.about.some((a) => a.key === key))) return send(res, 400, { error: 'Say which question.' });
    const chips = await help().suggest(c, key);
    const now = store.read();
    if (!chips?.length || !now) return send(res, 200, view(now));
    if (review) return send(res, 200, view(store.patch({ suggestions: { ...(now.suggestions || {}), [key]: chips } })));
    return send(res, 200, view(store.patch({ about: now.about.map((a) => (a.key === key ? { ...a, chips } : a)) })));
  }
  if (parts[1] === 'swot' && !parts[2]) {
    const swot = await help().swot(c);
    const now = store.read();
    return send(res, 200, view(swot && now ? store.patch({ swot }) : now));
  }
  if (parts[1] === 'stories' && parts[2] === 'suggest' && !parts[3]) {
    const who = typeof body.who === 'string' ? body.who.trim().slice(0, 40) : '';
    if (!who) return send(res, 400, { error: 'Say whose stories.' });
    const r = await help().stories(c, who);
    const have = new Set(c.stories.flatMap((g) => (g.who === who ? g.items.map((s) => s.text.toLowerCase()) : [])));
    const groups = new Set(c.stories.map((g) => g.who.toLowerCase()));
    return send(res, 200, { stories: (r?.stories || []).filter((s) => !have.has(s.toLowerCase())), group: r?.group && !groups.has(r.group) && r.group !== who.toLowerCase() ? r.group : '' });
  }
  return send(res, 405, { error: 'Not here' });
}

// A project that is not there: 404, as each of its routes answers.
function must(one) { if (!one.read()) throw Object.assign(new Error('There is no project yet.'), { status: 404, state: 'none' }); return one; }

// The company as the apps get it: with `day`, the day of the 90 it is on (null in setup), `checkin`, the check-in
// that waits for the owner (null when none does, #673), `facts`, how many things
// the owner told the company (its memory, as the Team step counts it), and `canUndo` for the proposal's last change.
function view(c) {
  if (!c) return null;
  const { proposalUndo, ...shown } = c;
  const facts = c.about.filter((a) => a.answer).length + c.stories.reduce((n, g) => n + g.items.length, 0) + c.never.length
    + [c.goal, c.time, c.swot?.firstTest].filter(Boolean).length + c.sources.length;
  const today = companyLib.localDay(new Date(), quietHours().timeZone).day;
  return { ...shown, day: store.day(c), checkin: store.checkinOf(c), facts, canUndo: (proposalUndo || []).length > 0, standupToday: c.standups.find((s) => s.day === today && s.merged) || null };
}

module.exports = { create, store, view, draftPlan, leads, standup, readSources };
