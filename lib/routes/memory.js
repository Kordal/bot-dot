// The owner's memory routes (/api/memory, ADR 015, ADR 016) and the notes for everyone. The Chief's are in chief.js.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const { CHIEF_NOTES } = require('../chief-tools'); // the Chief's own place for notes (ADR 017)
const chief = require('../chief');
const learningWords = require('../learning'); // what a chip, a memory card and a memory tool's answer say

function create(ctx) {
  const { groupOfCard, auditMemory, chiefReview } = ctx;
  // Who says a note that comes through an owner's route (ADR 015): what the owner types is the owner's word; what the
  // Chief's tools file there is a bot's.
  const typedBy = (by) => (by === 'you' ? 'owner' : 'bot');
  return async function routes(req, res, url, { parts, m, by, chiefChat }) {
    // Memory: notes (per bot and shared) and the searchable index of past runs. A bot's settings, Settings → Memory, and the Chief.
    if (parts[0] === 'memory' && parts[1] !== 'shared') {
      const M = B.memory;
      const owners = () => [B.SHARED_MEMORY, CHIEF_NOTES, ...B.bots.list().map((b) => b.id)];
      if (!parts[1] && m === 'GET') {
        const bots = B.bots.list();
        // Removed notes are for the owner's own apps: the Chief's tools are handed none (ADR 016).
        const removed = (owner) => (by === 'you' ? M.deletedOf(owner) : []);
        return send(res, 200, {
          shared: M.notesOf(B.SHARED_MEMORY),
          sharedDeleted: removed(B.SHARED_MEMORY),
          chief: M.notesOf(CHIEF_NOTES), // the Chief's own notes, which no bot is given (ADR 017)
          bots: bots.map((b) => ({ id: b.id, name: b.name, emoji: b.emoji, color: b.color, notes: M.notesOf(b.id), deleted: removed(b.id) })),
          pending: M.pending().filter((p) => !p.guarded || url.searchParams.get('guarded') === '1').length, // as the list below: guarded ones for an app that asks
          runs: M.stats(),
          review: M.reviewSettings(),
          lastReviews: Object.fromEntries([...bots.map((b) => [b.id, M.lastReview(b.id)]), [CHIEF_NOTES, M.lastReview(CHIEF_NOTES)]]),
          limits: { pinnedNotes: M.PIN_LIMITS.notes, pinnedChars: M.PIN_LIMITS.chars, noteChars: M.MAX_NOTE_CHARS },
        });
      }
      if (parts[1] === 'search' && m === 'GET') {
        const bot = url.searchParams.get('bot');
        const where = url.searchParams.get('in') || 'everything';
        const kinds = where === 'notes' ? ['notes'] : where === 'runs' ? ['runs'] : ['notes', 'runs'];
        const results = await M.search({
          query: url.searchParams.get('q') || '',
          notesOf: bot ? (bot === CHIEF_NOTES ? [CHIEF_NOTES] : [bot, ...(url.searchParams.get('shared') === '1' && bot !== B.SHARED_MEMORY ? [B.SHARED_MEMORY] : [])]) : owners(),
          runsOf: bot ? (bot === B.SHARED_MEMORY ? [] : [bot]) : 'all',
          kinds, days: Number(url.searchParams.get('days')) || 0, limit: Number(url.searchParams.get('limit')) || 12,
          history: url.searchParams.get('history') !== '0', // the owner's search shows earlier versions (to restore them); the Chief asks
          removed: by === 'you', // a removed note is found by the owner's own search; the Chief lists them with list_notes
        });
        // What the Chief's turn has read with this (ADR 017): a past run, or a note that is not the owner's own word,
        // is a bot's text. Notes the owner said alone are not.
        if (by === 'chief' && results.some((r) => r.kind === 'run' || r.source !== 'owner')) chief.readIn(chiefChat, 'bot');
        return send(res, 200, { results });
      }
      if (parts[1] === 'notes') {
        const body = m === 'GET' || m === 'DELETE' ? {} : await readBody(req);
        if (!parts[2] && m === 'POST') {
          const owner = body.owner === B.SHARED_MEMORY || B.bots.get(body.owner) ? body.owner : null;
          if (!owner) return send(res, 400, { error: 'Say whose note it is: the shared memory or a bot' });
          const r = M.addNote(owner, body.text, { by, topic: body.topic, pinned: body.pinned !== false, locked: body.pinned !== false, source: typedBy(by) });
          return send(res, 201, r);
        }
        const note = parts[2] && M.getNote(parts[2]);
        if (!note) return send(res, 404, { error: 'Note not found' });
        if (m === 'PUT') {
          let n = note;
          if (body.text !== undefined || body.topic !== undefined) n = M.editNote(note.owner, note.id, body.text, { by: 'you', topic: body.topic, source: 'owner' });
          if (body.pinned !== undefined) n = M.setPinned(note.id, !!body.pinned);
          return send(res, 200, n);
        }
        if (parts[3] === 'history' && m === 'GET') return send(res, 200, M.history(note.id));
        if (m === 'DELETE') { M.removeNote(null, note.id, { by: 'you' }); return send(res, 200, { ok: true }); }
      }
      if (parts[1] === 'versions' && parts[2] && parts[3] === 'restore' && m === 'POST') {
        return send(res, 200, M.restoreNote(parts[2], { by: 'you' })); // { note, unpinned }: every unpin is said (ADR 015)
      }
      if (parts[1] === 'pending') {
        // Each with its card's words, the server's (learning.js cardOf). A guarded change, one to what the owner
        // said, is listed only for an app that asks with guarded=1: one that does not know it would take it into
        // "Approve all" (docs/api.md, Memory, "The contract").
        if (!parts[2] && m === 'GET') {
          const guarded = url.searchParams.get('guarded') === '1';
          return send(res, 200, M.pending().filter((p) => guarded || !p.guarded).map((p) => ({ ...p, ...learningWords.cardOf(p), ...groupOfCard(p.runId), bot: (() => { const b = B.bots.get(p.botId); return b ? { id: b.id, name: b.name, emoji: b.emoji, color: b.color } : p.by === CHIEF_NOTES ? chief.named() : null; })() }))); // one the Chief asked for is the Chief's
        }
        if (parts[2] && m === 'POST') {
          const body = await readBody(req);
          const p = M.getPending(parts[2]);
          const yes = body.approve === true;
          const r = B.settleMemory(parts[2], yes); // a forget the owner approves leaves its runs out in their files too
          // The audit log: who answered, which change, which notes by their ids (ADR 016). An approved forget is two
          // events, the approval and the forget, and writes a line for each.
          const notes = p.action === 'erase' ? (yes ? r.erased : (p.notes || []).map((n) => n.id)) : [r.note?.id || p.noteId].filter(Boolean);
          auditMemory(yes ? 'memory.approved' : 'memory.declined', by, { change: p.action, notes, ...(p.botId ? { bot: p.botId } : {}) });
          if (yes && p.action === 'erase') auditMemory('memory.forgotten', by, { notes: r.erased, runs: r.leftOut.length, ...(p.botId ? { bot: p.botId } : {}) });
          return send(res, 200, { ...r, text: learningWords.answerOf(p, yes) }); // what the card reads now
        }
      }
      if (parts[1] === 'runs' && parts[2]) {
        const r = M.getRun(decodeURIComponent(parts[2]));
        if (!r) return send(res, 404, { error: 'This run is not in the index' });
        // The Chief's get_run for one of its own replies: a run that is left out is handed without its text.
        if (m === 'GET') return send(res, 200, by === 'chief' && B.leftOut(r) ? { run_id: r.run_id, bot_id: r.bot_id, bot_name: r.bot_name, at: r.at, status: r.status, leftOut: true } : B.fullRun(r.run_id));
        if (m === 'PUT') {
          const body = await readBody(req);
          // A run a forget left out stays left out: only the owner's own "Don't recall" is taken back.
          if (!body.excluded && M.forgottenRun(r.run_id)) return send(res, 409, { error: 'This run was left out by a forget, which is for good.' });
          B.setRunExcluded(r.run_id, !!body.excluded);
          return send(res, 200, M.getRun(r.run_id));
        }
      }
      if (parts[1] === 'settings' && m === 'PUT') {
        const body = await readBody(req);
        if (body.retentionDays !== undefined) M.setRetentionDays(body.retentionDays);
        if (body.review) M.setReviewSettings(body.review);
        return send(res, 200, { retentionDays: M.retentionDays(), runs: M.stats(), review: M.reviewSettings() });
      }
      if (parts[1] === 'semantic') {
        if (!parts[2] && m === 'GET') return send(res, 200, await M.semanticStatus());
        if (!parts[2] && m === 'PUT') { M.setSemanticSettings(await readBody(req)); return send(res, 200, await M.semanticStatus()); }
        if (parts[2] === 'pull' && m === 'POST') { M.pullModel(); return send(res, 202, await M.semanticStatus()); }
      }
      if (parts[1] === 'review' && parts[2] && m === 'POST') {
        // The Chief's own notes and the shared ones (#117): it reports in the Chief chat that asked, or the last used.
        if (parts[2] === CHIEF_NOTES) {
          chiefReview.review({ chatId: chiefChat || null }).catch((e) => console.error(`[memory] the Chief's review: ${e.message}`));
          return send(res, 200, { started: true, chief: true });
        }
        const bot = B.bots.get(parts[2]);
        if (!bot) return send(res, 404, { error: 'Bot not found' });
        return send(res, 200, B.startReview(bot));
      }
      return send(res, 404, { error: 'Unknown endpoint' });
    }
    // The shared memory every bot reads, as the owner's own app changes it. The Chief's tools have no such route
    // (CHIEF_ROUTES): what the Chief files, changes or removes goes through POST /api/chief/memory, which guards
    // what the owner said as a bot's run is guarded (ADR 017).
    if (parts[0] === 'memory' && parts[1] === 'shared') {
      const SH = B.SHARED_MEMORY;
      if (m === 'GET') return send(res, 200, { ...B.learn.get(SH), limits: B.learn.LIMITS });
      if (m === 'POST') {
        const body = await readBody(req);
        // What the owner types is the owner's word.
        if (body.action === 'add') B.learn.addNote(SH, body.text, { by, locked: by === 'you', source: typedBy(by) });
        else if (body.action === 'edit') B.learn.editNote(SH, body.id, body.text, { by, source: typedBy(by) });
        else if (body.action === 'remove') B.learn.removeNote(SH, body.id);
        else return send(res, 400, { error: 'Unknown action' });
        return send(res, 200, { ...B.learn.get(SH), limits: B.learn.LIMITS });
      }
    }
    return NEXT;
  };
}

module.exports = { create };
