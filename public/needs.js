// ---------- Needs you: everything waiting for the owner, as small heads in a banner and cards on a page ----------

// Jobs, memory changes, login and payment requests, and a locked Bitwarden, each with its bot (none: the Chief's).
// then: what a yes on it starts, as the botdot server says it (docs/api.md, "What follows a yes"): on an ask and on
// a waiting tile, and for a waiting job in the live feed's list of what waits.
// The memory changes that wait, guarded ones too (docs/api.md, "A guarded change"): each is a card here.
const MEMORY_WAITS = '/memory/pending?guarded=1';
// group: the group a card was asked in, `{ id, name }` (groupOfNeed): it stands at the end of that group's chat
// (groups.js) and in no bot's own.
function needsItems() {
  const bw = state.bw;
  return needsList(bw).map((x) => { const group = groupOfNeed(x); return group ? { ...x, group } : x; });
}
function needsList(bw) {
  return [
    ...(loginReq.pending || []).map((r) => {
      const chief = r.from === 'chief' && !botById(r.botId);
      return { key: `req:${r.id}`, kind: r.kind === 'card' ? 'pay' : 'login', r, bot: chief ? CHIEF_BOT : r.bot, color: chief ? CHIEF_COLOR : colorOf(r.bot) };
    }),
    ...(bw && bw.configured && !bw.unlocked ? [{ key: 'bitwarden', kind: 'bitwarden', bot: bw.wantedBy, color: bw.wantedBy ? colorOf(bw.wantedBy) : CHIEF_COLOR }] : []),
    ...pendingJobs().map(({ bot, job }) => ({ key: `job:${job.id}${changeKey(job)}`, kind: 'job', bot, job, color: bot.color, then: job.then || fedJobThen(bot.id, job.id) })),
    ...(state.memPending || []).map((p) => ({ key: `mem:${p.id}`, kind: 'memory', p, bot: p.bot, color: colorOf(p.bot) })),
    // A permission or a skill a bot (or the Chief) asked for, and a tool the Chief asks to install for a bot.
    // The Chief's own action in a connected app (`chief`, ADR 047) is the Chief's card, as a skill it asks for is.
    ...(state.asks || []).map((a) => ({ key: `ask:${a.id}`, kind: 'ask', a, bot: a.bot || (a.kind === 'skill' || a.chief ? CHIEF_BOT : null), color: a.bot ? colorOf(a.bot) : CHIEF_COLOR, then: a.then })),
    // A tile on the Board with a script: it runs on this computer, so it waits for you.
    ...(state.dash?.pending || []).map((t) => { const b = botById(t.bot); return { key: `tile:${t.id}:${tileScripts(t).join('').length}${changeKey(t)}`, kind: 'tile', t, bot: b || null, color: b ? b.color : CHIEF_COLOR, then: t.then }; }),
    // A bot's plan for the Chief: nothing happens until you approve it (here or in its chat).
    ...(state.chats || []).filter((c) => c.waiting).map((c) => ({ key: `sug:${c.id}`, kind: 'suggestion', chat: c, bot: c.waiting.from, color: colorOf(c.waiting.from) })),
  ];
}

// The group a card was asked in, `{ id, name }`, or null for a card of a bot's own chat (docs/api.md, "A card and
// a question in a group"). An ask, a login request and a memory change carry it; for a waiting job and a tile the
// feed's list of what waits does (`approvals`).
function groupOfNeed(x) {
  const fed = (list, same) => (Array.isArray(list) ? list : []).find((c) => c && same(c));
  const from = x.kind === 'ask' ? x.a : x.kind === 'login' || x.kind === 'pay' ? x.r : x.kind === 'memory' ? x.p
    : x.kind === 'job' ? fed(state.approvals?.jobs, (j) => j.botId === x.bot?.id && j.jobId === x.job?.id)
    : x.kind === 'tile' ? fed(state.approvals?.tiles, (t) => t.tileId === x.t?.id) : null;
  if (typeof from?.groupId !== 'string' || !from.groupId) return null;
  const name = (state.groups || []).find((g) => g.id === from.groupId)?.name || (typeof from.groupName === 'string' ? from.groupName : '');
  return { id: from.groupId, name: name || 'a group' };
}

// One card per run (docs/api.md, "One card per run"): the asks that share a `batch` are one card, where the first of
// them stood, with "Allow all" and "Decline all" above each ask's own card. A batch with one ask left on the page is
// that ask's card again. items: what stands on the page or in the chat, open ones only.
const batchIdOf = (x) => (x.kind === 'ask' && typeof x.a.batch?.id === 'string' && x.a.batch.id ? x.a.batch.id : null);
function batched(items) {
  const count = new Map();
  for (const x of items) { const id = batchIdOf(x); if (id) count.set(id, (count.get(id) || 0) + 1); }
  const out = [];
  const cards = new Map();
  for (const x of items) {
    const id = batchIdOf(x);
    if (!id || count.get(id) < 2) { out.push(x); continue; }
    if (!cards.has(id)) {
      const card = { key: `batch:${id}`, kind: 'batch', id, title: said(x.a.batch.title), items: [], bot: x.bot, color: x.color, ...(x.group ? { group: x.group } : {}) };
      cards.set(id, card);
      out.push(card);
    }
    cards.get(id).items.push(x);
  }
  return out;
}
// What "Allow all" leaves to an ask's own buttons (`own` on its batch): a Vault secret, an action too long to show.
const ownYes = (x) => x.a?.batch?.own === true;

// A change has a card of its own: a second change to the same job or tile, proposed after the first was answered
// on this page, is a new card and not the answered one.
const changeKey = (x) => (changeOf(x) ? `:change:${said(changeOf(x).at)}` : '');

// What a yes on a waiting job starts: the feed lists the waiting jobs (`approvals.jobs`), each with its `then`.
const fedJobThen = (botId, jobId) => (Array.isArray(state.approvals?.jobs) ? state.approvals.jobs : []).find((j) => j?.botId === botId && j.jobId === jobId)?.then;

const needsFigures = (items) => `<span class="needs-figs">${items.map((x, i) => `<i style="animation-delay:${(i * 0.15).toFixed(2)}s">${x.bot ? botMark(x.bot) : Figure.small(CHIEF_COLOR, Figure.CHIEF)}</i>`).join('')}</span>`;

