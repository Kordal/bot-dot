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

// The screen as large as the window lets it be, at the desktop's 4:3 (a boat.dev machine's 16:9), with all of the dialog in the window and no
// scrollbar of its own (#43): the screen is made as narrow as the height left for it asks. What is under it keeps
// the dialog's width, so its height does not change with the screen's.
function fitScreen(m, ratio = 4 / 3) {
  const f = $('#screen-frame', m);
  if (!f || !m.open) return;
  // The dialog's height may be the window's less 40 (the stylesheet's max-height), its 1px border included.
  const room = window.innerHeight - 42 - (m.scrollHeight - f.offsetHeight);
  m.style.setProperty('--screen-w', `${Math.max(240, Math.floor(room * ratio))}px`);
}

// A bot's machine of its own on boat.dev (ADR 088): its desktop from boat.dev's stream (#564), at its 16:9, and its line
// in the server's words. The page asks botdot for a new address each time it opens the screen, and again every few
// minutes while it is open, which keeps the machine on and the full-screen link fresh; an address is never kept. As
// on the account's computer, the owner watches until Take control lifts the shield that keeps clicks and keys off it.
const BOAT_ASK_MS = 4 * 60_000;
const boatFrameUrl = (url) => `/boat-desktop.html#u=${encodeURIComponent(url)}`;
// boat.dev's stream draws no frame in WebKit (Safari, the Mac app) nor is known to in Firefox: there the screen is
// botdot's own viewer, as on the account's computer (ADR 149). navigator.userAgentData is Chromium's alone.
const boatViaVnc = () => state.features.includes('boat-desktop-vnc') && !navigator.userAgentData;
// "I'm done" (ADR 225): while the owner has control, it hands the screen back to the bot, whose last run carries on.
function screenDone(m, bot) {
  $('#screen-done', m).onclick = async () => {
    $('#screen-done', m).disabled = true;
    try {
      const r = await api(`/bots/${bot.id}/computer/done`, { method: 'POST' });
      toast(r.text || tr("I'm done"));
      m.close();
    } catch (e) { toast(e.message, true); $('#screen-done', m).disabled = false; }
  };
}

