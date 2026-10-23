// ---------- a bot's conversation ----------
// Each run is what started it, then its reply: in the order they happened (Unread.order).

// newFirst: the run the "New" line goes above (the server's firstUnread when the chat was opened), or null.
// The answers of a reply stand under the reply that is last in the chat, and under the run its open question is from (bot.asks) when
// newer runs another bot or the Chief started came after it: what asks the owner can be answered where it stands.
function botThreadHTML(bot, runs, newFirst = null) {
  if (!runs.length) {
    return `
      <div class="chat-empty">
        ${botFigure(bot.color, bot.state, 'lg', bot.outfit)}
        <h3>${esc(bot.name)}</h3>
        <p class="muted">${esc(bot.description || '')}</p>
      </div>`;
  }
  // A reply stands where it ended, below what came while its run worked (a "/btw", another run): Unread.order (#460).
  const pieces = Unread.order(runs);
  const lastReply = pieces.filter((p) => p.part === 'reply').pop()?.run.id;
  const newest = runs[runs.length - 1]?.id;
  const parts = new Map();
  const partsOf = (r) => {
    if (!parts.has(r.id)) parts.set(r.id, runParts(bot, r, r.id === lastReply, r.id === newest));
    return parts.get(r.id);
  };
  let lastDay = '';
  return pieces.map(({ run: r, part, i }) => {
    const line = newFirst !== null && r.id === newFirst ? Unread.line(bot.color) : '';
    let html;
    if (r.kind === 'script') html = part === 'reply' ? line + scriptRunHTML(r) : '';
    else {
      const { asked, steered, reply, mine } = partsOf(r);
      // The "New" line: above what started the run, or, below the owner's own message (Unread.exchange), above its
      // reply. With nothing drawn for what started it, above the reply.
      html = part === 'asked' ? (asked ? Unread.exchange({ asked, mine }, mine ? '' : line) : '')
        : part === 'steered' ? steered[i] || ''
        : (mine || !asked ? line : '') + reply;
    }
    const when = !html ? null : part === 'asked' ? r.startedAt : part === 'steered' ? r.steered[i]?.at || r.startedAt : r.status === 'running' ? null : r.endedAt || r.startedAt;
    if (!when) return html;
    const day = new Date(when).toDateString();
    const sep = day !== lastDay ? `<div class="day">${esc(new Date(when).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }))}</div>` : '';
    lastDay = day;
    return sep + html;
  }).join('');
}