// What one thing waits on, in a few words, for the one-line summary on the keypad's Needs you card (#397): its card's
// title where the server sends one, else the words its card is drawn with.
function needLine(x) {
  const a = x.a || {};
  switch (x.kind) {
    case 'batch': return x.title || 'Several actions';
    case 'job': return jobCard(x.job).title;
    case 'tile': return tileCard(x.t).title;
    case 'memory': return said(x.p.title) || 'A memory change';
    case 'suggestion': return `A plan: ${x.chat.title}`;
    case 'tilesug': return `“${x.s.tile.title}” on the Board`;
    case 'bitwarden': return 'Bitwarden is locked';
    case 'pay': return `Pay on ${x.r.site}`;
    case 'login': return `A login for ${x.r.site}`;
    default:
      if (a.kind === 'permission') return `Let it ${a.what?.label || a.permission}`;
      if (ToolCard.is(a)) return said(a.title) || 'A tool to install';
      if (a.kind === 'skill' && !a.written) return `The skill “${a.skill?.name || ''}”`;
      return said(a.title) || said(a.text) || 'An OK';
  }
}
// The bots something waits for: a key of theirs says "Needs you".
const needsBots = (items) => new Set(items.flatMap((x) => (x.kind === 'batch' ? x.items : [x]).map((y) => y.bot?.id).filter(Boolean)));

// The banner: one small head per thing, in its bot's colour and hat, nothing to count. Review opens the one thing, or the page for several.
function showNeeds() {
  tellTab();
  const banner = $('#needs-banner');
  if (!banner) return;
  const items = batched(needsItems());
  const review = () => (items.length === 1 ? openNeed(items[0]) : setView('needs'));
  banner.classList.toggle('hidden', !items.length || state.view === 'needs');
  if (items.length) {
    banner.innerHTML = `${needsFigures(items)}<span>Waiting for your OK</span><button class="btn sm primary" id="needs-open">Review</button>`;
    $('#needs-open').onclick = review;
  }
  drawKeypadNeeds(state.view === 'needs' ? [] : items, review, items); // the same, on the keypad
  if (state.view === 'needs') renderNeeds();
  drawChatCards(); // the cards at the end of the open bot's or Chief's chat
  if (state.view === 'group') drawGroupCards(); // the cards at the end of the open group (groups.js)
}

function openNeed(x) {
  if (x.kind === 'job') return openJobApproval(x.bot, x.job);
  if (x.kind === 'bitwarden') return bwUi.unlocking ? null : openUnlock();
  if (x.kind === 'suggestion') return openChiefChat(x.chat.id);
  if (x.kind === 'tile') return setView('needs'); // the script is on its card
  if (x.kind === 'login' || x.kind === 'pay') return openLoginRequest(x.r);
  return setView('needs'); // anything else (a permission or skill a bot asked for, a memory change) is answered on its card
}

// Decided cards stay on the page, faded, until you leave it.
const needsDone = new Map(); // key -> the card's HTML
const needsOpen = new Set(); // cards clicked open (the rest show a few lines each)

