// Groups and their chat (ADR 018, ADR 020): make, rename and change one, write in it, stop it, its cards.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const loginRequests = require('../login-requests');
const { groupChange, GROUP_SAY } = require('../chief-tools'); // the Chief's words for a group
const messageKeys = require('../message-keys');

function create(ctx) {
  const { asks, keys, runOfAsk, askedOf, asRun } = ctx;
  const dashboard = ctx.board; // the owner's Board (lib/dashboard.js)
  // A take back of a message in a group whose line ended without a turn: every member was paused, deleted or out of
  // the group as its turn came, or the owner stopped each turn while it waited (lib/group-chat.js takeBack). Nothing
  // of it started, and nothing is left to take back.
  const NOBODY_TOOK_A_TURN = 'It is over, and nobody took a turn on it: its members were paused or gone, or you stopped their turns. Send it again when one can answer.';
  // The cards that belong to a group, oldest first, for the end of its chat (GET /api/group-chats/:id/chat): each
  // says where an app finds it whole. kind 'ask' (GET /api/asks), 'login' (a login request), 'memory' (a waiting
  // memory change), 'job' and 'tile' (what waits of a job or a Board tile); id: its id there. guarded: for an app
  // that asks for guarded memory changes (?guarded=1), as the list of them is: another app is handed none.
  function cardsOfGroup(groupId, { guarded = false } = {}) {
    const here = (runId) => !!runId && B.groupOfRun(runId) === groupId;
    const card = (kind, id, botId, runId, at) => ({ kind, id, botId: botId || null, runId, at });
    const out = [
      ...asks.list().filter((a) => here(runOfAsk(a))).map((a) => card('ask', a.id, a.botId, runOfAsk(a), a.at)),
      ...loginRequests.pending().filter((r) => here(r.runId)).map((r) => card('login', r.id, r.botId, r.runId, r.createdAt)),
      ...B.memory.pending().filter((x) => here(x.runId) && (guarded || !x.guarded)).map((x) => card('memory', x.id, x.botId, x.runId, x.at)),
      ...B.bots.list().flatMap((b) => (b.jobs || []).map((j) => [j, askedOf(j)]).filter(([, asked]) => here(asked?.runId)).map(([j, asked]) => card('job', j.id, b.id, asked.runId, asked.at))),
      ...dashboard.pending().map((t) => [t, askedOf(dashboard.get(t.id) || t)]).filter(([, asked]) => here(asked?.runId)).map(([t, asked]) => card('tile', t.id, t.bot, asked.runId, asked.at)),
    ];
    return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }

  // A group as the apps are handed it: its record, and what its chat holds now (docs/api.md, Groups): its new
  // replies, its newest reply with its bot's name, and the members at work in it.
  const groupFor = (group) => (group ? { ...group, ...B.groupChat.live(group.id) } : group);
  return async function routes(req, res, url, { parts, m, by, standing }) {
    // Groups: one chat with two to six bots (lib/groups.js, ADR 018). The routes are named apart from /api/groups,
    // which is the category's. The Chief's tools may list the groups, make one, rename one and change its members
    // (CHIEF_ROUTES), through these routes and under their refusals:
    // - only in a turn the owner started, as for memory (ADR 017): the turn that is going in the chat the call names.
    //   A call from a turn botdot started, from a look or from no turn at all makes and changes nothing;
    // - a name and members, nothing else: a group's place in the list stays the owner's, and so does deleting it;
    // - it is handed a group's name and its members' names (groupForChief), nothing of its chat, and with what it
    //   made or changed `say`, the sentence to pass on, and `chip`, the line under its reply (lib/chief-tools.js).
    if (parts[0] === 'group-chats' && !parts[2]) {
      const id = parts[1];
      const asChief = by === 'chief';
      const names = asChief ? Object.fromEntries(B.bots.list().map((b) => [b.id, b.name])) : null;
      const groupForChief = (g) => ({ id: g.id, name: g.name, members: g.members.map((botId) => ({ id: botId, name: names[botId] || botId })), category: g.category });
      const answer = (g, before) => (asChief ? { ...groupForChief(g), ...(before === undefined ? {} : groupChange(before, g, names)) } : groupFor(g));
      if (asChief && m !== 'GET' && standing()?.startedBy !== 'owner') return send(res, 403, { error: GROUP_SAY.notNow });
      if (!id && m === 'GET') return send(res, 200, B.groups.list().map((g) => answer(g)));
      if (!id && m === 'POST') {
        const body = await readBody(req);
        return send(res, 201, answer(B.groups.create(asChief ? { name: body?.name, members: body?.members } : body), null));
      }
      const group = id && B.groups.get(id);
      if (!group) return send(res, 404, { error: 'Group not found' });
      if (m === 'GET') return send(res, 200, answer(group));
      if (m === 'PUT') {
        const body = await readBody(req);
        if (!asChief) return send(res, 200, groupFor(B.groups.update(id, body)));
        const change = Object.fromEntries(['name', 'members'].filter((k) => body && typeof body === 'object' && k in body).map((k) => [k, body[k]]));
        if (!Object.keys(change).length) return send(res, 400, { error: GROUP_SAY.nothing });
        return send(res, 200, answer(B.groups.update(id, change), group));
      }
      // Deleting a group deletes no bot and no run: its members' turns stay their own past runs. The owner's alone.
      if (m === 'DELETE') return send(res, 200, { ok: B.groups.remove(id), name: group.name });
    }
    // A group's chat (lib/group-chat.js, ADR 019): the owner writes once and the botdot server gives the turns.
    if (parts[0] === 'group-chats' && parts[2]) {
      const id = parts[1];
      if (!B.groups.get(id)) return send(res, 404, { error: 'Group not found' });
      const where = `group:${id}`;
      // The chat in pages: the owner's messages and the replies, oldest first, the members at work and what waits.
      if (parts[2] === 'chat' && !parts[3] && m === 'GET') {
        const page = B.groupChat.chat(id, { limit: url.searchParams.get('limit'), before: url.searchParams.get('before') });
        const items = page.items.map((x) => { if (x.type !== 'reply') return x; const run = B.readMeta(x.id); return run ? { ...x, run: asRun(run) } : null; }).filter(Boolean);
        // cards: what waits for the owner from a turn in this group, for the end of the chat (ADR 020).
        return send(res, 200, { ...page, items, cards: cardsOfGroup(id, { guarded: url.searchParams.get('guarded') === '1' }) });
      }
      // The owner writes in the group. A message sent again with its key was taken already (lib/message-keys.js).
      if (parts[2] === 'messages' && !parts[3] && m === 'POST') {
        const body = await readBody(req);
        const key = messageKeys.read(body?.key);
        const first = key && keys.taken(where, key);
        if (first) return send(res, 200, { ...(B.groupChat.get(id, first.messageId) || { id: first.messageId }), again: true });
        // With ten of the owner's messages waiting for one of its members this throws (429), and the key is not taken.
        const message = B.groupChat.send(id, { text: body?.text, key, attachments: Array.isArray(body?.attachments) ? body.attachments : [] });
        // "Go on", typed while the group is stopped at the limit, is no message: its lines go on (ADR 019). Its key
        // is taken with a line that went on, so that the same words sent again are not a message after all.
        if (key) try { keys.take(where, key, { messageId: message.wentOn ? message.messages[0].id : message.id }); } catch (e) { console.error(`[groups] ${e.message}`); } // the message was taken: it is answered
        if (message.wentOn) return send(res, 200, { ok: true, wentOn: true, messages: message.messages });
        return send(res, 201, message);
      }
      // The owner takes a message back, while none of its turns has started: its text, for the message box.
      if (parts[2] === 'messages' && parts[3] && !parts[4] && m === 'DELETE') {
        const back = B.groupChat.takeBack(id, parts[3]);
        if (!back) return send(res, 404, { error: 'No such message' });
        if (back === 'started') return send(res, 409, { error: 'It has already started.' });
        // Its line is over and no member had a turn: not a 409, which the apps read as "it has started".
        if (back === 'skipped') return send(res, 410, { error: NOBODY_TOOK_A_TURN });
        // Its key is free again: the same message may be sent anew.
        if (back.key) try { keys.forget(where, back.key); } catch (e) { console.error(`[groups] ${e.message}`); }
        return send(res, 200, { text: back.text, attachments: back.attachments });
      }
      // "Stop all": every run of the group at work is ended by the owner, and the turns behind them never start.
      if (parts[2] === 'stop' && !parts[3] && m === 'POST') return send(res, 200, { ok: true, ...B.groupChat.stopAll(id) });
      // "Go on": the lines that stopped at the limit go on, each counting from one (ADR 019). With `messageId`,
      // that line alone.
      if (parts[2] === 'go-on' && !parts[3] && m === 'POST') {
        const body = await readBody(req);
        const messages = B.groupChat.goOn(id, typeof body?.messageId === 'string' ? body.messageId : null);
        if (!messages) return send(res, 409, { error: 'The group is not stopped.' });
        return send(res, 200, { ok: true, wentOn: true, messages });
      }
    }
    // Rename a category (the folder of the list; `group` on a bot), or remove it (to = ''): its bots and the groups
    // in it move with it.
    if (parts[0] === 'groups' && parts[1] === 'rename' && m === 'POST') {
      const { from, to } = await readBody(req);
      const name = String(to || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      let moved = 0;
      // In their order, so they keep it (each goes last in its new group).
      const members = B.bots.list().filter((b) => b.group && b.group === String(from || '')).sort((a, b) => (a.order || Infinity) - (b.order || Infinity));
      for (const b of members) { B.bots.update(b.id, { group: name }); moved++; }
      B.groups.renameCategory(from, name);
      return send(res, 200, { ok: true, moved });
    }
    return NEXT;
  };
}

module.exports = { create };
