// ---------- bot computers (live screen) ----------

const screenUrl = (botId, control = false) =>
  `/computer/${encodeURIComponent(botId)}/vnc.html?autoconnect=1&reconnect=1&resize=scale&show_dot=1&view_only=${control ? 0 : 1}&path=${encodeURIComponent(`computer/${botId}/websockify`)}`;

// The screen viewer (noVNC) only retries after it has connected once. If the first try fails (the
// computer was still starting) or the computer restarted, it would sit on "Failed to connect", so
// reload it every few seconds until it's connected.
function keepScreenConnected(iframe) {
  if (!iframe || iframe.dataset.kept) return;
  iframe.dataset.kept = '1';
  const t = setInterval(() => {
    if (!iframe.isConnected) return clearInterval(t);
    let doc;
    try { doc = iframe.contentDocument; } catch { return; }
    if (!doc || !doc.body) return;
    const dlgOpen = doc.getElementById('noVNC_connect_dlg')?.classList.contains('noVNC_open');
    const text = doc.body.innerText || '';
    if (dlgOpen || /Failed to connect|Screen not available|connection is closed/i.test(text)) iframe.src = iframe.src;
  }, 4000);
}

// The account's computer is always on, for every bot (#104): it is on, being started again, or not made yet.
function computerLabel(botId) {
  const st = state.computers?.[botId];
  return st === 'running' ? 'on' : st === 'stopped' ? 'starting again' : 'not made yet';
}

// The screen as large as the window lets it be, at the desktop's 4:3, with all of the dialog in the window and no
// scrollbar of its own (#43): the screen is made as narrow as the height left for it asks. What is under it keeps
// the dialog's width, so its height does not change with the screen's.
function fitScreen(m) {
  const f = $('#screen-frame', m);
  if (!f || !m.open) return;
  // The dialog's height may be the window's less 40 (the stylesheet's max-height), its 1px border included.
  const room = window.innerHeight - 42 - (m.scrollHeight - f.offsetHeight);
  m.style.setProperty('--screen-w', `${Math.max(240, Math.floor((room * 4) / 3))}px`);
}

// What each bot uses of the account's computer (#109), as the server words it: its line, then a row per bot, most
// memory first, and what runs on no bot's screen. Nothing for a server from before, or a computer that is not on.
function usageRows(usage) {
  if (!usage?.bots) return '';
  const row = (name, text) => `<div class="usage-row"><span class="usage-name">${esc(name)}</span><span class="muted">${esc(text)}</span></div>`;
  return `<div class="muted usage-text">${esc(usage.text || '')}</div>${usage.bots.map((b) => row(b.name, b.text)).join('')}${usage.other ? row(usage.other.name || '', usage.other.text) : ''}`;
}