// here: the Chief chat the card stands in (its id), null on the Needs you page and in a bot's chat.
function needCardHTML(x, here = null) {
  if (x.kind === 'batch') return batchCardHTML(x, here);
  // Whose it is, and for a card asked in a group, in which: the group's own chat says only the bot.
  const who = x.bot ? `${botLabel(x.bot)}${x.group && here !== `group:${x.group.id}` ? ` <span class="need-in">in ${esc(x.group.name)}</span>` : ''}` : '';
  // Under the body, one line that says who carries on after a yes, when the server says something does.
  const then = thenLine(x.then, here);
  const card = (title, meta, body, actions, cls = '') => `
    <div class="${['card', 'need-card', cls, needsOpen.has(x.key) ? 'open' : ''].filter(Boolean).join(' ')}" data-need="${esc(x.key)}" title="Click to see it all">
      ${who ? `<div class="need-who">${who}</div>` : ''}
      <div class="need-title">${title}</div>
      ${meta ? `<div class="need-meta">${meta}</div>` : ''}
      ${body || ''}${then ? `<div class="need-meta need-then">${esc(then)}</div>` : ''}
      <div class="need-actions">${actions}</div>
    </div>`;
  // A job: one that waits for its first OK, or a change to an approved one (jobCard). The no and the yes read the
  // server's words where it sends them: "Decline and remove", "Keep as it is", "Approve the change".
  if (x.kind === 'job') {
    const m = jobCard(x.job);
    return card(esc(m.title), esc(m.meta),
      `${summedHTML(m.summary, `${alsoHTML(m.also)}${changeBlocks([[m.scriptWas, m.script, 'pre'], [m.promptWas, m.prompt, 'div']])}`)}${m.assessment ? `<div class="job-why">${esc(m.assessment)}</div>` : ''}${untilHTML(m.line)}`,
      `<button class="btn sm" data-need-no>${esc(m.no)}</button><button class="btn sm" data-need-always>Always approve</button><button class="btn sm primary" data-need-yes>${esc(m.yes)}</button>`, [m.change ? 'need-changed' : '', m.summary ? 'need-summed' : ''].filter(Boolean).join(' '));
  }
  // A memory change: the title, why it waits and both buttons are the server's words (docs/api.md, "A waiting
  // memory change"), the same in every app. The body is the note: for a change one block, what goes, struck,
  // above what comes, so that a closed card shows the start of both; for a forget, what it would erase.
  if (x.kind === 'memory') {
    const p = x.p;
    const was = said(p.current?.text), now = said(p.text);
    return card(esc(said(p.title)), [shortTime(p.at), said(p.meta), said(p.reason)].filter(Boolean).map(esc).join(' · '),
      p.action === 'edit' ? changeBlock(was, now, 'div') : `<div class="need-body"><div class="nb">${esc(p.action === 'remove' ? was : now)}</div></div>`,
      `<button class="btn sm" data-need-no>${esc(said(p.no))}</button><button class="btn sm primary" data-need-yes>${esc(said(p.yes))}</button>`);
  }
  if (x.kind === 'ask' && x.a.kind === 'permission') return card(`Let it ${esc(x.a.what?.label || x.a.permission)}?`, x.a.reason ? esc(x.a.reason) : '',
    `<div class="need-body"><div class="nb">${esc((x.a.what?.hint || '').replace(/^./, (c) => c.toUpperCase()))}. It can't until you allow it; you can change this in its settings.</div></div>`,
    `<button class="btn sm" data-need-no>Decline</button><button class="btn sm primary" data-need-yes>Allow</button>`);
  // A changed bot: the server's title, and what changes as its `parts`. Without them, the details as they were written.
  // The yes button reads the server's `yes` where it sends one ("Allow", for a change that only gives permissions).
  if (x.kind === 'ask' && x.a.kind === 'bot-change') {
    const parts = partsHTML(x.a.parts);
    return card(esc(x.a.title), esc(x.a.reason || ''), parts || `<div class="need-body"><pre class="nb">${esc(x.a.details)}</pre></div>`,
      `<button class="btn sm" data-need-no>Decline</button><button class="btn sm primary" data-need-yes>${esc(said(x.a.yes) || 'Approve')}</button>`, parts ? 'need-rows' : '');
  }
  // A switch of a saved login a bot asks for (`vault-switch`): the server's title, the bot's reason, the login and the
  // switch as rows, the warning of "Usable in its computer", and the server's word on the yes. A Vault entry a bot asks
  // to remove (`vault-remove`) is drawn the same way: its rows name the entry, the bot and Bitwarden's Trash. So are
  // secrets a bot asks to keep in a file (`vault-file`, #253): the secrets, the file, and who can read it there. A rule a bot
  // asks to lift (`override`) too, with the server's second yes, `always`, between the two.
  if (x.kind === 'ask' && (x.a.kind === 'vault-switch' || x.a.kind === 'vault-remove' || x.a.kind === 'vault-file' || x.a.kind === 'override')) {
    const warning = said(x.a.warning);
    const always = x.a.kind === 'override' ? said(x.a.always) : '';
    return card(esc(said(x.a.title)), esc(said(x.a.reason)),
      `${partsHTML(x.a.parts)}${warning ? `<div class="need-body need-warn" role="note"><div class="nb">⚠️ ${esc(warning)}</div></div>` : ''}`,
      `<button class="btn sm" data-need-no>Decline</button>${always ? `<button class="btn sm" data-need-always>${esc(always)}</button>` : ''}<button class="btn sm primary" data-need-yes>${esc(said(x.a.yes) || 'Allow')}</button>`, 'need-rows');
  }
  // An action in a connected app: the server's title, whether its run still waits for the answer, and the action's
  // `rows`, drawn as a tool's facts: every row, and every value in full on an opened card. Without them, the
  // details as they were written. Rows that were cut short (the feed's entry) are not all a yes approves: the card
  // then shows `details` under them and offers no yes, until the list has brought the whole rows.
  // An action too long to show in full (`more` on the ask) has the rows that fit and one line that says so. It
  // cannot be allowed once, since that would send what the card does not show: Decline and "Always allow this
  // action" are left. Its `details` are as long as the action and are not drawn.
  if (x.kind === 'ask' && x.a.kind === 'connector-action') {
    const rows = ToolCard.rows(x.a.rows);
    const cut = !!rows && rowsCut(x.a);
    const long = !cut && tooLong(x.a);
    const details = () => (said(x.a.details) || !rows ? `<div class="need-body"><pre class="nb">${esc(x.a.details)}</pre></div>` : '');
    const body = long ? `${rows}<div class="need-meta">Too long to show in full.</div>` : rows ? `${rows}${cut ? details() : ''}` : details();
    return card(esc(x.a.title), esc(heldLine(x.a) || x.a.reason || ''), body,
      `<button class="btn sm" data-need-no>Decline</button>${cut ? '' : `<button class="btn sm" data-need-always>${esc(said(x.a.always) || 'Always allow')}</button>${long ? '' : '<button class="btn sm primary" data-need-yes>Allow once</button>'}`}`, rows ? 'need-rows' : '');
  }
  // A shared room's cards (docs/api.md, "Shared rooms: the owner's mention"): a tool a run from a room wants to use,
  // and what would go to a room. The server's title, why it waits (`meta`), the rows and the yes word. Rows cut short
  // (the feed's entry), or more than the card can show (`tooLong`), offer no yes: a yes approves only what is seen.
  if (x.kind === 'ask' && (x.a.kind === 'room-tool' || x.a.kind === 'room-post')) {
    const rows = ToolCard.rows(x.a.rows);
    const shut = rowsCut(x.a) || tooLong(x.a);
    return card(esc(said(x.a.title)), esc(said(x.a.meta)), `${rows}${shut && !rowsCut(x.a) ? '<div class="need-meta">Too long to show in full.</div>' : ''}`,
      `<button class="btn sm" data-need-no>Decline</button>${shut ? '' : `<button class="btn sm primary" data-need-yes>${esc(said(x.a.yes) || 'Allow')}</button>`}`, rows ? 'need-rows' : '');
  }
  // What the Chief asked to do after it read the web in a chat (docs/api.md, "The Chief reads the web"): the server's
  // title, why it waits (`meta`), and what it sent as `rows`, drawn as an action in a connected app's are. Rows cut
  // short (the feed's entry) or a request too long to show in full offer no yes: the yes does exactly what was sent.
  if (x.kind === 'ask' && x.a.kind === 'chief-action') {
    const rows = ToolCard.rows(x.a.rows);
    // A request of a type the owner may let through for good (#280) has the server's second yes, `always`.
    const shut = rowsCut(x.a) || tooLong(x.a);
    const always = shut ? '' : said(x.a.always);
    return card(esc(x.a.title), esc(said(x.a.meta)), `${rows}${tooLong(x.a) ? '<div class="need-meta">Too long to show in full.</div>' : ''}`,
      `<button class="btn sm" data-need-no>Decline</button>${always ? `<button class="btn sm" data-need-always>${esc(always)}</button>` : ''}${shut ? '' : '<button class="btn sm primary" data-need-yes>Approve</button>'}`, rows ? 'need-rows' : '');
  }
  // A tool the Chief asks to install for a bot: the server's own fields (tool-card.js), no wording from here.
  if (x.kind === 'ask' && ToolCard.is(x.a)) {
    const t = ToolCard.parts(x.a);
    return card(t.title, t.meta, t.body, t.actions, 'need-tool');
  }
  // A skill a bot wrote after it read content from others (`written`): the server's line as the title, and the
  // whole text a yes would save.
  if (x.kind === 'ask' && x.a.kind === 'skill' && x.a.written) return card(esc(said(x.a.text)), esc(said(x.a.reason)),
    `<div class="need-body"><pre class="nb">${esc(x.a.skill?.instructions)}</pre></div>`,
    `<button class="btn sm" data-need-no>Decline</button><button class="btn sm primary" data-need-yes>Approve</button>`);
  if (x.kind === 'ask') {
    const k = x.a.skill || {};
    const who = x.a.forBots?.length ? ` · for ${x.a.forBots.map((b) => b.name).join(', ')}` : '';
    return card(`Install the skill "${esc(k.name)}"?`, `${esc(x.a.url.replace(/^https?:\/\/(www\.)?/, ''))}${esc(who)}`,
      `<div class="need-body"><div class="nb">${esc(k.description || 'No description.')}${k.files > 1 ? ` (${k.files} files)` : ''}${k.exists ? ' It replaces your skill of the same name.' : ''}${x.a.reason ? `\n\nWhy: ${esc(x.a.reason)}` : ''}</div></div>`,
      `<button class="btn sm" data-need-no>Decline</button><button class="btn sm primary" data-need-yes>Install</button>`);
  }
  if (x.kind === 'tilesug') {
    const t = x.s.tile;
    return card(`Put “${esc(t.title)}” on your Board?`, esc(x.s.reason),
      (t.scripts || []).map((sc) => `<div class="need-body"><pre class="nb">${esc(sc)}</pre></div>`).join(''),
      `<button class="btn sm" data-need-no>No</button><button class="btn sm primary" data-need-yes>Add</button>`);
  }
  // A tile: one that waits for its first OK, or a change to the scripts of an approved one (tileCard).
  if (x.kind === 'tile') {
    const m = tileCard(x.t);
    const rows = Math.max(m.scripts.length, m.scriptsWas.length);
    return card(esc(m.title), esc(m.meta),
      changeBlocks(Array.from({ length: rows }, (_, i) => [m.scriptsWas[i] ?? null, m.scripts[i] ?? null, 'pre'])) + untilHTML(m.line),
      `<button class="btn sm" data-need-no>${esc(m.no)}</button><button class="btn sm primary" data-need-yes>${esc(m.yes)}</button>`, m.change ? 'need-changed' : '');
  }
  if (x.kind === 'suggestion') return card(`A plan for the Chief: ${esc(x.chat.title)}`, 'Nothing happens until you approve it', `<div class="need-body"><div class="nb">${esc(plain(x.chat.waiting.text))}</div></div>`,
    `<button class="link-btn need-link" data-need-open>Open chat</button><button class="btn sm" data-need-no>Decline</button><button class="btn sm primary" data-need-yes>Approve</button>`);
  if (x.kind === 'bitwarden') return card('Bitwarden is locked', "Bots can't use your saved logins until you unlock it.", '', `<button class="btn sm primary" data-need-open>Unlock</button>`);
  if (x.kind === 'pay') return card(`Pay on ${esc(x.r.site)}`, x.r.amount ? esc(x.r.amount) : '', '', `<button class="btn sm primary" data-need-open>Review</button>`);
  return card(`A login for ${esc(x.r.site)}`, x.r.reason ? esc(x.r.reason) : '', '', `<button class="btn sm primary" data-need-open>Add it</button>`);
}

