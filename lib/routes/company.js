// The Company (#669, lib/company.js, ADR 110): /api/company…. The owner sets it up and runs it; the Chief's tools may
// read it and change its teams and objectives (server.js CHIEF_ROUTES), never start, delete or reset it.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const feed = require('../events');
const companyLib = require('../company');
const teamLib = require('../company-team');

// The feed's event is the company as GET answers it.
const store = companyLib.create({ emit: (data) => feed.emit('company', { company: view(data.company) }) });
const known = (id) => !!B.bots.get(id);

function create({ audit, changeJob }) {
  // The Team step (#671): the Chief's proposal, "Change the team…", Duplicate and Create.
  const team = teamLib.create({
    store, bots: B.bots,
    ask: (prompt, opts) => require('../dresser').askClaude(prompt, opts),
    addJob: (bot, job) => changeJob(bot, 'add', job, { by: 'chief' }),
    apps: async () => (B.connectors?.status().configured ? (await B.connectors.connections()).filter((x) => x.status === 'ACTIVE').map((x) => x.toolkit) : []),
  });
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
      if (parts[1] === 'proposal' && m === 'POST') {
        if (!owner) return ownersOnly();
        if (!parts[2]) return answer(res, await team.propose());
        if (parts[2] === 'chat' && !parts[3]) return answer(res, await team.chat(((await readBody(req)) || {}).text));
        if (parts[2] === 'undo' && !parts[3]) return answer(res, store.undoProposal());
        if (parts[2] === 'duplicate' && !parts[3]) return answer(res, team.duplicate(((await readBody(req)) || {}).bot));
      }
      if (parts[1] === 'start' && !parts[2] && m === 'POST') {
        if (!owner) return ownersOnly();
        const was = store.read()?.phase;
        const c = await team.start();
        if (was !== 'running') logged('started', { bots: c.teams.reduce((n, t) => n + t.bots.length, 0) });
        return answer(res, c);
      }
      if (parts[1] === 'objectives' && parts[2] && !parts[3] && m === 'PUT') return answer(res, store.setObjective(parts[2], (await readBody(req)) || {}));
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

// The company as the apps get it: with `day`, the day of the 90 it is on (null in setup), `facts`, how many things
// the owner told the company (its memory, as the Team step counts it), and `canUndo` for the proposal's last change.
function view(c) {
  if (!c) return null;
  const { proposalUndo, ...shown } = c;
  const facts = c.about.filter((a) => a.answer).length + c.stories.reduce((n, g) => n + g.items.length, 0) + c.never.length
    + [c.goal, c.time, c.swot?.firstTest].filter(Boolean).length + c.sources.length;
  return { ...shown, day: store.day(c), facts, canUndo: (proposalUndo || []).length > 0 };
}

module.exports = { create, store, view };
