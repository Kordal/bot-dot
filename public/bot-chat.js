// ---------- a bot's conversation ----------
// Each run is one block (#625): what started it, one folded line of its steps, its reply and a footer with its time
// and Details. The blocks stand in the order their replies ended (Unread.order): a run at work at the bottom.

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
  // A block stands where its reply ended, below what came while its run worked (a "/btw", another run): Unread.order (#460).
  // A run that replies to another (#627) is a further round of that run's block, which stands where its newest reply does.
  const replies = Unread.order(runs).filter((p) => p.part === 'reply').map((p) => p.run);
  const blocks = roundsOf(runs, replies);
  const lastReply = replies[replies.length - 1]?.id;
  const newest = runs[runs.length - 1]?.id;
  let lastDay = '';
  return blocks.map((rounds) => {
    const r = rounds[rounds.length - 1];
    const line = newFirst !== null && rounds.some((x) => x.id === newFirst) ? Unread.line(bot.color) : '';
    const html = r.kind === 'script' ? line + scriptRunHTML(r) : runBlockHTML(bot, rounds, newFirst, line, lastReply, newest);
    const when = r.status === 'running' ? r.startedAt : r.endedAt || r.startedAt;
    if (!html || !when) return html;
    const day = new Date(when).toDateString();
    const sep = day !== lastDay ? `<div class="day">${esc(new Date(when).toLocaleDateString(I18n.locale, { weekday: 'long', month: 'short', day: 'numeric' }))}</div>` : '';
    lastDay = day;
    return sep + html;
  }).join('');
}

// The blocks of a bot's chat from its replies in their order: a block's runs are its rounds, oldest first. A run that
// replies to another (`replyTo`, #627) joins that run's block, followed back while those runs are drawn; the block
// stands where its newest round's reply stands.
function roundsOf(runs, replies) {
  const byId = new Map(runs.map((r) => [r.id, r]));
  const rootOf = (r) => { let x = r; for (let i = 0; x.replyTo && byId.has(x.replyTo) && i < 50; i++) x = byId.get(x.replyTo); return x.id; };
  const blocks = new Map();
  replies.forEach((r) => { const k = rootOf(r); (blocks.get(k) || blocks.set(k, []).get(k)).push(r); });
  const at = new Map(replies.map((r, i) => [r.id, i]));
  const placed = (b) => Math.max(...b.map((r) => at.get(r.id)));
  const started = (r) => Date.parse(r.startedAt) || 0;
  return [...blocks.values()].sort((a, b) => placed(a) - placed(b)).map((b) => b.sort((x, y) => started(x) - started(y))); // rounds in the order they started
}

// One run's block: for each of its rounds, what started it, what the owner steered into it, its step line and its
// reply with its footer. line: the "New" line, in the round newFirst names: above what started the run, or, below the
// owner's own message (Unread.exchange), above the rest. With nothing drawn for what started it, above the rest.
function runBlockHTML(bot, rounds, newFirst, line, lastReply, newest) {
  const last = rounds[rounds.length - 1];
  const live = rounds.some((r) => r.status === 'running');
  const html = rounds.map((r) => {
    const { asked, steered, reply, mine, stop } = runParts(bot, r, r.id === lastReply, r.id === newest, r === last && replyable(r));
    const here = r.id === newFirst ? line : '';
    const top = asked ? Unread.exchange({ asked, mine }, mine ? '' : here) : '';
    // A run at work has its Stop at the right end of its step line (#635).
    const steps = stop ? `<div class="steps-row">${stepLineHTML(r)}${stop}</div>` : stepLineHTML(r);
    return `${r === rounds[0] ? '' : '<div class="round-rule"></div>'}${top}${steered.join('')}${mine || !asked ? here : ''}${steps}${reply}`;
  }).join('');
  // data-run: the round at work, whose line drawBlockLines keeps; else the newest.
  return `<section class="run-block${live ? ' live' : ''}" data-run="${esc((rounds.find((r) => r.status === 'running') || last).id)}">${html}</section>`;
}

// Whether the owner may reply to a run's block (#627): a run of the bot's own chat, against a botdot that takes it.
const replyable = (r) => (state.features || []).includes('reply-to') && !r.groupId && !r.btw && r.kind !== 'script' && r.status !== 'queued';
const replyBtnHTML = (r) => `<button type="button" class="reply-btn" data-reply-run="${esc(r.id)}">${tr('Reply')}</button>`;