// The card of what one run waits on: whose, the server's title, "Decline all" and "Allow all", and each ask's own
// card under them, with its own buttons. An ask whose yes is its own (ownYes) says so above the buttons.
function batchCardHTML(x, here = null) {
  const who = x.bot ? `${botLabel(x.bot)}${x.group && here !== `group:${x.group.id}` ? ` <span class="need-in">in ${esc(x.group.name)}</span>` : ''}` : '';
  const own = x.items.filter(ownYes).map((s) => `“${said(s.a.title) || said(s.a.text)}”`);
  const line = !own.length ? '' : own.length === 1 ? `Allow all leaves ${own[0]} to its own Allow.` : `Allow all leaves ${own.slice(0, -1).join(', ')} and ${own.at(-1)} to their own Allow.`;
  const yes = x.items.some((s) => !ownYes(s) && !rowsCut(s.a));
  return `
    <div class="card need-batch" data-batch="${esc(x.key)}">
      ${who ? `<div class="need-who">${who}</div>` : ''}
      <div class="need-title">${esc(x.title || `${x.items.length} things wait for your OK`)}</div>
      ${line ? `<div class="need-meta need-own">${esc(line)}</div>` : ''}
      <div class="need-actions"><button class="btn sm" data-batch-no>Decline all</button>${yes ? '<button class="btn sm primary" data-batch-yes>Allow all</button>' : ''}</div>
      <div class="need-batch-items">${x.items.map((s) => needCardHTML(s, here)).join('')}</div>
    </div>`;
}

// Words of the server's that a card draws: a string, trimmed. '' for anything else.
const said = (v) => (typeof v === 'string' ? v.trim() : '');

// The line of a change's card: the approved job or tile is the one that works meanwhile.
const RUNS_AS_APPROVED = 'Runs as you approved it until you answer.';
const kindWords = (script) => (script ? 'a script, no AI' : 'uses AI');
const NOTIFY_WORDS = { always: 'after every run', 'report-only': 'only when it has something to report' };
const changedBy = (by) => (by === 'chief' ? 'changed by the Chief' : by === 'bot' ? 'changed by itself' : 'changed');
// "<label>: <was> → <now>" for a setting a change changes, '' for one it leaves. words: a value in words.
const changedLine = (label, was, now, words) => (typeof now !== 'string' || now === was ? '' : was ? `${label}: ${words(was)} → ${words(now)}` : `${label}: ${words(now)}`);

// What the card and the dialog of a waiting job show (docs/api.md, "Decline" and "A change that waits").
// A job before its first OK: its name, and the no in the server's words where it sends them (`no`).
// An approved job with a change beside it (`change`): "<name>: a change", the approved schedule and the new one,
// and what goes beside what comes: `promptWas` is the approved text where the text changes, `scriptWas` the
// approved script where the script changes, each null where it stays. `script` is null for a job that runs none
// after the yes. `also`: what else changes, a line each. `line`: that the approved job runs meanwhile.
// `summary`: what changes in the proposer's one sentence (`change-summary`), '' where the server sends none. A
// closed card with one shows it in place of what goes and what comes, which are behind the click.
function jobCard(j) {
  const c = changeOf(j);
  if (!c) {
    const script = j.kind === 'script';
    const by = j.changedBy === 'bot' ? 'added by itself' : j.changedBy === 'chief' ? 'added by the Chief' : 'changed';
    return { change: false, summary: '', title: j.name, name: j.name, when: j.when, meta: `${j.when} · ${kindWords(script)} · ${by}`, isScript: script, script: script ? j.script || '' : null, scriptWas: null,
      prompt: j.prompt || '', promptWas: null, also: [], aiWhen: j.aiWhen, assessment: j.assessment || '', line: '', no: said(j.no) || 'Decline', yes: 'Approve' };
  }
  const text = (v, or) => (typeof v === 'string' ? v : or); // a field the server left out did not change
  const script = text(c.kind, j.kind) === 'script';
  const when = said(c.when) || j.when;
  const name = said(c.name) || j.name;
  const scriptNow = script ? text(c.script, j.script || '') : null;
  const scriptWas = j.kind === 'script' ? j.script || '' : null;
  const prompt = text(c.prompt, j.prompt || '');
  const aiWhen = script ? text(c.aiWhen, j.aiWhen) : null;
  return {
    change: true, title: `${j.name}: a change`, name, when, isScript: script, summary: said(c.summary),
    meta: [when === j.when ? j.when : `now ${j.when} → ${when}`, name === j.name ? '' : `renamed “${name}”`, kindWords(script), changedBy(c.by)].filter(Boolean).join(' · '),
    script: scriptNow, scriptWas: scriptWas === scriptNow ? null : scriptWas,
    prompt, promptWas: (j.prompt || '').trim() && j.prompt !== prompt ? j.prompt : null,
    also: [
      changedLine('Tells you', j.notify || 'report-only', c.notify, (v) => NOTIFY_WORDS[v] || v),
      changedLine('Asks the AI', j.kind === 'script' ? j.aiWhen : '', aiWhen, (v) => (AI_WHEN_TEXT[v] || v).toLowerCase()),
    ].filter(Boolean),
    aiWhen, assessment: text(c.assessment, j.assessment) || '', line: RUNS_AS_APPROVED, no: said(j.no) || 'Keep as it is', yes: said(j.yes) || 'Approve the change',
  };
}