// What a bot's chat draws of one run: what started it, each message steered into it, its reply. last: its reply is
// the last in the chat (its quick answers stand under it). newest: it is the run that started last.
function runParts(bot, r, last, newest) {
  // Messages other bots left for it, read at the start of this run.
  const notes = notesFoldHTML(r.inbox, r.inbox?.length === 1 ? 'Read a note from' : 'Read notes from');
  let mine = false; // your own message started it: that isn't new, so the "New" line goes below it
  const asked = notes + (r.trigger === 'replies' || (r.trigger === 'bot' && !r.fromBot) ? '' // the answers it waited for, or notes that woke it (#225): the notes above are what started it
    : sender(r) // a message from another bot or the Chief: one folded line that opens to what it said
    ? `<div class="bubble-row from-me"><details class="notes-fold" ${state.keepOpen === r.id ? 'open' : ''}>${foldSummary(`Message from ${botLabel(sender(r))}`, r.prompt)}<div class="note"><div class="bubble from-other-bot">${esc(r.prompt)}${filesHTML(r.attachments)}</div><div class="bubble-meta">${copyBtn(r.prompt)}</div></div></details></div>`
    : r.jobName
    ? `<div class="bubble-row from-me"><span class="chip">${r.jobId === 'memory-review' ? '🧹' : '⏰'} ${esc(r.jobName)}${r.trigger === 'call' ? ', called' : ''}${r.parentRunId ? ' · its script found something' : ''} · ${esc(msgTime(r.startedAt))}</span></div>`
    : r.trigger === 'schedule'
    ? `<div class="bubble-row from-me"><span class="chip">⏰ Scheduled run · ${esc(msgTime(r.startedAt))}</span></div>`
    : r.trigger === 'hello' ? '' // a new bot's first message (#511): you asked nothing
    : r.kind === 'reminder' ? '' // a reminder it set went off (#343): botdot posted it, nobody asked
    : r.continues ? '' // it carries on after your OK: the request stands once, above the reply of the run that stopped (docs/api.md, "What follows a yes")
    : r.customPrompt === false
      ? `<div class="bubble-row from-me"><span class="chip">${ICON.play} Ran its main assignment</span></div>`
      : (mine = true, `<div class="bubble-row from-me"><div class="stack mine"><div class="bubble from-me" data-expand><div class="clamp">${escMentions(r.prompt, r.botId)}</div>${filesHTML(r.attachments, `bot:${r.botId}`)}</div><div class="bubble-meta">${copyBtn(r.prompt)}</div></div></div>`));
  // What the owner steered into it while it worked (ADR 040): their messages, after its request, without buttons.
  const steered = (Array.isArray(r.steered) ? r.steered : []).map((x) => `<div class="bubble-row from-me"><div class="stack mine"><div class="bubble from-me" data-expand><div class="clamp">${escMentions(String(x.text || ''), r.botId)}</div>${filesHTML(Array.isArray(x.attachments) ? x.attachments : [], `bot:${r.botId}`)}</div><div class="bubble-meta"><span>Steered · ${esc(msgTime(x.at))}</span>${copyBtn(String(x.text || ''))}</div></div></div>`);
  let reply;
  if (r.status === 'running') {
    // No bubble while it works: the status line under the chat says it (placeStatusLines). Only what it attached so far.
    // From a server with drafts, the reply as it is written so far stands here, and grows in place (replyDrafts).
    reply = `<div class="bubble-row from-bot" data-live="${esc(r.id)}">${draftHTML(replyDrafts.of(r.id), true)}${botFilesHTML(r.files)}</div>`;
  } else {
    const failed = ['error', 'stopped', 'interrupted'].includes(r.status);
    const body = failed ? r.problem || friendlyProblem(r, r.result) : r.result || 'Done. (No written reply.)';
    const meta = [msgTime(r.endedAt || r.startedAt), r.durationMs != null ? dur(r.durationMs) : null].filter(Boolean);
    // Between bots (a run another bot or the Chief started) the reply folds as the message above it does: one line,
    // whom it answered and its first words, that opens to what it sent its teammates and the reply. A problem stays open,
    // and so does a reply that addresses the owner: a teammate's request whose reply only the owner reads (#465).
    const outgoing = sentTo(r).filter((t) => t.text);
    const bubble = `<div class="bubble from-bot ${failed ? 'problem' : ''}"><div class="md">${md(body, failed ? null : r.botId)}</div>${failed ? '' : globalThis.docButton?.({ run: r.id }, body) || ''}${botFilesHTML(r.files)}${typeof Pages !== 'undefined' ? Pages.chipsHTML(r) : ''}${globalThis.reconnectCardsHTML?.(r) || ''}${globalThis.planInReply?.(r, newest) || ''}</div>
        ${learnedChips(r)}`;
    const shown = sender(r) && !failed && r.notificationAudience !== 'owner'
      ? `<details class="notes-fold theirs" ${state.keepOpen === r.id ? 'open' : ''}>${foldSummary(exchangeLabel(r), body)}
          ${outgoing.map((t) => `<div class="note"><div class="bot-msg-label">To ${botLabel(t)}</div><div class="bubble from-bot"><div class="md">${md(t.text)}</div></div></div>`).join('')}
          <div class="note">${bubble}</div>
        </details>`
      : messagedLabel(r) + bubble;
    reply = `
      <div class="bubble-row from-bot"><div class="stack">
        ${shown}
        <div class="bubble-meta">${meta.map(esc).join(' · ')}${r.kind === 'reminder' ? '' : ` · <button data-details="${esc(r.id)}">Details</button>`}${copyBtn(body)}</div>
        ${(last || r.id === bot.asks?.runId) && !failed ? choicesHTML(r.choices, r.yes, bot.color) + questionsHTML(r.questions) : ''}
      </div></div>`;
  }
  return { asked, steered, reply, mine };
}