function openScreen(botId) {
  const bot = state.bots.find((b) => b.id === botId);
  if (!bot) return;
  let control = false;
  const m = openModal(`
    <div class="modal-head"><h2>${botLabel(bot)}'s computer</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
    <div class="modal-body">
      <div class="screen-frame" id="screen-frame"><div class="muted">Loading…</div></div>
      <div class="screen-bar">
        <span class="muted" id="screen-state" style="font-size:12.5px"></span>
        <span style="flex:1"></span>
        <button class="btn sm" id="screen-control">🖱 Take control</button>
        <a class="btn sm" id="screen-full" target="_blank" rel="noopener">⤢ Full screen</a>
        <button class="btn sm danger" id="screen-reset" title="Erase the account's computer, for every bot that works on it.">Reset</button>
      </div>
      <div class="screen-steps hidden" id="screen-steps"><div class="muted" style="font-size:12.5px">What it's doing: <span id="screen-now"></span></div></div>
      <div class="req-note hidden" id="screen-update"><span id="screen-update-text"></span> <button class="btn sm" id="screen-update-yes"></button></div>
      <div class="req-note hidden" id="screen-old"><span id="screen-old-text"></span> <button class="btn sm" id="screen-old-copy"></button> <button class="btn sm danger" id="screen-old-erase"></button></div>
      <div class="screen-usage hidden" id="screen-usage"></div>
    </div>`);
  // The account's computer as the server describes it (#107): the words of its reset, of an update when one is
  // offered, of the bot's old computer of its own while it has one, and what each bot uses of it (#109). Nothing of
  // them is this page's own.
  let info = null;
  const describe = () => api(`/bots/${botId}/computer`).then((d) => {
    info = d;
    $('#screen-update', m).classList.toggle('hidden', !d.update);
    if (d.update) { $('#screen-update-text', m).textContent = d.update.text; $('#screen-update-yes', m).textContent = d.update.yes; }
    $('#screen-old', m).classList.toggle('hidden', !d.old);
    if (d.old) {
      $('#screen-old-text', m).textContent = d.old.text;
      $('#screen-old-copy', m).textContent = d.old.copy;
      $('#screen-old-erase', m).textContent = d.old.erase;
    }
    $('#screen-usage', m).innerHTML = usageRows(d.usage);
    $('#screen-usage', m).classList.toggle('hidden', !d.usage?.bots);
    $('#screen-state', m).dataset.disk = d.diskBytes != null ? ` Uses ${d.diskBytes > 1e9 ? (d.diskBytes / 1e9).toFixed(1) + ' GB' : Math.max(1, Math.round(d.diskBytes / 1e6)) + ' MB'} of disk.` : '';
    frame();
  }).catch(() => {});
  describe();
  m.classList.add('wide', 'screen');
  const fit = () => fitScreen(m);
  window.addEventListener('resize', fit);
  const frame = () => {
    // Its own screen off on the running computer (#134): the server's words and a button, not a viewer that can't connect.
    const off = state.computers?.[botId] === 'running' && info?.screenOff;
    const on = state.computers?.[botId] === 'running' && !off;
    $('#screen-state', m).textContent = `Computer is ${computerLabel(botId)}.${bot.running ? ' The bot is using it right now.' : ''}${$('#screen-state', m).dataset.disk || ''}`;
    $('#screen-control', m).textContent = control ? '👁 Just watch' : '🖱 Take control';
    $('#screen-full', m).href = screenUrl(botId, control);
    $('#screen-control', m).disabled = !on;
    $('#screen-frame', m).innerHTML = off
      ? `<div class="screen-off"><div class="big">🖥</div>${esc(off.text)}<div><button class="btn sm" id="screen-start">${esc(off.start)}</button></div></div>`
      : on
      ? `<iframe src="${screenUrl(botId, control)}" title="Live screen"></iframe>`
      : `<div class="screen-off"><div class="big">🖥</div>${state.computers?.[botId] === 'stopped' ? "The account's computer is starting again. It stays on for every bot." : "The account's computer isn't made yet. The first computer tool of any bot makes it."}</div>`;
    const start = $('#screen-start', m);
    if (start) start.onclick = async () => { start.disabled = true; await act('start', 'Starting its screen…'); await describe(); };
    keepScreenConnected($('#screen-frame iframe', m));
    fit();
  };
  const act = async (action, label) => {
    try {
      toast(label);
      const r = await api(`/bots/${botId}/computer`, { method: 'POST', body: { action } });
      state.computers = { ...state.computers, [botId]: r.state === 'none' ? undefined : r.state };
      frame();
    } catch (e) { toast(e.message, true); }
  };
  $('#screen-control', m).onclick = () => { control = !control; frame(); };
  // The account's computer, for every bot (#107): a reset and an update, each after the owner read what it does.
  const forAll = async (what, label) => {
    try {
      toast(label);
      const r = await api(`/computer/${what}`, { method: 'POST' });
      if (r.error) toast(r.error, true);
      const st = r.state === 'none' ? undefined : r.state;
      state.computers = Object.fromEntries(state.bots.filter((b) => b.computer === 'linux').map((b) => [b.id, st]));
      frame();
      describe();
    } catch (e) { toast(e.message, true); }
  };
  $('#screen-reset', m).onclick = () => {
    if (!info?.reset) return;
    if (confirm(`${info.reset.title}\n\n${info.reset.text}`)) forAll('reset', 'Resetting…');
  };
  $('#screen-update-yes', m).onclick = () => { if (info?.update && confirm(info.update.text)) forAll('update', 'Updating…'); };
  // A bot's old computer of its own: its files copied into its folder, then the old one erased.
  $('#screen-old-copy', m).onclick = async () => {
    try {
      toast('Copying…');
      const r = await api(`/bots/${botId}/computer`, { method: 'POST', body: { action: 'copy-old' } });
      toast(`Copied into ${r.copied}`);
    } catch (e) { toast(e.message, true); }
  };
  $('#screen-old-erase', m).onclick = async () => {
    if (!info?.old || !confirm(info.old.confirm)) return;
    await act('reset', 'Erasing…');
    describe();
  };
  // Its line as it works, in the server's words, so a quiet screen (e.g. while it waits for you) still tells you
  // what's happening.
  const run = state.runs.find((r) => r.botId === botId && r.status === 'running');
  const stepsEs = run && watchRun(run.id, () => { const n = $('#screen-now', m); if (n) n.textContent = 'finished'; }, null, (line) => {
    const box = $('#screen-steps', m);
    if (!box || !OpeningLine.text(line)) return;
    box.classList.remove('hidden');
    $('#screen-now', m).textContent = OpeningLine.text(line);
    fit();
  });
  m.addEventListener('close', () => {
    m.classList.remove('wide', 'screen');
    m.style.removeProperty('--screen-w');
    window.removeEventListener('resize', fit);
    stepsEs?.close();
  }, { once: true });
  frame();
}