// The same for a waiting tile: before its first OK with its scripts, and an approved tile with a change beside it,
// "<title>: a change", with the scripts it runs today (`scriptsWas`, where they differ) beside those it would run.
function tileCard(t) {
  const c = changeOf(t);
  const strings = (list) => (Array.isArray(list) ? list.filter((sc) => typeof sc === 'string') : null);
  if (!c) return { change: false, title: `Put “${t.title}” on your Board?`, meta: `${t.section ? `${t.section} · ` : ''}a script, no AI · ${t.changedBy === 'bot' ? 'added by itself' : 'added by the Chief'}`,
    scripts: tileScripts(t), scriptsWas: [], line: '', no: said(t.no) || 'Decline', yes: 'Approve' };
  const own = strings(t.scripts) || tileScripts(t);
  const scripts = strings(c.scripts) || tileScripts(c); // a change that lists none: those of the tile as proposed, never the approved ones
  const title = said(c.title);
  return {
    change: true, title: `${t.title}: a change`,
    meta: [t.section, title && title !== t.title ? `renamed “${title}”` : '', scripts.length ? 'a script, no AI' : '', changedBy(c.by)].filter(Boolean).join(' · '),
    scripts, scriptsWas: own.length === scripts.length && own.every((sc, i) => sc === scripts[i]) ? [] : own,
    line: RUNS_AS_APPROVED, no: said(t.no) || 'Keep as it is', yes: said(t.yes) || 'Approve the change',
  };
}

// One block of a card's body: a text (`div`) or a script (`pre`). Where it changes, what goes stands struck above
// what comes, in one block, so that a closed card shows the start of both. '' with neither.
function changeBlock(was, now, tag) {
  const part = (t, cls = '') => (t ? `<${tag} class="nb${cls}">${esc(t)}</${tag}>` : '');
  const old = goes(was, now);
  if (old === null) return now ? `<div class="need-body">${part(now)}</div>` : '';
  return `<div class="need-body need-change">${part(old, ' faint-strike')}${part(now)}</div>`;
}
// What a change takes away of a text or a script: the approved one where it differs, null where it stays.
const goes = (was, now) => (typeof was === 'string' && was && was !== now ? was : null);
// The blocks of a change's card, those that change first: a closed card shows its first block only, and that is
// never one that stays while another changes. pairs: [what it was, what it becomes, 'div' or 'pre'].
const changeBlocks = (pairs) => [...pairs.filter(([was, now]) => goes(was, now) !== null), ...pairs.filter(([was, now]) => goes(was, now) === null)]
  .map(([was, now, tag]) => changeBlock(was, now, tag)).join('');
// What else a change changes, a line each, above the blocks: whole on a closed card too.
const alsoHTML = (lines) => lines.map((l) => `<div class="need-meta need-also">${esc(l)}</div>`).join('');
// A change with its proposer's sentence (`summary`): the sentence, and behind the click what goes and what comes
// (`full`), which a closed card leaves out. Without a sentence the card is `full` alone, as before.
const summedHTML = (summary, full) => (summary ? `<div class="need-summary">${esc(summary)}</div><div class="need-meta need-more">Click to see the full change</div><div class="need-full">${full}</div>` : full);
const untilHTML = (line) => (line ? `<div class="need-meta need-until">${esc(line)}</div>` : '');

// What "Approve all" takes of the cards that wait (open: not answered on this page yet): AI jobs and changes to
// the shared memory, which a card shows in words. A job that runs a script, or would after its change, and a tile,
// which waits for a script, are left for their own cards and named in one line. A guarded memory change (one to
// what the owner said, and a forget) is left for its own card too, and is neither taken nor counted. `label`
// counts what it approves; with fewer than two there is no button, and no line.
function approveAll(open) {
  const takes = open.filter((x) => (x.kind === 'memory' && x.p.guarded !== true) || (x.kind === 'job' && !touchesScript(x.job)));
  const left = open.flatMap((x) => (x.kind === 'job' && touchesScript(x.job) ? [x.job.name] : x.kind === 'tile' ? [`“${x.t.title}”`] : []));
  const on = takes.length > 1;
  const line = !on || !left.length ? '' : left.length === 1 ? `${left[0]} runs a script: approve it on its card.`
    : `${left.slice(0, -1).join(', ')} and ${left[left.length - 1]} run scripts: approve them on their cards.`;
  return { takes: on ? takes : [], label: on ? `Approve ${takes.length}` : '', line };
}

// Whether the page asks before it sends a no: only for a job whose no removes it and whose button does not say
// so, as a server from before `decline-words` sends it. A button that reads the server's words asks nothing.
const asksBeforeNo = (x) => x.kind === 'job' && !changeOf(x.job) && !said(x.job.no);

// Who carries on after a yes, in the server's words (docs/api.md, "What follows a yes"): `text`, or `here` on a
// card that stands in the Chief chat it names. '' when the server says nothing: the yes changes the setting only.
function thenLine(then, here = null) {
  return (here && then?.chatId === here && said(then.here)) || said(then?.text);
}

// What changes on a bot (an ask's `parts`), in the server's order. A text that changes (it has `was`) is one
// block: what goes, struck, above what comes, so that a closed card shows the start of both. Anything else is a
// row of its label and what it becomes. One changed text is named by the card's title; several each stand under
// their label. '' without a part.
function partsHTML(parts) {
  const list = (Array.isArray(parts) ? parts : [])
    .map((p) => ({ label: ToolCard.text(p?.label), now: ToolCard.text(p?.now), was: typeof p?.was === 'string' ? said(p.was) : null }))
    .filter((p) => p.now || (p.was === null ? p.label : p.was)); // a row has a label or a value, a changed text something that goes or comes
  const texts = list.filter((p) => p.was !== null).length;
  const lines = (text, cls = '') => (text ? `<div class="nb${cls}">${esc(text)}</div>` : '');
  let html = '';
  let rows = [];
  const drawRows = () => { html += ToolCard.rows(rows); rows = []; };
  for (const p of list) {
    if (p.was === null) { rows.push({ label: p.label, value: p.now }); continue; }
    drawRows();
    html += (texts > 1 && p.label ? `<div class="need-meta need-part">${esc(p.label)}</div>` : '')
      + `<div class="need-body need-change">${lines(p.was, ' faint-strike')}${lines(p.now)}</div>`;
  }
  drawRows();
  return html;
}

