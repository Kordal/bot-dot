// Runs: search the chats, list runs, one run, wait for it, its images and its live stream, stop it.
const { NEXT, send, sendFile } = require('./http');
const chief = require('../chief');
const feed = require('../events');
const { simpleStep } = require('../working-line');
const B = require('../bots');
const learningWords = require('../learning'); // what a chip, a memory card and a memory tool's answer say
const fs = require('../principal-fs');

function create(ctx) {
  const { keys, chiefChatOf, asRun } = ctx;
  // A Chief chat's title, or null when it was deleted.
  const chiefTitle = (chatId) => { const c = chief.readChat(chatId); return c ? c.title : null; };

  // The simple form of a run's events (?simple), for clients that don't want Claude Code's raw stream:
  // { type: 'start', run } · { type: 'step', text } · { type: 'text', text } · { type: 'file', file } · { type: 'end', run },
  // and the run's lines and draft as the raw stream has them (opening_line, working_line, reply_draft).
  function simpleEvents(ev) {
    if (ev.type === 'run_start') return [{ type: 'start', run: feed.runSummary(ev.meta) }];
    if (ev.type === 'run_end') return [{ type: 'end', run: feed.runSummary(ev.meta || {}) }];
    if (ev.type === 'script_output') return [{ type: 'text', text: feed.clip(ev.text, 4000) }];
    if (ev.type === 'file') return [{ type: 'file', file: ev.file }]; // attached while it works: shown at once
    if (ev.type === 'opening_line' || ev.type === 'working_line' || ev.type === 'reply_draft') return [ev];
    if (ev.type !== 'assistant') return [];
    const out = [];
    for (const c of ev.message?.content || []) {
      if (c.type === 'text' && c.text.trim()) out.push({ type: 'text', text: c.text });
      if (c.type === 'tool_use' && c.name !== 'ToolSearch') {
        out.push({ type: 'step', tool: c.name, text: simpleStep(c.name, c.input, B.botLabel) }); // a step that is done, in words (working-line.js)
      }
    }
    return out;
  }
  // A run's event as it is sent: a `learned` item, and the record a start or an end carries, read the same way. A
  // `learned` event of what does not wait for the owner is not sent at all (null, ADR 024, ADR 025).
  const asEvent = (ev) => (ev?.type === 'learned' ? (learningWords.learnedSent(ev.item) ? { ...ev, item: learningWords.learnedView(ev.item, B.memory) } : null)
    : ev?.meta?.learned ? { ...ev, meta: { ...ev.meta, learned: learningWords.learnedViews(ev.meta.learned, B.memory) } } : ev);
  // A run that is left out, as the Chief's tools get it (get_run, list_runs, wait_for_run): that it ran and how it
  // ended, and nothing it was asked or replied (ADR 016). The owner's own apps get every run whole.
  const leftOutRun = (meta) => ({ id: meta.id, botId: meta.botId, botName: meta.botName, status: meta.status, trigger: meta.trigger, startedAt: meta.startedAt, ...(meta.endedAt ? { endedAt: meta.endedAt } : {}), ...(meta.durationMs !== undefined ? { durationMs: meta.durationMs } : {}), leftOut: true });
  const runFor = (by, meta) => (by === 'chief' && B.leftOut(meta) ? leftOutRun(meta) : asRun(meta));

  function streamRun(req, res, id, { simple = false } = {}) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const raw = (ev) => { const sent = asEvent(ev); if (sent) res.write(`data: ${JSON.stringify(sent)}\n\n`); };
    const write = simple ? (ev) => simpleEvents(ev).forEach(raw) : raw;
    // Replay what's already logged, then follow live events.
    const past = B.readEvents(id);
    past.forEach(write);
    if (!B.isActive(id)) {
      if (!past.some((e) => e.type === 'run_end')) write({ type: 'run_end', meta: B.readMeta(id) });
      return res.end();
    }
    const line = B.openingLineOf(id); // said before this client came: the log doesn't have it
    if (line) write({ type: 'opening_line', text: line });
    const now = B.workingLineOf(id); // and what its line reads now
    if (now) write({ type: 'working_line', text: now });
    const draft = B.replyDraftOf(id); // and the reply as it is written so far (reply-draft.js), once
    if (draft) write({ type: 'reply_draft', text: draft });
    const unsub = B.subscribe(id, (ev) => {
      write(ev);
      if (ev.type === 'run_end') res.end();
    });
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { clearInterval(ping); unsub && unsub(); });
  }
  return async function routes(req, res, url, { parts, m, by }) {
    // The search box: messages in every chat, for the owner. Each hit says where to open it:
    // a bot's run (runId), a message in a Chief chat (chatId, index) or, for an app that asks with ?groups=1, a
    // turn in a group (runId, and `group`). A turn in a group is no hit of its bot's own chat (ADR 018): an app
    // that does not ask is handed none, and none of a group that is gone.
    if (parts[0] === 'search' && m === 'GET') {
      // Every match is asked for and the hits are counted here: a turn that is left out takes no place of a hit.
      const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 50);
      const withGroups = url.searchParams.get('groups') === '1';
      const searchHit = (h) => {
        const chief = /^chief-(.+)-(\d+)$/.exec(h.runId);
        if (chief) { const title = chiefTitle(chief[1]); return title === null ? null : { chatId: chief[1], index: Number(chief[2]), title, at: h.at, snippet: h.snippet }; } // null: that chat is gone
        const b = B.bots.get(h.botId);
        const run = B.readMeta(h.runId);
        const group = run?.groupId ? B.groups.get(run.groupId) : null;
        if (run?.groupId && !(withGroups && group && !run.passed)) return null; // a pass is in no chat
        return { runId: h.runId, bot: { id: h.botId, name: b?.name || h.botName, color: b?.color || run?.botColor || null }, ...(group ? { group: { id: group.id, name: group.name } } : {}), ...(run?.fromBot ? { fromBot: run.fromBot } : {}), at: h.at, snippet: h.snippet };
      };
      const out = [];
      for (const h of B.memory.searchChats(url.searchParams.get('q') || '', Infinity)) {
        if (out.length >= limit) break;
        const hit = searchHit(h);
        if (hit) out.push(hit);
      }
      return send(res, 200, out);
    }
    if (parts[0] === 'runs') {
      const id = parts[1];
      // A bot's own chat, or every bot's: never a turn in a group. ?group=<id>: the turns of that group (ADR 018).
      if (!id && m === 'GET') return send(res, 200, B.listRuns({ botId: url.searchParams.get('botId'), groupId: url.searchParams.get('group') || undefined, limit: Number(url.searchParams.get('limit')) || 100, before: url.searchParams.get('before') || undefined }).map((r) => runFor(by, r)));
      const meta = id && B.readMeta(id);
      // A run that waits its turn has no record yet (ADR 011): it answers as what waits, and can be waited for.
      const waits = !meta && id && (!parts[2] || parts[2] === 'wait') && m === 'GET' ? B.waitingRun(id) : null;
      // Stop on a run that still waits to start takes it away (ADR 012): it never starts. The owner takes any; the
      // Chief only a run the Chief asked for, since the owner's waiting message is the owner's to take back.
      if (!meta && id && parts[2] === 'stop' && m === 'POST') {
        const gone = B.takeAway(id, { owners: by === 'you' });
        if (!gone) return send(res, 404, { error: 'Run not found' });
        // The owner's message: its key is free again, as after a take back. A turn in a group has no key of its own:
        // its message stays, and keeps its key.
        if (gone.msgKey) try { keys.forget(`bot:${gone.botId}`, gone.msgKey); } catch (e) { console.error(`[runs] ${e.message}`); }
        return send(res, 200, { ok: true });
      }
      if (!meta && !waits) return send(res, 404, { error: 'Run not found' });
      if (waits && !parts[2]) return send(res, 200, url.searchParams.get('events') === '0' ? waits : { ...waits, events: [] });
      if (!parts[2] && m === 'GET') {
        if (url.searchParams.get('seen') === 'chief') B.chiefSaw(id); // the Chief read how it ended: it won't be passed on
        // ?events=0: just the run, without its log (which can be large).
        if (by === 'chief' && B.leftOut(meta)) return send(res, 200, leftOutRun(meta)); // without its text, and without its log
        return send(res, 200, url.searchParams.get('events') === '0' ? asRun(meta) : { ...asRun(meta), events: B.readEvents(id).map(asEvent).filter(Boolean) });
      }
      // Wait until the run ends (or ?timeout seconds, up to 50, pass), then answer with the run as it is then. A run
      // that waits its turn is held for as one that is going: until it has started and ended, or the time is up.
      if (parts[2] === 'wait' && m === 'GET') {
        const ms = Math.min(Math.max(Number(url.searchParams.get('timeout')) || 25, 1), 50) * 1000;
        // The Chief's wait_for_run (?seen=chief) ends when the owner writes to the chat of the turn that waits: the
        // owner's message waits for that turn to end, so the turn is told at once (ADR 011). The chat its tools name
        // (X-Chief-Chat), else the chat whose reply started the run.
        const chiefChat = url.searchParams.get('seen') === 'chief' ? chiefChatOf(req, by) || chief.chatOfRun(id)?.id || null : null;
        const going = (r) => !!r && (r.status === 'running' || r.status === 'queued');
        const wrote = () => !!chiefChat && chief.ownerWaits(chiefChat);
        if (!wrote()) await new Promise((resolve) => {
          let unsub = null;
          let unhear = null;
          let timer = null;
          let over = false;
          const done = () => { if (over) return; over = true; clearTimeout(timer); if (unsub) unsub(); if (unhear) unhear(); resolve(); };
          if (chiefChat) unhear = chief.onOwnerWaits(chiefChat, done);
          const untilItEnds = () => {
            unsub = B.subscribe(id, (ev) => { if (ev.type === 'run_end') done(); });
            if (!unsub) done(); // not running (any more)
          };
          if (waits) unsub = B.onLeftQueue(id, () => { unsub = null; untilItEnds(); }); // it started, or it is gone
          else untilItEnds();
          if (over) return;
          timer = setTimeout(done, ms);
          res.on('close', done); // the caller went away
        });
        if (url.searchParams.get('seen') === 'chief') B.chiefSaw(id); // only a run that ended is marked
        const now = B.readMeta(id);
        // ownerWrote: the run is still going and the owner wrote meanwhile. The run goes on, and is not marked as seen.
        const told = (r) => (going(r) && wrote() ? { ...r, ownerWrote: true } : r);
        if (!now) { const still = B.waitingRun(id); return still ? send(res, 200, told(still)) : send(res, 404, { error: 'Run not found' }); } // taken back meanwhile
        return send(res, 200, told(runFor(by, now)));
      }
      // A screenshot its tools returned (kept apart from its log). It never changes, so it may be cached.
      if (parts[2] === 'images' && !parts[3] && m === 'GET') return send(res, 200, { images: B.runImages(id) });
      if (parts[2] === 'images' && parts[3] && m === 'GET') {
        const file = B.imageFile(id, parts[3]);
        if (!file || !fs.existsSync(file)) return send(res, 404, { error: 'No such image' });
        const type = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[parts[3].split('.').pop()];
        return sendFile(res, file, { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
      }
      if (parts[2] === 'stream' && m === 'GET') return streamRun(req, res, id, { simple: url.searchParams.has('simple') });
      if (parts[2] === 'stop' && m === 'POST') return send(res, 200, { ok: B.stopRun(id, by === 'chief' ? 'chief' : 'owner') }); // the run keeps who (ADR 012)
    }
    return NEXT;
  };
}

module.exports = { create };
