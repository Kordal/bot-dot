// The Company (#669, lib/company.js, ADR 110): /api/company…. The owner sets it up and runs it; the Chief's tools may
// read it and change its teams and objectives (server.js CHIEF_ROUTES), never start, delete or reset it.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const feed = require('../events');
const companyLib = require('../company');

const store = companyLib.create({ emit: (data) => feed.emit('company', data) });
const known = (id) => !!B.bots.get(id);

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

// The company as the apps get it: with `day`, the day of the 90 it is on (null in setup).
const view = (c) => (c ? { ...c, day: store.day(c) } : null);

module.exports = { create, store, view };