// Whether the run of a connected-app action still waits for the owner's answer, as the line under the card's
// title: `held`, or since when it does not (`stoppedAt`). '' for an ask that says neither.
function heldLine(a) {
  const name = said(a.bot?.name) || (a.chief ? CHIEF_BOT.name : 'The bot');
  if (a.held === true) return `${name} waits for your answer`;
  if (a.held === false && typeof a.stoppedAt === 'string' && Number.isFinite(Date.parse(a.stoppedAt))) return `${name} stopped waiting at ${msgTime(a.stoppedAt)}`;
  return '';
}

// Whether a row of a connected-app action was clipped (docs/api.md): `more: true` on the row, as the feed's short
// form marks it. Such a value is less than the action sends.
const rowsCut = (a) => Array.isArray(a?.rows) && a.rows.some((r) => r?.more === true);
// Whether the action is too long to show in full: `more: true` on the ask, beside its rows. The page draws its
// cards from the list (GET /api/asks), where that is what it says.
const tooLong = (a) => a?.more === true;

// What a card draws beyond its key that can change while it waits: the page draws it again when this does.
const needLive = (x, here = null) => [x.a?.batch?.id, x.a?.batch?.title, x.a?.batch?.own, thenLine(x.then, here), x.group?.name, x.a?.held, x.a?.stoppedAt, rowsCut(x.a), tooLong(x.a), x.job?.no, x.t?.no, changeOf(x.job || x.t) || null, x.p?.title, x.p?.guarded, x.p?.text];

// Back to where Needs you was opened from (state.cameFrom, needs-return.js): false when there is nowhere.
function leaveNeeds() {
  const to = state.cameFrom;
  if (!to) return false;
  if (to.view === 'chief' && to.id) openChiefChat(to.id);
  else setView(to.view, to.id);
  if (to.list) showList(); // a phone: the list it came from, over that view
  return true;
}
// The page's Back goes there too; where there is nowhere, to the list of bots, as every page's Back on a phone.
const needsBack = () => BACK_BTN.replace('data-back', 'data-needs-back');
let needsSeen = false; // a card stood open on the page during this visit
let needsLeaving = null; // the moment's wait after the last card, before the page leaves
// The page is left or opened again, or a card came in: nothing waits to leave it.
function stayOnNeeds() { clearTimeout(needsLeaving); needsLeaving = null; needsSeen = false; }

function renderNeeds() {
  const root = $('#view-needs');
  const items = needsItems();
  const open = items.filter((x) => !needsDone.has(x.key));
  // The last open card answered on the page: back where it was opened from, after a moment to read the answer.
  const now = NeedsReturn.step(needsSeen, open.length, needsDone.size > 0);
  if (open.length) { clearTimeout(needsLeaving); needsLeaving = null; }
  needsSeen = now.seen;
  if (now.leave && state.cameFrom) needsLeaving = setTimeout(() => { needsLeaving = null; if (state.view === 'needs') leaveNeeds(); }, NeedsReturn.DELAY);
  const all = approveAll(open);
  // Draw again only when the cards change: the regular refresh would otherwise swallow clicks.
  const sig = JSON.stringify([open.map((x) => [x.key, x.job?.cron, x.job?.prompt, x.job?.script, x.chat?.waiting?.text, needLive(x)]), [...needsDone.keys()], all.label, all.line]);
  if (root.dataset.sig === sig) return;
  root.dataset.sig = sig;
  const drawn = batched(open);
  root.innerHTML = `
    <div class="section-head"><div>${needsBack()}<h1>Needs you</h1>${open.length ? '' : '<p>All done.</p>'}${all.line ? `<p class="needs-left">${esc(all.line)}</p>` : ''}</div>
      ${all.label ? `<button class="btn primary" id="needs-all">${esc(all.label)}</button>` : ''}</div>
    <div class="need-grid">${drawn.map((x) => needCardHTML(x)).join('')}${[...needsDone.values()].join('')}</div>`;
  wireNeedCards(root, items);
  wireBatchCards(root, drawn);
  const back = $('[data-needs-back]', root);
  if (back) back.onclick = () => { if (!leaveNeeds()) showList(); };
  const button = $('#needs-all', root);
  if (button) button.onclick = async () => { for (const x of all.takes) await decide(x, true, false); refreshNeeds(); };
}

// The buttons on need cards (the Needs you page, and the cards in a chat).
function wireNeedCards(root, items) {
  const byKey = new Map(items.map((x) => [x.key, x]));
  $$('.need-card[data-need]', root).forEach((el) => {
    const x = byKey.get(el.dataset.need);
    if (!x) return;
    const yes = $('[data-need-yes]', el), no = $('[data-need-no]', el), op = $('[data-need-open]', el), always = $('[data-need-always]', el);
    // Each says it works until the answer comes (Bitwarden, for a job's call key, can take several seconds); a yes that turns on a call or
    // a notify address says "Creating connection…" with a spinner.
    if (yes) yes.onclick = () => whileApproving(yes, x.job, () => decide(x, true));
    if (always) always.onclick = () => { if (x.a?.kind === 'chief-action') { if (confirm(said(x.a.warning) || `${said(x.a.always)}?`)) whileApproving(always, null, () => decide(x, true, true, true)); return; } if (x.a?.kind === 'override') { whileApproving(always, x.job, () => decide(x, true, true, true)); return; } if (x.a?.kind === 'connector-action') { if (confirm(said(x.a.warning) || (x.a.chief ? `Let ${CHIEF_BOT.name} do this from now on, whatever the details?` : 'Let this bot do this from now on, whatever the details?'))) whileApproving(always, x.job, () => decide(x, true, true, true)); return; } if (!touchesScript(x.job) || confirm(scriptWarning(x.bot.name, x.job.name))) whileApproving(always, x.job, () => decide(x, true, true, true)); };
    if (no) no.onclick = () => { if (!asksBeforeNo(x) || confirm('Remove this job?')) whileBusy(no, 'Declining…', () => decide(x, false)); };
    if (op) op.onclick = () => openNeed(x);
    el.onclick = (e) => { if (e.target.closest('button')) return; el.classList.toggle('open'); el.classList.contains('open') ? needsOpen.add(x.key) : needsOpen.delete(x.key); };
  });
}