// "Run now" under the notes that wait (#225): the bot starts with them, or once it is free.
async function runNotes(botId, btn) {
  btn.disabled = true;
  try {
    const { status } = await api(`/bots/${encodeURIComponent(botId)}/inbox/run`, { method: 'POST' });
    if (status === 'queued') toast(`${botById(botId)?.name || 'It'} is busy: it reads them once it is free.`);
  } catch (e) { toast(e.message, true); btn.disabled = false; return; }
  refresh();
  loadInbox(botId);
}

// The notes other bots left for a bot, waiting for its next run (shown at the bottom of its chat).
function loadInbox(botId) {
  api(`/bots/${encodeURIComponent(botId)}/inbox`).then((notes) => {
    const before = JSON.stringify(state.inbox[botId] || []);
    state.inbox[botId] = notes;
    if (before !== JSON.stringify(notes) && state.view === 'bot' && state.botId === botId) renderBotChat();
  }).catch(() => {});
}

// The run a bot's chat reaches back to: its "New" line's, else the one its open question is from (docs/api.md, "A bot
// that asks"), else none. The question is the newest reply that counts, so the "New" line is never below it.
const chatBack = (bot, newFirst) => newFirst ?? bot?.asks?.runId ?? null;

// The open chat's runs from further back than the page holds (state.runs is the newest 200 of all bots):
// read when its "New" line or its open question is above them, and kept while that stays.
let reached = null; // { botId, first, runs }
function chatRuns(botId, first) {
  const held = state.runs.filter((r) => r.botId === botId);
  if (first === null) reached = null;
  if (!reached || reached.botId !== botId || reached.first !== first) return held;
  const known = new Set(held.map((r) => r.id));
  return held.concat(reached.runs.filter((r) => !r.quiet && !known.has(r.id)))
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)) || b.id.localeCompare(a.id));
}
function reachNew(botId, first) {
  if (reached && reached.botId === botId && reached.first === first) return; // being read, or it isn't there
  const mine = reached = { botId, first, runs: [] };
  const page = (before) => api(`/runs?botId=${encodeURIComponent(botId)}&limit=200${before ? `&before=${encodeURIComponent(before)}` : ''}`);
  Unread.reach(first, page).then((runs) => {
    if (reached !== mine || !runs) return; // not reached: the chat stays as it is, without a line
    mine.runs = runs;
    if (state.view === 'bot' && state.botId === botId) renderBotChat();
  }).catch(() => { if (reached === mine) reached = null; }); // the server couldn't be asked: the next draw asks again
}

// The plan under a reply that is done (plan.js): folded, its steps inside. Not under the newest run that was stopped
// or failed before its plan was done: that plan stands above the message box, until the owner dismisses it.
function planInReply(r, last) { return globalThis.Plan && r.plan && !(last && stoppedPlan(r)) ? Plan.replyHTML(r.plan) : ''; }
const stoppedPlan = (r) => !!r && r.status !== 'success' && r.status !== 'running' && Plan.has(r.plan) && !Plan.finished(r.plan) && !Plan.dismissed(r.id);
// A bot's plan above its message box (plan.js; docs/api.md, "The plan"): its running run's, else the newest run's
// that was stopped or failed before its plan was done.
function drawBotPlan(bot, runs) {
  const slot = $('#view-bot .plan-slot');
  if (!slot || !globalThis.Plan) return;
  slot.style.setProperty('--c', bot.color);
  const working = runs.find((r) => r.status === 'running');
  const last = runs[runs.length - 1];
  const view = working ? (working.plan ? { kind: 'live', plan: working.plan, id: working.id, who: bot.name } : null)
    : stoppedPlan(last) ? { kind: 'stopped', plan: last.plan, id: last.id, who: bot.name } : null;
  Plan.draw(slot, `bot:${bot.id}`, view, () => { delete $('#view-bot').dataset.sig; renderBotChat(); });
}