function openBoatComputer(bot) {
  let control = false;
  const vnc = boatViaVnc();
  const m = openModal(`
    <div class="modal-head"><h2>${tr("{name}'s computer", { name: botLabel(bot) })}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
    <div class="modal-body">
      <div class="screen-frame wide-screen" id="screen-frame"><div class="screen-off">${tr('Starting…')}</div></div>
      <div class="screen-bar">
        <span class="muted" id="boat-state" style="font-size:12.5px"></span>
        <span style="flex:1"></span>
        <button class="btn sm primary hidden" id="screen-done">✓ ${tr("I'm done")}</button>
        <button class="btn sm" id="screen-control" disabled>🖱 ${tr('Take control')}</button>
        <a class="btn sm hidden" id="screen-full" target="_blank" rel="noopener noreferrer">⤢ ${tr('Full screen')}</a>
      </div>
    </div>`);
  m.classList.add('wide', 'screen');
  const fit = () => fitScreen(m, 16 / 9);
  window.addEventListener('resize', fit);
  const line = () => api(`/bots/${bot.id}/computer`).then((d) => { $('#boat-state', m).textContent = d.text || ''; }, () => {});
  let shown = false, timer = null, open = true;
  const shield = () => {
    $('#screen-control', m).textContent = control ? `👁 ${tr('Just watch')}` : `🖱 ${tr('Take control')}`;
    $('#screen-done', m).classList.toggle('hidden', !control || !state.features.includes('screen-done'));
    if (vnc) {
      // noVNC takes the mouse and keys only when opened with them, as on the account's computer.
      $('#screen-full', m).href = screenUrl(bot.id, control);
      const f = $('#screen-frame iframe', m);
      if (f) f.src = screenUrl(bot.id, control);
      return;
    }
    $('#screen-shield', m)?.classList.toggle('hidden', control);
    $('#screen-frame iframe', m)?.setAttribute('tabindex', control ? '0' : '-1'); // no keys reach it by Tab either
  };
  const ask = async () => {
    if (!open) return;
    let d;
    try { d = await api(`/bots/${bot.id}/computer/desktop`, { method: 'POST', ...(vnc ? { body: { via: 'vnc' } } : {}) }); } catch (e) {
      shown = false;
      $('#screen-frame', m).innerHTML = `<div class="screen-off"><div class="big">🖥</div>${esc(e.message)}</div>`;
      $('#screen-control', m).disabled = true;
      $('#screen-full', m).classList.add('hidden');
      timer = setTimeout(ask, BOAT_ASK_MS);
      return;
    }
    if (!open) return;
    if (d.state !== 'running') {
      // Started again, or its desktop still readying: a new address once it runs, never the old one.
      shown = false;
      $('#screen-frame', m).innerHTML = `<div class="screen-off">${tr('Starting…')}</div>`;
      $('#screen-control', m).disabled = true;
      $('#screen-full', m).classList.add('hidden');
      timer = setTimeout(ask, 3000);
      return;
    }
    $('#screen-full', m).href = vnc ? screenUrl(bot.id, control) : d.url;
    $('#screen-full', m).classList.remove('hidden');
    $('#screen-control', m).disabled = false;
    if (!shown && vnc) {
      shown = true;
      $('#screen-frame', m).innerHTML = `<iframe src="${screenUrl(bot.id, control)}" title="${esc(tr('Live screen'))}"></iframe>`;
      keepScreenConnected($('#screen-frame iframe', m));
      line();
    } else if (!shown) {
      shown = true;
      $('#screen-frame', m).innerHTML = `<iframe src="${esc(boatFrameUrl(d.url))}" title="${esc(tr('Live screen'))}" allow="autoplay; fullscreen; clipboard-read; clipboard-write"></iframe><div class="screen-shield" id="screen-shield"></div>`;
      shield();
      line();
    }
    timer = setTimeout(ask, BOAT_ASK_MS);
  };
  $('#screen-control', m).onclick = () => { control = !control; shield(); };
  screenDone(m, bot);
  m.addEventListener('close', () => {
    open = false;
    clearTimeout(timer);
    m.classList.remove('wide', 'screen');
    m.style.removeProperty('--screen-w');
    window.removeEventListener('resize', fit);
  }, { once: true });
  line();
  ask();
  fit();
}

