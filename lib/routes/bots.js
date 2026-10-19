// The bots: list, make, change and delete one, its chat, its memory and the history of its instructions.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const loginRequests = require('../login-requests');
const asksLib = require('../asks');
const readLib = require('../read');
const messageKeys = require('../message-keys');
const chief = require('../chief');

function create(ctx) {
  const { asks, connectorApprovals, tools, computerRoutes, jobRoutes, keys, withJobViews, attachSkill, asRun } = ctx;
  const dashboard = ctx.board; // the owner's Board (lib/dashboard.js)
  // What each bot's face shows: needs_you (a login request, job or memory change waits for the owner, or the bot
  // asks them something: `asking`, B.asksByBot), working, failed (its last run didn't finish), paused (it has jobs,
  // all switched off) or idle.
  function botStates(bots, asking = B.asksByBot()) {
    const needs = new Set([...loginRequests.pending().map((r) => r.botId), ...B.memory.pending().map((p) => p.botId), ...asks.list().map((a) => a.botId)]);
    const last = B.lastStatuses();
    return Object.fromEntries(bots.map((b) => {
      const jobs = b.jobs || [];
      const state = needs.has(b.id) || asking.has(b.id) || jobs.some((j) => !j.approved || j.change) ? 'needs_you'
        : B.isBotRunning(b.id) ? 'working'
          : B.isBotWaiting(b.id) ? 'waiting' // asked teammates, their answers aren't all in
          : last[b.id] === 'error' ? 'failed'
            : asksLib.paused(b) ? 'paused'
              : 'idle';
      return [b.id, state];
    }));
  }

  // unread, asking: every bot's new replies (B.unreadByBot) and open questions (B.asksByBot), when the caller has
  // them for the whole list.
  function withNextRun(bot, asking = B.asksByBot(), states = botStates([bot], asking), unread = null) {
    const asks = asking.get(bot.id);
    return {
      ...withJobViews(bot),
      nextRunAt: B.nextRun(bot),
      running: B.isBotRunning(bot.id),
      queued: B.queuedOf(bot.id), // the owner's messages that wait for it (ADR 011)
      state: states[bot.id],
      ...(asks ? { asks } : {}), // its open question (docs/api.md, "A bot that asks")
      memoryCount: B.memory.countNotes(bot.id),
      // New replies in its chat (ADR 005): how many, and the run that is the first of them.
      ...(unread ? unread.get(bot.id) || readLib.NOTHING_NEW : B.unreadOfBot(bot.id)),
    };
  }

  // A bot as `by` is handed it. The Chief is handed the open question of a left-out run without its text
  // (B.asksForModel, ADR 016); the owner's apps get it whole: a left-out run stays in the owner's own chat.
  const botFor = (by, bot) => (by === 'chief' && bot.asks ? { ...bot, asks: B.asksForModel(bot.asks) } : bot);
  return async function routes(req, res, url, { parts, m, by, chiefChat }) {
    if (parts[0] === 'bots') {
      const id = parts[1];
      if (!id && m === 'GET') { const all = B.bots.list(); const asking = B.asksByBot(); const states = botStates(all, asking); const unread = B.unreadByBot(); return send(res, 200, all.map((b) => botFor(by, withNextRun(b, asking, states, unread)))); }
      if (!id && m === 'POST') {
        const body = await readBody(req);
        const created = B.bots.create(body, { by, chatId: chiefChat });
        B.applyComputerPower(created).catch((e) => console.error(`[computers] ${e.message}`));
        return send(res, 201, withJobViews(created));
      }
      const bot = id && B.bots.get(id);
      if (!bot) return send(res, 404, { error: 'Bot not found' });
      if (parts[2] === 'connector-actions' && m === 'GET') return send(res, 200, connectorApprovals.list(id));
      if (parts[2] === 'connector-actions' && m === 'DELETE') {
        connectorApprovals.revoke(id, String((await readBody(req)).action || ''));
        return send(res, 200, { ok: true });
      }
      if (!parts[2] && m === 'GET') return send(res, 200, botFor(by, withNextRun(bot)));
      if (!parts[2] && m === 'PUT') {
        const body = await readBody(req);
        const updated = B.bots.update(id, body, { by, chatId: chiefChat });
        if (updated.computerEgress !== bot.computerEgress) await B.computers.reconfigure(id, updated.computerEgress);
        // Editing policy or wording must not turn off a computer the owner started manually.
        if (updated.computer !== bot.computer || updated.computerAlwaysOn !== bot.computerAlwaysOn) {
          B.applyComputerPower(updated).catch((e) => console.error(`[computers] ${e.message}`));
        }
        return send(res, 200, withJobViews(updated));
      }
      if (!parts[2] && m === 'DELETE') {
        if (B.isBotRunning(id)) return send(res, 409, { error: 'Stop its run first, then delete it' });
        // The bot's computer goes with it (installed apps, files, browser logins). Run history is kept.
        B.endComputerHold(id);
        const computer = await B.computers.reset(id);
        if (computer === 'failed') console.warn(`[computers] couldn't erase the computer of deleted bot ${id} (is Docker running?)`);
        const ok = B.bots.remove(id);
        asks.forgetBot(id);
        tools.forgetBot(id, by); // its installed tools go with it
        dashboard.forgetBot(id);
        // So do the skills it wrote, unless you gave them to other bots too.
        const others = B.bots.list();
        const own = B.skills.list().filter((k) => k.createdBy === `bot:${id}` && !others.some((b) => b.skills.includes(k.name)));
        for (const k of own) B.skills.remove(k.name);
        return send(res, 200, { ok, name: bot.name, computer, skillsRemoved: own.length }); // name: what it was called, for whoever says it is gone
      }
      // Its computer: status, logs, details, restart, start, stop and erase (lib/routes/computers.js).
      { const out = await computerRoutes.ofBot(req, res, url, { parts, m, id, bot }); if (out !== NEXT) return out; }
      // Notes other bots left for it, waiting for its next run.
      if (parts[2] === 'inbox' && m === 'GET') return send(res, 200, B.inboxNotes(id));
      // Its jobs (lib/routes/jobs.js).
      { const out = await jobRoutes.ofBot(req, res, url, { parts, m, by, chiefChat, bot }); if (out !== NEXT) return out; }
      // Its memory and the history of its instructions (you can add, edit and remove notes, and undo changes).
      if (parts[2] === 'learning') {
        if (!parts[3] && m === 'GET') return send(res, 200, { ...B.learn.get(id), limits: B.learn.LIMITS });
        const body = await readBody(req);
        if (parts[3] === 'memory' && m === 'POST') {
          if (body.action === 'add') B.learn.addNote(id, body.text, { by: 'you', locked: true, source: 'owner' });
          else if (body.action === 'edit') B.learn.editNote(id, body.id, body.text, { by: 'you', source: 'owner' });
          else if (body.action === 'remove') B.learn.removeNote(id, body.id);
          else return send(res, 400, { error: 'Unknown action' });
          return send(res, 200, B.learn.get(id));
        }
        if (parts[3] === 'undo' && m === 'POST') {
          const c = B.learn.findChange(id, body.changeId);
          if (!c) return send(res, 404, { error: 'Change not found' });
          if (c.field.startsWith('skill:')) {
            // A skill the bot wrote: undoing its creation deletes it; undoing an edit brings the earlier text back.
            const name = c.field.slice(6);
            const k = B.skills.read(name);
            const now = k ? JSON.stringify({ description: k.description, instructions: k.instructions }) : '';
            if (now !== c.after) return send(res, 409, { error: 'That skill has changed since then. Edit it on the Skills page instead.' });
            if (!c.before) {
              for (const b of B.bots.list()) if (b.skills.includes(name)) B.bots.update(b.id, { skills: b.skills.filter((x) => x !== name) });
              B.skills.remove(name);
            } else {
              B.skills.save({ name, ...JSON.parse(c.before) }, { createdBy: `bot:${id}` }); // also brings back one an undo deleted
              if (!k) attachSkill(name, [id]);
            }
            B.learn.recordChange(id, { field: c.field, before: c.after, after: c.before, by: 'you', reason: `Undid a change from ${new Date(c.at).toLocaleString()}` });
          } else {
            if ((bot[c.field] || '') !== c.after) return send(res, 409, { error: 'It has changed again since then. Edit it in the settings instead.' });
            B.bots.update(id, { [c.field]: c.before }, { by: 'you', reason: `Undid a change from ${new Date(c.at).toLocaleString()}` });
          }
          const d = B.learn.get(id);
          // Notes the bot saved in the same run often describe the change; offer to drop them too.
          const relatedNotes = c.runId ? d.memory.filter((n) => n.runId === c.runId) : [];
          return send(res, 200, { ...d, relatedNotes });
        }
      }
      if (parts[2] === 'run' && m === 'POST') {
        const body = await readBody(req);
        // A message sent again with its key was taken already (lib/message-keys.js): its run as it is now, or as it waits.
        const key = messageKeys.read(body.key);
        const where = `bot:${bot.id}`;
        const first = key && keys.taken(where, key);
        if (first) { const ran = B.readMeta(first.runId); return send(res, 200, { ...(ran ? asRun(ran) : B.waitingRun(first.runId) || { id: first.runId }), again: true }); }
        const files = [...(Array.isArray(body.attachments) ? body.attachments : []), ...(by === 'chief' ? B.filesForBot(bot.id, body.files, chief.WORKDIR) : [])];
        // A busy bot starts no second run: the message waits its turn, on disk, under its run's id (ADR 011). With
        // ten of the owner's waiting already this throws (429), and the key is not taken.
        const asked = B.askBot(bot, { prompt: body.prompt || (files.length ? 'Have a look at the attached files.' : undefined), text: typeof body.prompt === 'string' ? body.prompt : '', attachments: files, by, msgKey: key, chat: by === 'you' });
        const run = asked.run || asked.queued;
        if (by === 'chief' && chiefChat) chief.ranFrom(chiefChat, run.id); // the chat whose turn asked for it, until its reply records the run
        // Kept before the answer, in the same step that took the message: the same key arriving meanwhile takes none.
        if (key) try { keys.take(where, key, { runId: run.id }); } catch (e) { console.error(`[runs] ${e.message}`); } // the message was taken: it is answered
        return send(res, 201, run);
      }
      // The owner takes a waiting message back (ADR 011): its text and files, for the message box. The owner's alone:
      // the Chief's tools have no such route (CHIEF_ROUTES).
      if (parts[2] === 'queued' && parts[3] && !parts[4] && m === 'DELETE') {
        const back = B.takeBack(bot.id, parts[3]);
        if (!back) {
          const run = B.readMeta(parts[3]);
          return run?.botId === bot.id ? send(res, 409, { error: 'It has already started.', runId: run.id }) : send(res, 404, { error: 'No such waiting message' });
        }
        // Its key is free again: the same message may be sent anew.
        if (back.msgKey) try { keys.forget(`bot:${bot.id}`, back.msgKey); } catch (e) { console.error(`[runs] ${e.message}`); }
        return send(res, 200, { text: back.text, attachments: back.attachments });
      }
    }
    return NEXT;
  };
}

module.exports = { create };
