// The Company (#669, lib/company.js, ADR 110): /api/company…. The owner sets it up and runs it; the Chief's tools may
// read it and change its teams and objectives (server.js CHIEF_ROUTES), never start, delete or reset it.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const feed = require('../events');
const companyLib = require('../company');

const store = companyLib.create({ emit: (data) => feed.emit('company', { company: view(data.company) }) });
const known = (id) => !!B.bots.get(id);

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
  try { require('../chief').tell({ prompt: `botdot writes this, not the user: nobody typed it. ${prompt}`, title: 'Company' }); } catch (e) { console.error(`[company] ${e.message}`); }
}

// Each Monday (or the first look after it) the Chief drafts the week's plan of a running company, once a week.
function draftPlan(at = new Date()) {
  const week = store.planDue(undefined, at);
  if (!week) return false;
  store.planAsked(week);
  tellChief(`It is a new week (from ${week}) for the company. Draft this week's plan with set_company_plan: three items, each tied to one of the objectives by its id, the ones that move the objectives most. Say in one line that the plan waits for the user's Approve in Company.`);
  return true;
}
setInterval(() => { try { draftPlan(); } catch (e) { console.error(`[company] ${e.message}`); } }, Number(process.env.BOT_DOT_COMPANY_EVERY_MS) || 15 * 60_000).unref();

function create({ audit }) {
  const logged = (action, details = {}) => { try { audit(`company.${action}`, 'you', details); } catch (e) { console.error(`[audit] ${e.message}`); } };
  const answer = (res, c, status = 200) => send(res, status, view(c));

  return async function routes(req, res, url, { parts, m, by }) {
    if (parts[0] !== 'company') return NEXT;
    const owner = by === 'you';
    const ownersOnly = () => send(res, 403, { error: 'Only the owner can do that.' });
    try {
      if (!parts[1]) {
        if (m === 'GET') return send(res, 200, { company: view(store.read()) });
        if (!owner) return ownersOnly();
        if (m === 'POST') {
          const c = store.start((await readBody(req)) || {});
          logged('created', { kind: c.kind });
          return answer(res, c, 201);
        }
        if (m === 'PATCH') return answer(res, store.patch((await readBody(req)) || {}));
        if (m === 'DELETE') { store.remove(); logged('deleted'); return send(res, 200, { ok: true }); }
      }
      if (parts[1] === 'teams' && !parts[3]) {
        const body = m === 'DELETE' ? {} : (await readBody(req)) || {};
        if (!parts[2] && m === 'POST') return answer(res, store.addTeam(body, known));
        if (parts[2] && m === 'PUT') return answer(res, store.setTeam(parts[2], body, known));
        if (parts[2] && m === 'DELETE') { if (!owner) return ownersOnly(); return answer(res, store.removeTeam(parts[2])); }
      }
      if (parts[1] === 'objectives' && parts[2] && !parts[3] && m === 'PUT') return answer(res, store.setObjective(parts[2], (await readBody(req)) || {}));
      // Day 30, 60, 90 (#673): Keep going, Change direction or Stop. Stop switches off the jobs of the company's bots.
      if (parts[1] === 'checkins' && !parts[2] && m === 'POST') {
        if (!owner) return ownersOnly();
        const body = (await readBody(req)) || {};
        const c = store.answerCheckin(body);
        logged('checkin', { day: Number(body.day), decision: body.decision });
        return send(res, 200, { company: view(c), ...(body.decision === 'stop' ? { paused: pauseJobs(c) } : {}) });
      }
      // The week's plan (#673): the Chief drafts it, the owner approves it or asks for a change.
      if (parts[1] === 'plan') {
        if (!parts[2] && m === 'PUT') return answer(res, store.setPlan((await readBody(req)) || {}));
        if (!owner) return ownersOnly();
        if (parts[2] === 'approve' && !parts[3] && m === 'POST') {
          const c = store.approvePlan();
          tellChief(`The user approved this week's plan for the company: ${c.plan.items.map((x, i) => `${i + 1}. ${x.text}`).join(' ')}. Hand each item to the bot of the company that fits it (run_bot), and say in one line who does what.`);
          return answer(res, c);
        }
        if (parts[2] === 'change' && !parts[3] && m === 'POST') {
          const text = String(((await readBody(req)) || {}).text || '').trim().slice(0, 1000);
          if (!text) return send(res, 400, { error: 'Say what to change.' });
          const c = store.read();
          if (!c?.plan) return send(res, 404, { error: 'There is no plan to change.', state: 'none' });
          tellChief(`The user wants this week's plan for the company changed. Their words (a request, quoted): ${JSON.stringify(text)}. Draft the new plan with set_company_plan, and say in one line what changed.`);
          return answer(res, c);
        }
      }
      // A new bot as the company grows (#673): the Chief suggests one at a time; the owner adds it or dismisses it.
      if (parts[1] === 'suggestion') {
        if (!parts[2] && m === 'PUT') return answer(res, store.suggest((await readBody(req)) || {}));
        if (!owner) return ownersOnly();
        if (!parts[2] && m === 'DELETE') return answer(res, store.dismissSuggestion());
        if (parts[2] === 'add' && !parts[3] && m === 'POST') {
          const s = store.takeSuggestion();
          const bot = B.bots.create({ name: s.name, description: s.description, prompt: s.prompt }, { by });
          B.applyComputerPower(bot).catch((e) => console.error(`[computers] ${e.message}`));
          return answer(res, store.added(bot.id), 201);
        }
      }
      if (parts[1] === 'todos' && !parts[3]) {
        if (!owner) return ownersOnly();
        if (!parts[2] && m === 'POST') {
          const body = (await readBody(req)) || {};
          const bot = typeof body.bot === 'string' && body.bot ? body.bot : null;
          const { company, todo } = store.addTodo({ text: body.text, bot }, known);
          // "@Bot task": the bot gets the task as the owner's message, as from its own chat.
          if (bot) B.askBot(B.bots.get(bot), { prompt: todo.text, text: todo.text, attachments: [], by, chat: true });
          return answer(res, company, 201);
        }
        if (parts[2] && m === 'PUT') return answer(res, store.setTodo(parts[2], (await readBody(req)) || {}));
        if (parts[2] && m === 'DELETE') return answer(res, store.removeTodo(parts[2]));
      }
    } catch (e) {
      if (e.status) return send(res, e.status, { error: e.message, ...(e.state ? { state: e.state } : {}) });
      throw e;
    }
    return send(res, 405, { error: 'Not here' });
  };
}

// The company as the apps get it: with `day`, the day of the 90 it is on (null in setup), and `checkin`, the check-in
// that waits for the owner (null when none does).
const view = (c) => (c ? { ...c, day: store.day(c), checkin: store.checkinOf(c) } : null);

module.exports = { create, store, view, draftPlan };