// Plain-language explanation for a failed or stopped run; the raw error stays in the details. The server
// sends the same text as `problem` (lib/problems.js); this is for a run the page followed live.
// endedBy: who ended the run (docs/api.md): the owner, the Chief, a sign-out, a silence or the time limit.
const ENDED_BY = {
  owner: 'You stopped this run before it finished.',
  chief: 'The Chief stopped this run before it finished.',
  signout: 'This run was stopped because Claude was signed out.',
  idle: 'I stopped because nothing happened for 20 minutes: I seemed stuck. Send it again, or break it into smaller pieces.',
  limit: 'I stopped after 4 hours: this took too long. Send it again, or break it into smaller pieces.',
};
function friendlyProblem(meta, resultText) {
  const text = `${resultText || ''} ${meta.error || ''}`;
  if (Object.hasOwn(ENDED_BY, meta.endedBy)) return ENDED_BY[meta.endedBy];
  // Stopped, and the server names nobody (a server from before `endedBy`): the owner did. With a name the page does not know, nobody is named.
  if (meta.status === 'stopped') return meta.endedBy ? 'This run was stopped before it finished.' : ENDED_BY.owner;
  if (meta.status === 'interrupted') return 'This run was cut off because botdot was restarted.';
  if (/not logged in|\/login/i.test(text)) return "I couldn't start because Claude isn't signed in yet. Open Settings → Claude and sign in, then try again.";
  // Claude's servers refused the sign-in (a revoked or expired token): Claude Code's "Failed to authenticate. API Error: 401".
  if (/Failed to authenticate|authentication_error|API Error: 401/i.test(text)) {
    return `Claude refused my sign-in, so I couldn't finish. ${meta.jobName ? 'I will try again at the next scheduled time' : 'Send it again'}; if this keeps happening, sign in to Claude again in Settings → Claude.`;
  }
  if (/max.?turns/i.test(text)) return 'The task took more steps than I was allowed. Try breaking it into smaller pieces.';
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|reach the API server|network error|fetch failed/i.test(text)) {
    return `I couldn't reach Claude's servers, so I couldn't start. This computer had no internet connection, or couldn't look up the address (a DNS problem).${meta.jobName ? ' I will try again at the next scheduled time.' : ' Check the connection and send the message again.'}`;
  }
  if (/overloaded|529|rate.?limit|429|usage limit/i.test(text)) return "Claude's servers were busy or my usage limit was reached, so I stopped. Try again in a little while.";
  // Something else: say what it was, briefly.
  const why = String(meta.error || resultText || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return `Something went wrong and I couldn't finish.${why ? ` It said: “${why}”.` : ''} The details show everything that happened.`;
}