function renderBotChat() {
  const bot = state.bots.find((b) => b.id === state.botId);
  const root = $('#view-bot');
  if (!bot) { if (state.bots.length) leaveBot(); return; }
  const newFirst = newLine.first(`bot:${bot.id}`); // the "New" line stays where it was put while the chat is open
  // Its newest runs, and with a line every run back to it: one further back is read first, and drawn then. So is the
  // run its open question is from (bot.asks), however far back: "Needs you" on its key points at something to answer.
  const back = chatBack(bot, newFirst);
  const drawn = Unread.shown(chatRuns(bot.id, back), back);
  if (drawn.missing) reachNew(bot.id, back);
  const runs = drawn.runs.reverse();
  if (root.dataset.bot !== bot.id) {
    root.dataset.bot = bot.id;
    delete root.dataset.sig; // not '': a bot with no runs yet has that signature too, and would never show its intro
    root.innerHTML = `
      <div class="chat-head">
        ${BACK_BTN}
        <button class="chat-title" id="bot-settings" title="Settings">
          <div id="bot-avatar"></div>
          <div class="grow"><h2 id="bot-name"></h2><div class="sub" id="bot-sub"></div></div>
        </button>
        <button type="button" class="icon-btn sm hidden" id="bot-add-to-chat" title="Add a bot to this chat" aria-label="Add a bot to this chat">＋</button>
        <div class="actions-right">
          <button class="icon-btn hidden" id="bot-screen" title="Its computer">${ICON.screen}</button>
        </div>
      </div>
      <div class="chat-thread" id="bot-thread"></div>
      <div class="pip hidden" id="bot-pip"></div>
      ${composerHTML(`Give ${bot.name} a task…`)}`;
    const form = $('form', root);
    wireComposer(form, (text, files, key) => runBot(bot.id, text, files, key), () => `bot:${bot.id}`, bot.id);
    $('#bot-settings').onclick = () => setPanel('toggle');
    // A group grown from this chat (groups.js): this bot and those picked. Its own chat stays as it is.
    $('#bot-add-to-chat').onclick = () => { const b = state.bots.find((x) => x.id === state.botId); if (b && canMakeGroup(b)) openGroupMaker(b); };
    $('#bot-screen').onclick = () => openScreen(state.botId);
    loadInbox(bot.id);
  }
  const av = $('#bot-avatar');
  const look = bot.color + bot.state + JSON.stringify(bot.outfit || '');
  if (av.dataset.sig !== look) { av.dataset.sig = look; av.innerHTML = botFigure(bot.color, bot.state, 'sm', bot.outfit); }
  $('#bot-name').textContent = bot.name;
  // Only what's happening now; its skills, jobs and computer are in its settings, behind its figure and name.
  $('#bot-sub').textContent = bot.running ? 'working…' : '';
  $('#bot-screen').classList.toggle('hidden', bot.computer !== 'linux');
  // The small plus right of the name (the owner at the test of Milestone 10): only where a group can be made.
  $('#bot-add-to-chat').classList.toggle('hidden', !canMakeGroup(bot));

  // Re-render the thread only when something changed, so live bits and scroll survive refreshes.
  const waiting = state.inbox[bot.id] || [];
  const sig = runs.map((r) => `${r.id}:${r.status}`).join('|') + `|notes:${waiting.map((n) => n.at).join(',')}|${mentionSig()}|new:${newFirst ?? ''}|asks:${bot.asks?.runId ?? ''}`;
  const thread = $('#bot-thread');
  if (root.dataset.sig !== sig) {
    const atBottom = !root.dataset.sig || thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120;
    root.dataset.sig = sig;
    thread.innerHTML = botThreadHTML(bot, runs, newFirst) + waitingNotesHTML(bot.id, waiting);
    if (atBottom) thread.scrollTop = thread.scrollHeight;
    scrollToNew(thread);
    $$('[data-expand]', thread).forEach((el) => (el.onclick = (e) => { if (!e.target.closest('a') && getSelection().isCollapsed) el.firstElementChild.classList.toggle('clamp'); })); // a click that ends a selection (to quote it) folds nothing
    $$('[data-details]', thread).forEach((el) => (el.onclick = () => openRun(el.dataset.details)));
    $$('[data-run-notes]', thread).forEach((el) => (el.onclick = () => runNotes(el.dataset.runNotes, el)));
    wireChoices(thread, (t, key) => sendFrom($('form', root), () => runBot(bot.id, t, [], key)));
    $$('[data-screen-open]', thread).forEach((el) => (el.onclick = () => openScreen(el.dataset.screenOpen)));
    // What it learned: a job opens its jobs, a change to its task, rules or skills its settings. A note opens nothing.
    $$('[data-learned]', thread).forEach((el) => (el.onclick = () => { const view = learnedOpens(el.dataset.learned); if (view) setView(view, state.botId); }));
    followBotRuns(runs.filter((r) => r.status === 'running'));
    markSearch(); // what you searched for, marked in the chat
    // From a search match: that run (older runs than the chat shows open on their own).
    if (state.jump?.runId && state.jump.bot?.id === bot.id) {
      const id = state.jump.runId;
      const row = $(`[data-details="${CSS.escape(id)}"]`, thread)?.closest('.bubble-row');
      // Between bots it's folded: open it (and the message that started it) so the match shows, and keep it open.
      state.keepOpen = id;
      [row, row?.previousElementSibling].forEach((el) => el && $$('details.notes-fold', el).forEach((d) => { d.open = true; }));
      if (!jumpTo(row)) openRun(id);
    }
  }
  // A reply that is new in the open chat arrives (a reply arrives): the reply side of its run's row, with its
  // quick answers. What started the run stands still.
  for (const id of repliesArrive(arrivals.bot, thread, `bot:${bot.id}`, botReplyIds(runs))) arrive($(`[data-details="${CSS.escape(id)}"]`, thread)?.closest('.bubble-row'));
  // The large head of an empty chat follows the bot's state, colour and hat, like the one in the header.
  const big = $('.chat-empty .avatar', thread);
  if (big && thread.dataset.look !== look) big.outerHTML = botFigure(bot.color, bot.state, 'lg', bot.outfit);
  thread.dataset.look = look;
  updateChatNeeds($('#bot-thread'), bot.id);
  updatePip(bot, runs.find((r) => r.status === 'running' && r.computer));
  setSendBusy($('form', root), false);
  globalThis.drawBotPlan?.(bot, runs);
  placeStatusLines();
}