const STEP_ICON = {
  open: '<svg class="ic chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  done: '<svg class="ic ok" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
  skill: '<svg class="ic sk" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></svg>',
  message: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
};
// The skills a run wrote or changed (what it learned, of a skill's kind): their names, each once.
const SKILL_KINDS = ['skill', 'skill-updated'];
const skillsChanged = (r) => [...new Set((r.learned || []).filter((x) => SKILL_KINDS.includes(x.kind)).map((x) => said(x.skill) || said(x.chip) || said(x.text)).filter(Boolean))];
// How long a run took, on its step line (#635): "42 s", "7 min", "1 h 5 min".
const tookFor = (ms) => { const s = Math.max(0, Math.round(ms / 1000)), m = Math.round(s / 60); return s < 60 ? `${s} s` : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`; };
// A time of a step: its hour and minute.
const stepTime = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(I18n.locale, { hour: '2-digit', minute: '2-digit' }); };
const firstLine = (t) => plain(String(t || '').split('\n').find((l) => l.trim()) || '').slice(0, 160);
// A run's step rows, less the last step that messaged each bot it has a row for (with what it said): that message is
// not drawn twice. Earlier messages to the same bot keep their step.
function shownSteps(r, sent) {
  const rows = Array.isArray(r.steps?.rows) ? [...r.steps.rows] : [];
  for (const t of sent) {
    const i = rows.findLastIndex((x) => x.kind === 'message' && x.text.endsWith(t.name || '\u0000'));
    if (i >= 0) rows.splice(i, 1);
  }
  return rows;
}
// What of a running run's step rows the chat shows (#633): a new row, or the last one that came again, draws it anew.
const stepsSig = (r) => { const rows = Array.isArray(r.steps?.rows) ? r.steps.rows : []; const last = rows[rows.length - 1]; return `${rows.length}:${last?.at ?? ''}:${last?.n ?? 1}`; };
// The open blocks' step lines, by run, each with whether its run was at work when it was opened: they stay open as the
// chat is drawn again. One opened to watch a run at work folds when the run ends, so a finished run's steps are folded.
const openSteps = new Map();
const stepsOpen = (r) => {
  if (openSteps.get(r.id) && r.status !== 'running') openSteps.delete(r.id);
  return openSteps.has(r.id);
};

// A run's step line (docs/api.md, "A run's steps"): folded, how many steps it took, the skills it changed and the
// bots it messaged; open, a row per step, with the messages it sent and the skills it changed among them. A run at
// work shows what it is doing now (its working line, the server's words) and its count so far. '' for a run that
// ended without a step, a skill or a message.
function stepLineHTML(r) {
  const running = r.status === 'running';
  const count = Number(r.steps?.count) || 0;
  const skills = skillsChanged(r);
  const to = sentTo(r);
  if (!running && !count && !skills.length && !to.length) return '';
  const n = count ? `<span class="step-n">${trn(count, '{n} step', '{n} steps')}</span>` : '';
  const sep = '<span class="step-dot">·</span>';
  const head = running
    ? `<i class="plan-spin"></i><span class="step-now">${esc(runLine(r))}</span>${n ? sep + n : ''}`
    : [`${STEP_ICON.done}${n}`, ...skills.map((k) => `<span class="step-pip skill"><span>${esc(k)}</span></span>`), ...to.map((t) => `<span class="step-pip">${STEP_ICON.message}<span>${esc(t.name || '')}</span></span>`),
      ...(r.durationMs != null ? [`<span class="step-took">${esc(tookFor(r.durationMs))}</span>`] : [])].join(sep);
  const label = [count ? trn(count, '{n} step', '{n} steps') : '', ...skills.map((k) => tr('the skill {name}', { name: k })), ...to.map((t) => t.name)].filter(Boolean).join(', ');
  const sent = to.filter((t) => t.text);
  const rows = [
    ...shownSteps(r, sent).map((x) => ({ at: x.at, icon: x.kind === 'message' ? STEP_ICON.message : x.kind === 'skill' ? STEP_ICON.skill : STEP_ICON.done, text: `${esc(x.text)}${x.n > 1 ? ` <span class="step-x">×${x.n}</span>` : ''}` })),
    ...sent.map((t) => ({ at: t.at, icon: STEP_ICON.message, text: `<b>${tr('Messaged {name}', { name: esc(t.name || '') })}</b><span class="step-q">${esc(firstLine(t.text))}</span>` })),
    ...(r.learned || []).filter((x) => SKILL_KINDS.includes(x.kind)).map((x) => ({ at: x.at, icon: STEP_ICON.skill, text: `<b>${esc(said(x.chip) || said(x.text))}</b>` })),
  ].map((x, i) => ({ ...x, i, t: Date.parse(x.at) })).sort((a, b) => (Number.isFinite(a.t) ? a.t : Infinity) - (Number.isFinite(b.t) ? b.t : Infinity) || a.i - b.i);
  return `<details class="run-steps${running ? ' now' : ''}" data-steps="${esc(r.id)}"${stepsOpen(r) ? ' open' : ''}>`
    + `<summary${label ? ` aria-label="${esc(label)}"` : ''}>${STEP_ICON.open}${head}</summary>`
    + (rows.length ? `<div class="step-rows">${rows.map((x) => `<div class="step-row"><time>${esc(stepTime(x.at))}</time>${x.icon}<span>${x.text}</span></div>`).join('')}</div>` : '')
    + '</details>';
}
// What a running run's step line says now: "Waiting for your OK" while it waits for the owner's answer, else its
// line in the server's words, else "Working".
function runLine(r) {
  if (r.waitingFor === 'ok') return OpeningLine.WAITING;
  return (typeof openingLines !== 'undefined' && openingLines.ofRun(`bot:${r.botId}`, r.id)) || OpeningLine.ofRun(r, state.features) || tr('Working');
}
// The running blocks' lines as the server says them, in place: no redraw of the chat.
function drawBlockLines(thread) {
  if (!thread) return;
  $$('.run-block.live', thread).forEach((block) => {
    const r = state.runs.find((x) => x.id === block.dataset.run);
    if (!r || r.status !== 'running') return;
    const now = $('.step-now', block);
    if (now && now.textContent !== runLine(r)) now.textContent = runLine(r);
    block.classList.toggle('held', r.waitingFor === 'ok');
    if (now) now.onclick = r.waitingFor === 'ok' ? (e) => { e.preventDefault(); if (!toHeldCard(thread, r.botId)) setView('needs'); } : null; // to the card it waits for
    const count = Number(r.steps?.count) || 0;
    const n = $('.step-n', block);
    if (count && !n) $('.run-steps summary', block)?.insertAdjacentHTML('beforeend', `<span class="step-dot">·</span><span class="step-n">${trn(count, '{n} step', '{n} steps')}</span>`);
    else if (n) n.textContent = trn(count, '{n} step', '{n} steps');
  });
}

// On a phone a long reply folds to its first paragraph and "More" (the style draws the fold in a narrow chat only). What
// links somewhere stays: a paragraph with a link is never folded, nor are its questions, which stand under it.
const LONG_REPLY = 600;
function foldLongReplies(thread) {
  $$('.run-block .bubble.from-bot:not(.problem) > .md', thread).forEach((el) => {
    if (el.children.length < 2 || el.textContent.length < LONG_REPLY || el.classList.contains('long') || $('pre', el)) return; // a code block is never cut
    el.classList.add('long');
    [...el.children].forEach((c) => { if ($('a[href]', c) || /https?:\/\//.test(c.textContent)) c.classList.add('keep'); }); // a link is never folded
    el.insertAdjacentHTML('afterend', `<button type="button" class="reply-more">${tr('More')}</button>`);
    el.nextElementSibling.onclick = (e) => { e.stopPropagation(); el.classList.add('more'); e.currentTarget.remove(); };
  });
}

// What a bot's chat draws of one run: what started it, each message steered into it, its reply. last: its reply is
// the last in the chat (its quick answers stand under it). newest: it is the run that started last.
function runParts(bot, r, last, newest, canReply = false) {
  // Messages other bots left for it, read at the start of this run.
  const notes = notesFoldHTML(r.inbox, r.inbox?.length === 1 ? tr('Read a note from') : tr('Read notes from'));
  let mine = false; // your own message started it: that isn't new, so the "New" line goes below it
  const asked = notes + (r.trigger === 'replies' || (r.trigger === 'bot' && !r.fromBot) ? '' // the answers it waited for, or notes that woke it (#225): the notes above are what started it
    : sender(r) // a message from another bot or the Chief: one folded line that opens to what it said
    ? `<div class="bubble-row from-me"><details class="notes-fold" ${state.keepOpen === r.id ? 'open' : ''}>${foldSummary(tr('Message from {name}', { name: botLabel(sender(r)) }), r.prompt)}<div class="note"><div class="bubble from-other-bot">${esc(r.prompt)}${filesHTML(r.attachments)}</div><div class="bubble-meta">${copyBtn(r.prompt)}</div></div></details></div>`
    : r.jobName
    ? `<div class="bubble-row from-me"><span class="chip">${r.jobId === 'memory-review' ? '🧹' : '⏰'} ${esc(r.jobName)}${r.trigger === 'call' ? tr(', called') : ''}${r.parentRunId ? ` · ${tr('its script found something')}` : ''} · ${esc(msgTime(r.startedAt))}</span></div>`
    : r.trigger === 'schedule'
    ? `<div class="bubble-row from-me"><span class="chip">⏰ ${tr('Scheduled run · {time}', { time: esc(msgTime(r.startedAt)) })}</span></div>`
    : r.trigger === 'hello' ? '' // a new bot's first message (#511): you asked nothing
    : r.trigger === 'project' ? '' // a lead's work for its project that botdot started (#696): you asked nothing
    : r.kind === 'reminder' ? '' // a reminder it set went off (#343): botdot posted it, nobody asked
    : r.continues ? '' // it carries on after your OK: the request stands once, above the reply of the run that stopped (docs/api.md, "What follows a yes")
    : r.customPrompt === false
      ? `<div class="bubble-row from-me"><span class="chip">${ICON.play} ${tr('Ran its main assignment')}</span></div>`
      : (mine = true, `<div class="bubble-row from-me"><div class="stack mine"><div class="bubble from-me" data-expand><div class="clamp">${escMentions(r.prompt, r.botId)}</div>${filesHTML(r.attachments, `bot:${r.botId}`)}</div><div class="bubble-meta on-hover">${copyBtn(r.prompt)}</div></div></div>`));
  // What the owner steered into it while it worked (ADR 040): their messages, after its request, without buttons.
  const steered = (Array.isArray(r.steered) ? r.steered : []).map((x) => `<div class="bubble-row from-me"><div class="stack mine"><div class="bubble from-me" data-expand><div class="clamp">${escMentions(String(x.text || ''), r.botId)}</div>${filesHTML(Array.isArray(x.attachments) ? x.attachments : [], `bot:${r.botId}`)}</div><div class="bubble-meta on-hover"><span>${tr('Steered · {time}', { time: esc(msgTime(x.at)) })}</span>${copyBtn(String(x.text || ''))}</div></div></div>`);
  let reply, stop = '';
  if (r.status === 'running') {
    // No bubble while it works: its step line says it. Only what it attached so far. From a server with drafts, the
    // reply as it is written so far stands here, and grows in place (replyDrafts). Its footer: when it started; its
    // Stop stands at the end of its step line (runBlockHTML).
    reply = `<div class="bubble-row from-bot" data-live="${esc(r.id)}">${draftHTML(replyDrafts.of(r.id), true)}${botFilesHTML(r.files)}</div>
      <div class="bubble-meta block-foot on-hover"><span>${esc(msgTime(r.startedAt))}</span><span class="grow"></span>${canReply ? replyBtnHTML(r) : ''}</div>`;
    stop = `<button type="button" class="block-stop" data-stop-run="${esc(r.id)}">${tr('Stop')}</button>`;
  } else {
    const failed = ['error', 'stopped', 'interrupted'].includes(r.status);
    const body = failed ? r.problem || friendlyProblem(r, r.result) : r.result || tr('Done. (No written reply.)');
    const meta = [msgTime(r.endedAt || r.startedAt), r.durationMs != null ? dur(r.durationMs) : null].filter(Boolean);
    // Between bots (a run another bot or the Chief started) the reply folds as the message above it does: one line,
    // whom it answered and its first words, that opens to what it sent its teammates and the reply. A problem stays open,
    // and so does a reply that addresses the owner: a teammate's request whose reply only the owner reads (#465).
    const outgoing = sentTo(r).filter((t) => t.text);
    // What it learned stands under it, but the skills it changed: those are in its step line (stepLineHTML).
    const bubble = `<div class="bubble from-bot ${failed ? 'problem' : ''}"><div class="md">${md(body, failed ? null : r.botId)}</div>${failed ? '' : globalThis.docButton?.({ run: r.id }, body) || ''}${botFilesHTML(r.files)}${typeof Pages !== 'undefined' ? Pages.chipsHTML(r) : ''}${globalThis.reconnectCardsHTML?.(r) || ''}${globalThis.planInReply?.(r, newest) || ''}</div>
        ${learnedChips({ ...r, learned: (r.learned || []).filter((x) => !SKILL_KINDS.includes(x.kind)) })}`;
    const shown = sender(r) && !failed && r.notificationAudience !== 'owner'
      ? `<details class="notes-fold theirs" ${state.keepOpen === r.id ? 'open' : ''}>${foldSummary(exchangeLabel(r), body)}
          ${outgoing.map((t) => `<div class="note"><div class="bot-msg-label">${tr('To {name}', { name: botLabel(t) })}</div><div class="bubble from-bot"><div class="md">${md(t.text)}</div></div></div>`).join('')}
          <div class="note">${bubble}</div>
        </details>`
      : bubble; // whom it messaged is in its step line (stepLineHTML)
    // Its questions are never folded: under the reply, above the block's footer.
    reply = `
      <div class="bubble-row from-bot"><div class="stack">
        ${shown}
        ${(last || r.id === bot.asks?.runId) && !failed ? choicesHTML(r.choices, r.yes, bot.color, r.id) + questionsHTML(r.questions) : ''}
        <div class="bubble-meta block-foot on-hover">${meta.map(esc).join(' · ')}${r.kind === 'reminder' ? '' : ` <button data-details="${esc(r.id)}">${tr('Details')}</button>`}${copyBtn(body)}${canReply ? replyBtnHTML(r) : ''}</div>
      </div></div>`;
  }
  return { asked, steered, reply, mine, stop };
}

// "Run now" under the notes that wait (#225): the bot starts with them, or once it is free.
async function runNotes(botId, btn) {
  btn.disabled = true;
  try {
    const { status } = await api(`/bots/${encodeURIComponent(botId)}/inbox/run`, { method: 'POST' });
    if (status === 'queued') toast(tr('{name} is busy: it reads them once it is free.', { name: botById(botId)?.name || tr('It') }));
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

// The ⋯ of a bot's chat head (#635): its settings, its computer and "Add a bot to this chat", so the head holds
// only its figure, its name, Files and this. It closes on a pick, a click outside it, and Esc (which then opens no Chief).
const MORE_ICON = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/></svg>';
function wireChatMenu(wrap) {
  const btn = wrap.querySelector('button');
  const menu = wrap.querySelector('[role="menu"]');
  const open = (on) => {
    menu.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
    if (on) menu.querySelector('button:not(.hidden)')?.focus();
  };
  btn.onclick = () => open(menu.hidden);
  menu.addEventListener('click', (e) => { if (e.target.closest('button')) open(false); });
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); open(false); btn.focus(); } });
}
// A tap in a chat shows the time, Details, Copy and Reply of that run or row (#635): a touch screen has no hover.
document.addEventListener('click', (e) => {
  const at = e.target.closest?.('.chat-thread .run-block, .chat-thread .bubble-row');
  for (const el of document.querySelectorAll('.chat-thread .tapped')) if (el !== at && !el.contains(at)) el.classList.remove('tapped');
  at?.classList.add('tapped');
});
// One listener for every ⋯ menu: the head is built again for each bot.
document.addEventListener('pointerdown', (e) => {
  for (const wrap of document.querySelectorAll('.chat-more')) {
    const menu = wrap.querySelector('[role="menu"]');
    if (!menu.hidden && !wrap.contains(e.target)) { menu.hidden = true; wrap.querySelector('button').setAttribute('aria-expanded', 'false'); }
  }
});

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
        <button class="chat-title" id="bot-settings" title="${tr('Settings')}">
          <div id="bot-avatar"></div>
          <div class="grow"><h2 id="bot-name"></h2></div>
        </button>
        <div class="actions-right">
          <button class="icon-btn hidden" id="bot-files" title="${tr('Files')}" aria-label="${tr('Files')}">${ICON.folder}</button>
          <div class="chat-more">
            <button type="button" class="icon-btn" id="bot-more" title="${tr('More')}" aria-label="${tr('More')}" aria-haspopup="menu" aria-expanded="false">${MORE_ICON}</button>
            <div class="chat-menu" role="menu" hidden>
              <button type="button" role="menuitem" data-more="settings">${tr('Settings')}</button>
              <button type="button" role="menuitem" class="hidden" id="bot-screen">${tr('Its computer')}</button>
              <button type="button" role="menuitem" class="hidden" id="bot-add-to-chat">${tr('Add a bot to this chat')}</button>
            </div>
          </div>
        </div>
      </div>
      <div class="chat-thread" id="bot-thread"></div>
      <div class="pip hidden" id="bot-pip"></div>
      ${composerHTML(tr('Message {name}', { name: bot.name }))}`;
    const form = $('form', root);
    wireComposer(form, (text, files, key) => runBot(bot.id, text, files, key, replyingTo.get(bot.id)?.runId), () => `bot:${bot.id}`, bot.id);
    $('.attach-list', form).insertAdjacentHTML('beforebegin', '<div class="reply-chip hidden"></div>');
    drawReplyChip(bot.id);
    $('#bot-settings').onclick = () => setPanel('toggle');
    wireChatMenu($('.chat-more', root));
    $('[data-more="settings"]', root).onclick = () => setPanel('toggle');
    // A group grown from this chat (groups.js): this bot and those picked. Its own chat stays as it is.
    $('#bot-add-to-chat').onclick = () => { const b = state.bots.find((x) => x.id === state.botId); if (b && canMakeGroup(b)) openGroupMaker(b); };
    $('#bot-screen').onclick = () => openScreen(state.botId);
    $('#bot-files').onclick = () => { const b = state.bots.find((x) => x.id === state.botId); if (b) Files.open(b); }; // files.js (#603)
    loadInbox(bot.id);
  }
  const av = $('#bot-avatar');
  const look = bot.color + bot.state + JSON.stringify(bot.outfit || '');
  if (av.dataset.sig !== look) { av.dataset.sig = look; av.innerHTML = botFigure(bot.color, bot.state, 'sm', bot.outfit); }
  $('#bot-name').textContent = bot.name;
  $('#bot-screen').classList.toggle('hidden', bot.computer !== 'linux' && bot.computer !== 'boat');
  $('#bot-files').classList.toggle('hidden', !state.features.includes('files-explorer'));
  // In its ⋯ menu (#635), with its computer: only where a group can be made.
  $('#bot-add-to-chat').classList.toggle('hidden', !canMakeGroup(bot));

  // Re-render the thread only when something changed, so live bits and scroll survive refreshes.
  const waiting = state.inbox[bot.id] || [];
  const sig = runs.map((r) => `${r.id}:${r.status}${r.status === 'running' ? `:${stepsSig(r)}:${sentTo(r).length}` : ''}`).join('|') + `|notes:${waiting.map((n) => n.at).join(',')}|${mentionSig()}|new:${newFirst ?? ''}|asks:${bot.asks?.runId ?? ''}`;
  const thread = $('#bot-thread');
  if (root.dataset.sig !== sig) {
    const atBottom = !root.dataset.sig || thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120;
    root.dataset.sig = sig;
    thread.innerHTML = botThreadHTML(bot, runs, newFirst) + waitingNotesHTML(bot.id, waiting);
    if (atBottom) thread.scrollTop = thread.scrollHeight;
    scrollToNew(thread);
    $$('[data-expand]', thread).forEach((el) => (el.onclick = (e) => { if (!e.target.closest('a') && getSelection().isCollapsed) el.firstElementChild.classList.toggle('clamp'); })); // a click that ends a selection (to quote it) folds nothing
    $$('[data-details]', thread).forEach((el) => (el.onclick = () => openRun(el.dataset.details)));
    // A block's step line opens and closes, and stays so; Stop in a running block's footer ends that run.
    $$('details.run-steps', thread).forEach((el) => el.addEventListener('toggle', () => { if (el.open) openSteps.set(el.dataset.steps, el.classList.contains('now')); else openSteps.delete(el.dataset.steps); }));
    $$('[data-reply-run]', thread).forEach((el) => (el.onclick = () => pickReply(bot.id, el.dataset.replyRun)));
    $$('[data-stop-run]', thread).forEach((el) => (el.onclick = () => { el.disabled = true; stopRun(el.dataset.stopRun); }));
    foldLongReplies(thread);
    $$('[data-run-notes]', thread).forEach((el) => (el.onclick = () => runNotes(el.dataset.runNotes, el)));
    wireChoices(thread, (t, key) => sendFrom($('form', root), () => runBot(bot.id, t, [], key)));
    $$('[data-screen-open]', thread).forEach((el) => (el.onclick = () => openScreen(el.dataset.screenOpen)));
    // What it learned: a job opens its jobs, a change to its task, rules or skills its settings. A note opens nothing.
    $$('[data-learned]', thread).forEach((el) => (el.onclick = () => openLearned(el, state.botId)));
    // A skill's chip at the start of the owner's message opens it in the settings too; "/btw" is no skill.
    $$('.cmd', thread).forEach((el) => {
      const name = el.textContent.slice(1).toLowerCase();
      if (name === 'btw') return;
      el.classList.add('opens');
      el.onclick = (e) => { e.stopPropagation(); state.openSkill = { bot: state.botId, name }; setView('botsettings', state.botId); };
    });
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
  updatePip(bot, bot.computer === 'linux' ? runs.find((r) => r.status === 'running' && r.computer) : null); // a machine on boat.dev has no live screen beside its runs
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
async function runBot(botId, text, attachments = [], key = messageKey(), replyTo = null) {
  const at = `bot:${botId}`;
  sentAtOnce(at, { key, text, attachments });
  showSent($('#bot-thread'));
  let took;
  try {
    took = await api(`/bots/${botId}/run`, { method: 'POST', body: { prompt: text || undefined, attachments, key, ...(replyTo ? { replyTo } : {}) } });
  } catch (e) {
    sentOver(at, key, false); // it did not go: nothing of it stays in the chat
    placeStatusLines();
    throw e;
  }
  // The task went. Nothing from here on may reject: the caller would put a sent message back into the box.
  try {
    if (replyTo && replyingTo.get(botId)?.runId === replyTo) { replyingTo.delete(botId); drawReplyChip(botId); }
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
// The run of a bot's chat the owner picked Reply on (#627), by bot: { runId, text }, until it is sent or ✕.
const replyingTo = new Map();
// Reply on a block: the chip above the box names the request of the block's first round, and the box takes the words.
function pickReply(botId, runId) {
  const runs = state.runs.filter((r) => r.botId === botId);
  let first = runs.find((r) => r.id === runId);
  for (let i = 0; first?.replyTo && i < 50; i++) first = runs.find((r) => r.id === first.replyTo) || first;
  replyingTo.set(botId, { runId, text: firstLine(first?.prompt) || tr('this task') });
  drawReplyChip(botId);
  $('#view-bot textarea')?.focus();
}
function drawReplyChip(botId) {
  const chip = $('#view-bot .reply-chip');
  if (!chip || state.botId !== botId) return; // the chat on screen is another bot's: its own chip stays
  const to = replyingTo.get(botId);
  chip.classList.toggle('hidden', !to);
  chip.innerHTML = to ? `<span class="grow">${tr('Reply to: {text}', { text: esc(to.text) })}</span><button type="button" aria-label="${tr("Don't reply to it")}">✕</button>` : '';
  if (to) $('button', chip).onclick = () => { replyingTo.delete(botId); drawReplyChip(botId); };
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
    el.innerHTML = `<button class="pip-show" data-pip="show" title="${tr("Show {name}'s screen", { name: esc(bot.name) })}">${ICON.screen} ${tr('Screen')} <span class="pill accent pulse">${tr('live')}</span></button>`;
  } else {
    el.classList.remove('collapsed');
    el.innerHTML = `
      <div class="pip-bar">
        <span class="pill ${pip.control ? 'warn' : 'accent pulse'}">${pip.control ? tr('you control it') : tr('live')}</span>
        <span class="grow pip-title">${tr("{name}'s screen", { name: esc(bot.name) })}</span>
        <button class="icon-btn sm" data-pip="control" title="${pip.control ? tr('Give control back (just watch)') : tr('Take control: use its mouse and keyboard')}">${pip.control ? '👁' : '🖱'}</button>
        <button class="icon-btn sm" data-pip="size" title="${pip.large ? tr('Make it smaller') : tr('Make it bigger')}">${pip.large ? '⤡' : '⤢'}</button>
        <button class="icon-btn sm" data-pip="open" title="${tr('Open in a window, with full screen')}">⧉</button>
        <button class="icon-btn sm" data-pip="hide" title="${tr('Hide')}">✕</button>
      </div>
      ${ready ? `<iframe src="${screenUrl(bot.id, pip.control)}" title="${tr("{name}'s screen", { name: esc(bot.name) })}"></iframe>` : `<div class="pip-wait">🖥 ${tr('Starting its computer…')}</div>`}`;
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