function runHeader(meta) {
  const when = fmtTime(meta.startedAt);
  const facts = [
    `${meta.jobName ? `⏰ ${esc(meta.jobName)}, ${meta.trigger === 'schedule' ? 'scheduled' : meta.trigger === 'call' ? 'called' : 'started'}` : meta.trigger === 'schedule' ? '⏰ Scheduled' : 'Started'} ${when}`,
    meta.kind === 'script' ? `⚙️ script, no AI${meta.exitCode != null ? ` · exit code ${meta.exitCode}` : ''}` : null,
    meta.durationMs != null ? `took ${dur(meta.durationMs)}` : null,
  ].filter(Boolean).join(' · ');
  return `
    <div class="run-header" style="--bot-color:${esc(meta.botColor || '#6c7cff')}">
      ${runFigure(meta)}
      <div class="grow"><h2>${esc(meta.botName)}</h2>
        <div class="muted" style="font-size:12.5px">${facts}</div></div>
      ${statusPill(meta.status)}
      ${meta.status === 'running' ? `<button class="btn danger sm" id="stop-run">■ Stop</button>` : `<button class="btn sm" id="rerun">↻ Run again</button>`}
    </div>`;
}

function detailsInfo(meta) {
  return `
    <div class="run-facts">
      <span>Folder <code class="mono">${esc(meta.project)}</code></span>
      ${meta.modelUsed || meta.model ? `<span>Model <b>${esc(meta.modelUsed || meta.model)}</b>${meta.effort ? ` · reasoning <b>${esc(effortLabel(meta.effort))}</b>` : ''}</span>` : ''}
      <span>Steps <b>${meta.numTurns ?? '—'}</b></span>
      ${meta.sessionId ? `<span>Continue in Claude Code: <code class="mono">cd ${esc(meta.project)} && claude --resume ${esc(meta.sessionId)}</code> <button class="btn ghost sm" id="copy-resume">copy</button></span>` : ''}
    </div>`;
}

const detailsOpen = () => { try { return localStorage.getItem('botdot.details') === '1'; } catch { return false; } };