// Allow all and Decline all on the cards of several (batchCardHTML). drawn: the cards as they were drawn.
function wireBatchCards(root, drawn) {
  const batches = new Map(drawn.filter((x) => x.kind === 'batch').map((x) => [x.key, x]));
  $$('.need-batch[data-batch]', root).forEach((el) => {
    const b = batches.get(el.dataset.batch);
    if (!b) return;
    const yes = $('[data-batch-yes]', el), no = $('[data-batch-no]', el);
    if (yes) yes.onclick = () => whileBusy(yes, 'Allowing…', () => decideBatch(b, true));
    if (no) no.onclick = () => whileBusy(no, 'Declining…', () => decideBatch(b, false));
  });
}

// ---------- approvals in the chat ----------

// What waits for your OK also shows at the bottom of the chat it belongs to: a bot's own jobs, permissions,
// skills, memory changes and logins in its chat; what the Chief set up or asked for in the Chief's.
// A tool is in both: the Chief asked for it, and it is installed for that bot. So is a change to a bot that the
// Chief asked for (`by: "chief"`): the card stands where the owner asked, and in the chat of the bot it changes.
const chatDecided = new Map(); // chat and key -> { scope, title, label }: decided here, shown as a faded line until you leave the chat
// Answered on the Needs you page: the same line, for each chat the card stood in. It moves into chatDecided when
// that chat is drawn, and goes with it when the chat is left.
const answeredAway = new Map(); // chat and key -> { scope, title, label }
const fromChief = (x) => (x.kind === 'job' ? (changeOf(x.job) ? changeOf(x.job).by : x.job.changedBy) === 'chief'
  : x.kind === 'tile' ? (changeOf(x.t) ? changeOf(x.t).by : x.t.changedBy) !== 'bot'
  : x.kind === 'ask' ? (['skill', 'vault-remove'].includes(x.a.kind) && !x.a.botId) || x.a.kind === 'chief-action' || x.a.chief === true
  : x.kind === 'login' || x.kind === 'pay' ? x.r.from === 'chief' : false);
const inBothChats = (x) => x.kind === 'ask' && (ToolCard.is(x.a) || (x.a.kind === 'bot-change' && x.a.by === 'chief'));
function chatNeeds(scope) {
  const suggested = scope === 'chief' ? [] : tileSuggestions().filter((x) => x.s.bot === scope); // a group's id is no bot's: none there
  return [...suggested, ...needsItems().filter((x) => {
    if (x.kind === 'bitwarden' || x.kind === 'suggestion') return false; // Bitwarden isn't a bot's; a plan already has its buttons in the chat
    if (x.group || String(scope).startsWith('group:')) return !!x.group && scope === `group:${x.group.id}`; // asked in a group: at the end of that group, and in no bot's own chat
    if (inBothChats(x)) return scope === 'chief' || x.a.botId === scope;
    if (scope === 'chief') return fromChief(x);
    const botId = x.kind === 'job' ? x.bot.id : x.kind === 'tile' ? x.t.bot : x.kind === 'memory' ? x.p.botId : x.kind === 'ask' ? x.a.botId : x.r.botId;
    return botId === scope && !fromChief(x);
  })];
}
// Tiles bots suggested for the Board, as cards (in the bot's chat; on the Board they're faded tiles). `then`: the
// bot that suggested one in a run carries on after Add (docs/api.md, "What a bot proposed").
const tileSuggestions = () => (state.dash?.suggestions || []).map((s) => ({ key: `tsug:${s.id}`, kind: 'tilesug', s, bot: botById(s.bot) || null, color: botById(s.bot)?.color || CHIEF_COLOR, then: s.then }));

// The chats an ask's card stands in, besides the Needs you page: its bot's, the Chief's, a group's (chatNeeds).
function chatsOfAsk(x) {
  if (x.kind !== 'ask') return [];
  return [...new Set([x.a.botId, 'chief', x.group && `group:${x.group.id}`])].filter((scope) => scope && chatNeeds(scope).some((c) => c.key === x.key));
}

// What waits for the owner is read after the chat was drawn (refresh): when it arrives, the cards at the end of
// the open bot's chat and the open Chief chat follow at once, as the banner does (showNeeds). Without this a card
// that came meanwhile stood only in Needs you, under a chat that said "Waiting for your OK", until the next refresh.
function drawChatCards() {
  if (state.view === 'bot' && state.botId && $('#view-bot')?.dataset.bot === state.botId) updateChatNeeds($('#bot-thread'), state.botId);
  if (state.view === 'chief' && state.chatId) updateChatNeeds($('#chat-thread'), 'chief');
}

// The card a bot's run waits for, in its chat: "Waiting for your OK" scrolls to it (drawStatusLine). The run's
// action in a connected app that is held (`held`): a bot has one run at a time, so it is that run's.
function toHeldCard(thread, botId) {
  const ask = (state.asks || []).find((a) => a?.kind === 'connector-action' && a.held === true && a.botId === botId && !a.groupId);
  const card = ask ? $(`.need-card[data-need="${CSS.escape(`ask:${ask.id}`)}"]`, thread) : null;
  if (!card) return false;
  card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return true;
}

// Put the cards (and what you decided here) at the end of a chat thread; scope: a bot's id, 'chief' or "group:<id>".
function updateChatNeeds(thread, scope) {
  if (!thread) return;
  for (const [k, d] of chatDecided) if (d.scope !== scope) chatDecided.delete(k); // you left that chat
  for (const [k, d] of answeredAway) if (d.scope === scope) { chatDecided.set(k, d); answeredAway.delete(k); } // answered on the Needs you page
  const items = chatNeeds(scope);
  // Whose messages these are: the Chief's chats share their cards, and one says "in this chat" only in its own;
  // a group's cards do not repeat the group's name.
  const here = scope === 'chief' ? thread.dataset.chat || null : String(scope).startsWith('group:') ? scope : null;
  const done = [...chatDecided.values()];
  let box = $('.chat-needs', thread);
  if (!box) { box = document.createElement('div'); box.className = 'chat-needs'; }
  if (box !== thread.lastElementChild) thread.append(box); // new messages go above it
  const sig = JSON.stringify([scope, items.map((x) => [x.key, x.job?.cron, x.job?.script, x.job?.prompt, needLive(x, here)]), done]);
  if (box.dataset.sig === sig) return;
  const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 160;
  box.dataset.sig = sig;
  box.dataset.scope = scope;
  const drawn = batched(items);
  box.innerHTML = done.map((d) => `<div class="chat-decided">${esc(d.title)} · ${esc(d.label)}</div>`).join('') + drawn.map((x) => needCardHTML(x, here)).join('');
  wireNeedCards(box, items);
  wireBatchCards(box, drawn);
  if (atBottom) thread.scrollTop = thread.scrollHeight;
}