// Rejects when the task did not go, with nothing added to the chat (wireComposer, sendFrom). key: as sendToChief's.
// From Send until botdot answers the task stands in the chat as the page's own bubble (sentAtOnce), with "Working"
// under it. The answer is drawn at once, from the answer itself (tookRun): the lists are read again after it, not
// before. A task botdot had already (again) answers the run it has, which the chat holds once.
// To a working bot the answer is a run that waits (`status: "queued"`): it is no run yet, so nothing is followed
// or opened for its id. It is drawn among the bot's `queued`, as every waiting message is.
async function runBot(botId, text, attachments = [], key = messageKey()) {
  const at = `bot:${botId}`;
  sentAtOnce(at, { key, text, attachments });
  showSent($('#bot-thread'));
  let took;
  try {
    took = await api(`/bots/${botId}/run`, { method: 'POST', body: { prompt: text || undefined, attachments, key } });
  } catch (e) {
    sentOver(at, key, false); // it did not go: nothing of it stays in the chat
    placeStatusLines();
    throw e;
  }
  // The task went. Nothing from here on may reject: the caller would put a sent message back into the box.
  try {
    sentOver(at, key);
    tookRun(botId, took, text, attachments);
    if (state.view === 'bot' && state.botId === botId) renderBotChat(); else placeStatusLines();
    const thread = $('#bot-thread');
    if (thread) thread.scrollTop = thread.scrollHeight;
  } catch (e) { console.error(e); }
  refresh(); // the bots, the list and the rest follow: never rejects, and nothing waits for it
}
// botdot's answer to a task, into what the page holds: the run it started, on top of the runs, or the message
// among those that wait for the bot, last. One the page holds already stays as it is: the feed brought it, maybe
// further on than this answer, or the same task was sent again and botdot took it once.
function tookRun(botId, run, text, attachments) {
  if (!run || typeof run.id !== 'string' || !run.id || state.runs.some((r) => r.id === run.id)) return;
  if (run.status !== 'queued') { state.runs = [run, ...state.runs]; return; }
  const at = `bot:${botId}`;
  if (queuedIn(at).some((q) => q.id === run.id)) return;
  setQueued(at, [...queuedIn(at), { id: run.id, text: String(text || '').trim(), attachments: Array.isArray(run.attachments) ? run.attachments : attachments, at: run.queuedAt }]);
}

