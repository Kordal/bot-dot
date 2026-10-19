// A bot's own tools in a run (/api/self/session): identified by the run's key, never by the owner's session.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const chief = require('../chief');
const asksLib = require('../asks');
const learningWords = require('../learning'); // what a chip, a memory card and a memory tool's answer say

function create(ctx) {
  const { tools, connectedApps, asks, readyForSecrets, store, askSkill, jobView, changeJob, auditMemory, chiefHas,
    writeSkill } = ctx;
  const dashboard = ctx.board; // the owner's Board (lib/dashboard.js)
  return async function routes(req, res, url, { parts, m }) {
    // A bot learning during its run (its own memory and instructions only), identified by the run token.
    if (parts[0] === 'self' && parts[1] === 'session' && m === 'POST') {
      const session = B.runSession(req.headers['x-run-token']);
      if (!session) return send(res, 403, { ok: false, error: 'This run may not change its bot.' });
      const bot = B.bots.get(session.botId);
      if (!bot) return send(res, 403, { ok: false, error: 'This run may not change its bot.' });
      const body = await readBody(req);
      try {
        if (parts[2] === 'notify') return send(res, 200, B.notifyOwner(session.runId, body));
        // Messaging teammates: who it may message, and sending (checked in bots.js).
        if (parts[2] === 'teammates') return send(res, 200, { ok: true, teammates: B.teammatesOf(session) });
        // A suggestion for the Chief: it waits in a new Chief chat until the owner answers it.
        if (parts[2] === 'chief') {
          const chat = chief.suggest(bot, { title: body.title, text: body.text });
          return send(res, 200, { ok: true, chatId: chat.id });
        }
        // A tool it lacks: it asks the Chief, who asks the owner. A bot never puts that card in Needs you itself.
        if (parts[2] === 'tool') return send(res, 200, { ok: true, ...(await tools.request({ bot, session, name: body.name, reason: body.reason })) });
        // A connected app it wasn't given: the same, through the Chief (lib/connected-apps.js).
        if (parts[2] === 'app') return send(res, 200, { ok: true, ...connectedApps.request({ bot, session, app: body.app, reason: body.reason }) });
        // Asking the owner for what it can't give itself: a permission, or a skill from a link. It waits in Needs you.
        if (parts[2] === 'ask') {
          if (body.kind === 'permission') {
            const perm = asksLib.PERMISSIONS[body.permission];
            if (!perm) throw new Error(`Ask for one of: ${Object.keys(asksLib.PERMISSIONS).join(', ')}.`);
            if (perm.tools.every((t) => bot.allowedTools.includes(t))) throw new Error('You already have that permission.');
            if (asks.declinedRecently(bot.id, body.permission) && !asks.changeHolds(bot.id, body.permission, bot)) throw new Error("The owner said no to this recently. Don't ask again; do what you can without it.");
            asks.add({ kind: 'permission', botId: bot.id, permission: body.permission, reason: body.reason }, { runId: session.runId, bot });
            return send(res, 200, { ok: true });
          }
          if (body.kind === 'skill') {
            const a = await askSkill({ url: body.url, botId: bot.id, forBots: [bot.id], reason: body.reason, runId: session.runId });
            return send(res, 200, { ok: true, skill: a.skill.name });
          }
          throw new Error('Ask for a permission or a skill.');
        }
        // Suggesting a tile for the owner's Board: it waits there, and in this bot's chat, for Add.
        if (parts[2] === 'suggest') {
          const tile = body.tile && typeof body.tile === 'object' ? body.tile : {};
          for (const src of [tile.read, tile.do, tile.turnOn, tile.turnOff]) {
            if (src?.type !== 'http') continue;
            await readyForSecrets(bot.id);
            const creds = store().credentials(bot.id, String(src.login || '')); // throws when it may not use that login
            creds.password = null;
          }
          const x = dashboard.suggest(bot.id, tile, body.reason, { runId: session.runId });
          return send(res, 200, { ok: true, id: x.id });
        }
        // Filling its own tiles on the Board (those that don't read their value themselves).
        if (parts[2] === 'tile') {
          const mine = dashboard.pushable(bot.id);
          const t = mine.find((x) => x.id === body.id || x.title.toLowerCase() === String(body.id || body.title || '').toLowerCase());
          if (!t) throw new Error(mine.length ? `Your tiles: ${mine.map((x) => `"${x.title}" (${x.id}, ${x.kind})`).join(', ')}.` : 'You have no tiles to fill on the Board.');
          dashboard.setValue(t.id, body.value, { botId: bot.id });
          return send(res, 200, { ok: true });
        }
        // A file for the owner, from its workspace: shown under its reply.
        if (parts[2] === 'file') return send(res, 200, { ok: true, file: B.attachFile(session.runId, body.path), ...(B.replyPrivate(session.runId) ? { replyPrivate: true } : {}) });
        if (parts[2] === 'message') return send(res, 200, { ok: true, ...B.sendBotMessage(session, { to: body.to, text: body.message, priority: body.priority === true, files: Array.isArray(body.files) ? body.files : [] }) });
        // Looking things up: its own notes, the shared memory and its own past runs (never other bots' runs).
        if (parts[2] === 'recall') {
          const where = body.in === 'notes' ? ['notes'] : body.in === 'runs' ? ['runs'] : ['notes', 'runs'];
          // Removed notes, for bringing one back: only a run the owner started is handed them (ADR 016).
          // A page of it: `limit` results (8, at most 25) from `offset`, with `total`, how many there are in all.
          const limit = Math.min(Math.max(1, Math.floor(Number(body.limit)) || 8), 25);
          const offset = Math.max(0, Math.floor(Number(body.offset)) || 0);
          if (body.removed === true) {
            if (B.runStanding(session.runId)?.startedBy !== 'owner') return send(res, 200, { ok: true, results: [], total: 0, offset, limit, say: 'Removed notes are listed only in a run the owner started. The owner can ask you for them in a message.' });
            const owners = [bot.id, B.SHARED_MEMORY];
            return send(res, 200, { ok: true, results: B.memory.removedOf(owners, { query: body.query, limit, offset }).map((v) => ({ kind: 'removed', ...v })), total: B.memory.countRemoved(owners, { query: body.query }), offset, limit });
          }
          // Without a query: every note of its own and every shared one, then its past runs, in a fixed order (memory.js page).
          const listing = !String(body.query || '').trim();
          const found = await B.memory.page({ query: body.query, notesOf: [bot.id, B.SHARED_MEMORY], runsOf: [bot.id], kinds: where, days: Number(body.days) || 0, limit, offset, history: body.history === true });
          if (!listing) B.memory.touch(found.results.filter((r) => r.kind === 'note').map((r) => r.id)); // a note that was looked for was used; one that was listed was not
          return send(res, 200, { ok: true, results: found.results.filter((r) => r.kind !== 'run' || r.runId !== session.runId), total: found.total, offset, limit }); // not the run that's asking
        }
        if (parts[2] === 'run') {
          const r = B.memory.getRun(String(body.run || ''));
          if (!r || r.bot_id !== bot.id || B.leftOut(r)) return send(res, 200, { ok: false, error: 'No past run of yours with that number.' });
          // In full, from the run's own file; a very long reply comes in parts.
          const full = B.fullRun(r.run_id);
          const from = Math.max(0, Math.floor(Number(body.from)) || 0);
          const PART = 20_000;
          const more = Math.max(0, full.reply.length - from - PART);
          return send(res, 200, { ok: true, run: { run: r.run_id, at: r.at, trigger: r.trigger, job: r.job, status: r.status, asked: full.asked, reply: full.reply.slice(from, from + PART), steps: r.steps, learned: r.learned, ...(from ? { from } : {}), ...(more ? { more, next: from + PART } : {}) } });
        }
        // Its own scheduled jobs. Anything it adds or changes waits for the owner's approval.
        if (parts[2] === 'jobs') {
          if (body.action === 'list') return send(res, 200, { ok: true, jobs: (bot.jobs || []).map(jobView) });
          if (!['add', 'update', 'remove'].includes(body.action)) return send(res, 400, { ok: false, error: 'Unknown action' });
          const before = (bot.jobs || []).find((j) => j.id === body.id);
          const { job } = changeJob(bot, body.action, body, { by: 'bot', runId: session.runId });
          const j = job || before;
          const verb = { add: 'Added', update: 'Changed', remove: 'Removed' }[body.action];
          const waits = !!job && (!job.approved || !!job.change);
          B.noteLearned(session.runId, { kind: 'job', text: `${verb} job ${j?.name || ''}${job && (job.change || job).kind === 'script' ? ' (a script, no AI)' : ''}${waits ? `, ${learningWords.WAITS}` : ''}` });
          return send(res, 200, { ok: true, job, needsApproval: waits });
        }
        if (parts[2] === 'memory') {
          const SH = B.SHARED_MEMORY;
          const M = B.memory;
          const { SAY } = learningWords;
          // A note it may touch: one of its own, or a shared one.
          const noteOf = (id) => { const n = M.getNote(String(id ?? '')); return n && (n.owner === bot.id || n.owner === SH) ? n : null; };
          const none = () => send(res, 200, { ok: false, error: `No note with id ${body.id}` });
          const who = (target) => (target === SH ? `bot:${bot.id}` : 'bot');
          // Where this run stands (bots.js runStanding, ADR 015): who started it and what it has read so far. The
          // server alone decides it: nothing in the request does. A run it cannot place counts as having read anything.
          const run = B.runStanding(session.runId) || { startedBy: null, outside: ['unknown'], fromOthers: true, waits: true };
          // Who says what this call saves: the owner, in a run they started that has read nothing outside; otherwise
          // the bot, or the bot after outside content.
          const clean = run.startedBy === 'owner' && !run.outside.length;
          const source = run.outside.length ? 'outside' : clean ? 'owner' : 'bot';
          // What the owner said changes only when the owner asks: at once in such a run, never from a job's run or the
          // review, and from any other run on a card (a guarded change).
          const guard = (n) => (n.source !== 'owner' || clean ? 'free' : ['job', 'review'].includes(run.startedBy) ? 'refused' : 'guarded');
          const refused = (n) => send(res, 200, { ok: true, result: 'refused', say: SAY.refused(n), note: n });
          // What the run learned is kept as a kind and a note's id, never a text (ADR 016): the chip is put together
          // when the run is read (asRun).
          const learned = (item) => B.noteLearned(session.runId, item);
          const idsOf = (list) => list.map((n) => n.id);
          // The change waits for the owner: a guarded one, or one to the shared memory, which reaches every bot,
          // after the run read outside content.
          const waits = (action, target, extra, guarded) => {
            const p = M.propose({ action, owner: target, by: who(target), runId: session.runId, botId: bot.id, source, guarded, ...extra });
            learned({ kind: 'memory-pending', pending: p.id, action, ...(p.guarded ? { guarded: true } : {}), ...(p.noteId ? { id: p.noteId } : {}) });
            return send(res, 200, { ok: true, result: 'waits', say: action === 'erase' ? SAY.forgetWaits(p) : SAY.waits(p), id: p.id });
          };
          if (body.action === 'add') {
            const target = body.scope === 'shared' ? SH : bot.id;
            const wanted = body.pin !== false;
            if (target === SH && run.waits) return waits('add', target, { text: body.text, topic: body.topic, pinned: wanted, until: body.until }, false);
            const r = M.addNote(target, body.text, { by: who(target), runId: session.runId, topic: body.topic, pinned: wanted, source, similarIn: [bot.id, SH], until: body.until });
            if (r.duplicate) return send(res, 200, { ok: true, result: 'already', say: SAY.already(r.note), note: r.note }); // no second note, no chip
            learned({ kind: target === SH ? 'memory-shared' : 'memory', id: r.note.id, what: 'add', unpinned: idsOf(r.unpinned), ...(wanted ? {} : { wanted: false }) });
            return send(res, 200, { ok: true, result: 'saved', say: SAY.saved(r.note, { unpinned: r.unpinned, wanted, similar: r.similar }), note: r.note, unpinned: r.unpinned, similar: r.similar });
          }
          // Forget (ADR 016): erase the notes named, with their history, and leave out the runs named, the runs that
          // wrote those notes and this run, which holds the request. At once only in a run the owner started that
          // has read nothing outside; anywhere else nothing is erased and it waits for the owner on a card.
          if (body.action === 'forget') {
            const list = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => String(x ?? '').trim()).filter(Boolean))].slice(0, 50);
            // A note it may name: one of its own or a shared one, a removed one too. A run: one of its own.
            const mine = (id) => { const n = M.getNote(id) || M.removedNote(id); return !!n && (n.owner === bot.id || n.owner === SH); };
            const ownRun = (id) => (B.readMeta(id)?.botId || M.getRun(id)?.bot_id) === bot.id;
            const notes = list(body.notes).filter(mine);
            const runs = list(body.runs).filter((id) => id !== session.runId && ownRun(id));
            const unknown = [...list(body.notes).filter((id) => !notes.includes(id)), ...list(body.runs).filter((id) => !runs.includes(id) && id !== session.runId)];
            if (!notes.length && !runs.length) return send(res, 200, { ok: false, error: `Nothing to forget: name the notes by their [id] and your past runs by their number, from recall.${unknown.length ? ` Not yours, or not found: ${unknown.join(', ')}.` : ''}` });
            if (!clean) return waits('erase', bot.id, { notes, runs, reason: body.reason }, true);
            // What still matches is searched by the bot's words, or by the words of the notes it had erased.
            const about = String(body.about || '').trim() || notes.map((id) => (M.getNote(id) || M.removedNote(id))?.text || '').join(' ');
            const done = B.forget({ notes, runs: [...runs, session.runId] });
            auditMemory('memory.forgotten', bot.id, { notes: done.erased, runs: done.leftOut.length, bot: bot.id });
            const still = M.stillMatching({ about, owners: [bot.id, SH], runsOf: [bot.id], not: [session.runId], waitingBy: bot.id }); // another bot's waiting change is named without its text
            learned({ kind: 'forgot', count: done.erased.length, runs: done.leftOut.length });
            return send(res, 200, { ok: true, result: 'forgotten', say: `${SAY.forgot({ ...done, still })}${unknown.length ? `\nNot yours, or not found, and left as they are: ${unknown.join(', ')}.` : ''}`, erased: done.erased.length, leftOut: done.leftOut, still });
          }
          // A removed note comes back, in a run the owner started (ADR 016).
          if (body.action === 'restore') {
            const was = M.removedNote(String(body.id ?? ''));
            if (run.startedBy !== 'owner') return send(res, 200, { ok: true, result: 'refused', say: 'Not done: a removed note is brought back only in a run the owner started. The owner can ask you for it in a message.' });
            if (!was || (was.owner !== bot.id && was.owner !== SH)) return send(res, 200, { ok: false, error: `No removed note with id ${body.id}. recall with "removed": true lists those that can be brought back.` });
            const { note, unpinned } = M.restoreNote(was.vid, { by: who(was.owner) });
            // The same sentence was saved again meanwhile: that note stands, and nothing was brought back.
            if (note.id !== was.noteId) return send(res, 200, { ok: true, result: 'already', say: `Nothing to bring back: the same note is already there as [${note.id}].`, note });
            // A pinned note that comes back into a full pinned set unpins another: the answer and the chip name it (ADR 015).
            learned({ kind: 'memory-restored', id: note.id, unpinned: idsOf(unpinned) });
            return send(res, 200, { ok: true, result: 'saved', say: SAY.restored(note, { unpinned }), note, unpinned });
          }
          if (body.action === 'edit') {
            const n = noteOf(body.id);
            if (!n) return none();
            const g = guard(n);
            if (g === 'refused') return refused(n);
            const change = { noteId: n.id, text: body.text ?? n.text, topic: body.topic, reason: body.reason, until: body.until };
            if (g === 'guarded') return waits('edit', n.owner, change, true);
            if (n.owner === SH && run.waits) return waits('edit', n.owner, change, false);
            const r = M.changeNote(n.owner, n.id, body.text, { by: who(n.owner), topic: body.topic, runId: session.runId, reason: body.reason, source, until: body.until });
            if (r.unchanged) return send(res, 200, { ok: true, result: 'already', say: `Note [${n.id}] already says that; nothing changed.`, note: r.note });
            learned({ kind: n.owner === SH ? 'memory-shared' : 'memory', id: r.note.id, what: 'edit', unpinned: idsOf(r.unpinned.filter((x) => x.id !== r.note.id)), ...(r.unpinned.some((x) => x.id === r.note.id) ? { left: true } : {}) });
            return send(res, 200, { ok: true, result: 'saved', say: SAY.updated(r.note, { unpinned: r.unpinned }), note: r.note, unpinned: r.unpinned });
          }
          if (body.action === 'remove') {
            const n = noteOf(body.id);
            if (!n) return none();
            const g = guard(n);
            if (g === 'refused') return refused(n);
            if (g === 'guarded') return waits('remove', n.owner, { noteId: n.id, reason: body.reason }, true);
            if (n.owner === SH && run.waits) return waits('remove', n.owner, { noteId: n.id, reason: body.reason }, false);
            const gone = M.removeNote(n.owner, n.id, { by: who(n.owner), reason: body.reason });
            learned({ kind: 'memory-removed', id: gone.id });
            return send(res, 200, { ok: true, result: 'saved', say: SAY.removed(gone) });
          }
          if (body.action === 'pin') {
            const n = noteOf(body.id);
            if (n?.owner === SH) return send(res, 200, { ok: false, error: 'Only the owner pins or unpins shared notes.' });
            if (!n) return none();
            if (n.pinLocked && !body.pin) return send(res, 200, { ok: false, error: 'The owner pinned this note; leave it pinned.' });
            // What the owner said is never unpinned by itself: a bot unpins it only when the owner asks, as for a change.
            if (!body.pin && n.pinned && guard(n) !== 'free') return send(res, 200, { ok: true, result: 'refused', say: `Not done: note [${n.id}] is what the owner said, so it stays pinned. Only the owner has it unpinned, by telling you in chat.`, note: n });
            const r = M.pinNote(n.id, !!body.pin, { byBot: true });
            if (r.unpinned.length) learned({ kind: 'memory-pin', id: r.note.id, unpinned: idsOf(r.unpinned) });
            return send(res, 200, { ok: true, result: 'saved', say: body.pin ? SAY.pinned(r.note, { unpinned: r.unpinned }) : SAY.unpinned(r.note), note: r.note, unpinned: r.unpinned });
          }
        }
        // Skills it writes for itself (instructions only). It may improve only its own, and only while it still has them.
        if (parts[2] === 'skill') {
          if (bot.useSkills === false) return send(res, 403, { ok: false, error: 'Skills are switched off for this bot.' });
          const S = B.skills;
          const name = String(body.name || '').trim().toLowerCase();
          const mine = `bot:${bot.id}`;
          const existing = S.NAME_RE.test(name) ? S.read(name) : null;
          if (existing && existing.createdBy !== mine) return send(res, 200, { ok: false, error: `A skill called "${name}" already exists and isn't yours. Pick another name.` });
          if (body.action === 'create' && existing) return send(res, 200, { ok: false, error: `You already wrote a skill called "${name}". Use update_skill to improve it.` });
          if (body.action === 'update' && !existing) return send(res, 200, { ok: false, error: `You have no skill called "${name}". Use create_skill.` });
          if (existing && !bot.skills.includes(name)) return send(res, 200, { ok: false, error: `The owner took "${name}" away from you, so leave it as it is.` });
          // The Chief's skills are part of its instructions, which only the owner changes.
          if (existing && chiefHas(name)) return send(res, 200, { ok: false, error: `The owner gave "${name}" to the Chief of Staff too, so leave it as it is.` });
          if (!existing && S.list().filter((k) => k.createdBy === mine).length >= 20) return send(res, 200, { ok: false, error: 'You already wrote 20 skills. Improve or merge existing ones instead.' });
          if (String(body.instructions || '').length > 20000) return send(res, 200, { ok: false, error: 'Keep the instructions under 20,000 characters.' });
          // After the run read content from others (the web, a connected app, its computer, a teammate's message
          // or files) the skill waits for the owner's OK, as a skill from a link does: an ask of kind "skill". Before
          // that, or after its own commands alone, it goes in as before (ADR 015).
          const run = B.runStanding(session.runId);
          if (!run || run.fromOthers) {
            // What a save would refuse is refused now, by the same check: the owner is asked only for what their yes can save.
            try { S.validate({ name, description: body.description, instructions: body.instructions }); } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
            const description = String(body.description).trim();
            const why = String(body.reason || '').replace(/\s+/g, ' ').trim();
            asks.add({ kind: 'skill', botId: bot.id, forBots: [bot.id], url: '', reason: `${bot.name} wrote this after it read content from others in its run.${why ? ` Its reason: ${why}` : ''}`,
              skill: { name, description: description.slice(0, 400), files: 1, exists: !!existing },
              written: { name, description, instructions: String(body.instructions), reason: why.slice(0, 300), runId: session.runId } });
            const chip = `Asked to ${existing ? 'change' : 'add'} the skill ${name} (waiting for your OK)`;
            B.noteLearned(session.runId, { kind: 'skill-pending', text: chip, chip });
            return send(res, 200, { ok: true, name, result: 'waits', say: `Not saved yet: this run read content from others (the web, an app, your computer or another bot's message), so the skill "${name}" waits for the owner's OK on a card in Needs you. ${existing ? 'Until then it stays as it was.' : 'Until then you do not have it.'} Tell the owner that, and carry on.` });
          }
          const saved = writeSkill(bot, { name, description: body.description, instructions: body.instructions, reason: body.reason, runId: session.runId });
          const chip = `${existing ? 'Updated' : 'Created'} skill ${saved.name}${body.reason ? `: ${String(body.reason).slice(0, 140)}` : ''}`;
          B.noteLearned(session.runId, { kind: existing ? 'skill-updated' : 'skill', text: chip, chip });
          return send(res, 200, { ok: true, name: saved.name, result: 'saved', say: existing ? `Updated skill "${saved.name}".` : `Created skill "${saved.name}". It loads from your next run; the owner can see and undo it.` });
        }
        if (parts[2] === 'instructions') {
          const changes = {};
          if (typeof body.task === 'string' && body.task.trim() && body.task.trim() !== bot.prompt.trim()) changes.prompt = body.task.slice(0, 20000);
          if (typeof body.rules === 'string' && body.rules.trim() !== bot.systemPrompt.trim()) changes.systemPrompt = body.rules.slice(0, 20000);
          if (!Object.keys(changes).length) return send(res, 200, { ok: true, changed: [] });
          const proposed = B.bots.update(bot.id, changes, { by: 'bot', runId: session.runId, reason: body.reason || '' });
          const changed = Object.keys(changes).map((f) => B.learn.FIELDS[f]);
          B.noteLearned(session.runId, { kind: 'instructions', text: `Proposed changing its ${changed.join(' and ')}; ${learningWords.WAITS}` });
          return send(res, 200, { ok: true, changed: [], needsApproval: true, requestId: proposed.pendingChange });
        }
      } catch (e) {
        return send(res, 200, { ok: false, error: e.message });
      }
      return send(res, 404, { error: 'Unknown endpoint' });
    }
    return NEXT;
  };
}

module.exports = { create };
