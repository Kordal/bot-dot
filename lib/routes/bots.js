// The bots: list, make, change and delete one, its chat, its memory and the history of its instructions.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const loginRequests = require('../login-requests');
const asksLib = require('../asks');
const readLib = require('../read');
const messageKeys = require('../message-keys');
const chief = require('../chief');
const path = require('path');
const { download } = require('./files');

// A message of the owner that no longer waits: 409 when it started, or was read by the run it was steered into
// (ADR 040), else 404.
function notWaiting(res, bot, id) {
  const run = B.readMeta(id) || B.readMeta(B.steeredInto(id));
  return run?.botId === bot.id ? send(res, 409, { error: 'It has already started.', runId: run.id }) : send(res, 404, { error: 'No such waiting message' });
}

function create(ctx) {
  const { asks, connectorApprovals, tools, computerRoutes, jobRoutes, keys, withJobViews, attachSkill, asRun, store, bitwarden } = ctx;
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

  // What "Duplicate" copies of a bot (#227), as the confirmation lists it: the same lines on the web and in Android.
  // logins: the Vault entries shared with it, which the copy may use too. vaultLocked: Bitwarden is locked, so they
  // can't be read (or shared) now.
  function copyPlan(bot) {
    const vaultLocked = !!bitwarden?.configured() && !bitwarden.unlocked();
    const logins = vaultLocked ? [] : store().list().filter((e) => (e.allowedBots || []).includes(bot.id));
    const copies = [
      'Its emoji and hat, in another colour',
      'Its main assignment, rules and description',
      'Its tools, permission mode, model and reasoning',
      bot.skills.length ? `Its skills: ${bot.skills.join(', ')}` : '',
      bot.connectors.length ? `Its connected apps: ${bot.connectors.join(', ')}` : '',
      bot.computer === 'linux' ? `The account's computer${bot.computerAlwaysOn ? ', always on' : ''}` : '',
      'Which bots it may message',
      logins.length ? `The Vault entries it may use: ${logins.map((e) => e.name).join(', ')}` : '',
    ].filter(Boolean);
    return { name: B.bots.copyName(bot.name), copies, notCopied: 'Its memory, chats, runs, jobs, Board tiles, files and groups', logins, vaultLocked };
  }

  // A bot as `by` is handed it. The Chief is handed the open question of a left-out run without its text
  // (B.asksForModel, ADR 016); the owner's apps get it whole: a left-out run stays in the owner's own chat.
  const botFor = (by, bot) => (by === 'chief' && bot.asks ? { ...bot, asks: B.asksForModel(bot.asks) } : bot);
  return async function routes(req, res, url, { parts, m, by, chiefChat, standing, replay }) {
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
      // "Duplicate" (#227): what a copy would get, then the copy. The owner's copy may use the original's Vault
      // entries, as if shared by hand in the Vault; the Chief's gets none (only the owner shares an entry), and
      // what it may not give waits on a card as for create_bot.
      if (parts[2] === 'duplicate' && !parts[3] && m === 'GET') {
        const { logins, ...plan } = copyPlan(bot);
        return send(res, 200, { ...plan, logins: logins.map((e) => e.name) });
      }
      if (parts[2] === 'duplicate' && !parts[3] && m === 'POST') {
        const body = (await readBody(req)) || {};
        const { logins, vaultLocked } = copyPlan(bot);
        if (by === 'you' && vaultLocked) return send(res, 423, { error: 'Bitwarden is locked. Unlock it, so the copy can use the same Vault entries, then duplicate again.' });
        const made = B.bots.duplicate(bot.id, { name: body.name, by, chatId: chiefChat });
        // Shared one by one: an entry that fails (Bitwarden locked meanwhile) is named, and the copy stays.
        const shared = []; const notShared = [];
        for (const e of logins) {
          if (by !== 'you') { notShared.push(e.name); continue; }
          try { await store().update(e.id, { allowedBots: [...new Set([...e.allowedBots, made.id])] }); shared.push(e.name); } catch (err) { console.error(`[vault] ${err.message}`); notShared.push(e.name); }
        }
        B.applyComputerPower(made).catch((e) => console.error(`[computers] ${e.message}`));
        return send(res, 201, { ...withJobViews(made), ...(by === 'you' ? { logins: shared } : {}), ...(notShared.length ? { loginsNotShared: notShared } : {}), ...(vaultLocked ? { vaultLocked } : {}) });
      }
      // Its files (#235): what the owner and teammates gave it, kept in its uploads/. The owner lists, pins ("keep in
      // mind"), downloads and deletes them; the Chief lists and deletes them, by name only, never their content.
      if (parts[2] === 'files' && !parts[4]) {
        const ws = path.join(B.WORKSPACES_DIR, bot.id);
        const listed = () => ({ files: B.botFiles.list(bot.id, ws).map((f) => (by === 'chief' ? { file: f.file, name: f.name, size: f.size, at: f.at, pinned: f.pinned } : f)), maxPinned: B.botFiles.MAX_PINNED });
        if (!parts[3] && m === 'GET') return send(res, 200, listed());
        // One file, by its name in uploads/ (the last part of `file`).
        let name = '';
        try { name = decodeURIComponent(parts[3] || ''); } catch { /* no such file */ }
        const one = () => B.botFiles.find(bot.id, ws, `uploads/${name}`);
        if (name && m === 'GET' && by === 'you') { const f = one(); return download(res, path.join(ws, f.file), f.name); }
        if (name && m === 'PUT' && by === 'you') {
          const body = (await readBody(req)) || {};
          B.botFiles.pin(bot.id, ws, one().file, { pinned: body.pinned !== false });
          return send(res, 200, listed());
        }
        if (name && m === 'DELETE') { B.botFiles.remove(bot.id, ws, one().file); return send(res, 200, listed()); }
        return send(res, by === 'you' ? 405 : 403, { error: by === 'you' ? 'Not here' : 'Only the owner opens or pins a bot\'s files.' });
      }
      if (!parts[2] && m === 'PUT') {
        const body = await readBody(req);
        const updated = B.bots.update(id, body, { by, chatId: chiefChat });
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
        // Its screen on the account's computer ends and its number is free again (#105); its folder there stays.
        await B.computers.free(id);
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
      { const out = await computerRoutes.ofBot(req, res, url, { parts, m, id, bot, by, chiefChat, standing, replay }); if (out !== NEXT) return out; }
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
        // A message the owner steered into a run that read it (ADR 040) answers that run.
        if (first) { const ran = B.readMeta(first.runId) || B.readMeta(B.steeredInto(first.runId)); return send(res, 200, { ...(ran ? asRun(ran) : B.waitingRun(first.runId) || { id: first.runId }), again: true }); }
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
          return notWaiting(res, bot, parts[3]);
        }
        // Its key is free again: the same message may be sent anew.
        if (back.msgKey) try { keys.forget(`bot:${bot.id}`, back.msgKey); } catch (e) { console.error(`[runs] ${e.message}`); }
        return send(res, 200, { text: back.text, attachments: back.attachments });
      }
      // The owner steers a waiting message into the run that is going (ADR 040): it reads it at its next tool call.
      // The owner's alone, as Take back: the Chief's tools have no such route (CHIEF_ROUTES).
      if (parts[2] === 'queued' && parts[3] && parts[4] === 'steer' && !parts[5] && m === 'POST') {
        let steered;
        try { steered = B.steer(bot.id, parts[3]); } catch (e) { if (e.status === 409) return send(res, 409, { error: e.message }); throw e; }
        if (steered) return send(res, 200, steered);
        return notWaiting(res, bot, parts[3]);
      }
    }
    return NEXT;
  };
}

module.exports = { create };