// Every run of the bot that is going, each from its start again, as the chat is drawn again: a message to a busy
// bot starts beside the run that is going (ADR 062), and each has its draft and files in its own row.
function followBotRuns(running) {
  for (const es of state.botStreams.splice(0)) es.close();
  running.forEach(followBotRun);
}
// A bot's running run as it happens: a file it attaches shows at once, its line goes to the status line as the
// server says it (its steps are not put in words here), its reply draft into its row, then refresh when it ends.
function followBotRun(run) {
  if (!run) return;
  const es = watchRun(run.id, () => { state.botStreams = state.botStreams.filter((x) => x !== es); replyDrafts.end(run.id); refresh(); }, (file) => {
    const live = $(`[data-live="${CSS.escape(run.id)}"]`);
    if (!live || $(`a[href="${CSS.escape(fileHref(file))}"]`, live)) return; // shown already (the stream replays)
    const list = $('.bubble-files', live);
    const html = botFilesHTML([file]);
    if (list) list.insertAdjacentHTML('beforeend', html.replace(/^<div class="bubble-files">|<\/div>$/g, ''));
    else live.insertAdjacentHTML('beforeend', html);
    const t = $('#bot-thread');
    if (t && t.scrollHeight - t.scrollTop - t.clientHeight < 200) t.scrollTop = t.scrollHeight;
  }, (line) => { if (openingLines.say(`bot:${run.botId}`, line, run.id)) { renderContacts(); placeStatusLines(); } },
  (text) => replyDrafts.say(run.id, text, () => [$(`[data-live="${CSS.escape(run.id)}"]`), $('#bot-thread')]),
  (plan) => {
    const held = state.runs.find((r) => r.id === run.id);
    if (held) { if (plan) held.plan = plan; else delete held.plan; }
    if (state.view === 'bot' && state.botId === run.botId) renderBotChat();
  });
  state.botStreams.push(es);
}

