// The bots: list, make, change and delete one, its chat, its memory and the history of its instructions.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const loginRequests = require('../login-requests');
const asksLib = require('../asks');
const readLib = require('../read');
const messageKeys = require('../message-keys');
const chief = require('../chief');
const path = require('path');
const { download, viewAsked, sendView } = require('./files');
const { workspaceRoute, filesRoute } = require('./workspace');
const { pagesRoute } = require('./pages');

// A message of the owner that no longer waits: 409 when it started, or was read by the run it was steered into
// (ADR 040), else 404.
function notWaiting(res, bot, id) {
  const run = B.readMeta(id) || B.readMeta(B.steeredInto(id));
  return run?.botId === bot.id ? send(res, 409, { error: 'It has already started.', runId: run.id }) : send(res, 404, { error: 'No such waiting message' });
}

function create(ctx) {
  const { asks, audit, connectorApprovals, tools, computerRoutes, jobRoutes, keys, withJobViews, attachSkill, asRun, store, bitwarden, changeJob } = ctx;
  const dashboard = ctx.board; // the owner's Board (lib/dashboard.js)
  // The owner's messages to a bot at work being sorted now (ADR 106): by where and key, so that the same message sent
  // again waits for it; and the last one of each bot, so that its messages are dealt with in the order sent.
  const sorting = new Map();
  const lastOf = new Map();
  // A message sent again with its key that was taken already: its run as it is now, or as it waits (ADR 040: or the run it was read into).
  const answerAgain = (res, first) => { const ran = B.readMeta(first.runId) || B.readMeta(B.steeredInto(first.runId)); return send(res, 200, { ...(ran ? asRun(ran) : B.waitingRun(first.runId) || { id: first.runId }), again: true }); };
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
      ...(B.computerMove(bot.id) ? { computerMove: B.computerMove(bot.id) } : {}), // its files on their way to its new computer (#556)
      runningCount: B.runsOf(bot.id), // up to three at once (ADR 062): the key says "Working ×2"
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
      bot.computer === 'linux' ? `The account's computer${bot.computerAlwaysOn ? ', always on' : ''}` : bot.computer === 'boat' ? "The account's External Virtual PC, a folder of its own there" : '',
      'Which bots it may message',
      logins.length ? `The Vault entries it may use: ${logins.map((e) => e.name).join(', ')}` : '',
    ].filter(Boolean);
    return { name: B.bots.copyName(bot.name), copies, notCopied: 'Its memory, chats, runs, jobs, Board tiles, files and groups', logins, vaultLocked };
  }

  // A bot as `by` is handed it. The Chief is handed the open question of a left-out run without its text
  // (B.asksForModel, ADR 016); the owner's apps get it whole: a left-out run stays in the owner's own chat.
  // Its lasting grants in connected apps go with it as `alwaysAllowed`, each in the owner's words, for "Always approved"
  // in its settings (#474); none, and it has no such field.
  const botFor = (by, bot) => {
    const grants = connectorApprovals.list(bot.id);
    const out = grants.length ? { ...bot, alwaysAllowed: grants.map((action) => asksLib.grantView(action, B.appName)) } : bot;
    return by === 'chief' && out.asks ? { ...out, asks: B.asksForModel(out.asks) } : out;
  };
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
      // How its runs went (ADR 099): read-only, for the Chief's review and what else reads the ledger.
      if (parts[2] === 'outcomes' && !parts[3] && m === 'GET') {
        const days = url.searchParams.has('days') ? Number(url.searchParams.get('days')) : 7;
        if (!Number.isInteger(days) || days < 1 || days > 90) return send(res, 400, { error: 'days is a whole number from 1 to 90' });
        return send(res, 200, B.outcomesOf(id, days));
      }
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
      // A rule the owner lifted for it for good (ask_override, #253), taken back in its settings. Only the owner.
      if (parts[2] === 'overrides' && parts[3] && !parts[4] && m === 'DELETE') {
        if (by !== 'you') return send(res, 403, { error: 'Only the owner takes back a lifted rule.' });
        const kept = (bot.overrides || []).filter((o) => o.id !== parts[3]);
        if (kept.length === (bot.overrides || []).length) return send(res, 404, { error: 'That lifted rule is no longer there.' });
        const updated = B.bots.update(bot.id, { [B.OVERRIDES]: kept }, { by: 'you' });
        audit('override.revoked', 'you', { bot: bot.id, override: parts[3] });
        return send(res, 200, withJobViews(updated));
      }
      // Its files (#235): what the owner and teammates gave it, kept in its uploads/. The owner lists, pins ("keep in
      // mind"), downloads and deletes them; the Chief lists and deletes them, by name only, never their content.
      if (parts[2] === 'files' && !parts[4]) return filesRoute(req, res, url, { name: parts[3], m, by, key: bot.id, ws: path.join(B.WORKSPACES_DIR, bot.id) });
      // Its workspace (#296): every file in its folder on this server, and in its folder on the account's computer.
      if (parts[2] === 'workspace') return workspaceRoute(req, res, url, { parts, m, by, bot, audit });
      // Its pages (#346): what it saved with save_page, and the job that keeps one up to date.
      if (parts[2] === 'pages') return pagesRoute(req, res, url, { parts, m, by, bot, changeJob });
      if (!parts[2] && m === 'PUT') {
        const { moveFiles, ...body } = (await readBody(req)) || {};
        const updated = B.bots.update(id, body, { by, chatId: chiefChat, moveFiles: moveFiles === true });
        // Its files copied to its new computer, when that was asked for (#556).
        if (B.computerChanged(updated, bot)) B.settleComputerMove(updated, bot, moveFiles === true);
        // Editing policy or wording must not turn off a computer the owner started manually.
        if (B.computerChanged(updated, bot) || updated.computerAlwaysOn !== bot.computerAlwaysOn) {
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
        B.settleComputerMove({ ...bot, computer: 'none' }, bot); // a failed copy of its files goes with it (#556)
        const ok = B.bots.remove(id);
        asks.forgetBot(id);
        require('../projects').dropBot(id); // it leaves its shared projects (#578)
        tools.forgetBot(id, by); // its installed tools go with it
        dashboard.forgetBot(id);
        // So do the skills it wrote, unless you gave them to other bots too.
        const others = B.bots.list();
        const own = B.skills.list().filter((k) => k.createdBy === `bot:${id}` && !others.some((b) => b.skills.includes(k.name)));
        for (const k of own) B.skills.remove(k.name);
        return send(res, 200, { ok, name: bot.name, computer, skillsRemoved: own.length }); // name: what it was called, for whoever says it is gone
      }
      // Its files' copy to its new computer that failed, again (#556). Only the owner.
      if (parts[2] === 'computer' && parts[3] === 'move' && !parts[4] && m === 'POST') {
        if (by !== 'you') return send(res, 403, { error: 'Only the owner tries a copy of its files again.' });
        if (!B.retryComputerMove(id)) return send(res, 409, { error: 'No copy of its files waits to be tried again.' });
        return send(res, 200, { computerMove: B.computerMove(id) });
      }
      // Its computer: status, logs, details, restart, start, stop and erase (lib/routes/computers.js).
      { const out = await computerRoutes.ofBot(req, res, url, { parts, m, id, bot, by, chiefChat, standing, replay }); if (out !== NEXT) return out; }
      // Notes other bots left for it, waiting for its next run.
      if (parts[2] === 'inbox' && m === 'GET') return send(res, 200, B.inboxNotes(id));
      // "Run now" under them (#225): it starts with the notes, or once it is free (`status`: "started" or "queued").
      if (parts[2] === 'inbox' && parts[3] === 'run' && m === 'POST') return send(res, 200, B.runNotes(id));
      // Its jobs (lib/routes/jobs.js).
      { const out = await jobRoutes.ofBot(req, res, url, { parts, m, by, chiefChat, standing, bot }); if (out !== NEXT) return out; }
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
            // A change a card made is undone whole: its main assignment and its rules together (#596).
            const all = B.learn.changesWith(id, c);
            if (all.some((x) => (bot[x.field] || '') !== x.after)) return send(res, 409, { error: 'It has changed again since then. Edit it in the settings instead.' });
            B.bots.update(id, Object.fromEntries(all.map((x) => [x.field, x.before])), { by: 'you', reason: `Undid a change from ${new Date(c.at).toLocaleString()}` });
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
        if (first) return answerAgain(res, first);
        const files = [...(Array.isArray(body.attachments) ? body.attachments : []), ...(by === 'chief' ? B.filesForBot(bot.id, body.files, chief.WORKDIR) : [])];
        // The owner's "/btw" to a bot at work is a quick side question (ADR 063): answered at once, without tools,
        // beside its runs and in none of their places. To a bot that is free, or with files, it is a message as any.
        if (by === 'you' && B.btw.isBtw(body.prompt)) {
          if (B.isBotRunning(bot.id) && !files.length && B.btw.question(body.prompt)) {
            const run = B.askAside(bot, { text: body.prompt });
            if (key) try { keys.take(where, key, { runId: run.id }); } catch (e) { console.error(`[runs] ${e.message}`); }
            return send(res, 201, run);
          }
          body.prompt = B.btw.question(body.prompt) || body.prompt;
        }
        // After the owner's message, the bot may ask again for a login they said no to, if the message asks for it (#611).
        if (by === 'you') asks.ownerWrote(bot.id);
        // The message as any: a busy bot starts no second run past three, the message waits its turn, on disk, under
        // its run's id (ADR 011). With ten of the owner's waiting already this throws (429), and the key is not taken.
        const startAsked = () => {
          const asked = B.askBot(bot, { prompt: body.prompt || (files.length ? 'Have a look at the attached files.' : undefined), text: typeof body.prompt === 'string' ? body.prompt : '', attachments: files, by, msgKey: key, chat: by === 'you', afterWeb: by === 'chief' && !!standing?.()?.web });
          const run = asked.run || asked.queued;
          if (by === 'chief' && chiefChat) chief.ranFrom(chiefChat, run.id); // the chat whose turn asked for it, until its reply records the run
          // Kept before the answer, in the same step that took the message: the same key arriving meanwhile takes none.
          if (key) try { keys.take(where, key, { runId: run.id }); } catch (e) { console.error(`[runs] ${e.message}`); } // the message was taken: it is answered
          return send(res, 201, run);
        };
        // The owner's message to a bot at work may be more for a run of theirs that goes on, or a question about it
        // (ADR 106): a short model call sorts it. Steered, it waits marked for that run; a question is answered as a
        // "/btw" is; anything else, a failure among them, starts as below. The same key arriving meanwhile waits for
        // it, and the bot's next message waits for it too, so that they keep the order sent.
        const sortKey = key && `${where}:${key}`;
        if (sortKey && sorting.has(sortKey)) {
          await sorting.get(sortKey);
          const again = keys.taken(where, key);
          if (again) return answerAgain(res, again);
        }
        const before = lastOf.get(bot.id);
        if (before || (by === 'you' && !files.length && typeof body.prompt === 'string' && B.isBotRunning(bot.id))) {
          let done = () => {};
          const turn = new Promise((resolve) => { done = resolve; });
          lastOf.set(bot.id, turn);
          if (sortKey) sorting.set(sortKey, turn);
          try {
            await before;
            const d = by === 'you' && !files.length && typeof body.prompt === 'string' ? await B.sortMessage(bot, { text: body.prompt, files: files.length }) : { decision: 'new' };
            const sorted = d.decision === 'ask' ? { run: B.askAside(bot, { text: body.prompt }) }
              : d.decision === 'steer' ? B.steerMessage(bot, { runId: d.runId, text: body.prompt, msgKey: key }) : null;
            if (sorted) {
              const run = sorted.run || sorted.queued;
              if (key) try { keys.take(where, key, { runId: run.id }); } catch (e) { console.error(`[runs] ${e.message}`); }
              return send(res, 201, run);
            }
            return startAsked();
          } finally {
            done();
            if (sortKey) sorting.delete(sortKey);
            if (lastOf.get(bot.id) === turn) lastOf.delete(bot.id);
          }
        }
        return startAsked();
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
