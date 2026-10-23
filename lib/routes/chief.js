// The Chief of Staff (/api/chief): its chats, reminders, looks and checkups, and its own memory (chiefMemory, ADR 017).
const { NEXT, send, readBody, drained } = require('./http');
const B = require('../bots');
const learningWords = require('../learning'); // what a chip, a memory card and a memory tool's answer say
const chief = require('../chief');
const asksLib = require('../asks');
const { CHIEF_NOTES } = require('../chief-tools'); // the Chief's own place for notes (ADR 017)
const { dayOf } = require('../prompt-text');
const checkupLib = require('../checkup');
const messageKeys = require('../message-keys');
const { ownerUpload } = require('./files');
const { workspaceRoute, filesRoute } = require('./workspace');

function create(ctx) {
  const { keys, auditMemory } = ctx;
  // The Chief's memory (ADR 017; docs/api.md, "The Chief's memory"): its tools list the notes of one place and
  // file, correct, remove, restore and forget notes, wherever they are: for everyone, its own, or a bot's.
  // - Only a turn the owner started writes: the turn that is going in the chat the call names (X-Chief-Chat). A
  //   call from a turn botdot started, from a look or from no turn at all is refused.
  // - In such a turn, what it has read decides (chief.js standing): before it read anything that is not the owner's,
  //   a note it files is the owner's word, and a forget or a change to what the owner said is done at once. After,
  //   a note is saved as "outside", and the forget or the change waits for the owner as a guarded change.
  // - Every answer has `say`, the sentence for the Chief, and where something changed `chip`, the whole line the
  //   apps print, written from what the store answered, and `notes`, the ids it is about.
  async function chiefMemory(req, res, url, { by, chiefChat }) {
    if (by !== 'chief') return send(res, 403, { error: "This is the Chief's own route. The owner's are under /api/memory." });
    const M = B.memory;
    const SH = B.SHARED_MEMORY;
    const { CHIEF_SAY: SAY, chiefChip } = learningWords;
    const names = Object.fromEntries(B.bots.list().map((b) => [b.id, b.name]));
    // The bots a word names: the one with that id, else every bot of that name.
    const botsNamed = (word) => { const w = String(word ?? '').trim(); const one = w && B.bots.get(w); return one ? [one] : w ? B.bots.list().filter((b) => b.name.trim().toLowerCase() === w.toLowerCase()) : []; };
    const noBot = (word, found) => (found.length ? `${found.length} bots are called that: name it by its id (${found.map((b) => b.id).join(', ')}).` : `no bot has the name or id "${String(word).slice(0, 60)}"; it may have been deleted.`);
    const turn = chiefChat ? chief.standing(chiefChat) : null;

    if (req.method === 'GET') {
      const of = (url.searchParams.get('of') || '').trim();
      const found = of === 'everyone' || of === 'me' ? [] : botsNamed(of);
      if (of !== 'everyone' && of !== 'me' && found.length !== 1) return send(res, 404, { error: `Whose notes? "everyone", "me" or a bot: ${noBot(of, found)}` });
      const owner = of === 'everyone' ? SH : of === 'me' ? CHIEF_NOTES : found[0].id;
      const whose = owner === SH ? 'everyone' : owner === CHIEF_NOTES ? 'me' : found[0].name;
      const limit = Math.min(Math.max(1, Math.floor(Number(url.searchParams.get('limit'))) || 20), 50);
      const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset'))) || 0);
      const line = (n) => ({ id: n.id ?? n.noteId, text: n.text, ...(n.topic ? { topic: n.topic } : {}), saidBy: n.source, day: dayOf(n.at || n.validTo), ...(n.until ? { until: n.until } : {}), ...(n.pinned !== undefined ? { pinned: n.pinned } : {}) });
      let all;
      if (url.searchParams.get('removed') === '1') {
        // Removed notes, for bringing one back: only a turn the owner started is handed them, as for a bot (ADR 016).
        if (turn?.startedBy !== 'owner') return send(res, 200, { of: whose, removed: true, notes: [], total: 0, offset, limit, say: 'Removed notes are listed only in a turn the user started.' });
        all = M.deletedOf(owner).map((v) => ({ ...v, removedOn: dayOf(v.validTo) }));
      } else all = M.notesOf(owner);
      if (url.searchParams.get('saidBy') === 'owner') all = all.filter((n) => n.source === 'owner');
      const page = all.slice(offset, offset + limit);
      // A note that is not the owner's own word is a bot's text: the turn has read it (ADR 017).
      if (page.some((n) => n.source !== 'owner')) chief.readIn(chiefChat, 'bot');
      return send(res, 200, { of: whose, ...(url.searchParams.get('removed') === '1' ? { removed: true } : {}), notes: page.map((n) => ({ ...line(n), ...(n.removedOn ? { removedOn: n.removedOn } : {}) })), total: all.length, offset, limit, ...(offset + page.length < all.length ? { next: offset + page.length } : {}) });
    }

    const body = await readBody(req);
    if (turn?.startedBy !== 'owner') return send(res, 403, { error: SAY.notNow });
    const clean = !turn.read.length;
    const source = clean ? 'owner' : 'outside';
    const runId = turn.replyId; // the reply that holds the request: a forget of the note leaves it out too
    const done = (answer) => send(res, 200, { ok: true, ...answer });
    const none = () => send(res, 404, { error: `No note with id ${String(body.id ?? '').slice(0, 40)}. list_notes and recall show the ids.` });
    // What the owner said is removed at once only before the turn read anything else; after, it waits on a card.
    // A change to it does not wait (ADR 059).
    const waits = (action, owner, extra) => {
      const p = M.propose({ action, owner, by: CHIEF_NOTES, runId, botId: null, source, guarded: true, ...extra });
      return done({ result: 'waits', say: SAY.waits(p), chip: learningWords.waitingChip(p), id: p.id });
    };

    if (body.action === 'add') {
      const targets = [];
      const missing = [];
      if (body.place === 'everyone') targets.push({ owner: SH });
      else if (body.place === 'me') targets.push({ owner: CHIEF_NOTES });
      else if (body.place === 'bots') {
        const words = [...new Set((Array.isArray(body.bots) ? body.bots : []).map((w) => String(w ?? '').trim()).filter(Boolean))].slice(0, 30);
        if (!words.length) return send(res, 400, { error: 'Name the bots the note is for, in bots.' });
        for (const w of words) {
          const found = botsNamed(w);
          if (found.length !== 1) missing.push({ bot: w.slice(0, 60), why: `${noBot(w, found)} Nothing was saved for it.` });
          else if (!targets.some((t) => t.owner === found[0].id)) targets.push({ owner: found[0].id, name: found[0].name });
        }
      } else return send(res, 400, { error: 'Say where the note belongs: place "everyone", "bots" or "me".' });
      const saved = [];
      const already = [];
      const unpinned = [];
      for (const t of targets) {
        try {
          // similarIn: nothing. The hint about notes that look alike is for a bot that saves its own.
          const r = M.addNote(t.owner, body.text, { by: CHIEF_NOTES, runId, topic: body.topic, pinned: true, source, similarIn: [], until: body.until });
          (r.duplicate ? already : saved).push({ note: r.note, name: t.name });
          unpinned.push(...r.unpinned);
        } catch (e) {
          if (!t.name) throw e; // the one place asked for
          missing.push({ bot: t.name, why: `${e.message}. Nothing was saved for it.` });
        }
      }
      return done({
        result: saved.length ? 'saved' : already.length ? 'already' : 'none',
        say: SAY.filed({ saved, already, missing, source, unpinned }),
        // No chip for a note that was there already.
        ...(saved.length ? { chip: chiefChip('add', saved.map((x) => x.note), { names, unpinned }), notes: saved.map((x) => x.note.id) } : {}),
        saved: saved.map((x) => ({ id: x.note.id, ...(x.name ? { bot: x.name } : {}), saidBy: x.note.source, pinned: x.note.pinned })),
        ...(already.length ? { already: already.map((x) => ({ id: x.note.id, ...(x.name ? { bot: x.name } : {}) })) } : {}),
        ...(missing.length ? { notSaved: missing } : {}),
      });
    }

    if (body.action === 'edit') {
      const n = M.getNote(String(body.id ?? ''));
      if (!n) return none();
      // A change to what the owner said is saved at once, also after the turn read something else (ADR 059). Then
      // its chip says so, and is shown under the reply as a waiting one was (chief.js shownAction).
      const said = n.source === 'owner' && !clean;
      const r = M.changeNote(n.owner, n.id, body.text, { by: CHIEF_NOTES, topic: body.topic, runId, reason: body.reason, source, until: body.until });
      if (r.unchanged) return done({ result: 'already', say: SAY.unchanged(r.note) }); // an edit that changed nothing: no chip
      return done({ result: 'saved', say: SAY.updated(r.note, { names, unpinned: r.unpinned, source: r.note.source }), chip: chiefChip('edit', r.note, { names, unpinned: r.unpinned, said }), notes: [r.note.id] });
    }

    if (body.action === 'remove') {
      const n = M.getNote(String(body.id ?? ''));
      if (!n) return none();
      if (n.source === 'owner' && !clean) return waits('remove', n.owner, { noteId: n.id, reason: body.reason });
      const gone = M.removeNote(n.owner, n.id, { by: CHIEF_NOTES, reason: body.reason });
      return done({ result: 'saved', say: SAY.removed(gone, { names }), chip: chiefChip('remove', gone, { names }), notes: [gone.id] });
    }

    // A removed note comes back, in a turn the owner started, whatever that turn has read: it restores a text that was there.
    if (body.action === 'restore') {
      const was = M.removedNote(String(body.id ?? ''));
      if (!was) return send(res, 404, { error: `No removed note with id ${String(body.id ?? '').slice(0, 40)}. list_notes with removed: true lists those that can be brought back.` });
      const { note, unpinned } = M.restoreNote(was.vid, { by: CHIEF_NOTES });
      if (note.id !== was.noteId) return done({ result: 'already', say: SAY.alreadyBack(note) }); // the same sentence was saved again meanwhile
      // A pinned note that comes back into a full pinned set unpins another: the answer and the chip name it (ADR 015).
      return done({ result: 'saved', say: SAY.restored(note, { names, unpinned }), chip: chiefChip('restore', note, { names, unpinned }), notes: [note.id], ...(unpinned.length ? { unpinned: unpinned.map((n) => n.id) } : {}) });
    }

    // Forget (ADR 016): the notes named are erased with their history, whoever holds them, and the runs and chats
    // named, the runs that wrote those notes and this reply, which holds the request, are left out for good. At
    // once only before the turn read anything that is not the owner's; after, nothing is erased and it waits.
    if (body.action === 'forget') {
      const list = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => String(x ?? '').trim()).filter((x) => /^[\w-]{1,80}$/.test(x)))].slice(0, 50);
      const notes = list(body.notes).filter((id) => M.getNote(id) || M.removedNote(id));
      const runs = list(body.runs).filter((id) => id !== runId && (M.getRun(id) || B.readMeta(id)));
      const unknown = [...list(body.notes).filter((id) => !notes.includes(id)), ...list(body.runs).filter((id) => id !== runId && !runs.includes(id))];
      if (!notes.length && !runs.length) return send(res, 404, { error: `Nothing to forget: name the notes by their [id] (list_notes, recall) and the chats by their run id (recall).${unknown.length ? ` Not found: ${unknown.join(', ')}.` : ''}` });
      if (!clean) return waits('erase', CHIEF_NOTES, { notes, runs, reason: body.reason });
      const about = String(body.about || '').trim() || notes.map((id) => (M.getNote(id) || M.removedNote(id))?.text || '').join(' ');
      const gone = B.forget({ notes, runs: [...runs, runId] });
      auditMemory('memory.forgotten', 'chief', { notes: gone.erased, runs: gone.leftOut.length });
      const still = M.stillMatching({ about, owners: [SH, CHIEF_NOTES, ...B.bots.list().map((b) => b.id)], runsOf: 'all', not: [runId] }); // every waiting change, whoever asked for it
      // What still matches is handed to the Chief with its text, and the Chief is told to forget again with it. A
      // note that is not the owner's own word (an earlier version among them), and what a run was asked that the
      // owner did not start, is a bot's text: the turn has read it, and the next forget waits. The owner's own
      // notes, their own messages to a bot and to the Chief are not.
      const theirs = (n) => !n.earlier && (M.getNote(n.id) || M.removedNote(n.id))?.source === 'owner';
      // A change that waits is the text of whoever asked for it, never the owner's own word.
      if (still.notes.some((n) => !theirs(n)) || still.runs.some((r) => !/^chief-/.test(r.runId) && !B.ownerStarted(r.runId)) || still.waiting?.length) chief.readIn(chiefChat, 'bot');
      return done({ result: 'forgotten', say: SAY.forgot({ ...gone, still, unknown }), chip: learningWords.forgotChip(gone.erased.length, gone.leftOut.length), erased: gone.erased.length, leftOut: gone.leftOut, still });
    }
    return send(res, 400, { error: 'Unknown action' });
  }
  // A lasting grant "<app>:<ACTION>" as the owner reads it.
  const grantView = (action) => {
    const [app, name] = [action.slice(0, action.indexOf(':')), action.slice(action.indexOf(':') + 1)];
    const words = asksLib.actionPhrase({ app, action: name }, B.appName);
    return { action, label: words[0].toUpperCase() + words.slice(1) };
  };
  return async function routes(req, res, url, { parts, m, by, chiefChat, standing }) {
    if (parts[0] === 'chief') {
      if (!parts[1] && m === 'GET') { const chats = chief.listChats(); return send(res, 200, { chief: chief.named(), chats, busy: chief.activeCount() > 0, unread: chats.reduce((n, c) => n + c.unread, 0) }); }
      // The Chief's lasting grants in connected apps, "Always allow this action" on its cards (ADR 047): the Chief and
      // the owner list them and remove one; only a card's yes adds one. Kept apart from every bot's.
      if (parts[1] === 'connector-actions' && !parts[2]) {
        const { connectorApprovals } = ctx;
        // Each also in the owner's words, for the "Always approved" list in the Chief's settings: "Send email with Gmail".
        const listed = () => { const actions = connectorApprovals.list(connectorApprovals.CHIEF); return { actions, grants: actions.map(grantView) }; };
        if (m === 'GET') return send(res, 200, listed());
        if (m === 'DELETE') {
          const action = String((await readBody(req)).action || '');
          const had = connectorApprovals.list(connectorApprovals.CHIEF).includes(action);
          if (had) connectorApprovals.revoke(connectorApprovals.CHIEF, action);
          return send(res, had ? 200 : 404, had ? { ok: true, ...listed() } : { error: `There is no lasting grant "${action.slice(0, 120)}". connector_grants lists them.` });
        }
      }
      // The types of the Chief's changes that the owner let through after the web, "Always allow" on its cards (#280):
      // the Chief and the owner list them and remove one; only a card's yes adds one.
      if (parts[1] === 'after-web' && !parts[2]) {
        const listed = () => B.settings.afterWeb().filter((t) => asksLib.AFTER_WEB_TYPES[t]).map((type) => ({ type, label: asksLib.AFTER_WEB_TYPES[type].label }));
        if (m === 'GET') return send(res, 200, { types: listed() });
        if (m === 'DELETE') {
          const type = String((await readBody(req)).type || '');
          const had = B.settings.afterWeb().includes(type);
          if (had) B.settings.removeAfterWeb(type);
          return send(res, had ? 200 : 404, had ? { ok: true, types: listed() } : { error: `There is no lasting grant "${type.slice(0, 60)}". after_web_grants lists them.` });
        }
      }
      // Its own jobs (#408, ADR 073): the owner's apps list, switch, change, remove and run them; the Chief adds and
      // changes them only in a turn the owner started (after the web such a call waits for the owner's card, server.js).
      if (parts[1] === 'jobs' && !parts[3]) {
        if (by === 'chief' && m !== 'GET' && standing()?.startedBy !== 'owner') return send(res, 403, { error: 'Not done: you set up and change your jobs only in a turn the user started by writing to you. Nothing was changed.' });
        try {
          if (!parts[2] && m === 'GET') return send(res, 200, { jobs: chief.chiefJobs.list() });
          if (!parts[2] && m === 'POST') return send(res, 201, chief.chiefJobs.add(await readBody(req), { chatId: by === 'chief' ? chiefChat : null }));
          if (parts[2] && m === 'PUT') return send(res, 200, chief.chiefJobs.update(parts[2], await readBody(req)));
          if (parts[2] && m === 'DELETE') return send(res, 200, chief.chiefJobs.remove(parts[2]));
        } catch (e) { return send(res, e.status || 400, { error: e.message }); }
      }
      if (parts[1] === 'jobs' && parts[2] && parts[3] === 'run' && !parts[4] && m === 'POST') {
        if (by === 'chief' && standing()?.startedBy !== 'owner') return send(res, 403, { error: 'Not done: you run a job of yours now only in a turn the user started by writing to you.' });
        let started;
        try { started = chief.chiefJobs.run(parts[2]); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
        return started ? send(res, 202, { started: true }) : send(res, 409, { error: 'Another run of the Chief (a look, a page or a job) is at work. Try again in a minute.' });
      }
      // Reminders the Chief set for the owner (it passes the chat it was asked in).
      if (parts[1] === 'reminders') {
        if (!parts[2] && m === 'GET') return send(res, 200, chief.listReminders());
        if (!parts[2] && m === 'POST') { const b = await readBody(req); return send(res, 201, chief.addReminder(b)); }
        if (parts[2] && m === 'DELETE') return send(res, 200, { ok: chief.cancelReminder(parts[2]) });
      }
      // A look now, for a test environment (BOT_DOT_LOOK_ON_DEMAND=1): its time and the first hour don't apply, the rest does.
      // kind: "brief", "handoff" or "meet" starts that kind of look (#416); without it, the kind whose turn it is.
      if (parts[1] === 'look' && !parts[2] && m === 'POST' && process.env.BOT_DOT_LOOK_ON_DEMAND === '1') return send(res, 200, await chief.looks.onDemand({ kind: (await readBody(req)).kind }));
      // A checkup (ADR 023). For the Chief, in a chat where the owner asked for one: what botdot recorded since the
      // last one and what was proposed before (GET), the proposals it then makes, kept as a checkup's are (POST
      // proposals), and what it did with them (POST outcome). The chat is the one its call names.
      if (parts[1] === 'checkup') {
        if (!parts[2] && m === 'GET') {
          const since = chief.checkups.since();
          const zone = B.settings.get().quietHours.timeZone;
          if (by === 'chief') chief.readIn(chiefChat, 'bot'); // what the bots' runs said is not the owner's word (ADR 017)
          return send(res, 200, { since: since.toISOString(), records: checkupLib.facts({ timeZone: zone, ...chief.checkupFacts(since) }), proposedBefore: checkupLib.beforeLines(chief.checkups.record(), new Date()), ...chief.checkups.status() });
        }
        // Only a turn the owner started keeps proposals or their outcome: a turn botdot started must not mark one done.
        if (parts[2] && parts[2] !== 'now' && by === 'chief' && standing()?.startedBy !== 'owner') return send(res, chiefChat ? 403 : 400, { error: 'A checkup in a chat is done in a turn the user started by writing to you. Nothing was kept.' });
        if (parts[2] === 'proposals' && m === 'POST') {
          if (!chiefChat) return send(res, 400, { error: 'Proposals are made in a chat with the owner.' });
          return send(res, 200, chief.checkups.propose((await readBody(req)).proposals, { chatId: chiefChat }));
        }
        if (parts[2] === 'outcome' && m === 'POST') {
          if (!chiefChat) return send(res, 400, { error: 'An outcome is of the proposals in a chat with the owner.' });
          return send(res, 200, { decided: chief.checkups.decided(chiefChat, await readBody(req)) });
        }
        // A checkup now, for a test environment: its time, its switch and the first hour don't apply, the rest does.
        if (parts[2] === 'now' && m === 'POST' && process.env.BOT_DOT_LOOK_ON_DEMAND === '1') return send(res, 200, await chief.checkups.onDemand());
      }
      if (parts[1] === 'memory' && !parts[2] && (m === 'GET' || m === 'POST')) return chiefMemory(req, res, url, { by, chiefChat });
      // Its files and workspace (#383), as a bot's: what the owner attached in its chats, in uploads/ of its folder,
      // the ones kept in mind with every turn; and every file in its folder, the owner's to manage.
      if (parts[1] === 'files' && !parts[3]) return filesRoute(req, res, url, { name: parts[2], m, by, key: chief.FILES, ws: chief.WORKDIR, chief: { standing } });
      if (parts[1] === 'workspace') return workspaceRoute(req, res, url, { parts, m, by, bot: { id: chief.FILES }, audit: ctx.audit, ws: chief.WORKDIR, at: 1, computer: false });
      // The steer hook of a turn the owner started asks, after each tool call, for the owner's messages steered into
      // it (ADR 040): the Chief's own route, for the chat its call names, answered in Claude Code's hook output.
      if (parts[1] === 'steer' && !parts[2] && m === 'POST') {
        if (by !== 'chief') return send(res, 403, { error: "This is the Chief's own route." });
        await drained(req, Infinity); // what Claude Code posts is not read, but taken in whole first (as for a bot)
        return send(res, 200, B.steerAnswer(chief.takeSteered(chiefChat)));
      }
      if (parts[1] !== 'chats') return send(res, 404, { error: 'Unknown endpoint' });
      const id = parts[2];
      if (!id && m === 'POST') return send(res, 201, chief.createChat());
      const chat = id && chief.readChat(id);
      if (!chat) return send(res, 404, { error: 'Chat not found' });
      if (!parts[3] && m === 'GET') {
        // A part of a long chat: ?limit=N (its last N messages) and/or ?offset=I (from message I). offset and total say
        // where the part sits, so the app can fetch only what changed at the end, or older messages as you scroll up.
        const total = chat.messages.length;
        const lim = Number(url.searchParams.get('limit')) || 0;
        const off = url.searchParams.has('offset') ? Math.min(Math.max(Number(url.searchParams.get('offset')) || 0, 0), total) : lim ? Math.max(total - lim, 0) : 0;
        const end = url.searchParams.has('offset') && lim ? Math.min(off + lim, total) : total;
        const line = chief.openingLineOf(id); // what the Chief said it is about to do, while it replies
        // queued: the owner's messages that wait for the reply to end (ADR 011), oldest first.
        return send(res, 200, { ...chat, messages: chat.messages.slice(off, end).map(chief.sentMessage), offset: off, total, busy: chief.isBusy(id), queued: chief.queuedOf(id), ...(line ? { openingLine: line } : {}), ...chief.unreadOfChat(chat) });
      }
      if (!parts[3] && m === 'DELETE') return send(res, 200, { ok: chief.deleteChat(id) });
      // A file the owner sent in this chat (#268): only one a message of it lists.
      if (parts[3] === 'uploads' && parts[4] && !parts[5] && m === 'GET') return ownerUpload(res, url, by, parts[4], (name) => chief.ownerFile(id, name));
      // 👍 or 👎 on an unasked message: { rating: "up" | "down" | null }.
      if (parts[3] === 'messages' && parts[5] === 'rating' && !parts[6] && m === 'PUT') {
        const b = await readBody(req);
        if (!/^\d+$/.test(parts[4]) || !('rating' in b)) return send(res, 400, { error: 'Give the message\'s index and a rating: "up", "down" or null' });
        return send(res, 200, { ok: true, ...chief.rate(id, Number(parts[4]), b.rating) });
      }
      if (parts[3] === 'messages' && !parts[4] && m === 'POST') {
        const b = await readBody(req);
        // A message sent again with its key is in the chat already (lib/message-keys.js): the chat as it is now.
        const key = messageKeys.read(b.key);
        const where = `chief:${id}`;
        if (key && keys.taken(where, key)) return send(res, 200, { ...chat, messages: chat.messages.map(chief.sentMessage), busy: chief.isBusy(id), queued: chief.queuedOf(id), again: true });
        // While the Chief replies the message is not refused: it waits its turn, on disk, and the answer lists it in
        // `queued` (ADR 011). The key is kept in the step that takes the message, in the chat or to wait, never for
        // one that was refused (ten wait already: 429).
        const took = chief.send(id, b.text, b.attachments, { key, saved: key ? () => keys.take(where, key) : null });
        return send(res, 201, { ...took, ...(Array.isArray(took?.messages) ? { messages: took.messages.map(chief.sentMessage) } : {}), busy: chief.isBusy(id), queued: chief.queuedOf(id) });
      }
      // The owner takes a waiting message back: its text and files, for the message box. The owner's alone: the
      // Chief's tools have no such route (CHIEF_ROUTES).
      if (parts[3] === 'queued' && parts[4] && !parts[5] && m === 'DELETE') {
        const back = chief.takeBack(id, parts[4]);
        if (!back) return chief.startedFrom(id, parts[4]) ? send(res, 409, { error: 'It has already started.' }) : send(res, 404, { error: 'No such waiting message' });
        // Its key is free again: the same message may be sent anew.
        if (back.key) try { keys.forget(`chief:${id}`, back.key); } catch (e) { console.error(`[chief] ${e.message}`); }
        return send(res, 200, { text: back.text, attachments: back.attachments });
      }
      // The owner steers a waiting message into the reply that is going (ADR 040): it is read at the turn's next tool
      // call. The owner's alone, as Take back: the Chief's tools have no such route (CHIEF_ROUTES).
      if (parts[3] === 'queued' && parts[4] && parts[5] === 'steer' && !parts[6] && m === 'POST') {
        let steered;
        try { steered = chief.steer(id, parts[4]); } catch (e) { if (e.status === 409) return send(res, 409, { error: e.message }); throw e; }
        if (steered) return send(res, 200, steered);
        return chief.startedFrom(id, parts[4]) ? send(res, 409, { error: 'It has already started.' }) : send(res, 404, { error: 'No such waiting message' });
      }
      // Stop ends the reply and the bot runs it started (ADR 012). The owner's: the Chief's tools have no such route.
      if (parts[3] === 'stop' && m === 'POST') return send(res, 200, { ok: chief.stop(id, 'owner') });
      if (parts[3] === 'dismiss' && m === 'POST') return send(res, 200, { ok: chief.dismissSuggestion(id) });
      if (parts[3] === 'stream' && m === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        // What the apps are not sent of a reply (ADR 024) is left out here: the chat file keeps it.
        const write = (ev) => { const sent = chief.sentEvent(ev); if (sent) res.write(`data: ${JSON.stringify(sent)}\n\n`); };
        const unsub = chief.subscribe(id, (ev) => { write(ev); if (ev.type === 'done') res.end(); });
        if (!unsub) { write({ type: 'done', message: chat.messages[chat.messages.length - 1] || null }); return res.end(); }
        const ping = setInterval(() => res.write(': ping\n\n'), 15000);
        req.on('close', () => { clearInterval(ping); unsub(); });
        return;
      }
    }
    return NEXT;
  };
}

module.exports = { create };