// "Always approve" a script job: its later changes run without you seeing them, so say what that means first.
const scriptWarning = (bot, job) => `Always approve "${job}" from ${bot}?\n\nIt's a script: it runs as commands on this computer with your permissions, without AI and without the bot's tool limits. If a web page or email ever tricks ${bot} into changing it, the new version would run on its schedule without you seeing it first.\n\nYou can take this back in ${bot}'s settings.`;

// A job in one line: when it runs and what kind it is.
const jobLine = (j) => `${j.when} · ${j.kind === 'script' ? 'a script, no AI' : 'uses AI'}`;

// Approve or decline one card; it fades and says so. always: approve the job and trust its later changes.
// After a yes the server may say who carries on (`carriesOn` in its answer, docs/api.md "What follows a yes"):
// its words follow the page's own, "Allowed · it carries on".
async function decide(x, yes, redraw = true, always = false) {
  const chats = chatsOfAsk(x); // where its card stands, read while it still waits
  let answer = null; // the server's: what a yes starts (a job, an ask, a tile, a suggested tile), and the words a card then reads
  try {
    if (x.kind === 'job') answer = await api(`/bots/${x.bot.id}/jobs/${x.job.id}/approve`, { method: 'POST', body: { approve: yes, always } });
    else if (x.kind === 'ask') answer = await api(`/asks/${x.a.id}`, { method: 'POST', body: { yes, always } });
    else if (x.kind === 'tile') { answer = await api(`/dashboard/tiles/${x.t.id}/approve`, { method: 'POST', body: { approve: yes } }); loadDash(true); }
    else if (x.kind === 'tilesug') { answer = await api(`/dashboard/suggestions/${x.s.id}`, { method: 'POST', body: { add: yes } }); loadDash(true); }
    // A bot's plan: Approve answers it in its Chief chat, like the button there; the Chief works on it in the background.
    else if (x.kind === 'suggestion') await (yes ? api(`/chief/chats/${x.chat.id}/messages`, { method: 'POST', body: { text: PLAN_APPROVAL } }) : api(`/chief/chats/${x.chat.id}/dismiss`, { method: 'POST' }));
    else answer = await api(`/memory/pending/${x.p.id}`, { method: 'POST', body: { approve: yes } });
  } catch (e) { toast(e.message, true); return; }
  markAnswered(x, yes, always, answer, chats);
  if (redraw) refreshNeeds();
}

// "Allow all" or "Decline all" on the card of what one run waits on: the server answers each of its asks as its own
// card would (`POST /api/asks/batch/:id`, with the asks this card shows), and each card reads its answer. An ask that could not be answered keeps
// its card and says why; one whose yes is its own (`left`) waits for it.
async function decideBatch(b, yes) {
  const chats = new Map(b.items.map((x) => [x.a.id, chatsOfAsk(x)]));
  let answer;
  try { answer = await api(`/asks/batch/${encodeURIComponent(b.id)}`, { method: 'POST', body: { yes, ids: b.items.map((x) => x.a.id) } }); } catch (e) { toast(e.message, true); return; }
  const failed = [];
  for (const one of Array.isArray(answer?.answers) ? answer.answers : []) {
    const x = b.items.find((s) => s.a.id === one?.id);
    if (!x) continue;
    if (one.ok === false) { failed.push(said(one.error) || 'It could not be answered.'); continue; }
    markAnswered(x, yes, false, one, chats.get(x.a.id) || []);
  }
  if (failed.length) toast(failed.join(' '), true);
  refreshNeeds();
}

// A card answered: it fades and says so, here and in every chat it stood in. After a yes the server may say who
// carries on (`carriesOn`): its words follow the page's own, "Allowed · it carries on".
function markAnswered(x, yes, always, answer, chats) {
  const word = answeredWord(x, yes, always, answer);
  const carries = yes && typeof answer?.carriesOn?.text === 'string' ? answer.carriesOn.text.trim() : '';
  const label = carries ? `${word} · ${carries}` : word;
  // The same card can be on the Needs you page and in a chat.
  let away = null; // the title of its card on the Needs you page, when it was answered there
  $$(`.need-card[data-need="${CSS.escape(x.key)}"]`).forEach((el) => {
    el.classList.add('done');
    $('.need-actions', el).innerHTML = `<span class="muted">${esc(label)}</span>`; // the server's words are text
    $('.need-then', el)?.remove(); // "when you allow it" is answered: the label says what follows now
    $('.need-until', el)?.remove(); // and so is "until you answer"
    const chat = el.closest('.chat-needs');
    if (chat) chatDecided.set(`${chat.dataset.scope} ${x.key}`, { scope: chat.dataset.scope, title: $('.need-title', el).textContent, label }); // a tool's card is in two chats
    else { needsDone.set(x.key, el.outerHTML); away = $('.need-title', el).textContent; }
  });
  // Answered on the Needs you page: the chats the card stood in say so too, unless it was answered there.
  if (away !== null) for (const scope of chats) if (!chatDecided.has(`${scope} ${x.key}`)) answeredAway.set(`${scope} ${x.key}`, { scope, title: away, label });
}

// The word a card reads after its answer, before who carries on. The page's own where it has one; for a job and a
// tile the server's (`text` of the answer: "Declined and removed", "Kept as it was: …", "Changed: …") in place of
// "Declined", and of "Approved" on a change. A memory change always reads the server's: "Forgotten", "Kept".
function answeredWord(x, yes, always, answer) {
  if (always) return x.a?.kind === 'chief-action' ? 'Always allowed' : 'Always approved';
  if (x.kind === 'tilesug') return yes ? 'On your Board' : 'Not added';
  const waits = x.kind === 'job' ? x.job : x.kind === 'tile' ? x.t : null;
  const servers = x.kind === 'memory' || (waits && (!yes || changeOf(waits))) ? said(answer?.text) : '';
  if (servers) return servers;
  if (!yes) return 'Declined';
  if (x.kind === 'ask') return ToolCard.is(x.a) ? 'Installing' : x.a.kind === 'skill' ? (x.a.written ? 'Approved' : 'Installed') : 'Allowed';
  return x.kind === 'suggestion' ? 'Approved · the Chief is on it' : 'Approved';
}

async function refreshNeeds() {
  state.memPending = await api(MEMORY_WAITS).catch(() => state.memPending);
  state.asks = await api('/asks?vault-switch=1&vault-remove=1&vault-file=1&override=1&chief-action=1&room-tool=1&room-post=1').catch(() => state.asks);
  await refresh();
}