function showRun(id) {
  if (state.runStream) { state.runStream.close(); state.runStream = null; }
  const view = $('#run-view');
  if (!view) return;
  view.dataset.id = id;
  $$('.run-item').forEach((el) => el.classList.toggle('active', el.dataset.id === id));
  const meta = activityRuns().find((r) => r.id === id); // a turn in a group too (#294)
  const showDetails = detailsOpen();
  view.innerHTML = `
    <div id="run-head">${meta ? runHeader(meta) : ''}</div>
    <div class="conversation" id="conversation">
      <div class="bubble-row from-me"><div class="bubble from-me" id="ask"></div></div>
      <div id="live-screen"></div>
      <div class="bubble-row from-bot" style="--bot-color:${esc(meta?.botColor || '#6c7cff')}">
        ${runFigure(meta || {}, 'sm')}
        <div class="bubble from-bot live" id="answer"><div class="live-line"><div class="typing"><span></span><span></span><span></span></div><span class="activity muted">Working…</span></div></div>
      </div>
      <button class="details-toggle" id="details-toggle">${showDetails ? 'Hide details' : 'Show details'}</button>
      <div id="details" class="${showDetails ? '' : 'hidden'}">
        <div id="details-info">${meta ? detailsInfo(meta) : ''}</div>
        <div class="transcript" id="transcript"></div>
      </div>
    </div>`;
  const conv = $('#conversation');
  const tr = $('#transcript');
  const answer = $('#answer');
  const ctx = { tools: {}, results: [] };
  let current = meta;
  let resultText = null;
  let resultIsError = false;
  let line = ''; // the run's line while it goes on, as the server says it: the page has no words of its own for a step
  // Follow live output; open finished runs at the top of the answer.
  let stick = meta?.status === 'running';
  conv.onscroll = () => { stick = conv.scrollTop + conv.clientHeight > conv.scrollHeight - 40; };

  $('#details-toggle').onclick = () => {
    const d = $('#details');
    d.classList.toggle('hidden');
    const open = !d.classList.contains('hidden');
    $('#details-toggle').textContent = open ? 'Hide details' : 'Show details';
    try { localStorage.setItem('botdot.details', open ? '1' : '0'); } catch { /* ignore */ }
  };

  const wire = () => {
    const stop = $('#stop-run');
    if (stop) stop.onclick = async () => { await api(`/runs/${id}/stop`, { method: 'POST' }); toast('Stopping…'); };
    const rerun = $('#rerun');
    if (rerun) rerun.onclick = () => {
      const bot = state.bots.find((b) => b.id === current.botId);
      if (!bot) return toast('That bot was deleted', true);
      openRunDialog(bot.id);
    };
    const copy = $('#copy-resume');
    if (copy) copy.onclick = () => { navigator.clipboard.writeText(`cd ${current.project} && claude --resume ${current.sessionId}`); toast('Copied'); };
  };
  const refreshMeta = (m) => {
    current = m;
    $('#run-head').innerHTML = runHeader(m);
    $('#details-info').innerHTML = detailsInfo(m);
    wire();
  };
  const setActivity = (label) => {
    const a = answer.querySelector('.activity');
    if (a) a.textContent = `${label}…`;
  };
  const showAnswer = () => {
    const failed = resultIsError || ['error', 'stopped', 'interrupted'].includes(current?.status);
    const body = failed ? current?.problem || friendlyProblem(current || {}, resultText) : resultText || 'Done. (No written reply.)';
    answer.classList.toggle('problem', failed);
    answer.classList.remove('live'); // the answer can wrap normally
    answer.innerHTML = `<div class="md">${md(body)}</div>`;
  };
  wire();

  const es = new EventSource(`/api/runs/${id}/stream`);
  state.runStream = es;
  es.onmessage = (msg) => {
    const ev = JSON.parse(msg.data);
    if (OpeningLine.says(ev.type, state.features)) { line = OpeningLine.text(ev.text); setActivity(line || 'Working'); }
    if (ev.type === 'phase') {
      setActivity(OpeningLine.text(ev.text) || line || 'Working');
    } else if (ev.type === 'run_start') {
      refreshMeta(ev.meta);
      $('#ask').textContent = ev.meta.prompt;
      if (ev.meta.computer && ev.meta.status === 'running') {
        $('#live-screen').innerHTML = `<div class="live-screen"><div class="live-label"><span class="pill accent pulse">live</span> ${esc(ev.meta.botName)}'s screen <button class="btn ghost sm" data-screen-open>open</button></div><iframe src="${screenUrl(ev.meta.botId)}" title="Live screen"></iframe></div>`;
        keepScreenConnected($('#live-screen iframe'));
        $('[data-screen-open]').onclick = () => openScreen(ev.meta.botId);
      }
      $('#ask').onclick = () => $('#ask').classList.toggle('expanded');
    } else if (ev.type === 'run_end') {
      if (ev.meta) {
        refreshMeta(ev.meta);
        if (!$('#ask').textContent) $('#ask').textContent = ev.meta.prompt || '';
        if (resultText == null && ev.meta.result) resultText = ev.meta.result;
        if (ev.meta.error) tr.insertAdjacentHTML('beforeend', `<div class="msg stderr">${esc(ev.meta.error)}</div>`);
        const i = state.runs.findIndex((r) => r.id === id);
        if (i >= 0) state.runs[i] = ev.meta;
        renderRunList();
        render();
      }
      showAnswer();
      $('#live-screen').innerHTML = '';
      es.close();
    } else if (ev.type === 'result') {
      resultText = ev.result || '';
      resultIsError = !!ev.is_error;
    } else {
      const html = renderEvent(ev, ctx);
      if (html) tr.insertAdjacentHTML('beforeend', html);
      applyToolResults(tr, ctx);
    }
    if (stick) conv.scrollTop = conv.scrollHeight;
  };
  es.onerror = () => es.close();
  history.replaceState(null, '', `#runs/${id}`);
}