function openScreen(botId) {
  const bot = state.bots.find((b) => b.id === botId);
  if (!bot) return;
  if (bot.computer === 'boat') return openBoatComputer(bot);
  let control = false;
  const m = openModal(`
    <div class="modal-head"><h2>${tr("{name}'s computer", { name: botLabel(bot) })}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
    <div class="modal-body">
      <div class="screen-frame" id="screen-frame"><div class="muted">${tr('Loading…')}</div></div>
      <div class="screen-bar">
        <span style="flex:1"></span>
        <button class="btn sm primary hidden" id="screen-done">✓ ${tr("I'm done")}</button>
        <button class="btn sm" id="screen-control">🖱 ${tr('Take control')}</button>
        <a class="btn sm" id="screen-full" target="_blank" rel="noopener">⤢ ${tr('Full screen')}</a>
        <button class="btn sm danger" id="screen-reset" title="${esc(tr("Erase the account's computer, for every bot that works on it."))}">${tr('Reset')}</button>
      </div>
      <div class="req-note hidden" id="screen-update"><span id="screen-update-text"></span> <button class="btn sm" id="screen-update-yes"></button></div>
      <div class="req-note hidden" id="screen-old"><span id="screen-old-text"></span> <button class="btn sm" id="screen-old-copy"></button> <button class="btn sm danger" id="screen-old-erase"></button></div>
    </div>`);
  // The account's computer as the server describes it (#107): the words of its reset, of an update when one is
  // offered, of the bot's old computer of its own while it has one. Nothing of
  // them is this page's own.
  let info = null;
  const describe = () => api(`/bots/${botId}/computer`).then((d) => {
    info = d;
    // The server's word on the computer now: a bot made after this page loaded is not in state.computers yet.
    if (d.state) state.computers = { ...state.computers, [botId]: d.state === 'none' ? undefined : d.state };
    $('#screen-update', m).classList.toggle('hidden', !d.update);
    if (d.update) { $('#screen-update-text', m).textContent = d.update.text; $('#screen-update-yes', m).textContent = d.update.yes; }
    $('#screen-old', m).classList.toggle('hidden', !d.old);
    if (d.old) {
      $('#screen-old-text', m).textContent = d.old.text;
      $('#screen-old-copy', m).textContent = d.old.copy;
      $('#screen-old-erase', m).textContent = d.old.erase;
    }
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
    $('#screen-control', m).textContent = control ? `👁 ${tr('Just watch')}` : `🖱 ${tr('Take control')}`;
    $('#screen-full', m).href = screenUrl(botId, control);
    $('#screen-done', m).classList.toggle('hidden', !(control && on && state.features.includes('screen-done')));
    $('#screen-control', m).disabled = !on;
    $('#screen-frame', m).innerHTML = off
      ? `<div class="screen-off"><div class="big">🖥</div>${esc(off.text)}<div><button class="btn sm" id="screen-start">${esc(off.start)}</button></div></div>`
      : on
      ? `<iframe src="${screenUrl(botId, control)}" title="${esc(tr('Live screen'))}"></iframe>`
      : `<div class="screen-off"><div class="big">🖥</div>${state.computers?.[botId] === 'stopped' ? tr("The account's computer is starting again. It stays on for every bot.") : tr("The account's computer isn't made yet. The first computer tool of any bot makes it.")}</div>`;
    const start = $('#screen-start', m);
    if (start) start.onclick = async () => { start.disabled = true; await act('start', tr('Starting its screen…')); await describe(); };
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
  screenDone(m, bot);
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
  $('#screen-reset', m).onclick = async () => {
    if (!info?.reset) return;
    if (await askFirst(`${info.reset.title}\n\n${info.reset.text}`, tr('Reset'))) forAll('reset', tr('Resetting…'));
  };
  $('#screen-update-yes', m).onclick = async () => { if (info?.update && await askFirst(info.update.text, tr('Update'), { danger: false })) forAll('update', tr('Updating…')); };
  // A bot's old computer of its own: its files copied into its folder, then the old one erased.
  $('#screen-old-copy', m).onclick = async () => {
    try {
      toast(tr('Copying…'));
      const r = await api(`/bots/${botId}/computer`, { method: 'POST', body: { action: 'copy-old' } });
      toast(tr('Copied into {folder}', { folder: r.copied }));
    } catch (e) { toast(e.message, true); }
  };
  $('#screen-old-erase', m).onclick = async () => {
    if (!info?.old || !(await askFirst(info.old.confirm, tr('Erase')))) return;
    await act('reset', tr('Erasing…'));
    describe();
  };
  m.addEventListener('close', () => {
    m.classList.remove('wide', 'screen');
    m.style.removeProperty('--screen-w');
    window.removeEventListener('resize', fit);
  }, { once: true });
  frame();
}


// Plain-language explanation for a failed or stopped run; the raw error stays in the details. The server
// sends the same text as `problem` (lib/problems.js); this is for a run the page followed live.
// endedBy: who ended the run (docs/api.md): the owner, the Chief, a sign-out, a silence or the time limit.
const ENDED_BY = {
  owner: tr('You stopped this run before it finished.'),
  chief: tr('The Chief stopped this run before it finished.'),
  signout: tr('This run was stopped because Claude was signed out.'),
  idle: tr('I stopped because nothing happened for 20 minutes: I seemed stuck. Send it again, or break it into smaller pieces.'),
  limit: tr('I stopped after 4 hours: this took too long. Send it again, or break it into smaller pieces.'),
};
function friendlyProblem(meta, resultText) {
  const text = `${resultText || ''} ${meta.error || ''}`;
  if (Object.hasOwn(ENDED_BY, meta.endedBy)) return ENDED_BY[meta.endedBy];
  // Stopped, and the server names nobody (a server from before `endedBy`): the owner did. With a name the page does not know, nobody is named.
  if (meta.status === 'stopped') return meta.endedBy ? tr('This run was stopped before it finished.') : ENDED_BY.owner;
  if (meta.status === 'interrupted') return tr('This run was cut off because botdot was restarted.');
  if (/not logged in|\/login/i.test(text)) return tr("I couldn't start because Claude isn't signed in yet. Open Settings → Claude and sign in, then try again.");
  // Claude's servers refused the sign-in (a revoked or expired token): Claude Code's "Failed to authenticate. API Error: 401".
  if (/Failed to authenticate|authentication_error|API Error: 401/i.test(text)) {
    return meta.jobName ? tr("Claude refused my sign-in, so I couldn't finish. I will try again at the next scheduled time; if this keeps happening, sign in to Claude again in Settings → Claude.") : tr("Claude refused my sign-in, so I couldn't finish. Send it again; if this keeps happening, sign in to Claude again in Settings → Claude.");
  }
  if (/max.?turns/i.test(text)) return tr('The task took more steps than I was allowed. Try breaking it into smaller pieces.');
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|reach the API server|network error|fetch failed/i.test(text)) {
    return `${meta.steps ? tr("I lost the connection to Claude's servers, so I couldn't finish. This computer had no internet connection.") : tr("I couldn't reach Claude's servers, so I couldn't start. This computer had no internet connection.")} ${meta.jobName ? tr('I will try again at the next scheduled time.') : tr('Check the connection and send the message again.')}`;
  }
  if (meta.carriesOnAfterLimit) return tr("Claude's usage limit was reached, so I stopped. I'll carry on by myself once it resets."); // #1090
  if (/usage limit|hit your (usage )?limit|limit will reset/i.test(text)) return tr("Claude's usage limit was reached, so I stopped. Try again once it resets.");
  if (/overloaded|529|rate.?limit|429/i.test(text)) return tr("Claude's servers were busy, so I stopped. Try again in a little while.");
  // Something else: say what it was, briefly.
  const why = String(meta.error || resultText || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return why ? tr("Something went wrong and I couldn't finish. It said: “{why}”. The details show everything that happened.", { why }) : tr("Something went wrong and I couldn't finish. The details show everything that happened.");
}

function runHeader(meta) {
  const when = fmtTime(meta.startedAt);
  const facts = [
    meta.jobName ? `⏰ ${meta.trigger === 'schedule' ? tr('{job}, scheduled {when}', { job: esc(meta.jobName), when }) : meta.trigger === 'call' ? tr('{job}, called {when}', { job: esc(meta.jobName), when }) : tr('{job}, started {when}', { job: esc(meta.jobName), when })}`
      : meta.trigger === 'schedule' ? `⏰ ${tr('Scheduled {when}', { when })}` : tr('Started {when}', { when }),
    meta.kind === 'script' ? `⚙️ ${tr('script, no AI')}${meta.exitCode != null ? ` · ${tr('exit code {code}', { code: meta.exitCode })}` : ''}` : null,
    meta.durationMs != null ? tr('took {time}', { time: dur(meta.durationMs) }) : null,
  ].filter(Boolean).join(' · ');
  return `
    <div class="run-header" style="--bot-color:${esc(meta.botColor || '#6c7cff')}">
      ${runFigure(meta)}
      <div class="grow"><h2>${esc(meta.botName)}</h2>
        <div class="muted" style="font-size:12.5px">${facts}</div></div>
      ${statusPill(meta.status)}
      ${meta.status === 'running' ? `<button class="btn danger sm" id="stop-run">■ ${tr('Stop')}</button>` : `<button class="btn sm" id="rerun">↻ ${tr('Run again')}</button>`}
    </div>`;
}

// A run's folder, model, steps and how to go on in Claude Code: only with Advanced on (ADR 205).
function detailsInfo(meta) {
  if (!advanced()) return '';
  return `
    <div class="run-facts">
      <span>${tr('Folder')} <code class="mono">${esc(meta.project)}</code></span>
      ${meta.modelUsed || meta.model ? `<span>${tr('Model')} <b>${esc(meta.modelUsed || meta.model)}</b>${meta.effort ? ` · ${tr('reasoning')} <b>${esc(effortLabel(meta.effort))}</b>` : ''}</span>` : ''}
      <span>${tr('Steps')} <b>${meta.numTurns ?? '—'}</b></span>
      ${meta.sessionId ? `<span>${tr('Continue in Claude Code:')} <code class="mono">cd ${esc(meta.project)} && claude --resume ${esc(meta.sessionId)}</code> <button class="btn ghost sm" id="copy-resume">${tr('copy')}</button></span>` : ''}
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
        <div class="bubble from-bot live" id="answer"><div class="live-line"><div class="typing"><span></span><span></span><span></span></div><span class="activity muted">${tr('Working…')}</span></div></div>
      </div>
      <button class="details-toggle" id="details-toggle">${showDetails ? tr('Hide details') : tr('Show details')}</button>
      <div id="details" class="${showDetails ? '' : 'hidden'}">
        <div id="details-info">${meta ? detailsInfo(meta) : ''}</div>
        <div class="transcript" id="transcript"></div>
      </div>
    </div>`;
  const conv = $('#conversation');
  const transcript = $('#transcript');
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
    $('#details-toggle').textContent = open ? tr('Hide details') : tr('Show details');
    try { localStorage.setItem('botdot.details', open ? '1' : '0'); } catch { /* ignore */ }
  };

  const wire = () => {
    const stop = $('#stop-run');
    if (stop) stop.onclick = async () => { await api(`/runs/${id}/stop`, { method: 'POST' }); toast(tr('Stopping…')); };
    const rerun = $('#rerun');
    if (rerun) rerun.onclick = () => {
      const bot = state.bots.find((b) => b.id === current.botId);
      if (!bot) return toast(tr('That bot was deleted'), true);
      openRunDialog(bot.id);
    };
    const copy = $('#copy-resume');
    if (copy) copy.onclick = () => { navigator.clipboard.writeText(`cd ${current.project} && claude --resume ${current.sessionId}`); toast(tr('Copied')); };
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
    const body = failed ? current?.problem || friendlyProblem(current || {}, resultText) : resultText || tr('Done. (No written reply.)');
    answer.classList.toggle('problem', failed);
    answer.classList.remove('live'); // the answer can wrap normally
    answer.innerHTML = `<div class="md">${md(body)}</div>`;
  };
  wire();

  const es = new EventSource(`/api/runs/${id}/stream`);
  state.runStream = es;
  es.onmessage = (msg) => {
    const ev = JSON.parse(msg.data);
    if (OpeningLine.says(ev.type, state.features)) { line = OpeningLine.text(ev.text); setActivity(line || tr('Working')); }
    if (ev.type === 'phase') {
      setActivity(OpeningLine.text(ev.text) || line || tr('Working'));
    } else if (ev.type === 'run_start') {
      refreshMeta(ev.meta);
      $('#ask').textContent = ev.meta.prompt;
      if (ev.meta.computer && ev.meta.status === 'running' && state.bots.find((b) => b.id === ev.meta.botId)?.computer === 'linux') {
        $('#live-screen').innerHTML = `<div class="live-screen"><div class="live-label"><span class="pill accent pulse">${tr('live')}</span> ${tr("{name}'s screen", { name: esc(ev.meta.botName) })} <button class="btn ghost sm" data-screen-open>${tr('open')}</button></div><iframe src="${screenUrl(ev.meta.botId)}" title="${esc(tr('Live screen'))}"></iframe></div>`;
        keepScreenConnected($('#live-screen iframe'));
        $('[data-screen-open]').onclick = () => openScreen(ev.meta.botId);
      }
      $('#ask').onclick = () => $('#ask').classList.toggle('expanded');
    } else if (ev.type === 'run_end') {
      if (ev.meta) {
        refreshMeta(ev.meta);
        if (!$('#ask').textContent) $('#ask').textContent = ev.meta.prompt || '';
        if (resultText == null && ev.meta.result) resultText = ev.meta.result;
        if (ev.meta.error) transcript.insertAdjacentHTML('beforeend', `<div class="msg stderr">${esc(ev.meta.error)}</div>`);
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
      if (html) transcript.insertAdjacentHTML('beforeend', html);
      applyToolResults(transcript, ctx);
    }
    if (stick) conv.scrollTop = conv.scrollHeight;
  };
  es.onerror = () => es.close();
  history.replaceState(null, '', `#runs/${id}`);
}