// Follow a running run (the stream replays what already happened first). onEnd() when the run finishes;
// onFile(file) for a file it attached; onLine(text) with its line, each time the server says one: its working
// line, or its opening line from a server without the working line. Its steps are not read: the words for what
// a run is doing are the server's. onDraft(text) with its reply draft, from a server that has drafts ('' for none).
// onPlan(plan) with its plan each time it changes (null when it was cleared; plan.js).
function watchRun(runId, onEnd, onFile, onLine, onDraft, onPlan) {
  const es = new EventSource(`/api/runs/${runId}/stream`);
  es.onmessage = (msg) => {
    const ev = JSON.parse(msg.data);
    if (ev.type === 'file') onFile?.(ev.file); // a file it attached: shown at once
    if (OpeningLine.says(ev.type, state.features)) onLine?.(ev.text);
    if (ev.type === 'reply_draft' && showsDrafts()) onDraft?.(String(ev.text ?? ''));
    if (ev.type === 'plan') onPlan?.(ev.plan || null);
    if (ev.type === 'run_end') { es.close(); onEnd?.(); }
  };
  es.onerror = () => es.close();
  return es;
}

// ---------- live screen preview (top right of a bot's chat, while it uses its computer) ----------

const pip = { runId: null, control: false, large: false };
const pipHidden = () => { try { return localStorage.getItem('botdot.pip.hidden') === '1'; } catch { return false; } };
const setPipHidden = (v) => { try { v ? localStorage.setItem('botdot.pip.hidden', '1') : localStorage.removeItem('botdot.pip.hidden'); } catch { /* private mode */ } };

function updatePip(bot, run) {
  const el = $('#bot-pip');
  if (!el) return;
  if (!run) { el.classList.add('hidden'); el.innerHTML = ''; pip.runId = null; pip.control = false; return; }
  const ready = state.computers?.[bot.id] === 'running';
  const key = `${run.id}:${pip.control}:${pipHidden()}:${pip.large}:${ready}`;
  if (el.dataset.key === key) return; // keep the stream running across refreshes
  el.dataset.key = key;
  pip.runId = run.id;
  el.classList.remove('hidden');
  el.classList.toggle('large', pip.large && !pipHidden());
  el.classList.toggle('in-control', pip.control);
  if (pipHidden()) {
    el.classList.add('collapsed');
    el.innerHTML = `<button class="pip-show" data-pip="show" title="Show ${esc(bot.name)}'s screen">${ICON.screen} Screen <span class="pill accent pulse">live</span></button>`;
  } else {
    el.classList.remove('collapsed');
    el.innerHTML = `
      <div class="pip-bar">
        <span class="pill ${pip.control ? 'warn' : 'accent pulse'}">${pip.control ? 'you control it' : 'live'}</span>
        <span class="grow pip-title">${esc(bot.name)}'s screen</span>
        <button class="icon-btn sm" data-pip="control" title="${pip.control ? 'Give control back (just watch)' : 'Take control: use its mouse and keyboard'}">${pip.control ? '👁' : '🖱'}</button>
        <button class="icon-btn sm" data-pip="size" title="${pip.large ? 'Make it smaller' : 'Make it bigger'}">${pip.large ? '⤡' : '⤢'}</button>
        <button class="icon-btn sm" data-pip="open" title="Open in a window, with full screen">⧉</button>
        <button class="icon-btn sm" data-pip="hide" title="Hide">✕</button>
      </div>
      ${ready ? `<iframe src="${screenUrl(bot.id, pip.control)}" title="${esc(bot.name)}'s screen"></iframe>` : '<div class="pip-wait">🖥 Starting its computer…</div>'}`;
    keepScreenConnected($('iframe', el));
  }
  $$('[data-pip]', el).forEach((b) => (b.onclick = () => {
    const a = b.dataset.pip;
    if (a === 'show') setPipHidden(false);
    if (a === 'hide') setPipHidden(true);
    if (a === 'size') pip.large = !pip.large;
    if (a === 'control') pip.control = !pip.control; // no question: the same button gives control back
    if (a === 'open') return openScreen(bot.id);
    updatePip(bot, run);
  }));
}
