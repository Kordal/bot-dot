// ---------- scheduled jobs ----------

const AI_WHEN_TEXT = {
  output: tr('Only when it prints something'),
  failed: tr('Only when it fails'),
  always: tr('Every time it runs'),
  never: tr('Never, just show its output'),
};
const BY_WHO = { you: tr('you'), chief: tr('the Chief'), bot: tr('the bot itself') };

// `last` as the server sends it with `job-line` (docs/api.md): `status` may be "missed" (its time passed and it
// did not run), `failures` counts the failed runs in a row, and `text` is the whole line for under the job.
function jobStatus(j) {
  if (!j.approved) return `<span class="pill warn">${tr('needs your OK')}</span>`;
  if (!j.enabled) return `<span class="pill">${tr('paused')}</span>`;
  if (j.last?.status === 'missed') return `<span class="pill warn">${tr('did not run')}</span>`;
  if (j.last?.status === 'error') return Number.isInteger(j.last.failures) && j.last.failures > 1 ? `<span class="pill err">${trn(j.last.failures, 'failed {n} time', 'failed {n} times')}</span>` : `<span class="pill err">${tr('last run failed')}</span>`;
  return j.nextRunAt ? `<span class="pill">${tr('next {time}', { time: esc(shortTime(j.nextRunAt)) })}</span>` : '';
}

// The line under a job: the server's own (`last.text`: why it failed or did not run, with times in the owner's
// time zone), else the page's, for a server that sends none.
function jobLastText(j) {
  const l = j.last;
  if (!l) return tr('Not run yet.');
  if (OpeningLine.text(l.text)) return OpeningLine.text(l.text);
  if (l.status === 'missed') return tr('Did not run.');
  const what = { held: tr('held till morning'), quiet: tr('nothing to report'), success: tr('done'), error: tr('failed'), stopped: tr('stopped'), interrupted: tr('cut off') }[l.status] || l.status;
  return tr('Last run {ago}: {what}.', { ago: ago(l.at), what });
}
// A job's pill and its line, on its card: drawn again only when the server says something new about the job,
// so that the fields of an open card, and "Saved." after a change, stay as they are.
const jobLineSig = (j) => JSON.stringify([j.approved, j.enabled, j.last || null, j.nextRunAt || null, j.createdBy || null, changeOf(j)?.at || null]);
const jobFootText = (j) => `${jobLastText(j)}${j.createdBy && j.createdBy !== 'you' ? ` ${tr('Set up by {who}.', { who: BY_WHO[j.createdBy] || j.createdBy })}` : ''}`;
const jobWarns = (j) => ['error', 'missed', 'stopped', 'interrupted'].includes(j.last?.status);
function drawJobLine(card, j, force = false) {
  const sig = jobLineSig(j);
  if (!force && card.dataset.line === sig) return;
  card.dataset.line = sig;
  $('summary .pill', card)?.remove();
  $('.switch', card)?.insertAdjacentHTML('beforebegin', jobStatus(j));
  drawJobChange(card, j);
  const line = $('.job-last', card);
  if (!line) return;
  line.textContent = jobFootText(j);
  line.classList.toggle('warn', jobWarns(j));
}

// A job with a change waiting is the approved job, and runs: its pill and its fields are the approved ones. One
// note says that a change waits, with the way to its card. '' for a job without one.
const jobChangeNote = (j) => (changeOf(j) ? `<div class="req-note job-change">${tr('A change waits for your OK.')} ${esc(RUNS_AS_APPROVED)} <button type="button" class="btn sm primary" data-review>${tr('Review the change')}</button></div>` : '');
// The note follows the job while its card is open: it comes with a change and goes with the answer.
function drawJobChange(card, j) {
  $('.job-change', card)?.remove();
  const note = jobChangeNote(j);
  if (!note) return;
  $('.job-body', card)?.insertAdjacentHTML('afterbegin', note);
  wireJobChange(card);
}
// "Review the change" opens the change as the server has it now: a second one may have taken the first one's place.
function wireJobChange(card) {
  const review = $('[data-review]', card);
  if (review) review.onclick = () => { const bot = botById(state.botId); const job = bot?.jobs?.find((x) => x.id === card.dataset.job); if (job && changeOf(job)) openJobApproval(bot, job); };
}

// Where a job sends the end of each run (`notifyUrl`, docs/api.md "Telling an address when a run ends"): shown, not
// edited here; the Chief or the bot proposes it and the owner approves it on a card. '' for a job without one.
// The Vault logins a script job's script may use with botdot-request (ADR 085): shown, not edited (the Chief changes them by chat).
const jobLoginsLine = (j) => (j.kind === 'script' && Array.isArray(j.logins) && j.logins.length ? `<div class="faint job-logins">${tr('Logins: {names}', { names: esc(j.logins.filter((n) => typeof n === 'string').join(', ')) })}</div>` : '');
const jobNotifyLine = (j) => (typeof j.notifyUrl === 'string' && j.notifyUrl ? `<div class="faint job-notify">${tr('Tells {url} when a run ends, signed with the secret in the Vault.', { url: `<span class="mono">${esc(j.notifyUrl)}</span>` })}</div>` : '');
// A job that takes signed calls (`callMode: "signed"`, docs/api.md "A signed call"): how a sender gets in, beside the
// notify line. '' for any other job.
const jobCallModeLine = (j) => (j.call === true && j.callMode === 'signed' ? `<div class="faint job-call-mode">${tr('Takes signed calls: each one is signed with the secret in the Vault, and runs once.')}</div>` : '');

// What an empty task means, as its placeholder rather than a line beside its label (#635).
const jobPromptEmpty = (script) => (script ? tr('When it is asked') : tr("Empty: the bot's main assignment"));

function jobCardHTML(j, open = false) {
  const script = j.kind === 'script';
  const preset = CRON_PRESETS.some((p) => p.cron === j.cron);
  return `
    <details class="job-card" data-job="${esc(j.id)}" data-line="${esc(jobLineSig(j))}" ${open || jobWaits(j) ? 'open' : ''}>
      <summary>
        <span class="job-icon">${script ? '⚙️' : '🧠'}</span>
        <span class="grow"><b class="job-title">${esc(j.name || tr('New job'))}</b> <span class="faint job-when">${esc(j.when)}</span></span>
        ${jobStatus(j)}
        <label class="switch" title="${j.enabled !== false ? tr('On: click to pause') : tr('Paused: click to resume')}"><input type="checkbox" name="jobEnabled" ${j.enabled !== false ? 'checked' : ''} aria-label="${tr('Job on')}"><span></span></label>
      </summary>
      <div class="job-body">
        ${jobChangeNote(j)}${!j.approved ? `<div class="req-note job-approve">${esc(j.changedBy === 'bot' ? tr('The bot set this up, so it waits for your OK before it runs.') : j.changedBy === 'chief' ? tr('The Chief set this up, so it waits for your OK before it runs.') : tr('Someone set this up, so it waits for your OK before it runs.'))} <button type="button" class="btn sm primary" data-approve>${tr('Approve')}</button></div>` : ''}
        ${j.assessment ? `<div class="job-why">💡 ${esc(j.assessment)}</div>` : ''}
        ${jobCallModeLine(j)}${jobNotifyLine(j)}${jobLoginsLine(j)}
        <div class="row">
          <label class="field">${tr('Name')}<input type="text" name="jobName" value="${esc(j.name)}" placeholder="${tr('e.g. Morning news')}" maxlength="60"></label>
          <label class="field">${tr('When')}<select name="jobWhen">
            ${CRON_PRESETS.map((p) => `<option value="${p.cron}" ${p.cron === j.cron ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
            <option value="" ${preset ? '' : 'selected'}>${tr('Another time…')}</option>
          </select></label>
        </div>
        <div class="job-cron ${preset ? 'hidden' : ''}">
          <label class="field" title="${tr('cron: min hour day month weekday')}">${tr('Schedule')}<input type="text" class="mono" name="jobCron" value="${esc(j.cron)}" placeholder="30 7 * * 1-5"></label>
          <div class="cron-preview"></div>
        </div>
        <div class="job-script ${script ? '' : 'hidden'}">
          <label class="field" title="${tr("bash, runs in the bot's folder on this computer. Print nothing when there's nothing to report. $JOB_STATE_DIR keeps files between runs.")}">${tr('Script')}
            <textarea class="mono" name="jobScript" rows="6" placeholder="curl -fsS https://example.com > /dev/null || echo &quot;example.com is down&quot;">${esc(j.script || '')}</textarea></label>
          <label class="field">${tr('Then ask the AI')}<select name="jobAiWhen">${Object.entries(AI_WHEN_TEXT).map(([k, v]) => `<option value="${k}" ${(j.aiWhen || 'output') === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span class="job-prompt-label">${script ? tr('What the AI should do with the output') : tr('Task')}</span>
          <textarea name="jobPrompt" rows="3" placeholder="${jobPromptEmpty(script)}">${esc(j.prompt || '')}</textarea></label>
        <details class="job-more"><summary class="faint">${tr('More options')}</summary>
          <div class="row">
            <label class="field">${tr('Kind')}<select name="jobKind">
              <option value="ai" ${script ? '' : 'selected'}>🧠 ${tr('AI: a run of the bot')}</option>
              <option value="script" ${script ? 'selected' : ''}>⚙️ ${tr('Script, no AI')}</option>
            </select></label>
            <label class="field job-timeout ${script ? '' : 'hidden'}">${tr('Script time limit (seconds)')}<input type="number" name="jobTimeout" min="10" max="3600" value="${esc(j.timeoutSeconds || 300)}"></label>
          </div>
        </details>
        <div class="job-foot">
          <span class="faint grow job-last${jobWarns(j) ? ' warn' : ''}">${esc(jobFootText(j))}</span>
          <button type="button" class="btn sm" data-run-job>${tr('Run now')}</button>
          <button type="button" class="btn sm danger" data-remove-job>${tr('Remove')}</button>
        </div>
      </div>
    </details>`;
}

const readJob = (card) => {
  const v = (n) => card.querySelector(`[name=${n}]`);
  return {
    name: v('jobName').value.trim(),
    kind: v('jobKind').value,
    cron: v('jobCron').value.trim(),
    prompt: v('jobPrompt').value,
    script: v('jobScript').value,
    aiWhen: v('jobAiWhen').value,
    timeoutSeconds: Number(v('jobTimeout').value) || 300,
  };
};

// A job on the jobs page: every change saves by itself; the switch pauses or resumes it right away.
function wireJobCard(card, bot) {
  const $in = (n) => card.querySelector(`[name=${n}]`);
  const jobUrl = () => `/bots/${bot.id}/jobs/${card.dataset.job}`;
  const showStatus = (job) => {
    $('summary .pill', card)?.remove();
    if (job) $('.switch', card).insertAdjacentHTML('beforebegin', jobStatus(job));
    if (job) drawJobChange(card, job); // the owner's own edit is approved at once and drops a waiting change
  };
  wireJobChange(card);
  // The schedule in the field, as the server says it: its words in the header and, with its next runs, under
  // the field. Only the newest answer is shown: an earlier one can arrive after it.
  let asked = 0;
  const preview = async () => {
    const mine = ++asked;
    const r = await api('/cron/preview', { method: 'POST', body: { expr: $in('jobCron').value } }).catch((e) => ({ error: e.message }));
    if (mine !== asked) return;
    if (r.when) $('.job-when', card).textContent = r.when;
    const el = $('.cron-preview', card);
    el.classList.toggle('err', !!r.error);
    el.textContent = r.error ? r.error : r.next.length ? tr('{when}. Next: {times}', { when: r.when, times: r.next.map(fmtTime).join(' · ') }) : r.when;
  };
  $in('jobCron').oninput = preview;
  $in('jobWhen').onchange = () => {
    const cron = $in('jobWhen').value;
    $('.job-cron', card).classList.toggle('hidden', !!cron);
    if (cron) $in('jobCron').value = cron;
    else $in('jobCron').focus();
    preview();
  };
  // A job on a listed time has its words from the server already; the others need their next runs.
  if (!$('.job-cron', card).classList.contains('hidden')) preview();
  $in('jobName').oninput = () => { $('.job-title', card).textContent = $in('jobName').value || tr('New job'); };
  $in('jobKind').onchange = () => {
    const script = $in('jobKind').value === 'script';
    $('.job-script', card).classList.toggle('hidden', !script);
    $('.job-timeout', card).classList.toggle('hidden', !script);
    $('.job-icon', card).textContent = script ? '⚙️' : '🧠';
    $('.job-prompt-label', card).textContent = script ? tr('What the AI should do with the output') : tr('Task');
    card.querySelector('[name=jobPrompt]').placeholder = jobPromptEmpty(script);
    if (script) $in('jobScript').focus();
  };
  // Save what changed, a moment after the last change (a script job without its script waits until it has one).
  let saved = JSON.stringify(readJob(card));
  let timer = null;
  let savedTimer = null; // while "Saved." stands where the job's line is
  const save = async () => {
    const now = readJob(card);
    if (JSON.stringify(now) === saved || (now.kind === 'script' && !now.script.trim())) return;
    try {
      const job = await api(jobUrl(), { method: 'PUT', body: now });
      saved = JSON.stringify(now);
      showStatus(job);
      // Said where the job's line is, for a moment: then the line is the job's again.
      const line = $('.job-last', card);
      line.textContent = job.approved ? tr('Saved.') : tr('Saved. It waits for your OK again.');
      line.classList.remove('warn');
      card.dataset.line = jobLineSig(job); // what the server said with the save: a later change of it redraws the line at once
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => { const j = botById(bot.id)?.jobs?.find((x) => x.id === card.dataset.job) || job; drawJobLine(card, j, true); }, 2500);
      refresh();
    } catch (e) { toast(e.message, true); }
  };
  card.addEventListener('change', (e) => { if (e.target.name !== 'jobEnabled') { clearTimeout(timer); timer = setTimeout(save, 300); } });
  $('[data-remove-job]', card).onclick = async () => {
    if (!confirm(tr('Remove this job?'))) return;
    try { await api(jobUrl(), { method: 'DELETE' }); card.remove(); toast(tr('Job removed')); refresh(); } catch (e) { toast(e.message, true); }
  };
  const sw = $('.switch', card);
  sw.onclick = async (e) => {
    e.preventDefault(); // a click in the summary would also open or close the job
    const input = $('input', sw);
    const on = !input.checked;
    input.checked = on;
    sw.title = on ? tr('On: click to pause') : tr('Paused: click to resume');
    try {
      const job = await api(jobUrl(), { method: 'PUT', body: { enabled: on } });
      showStatus(job);
      toast(on ? tr('Job resumed') : tr('Job paused. It won’t run until you turn it back on.'));
      refresh();
    } catch (err) { input.checked = !on; toast(err.message, true); }
  };
  $('[data-run-job]', card).onclick = async () => {
    try {
      const r = await api(`${jobUrl()}/run`, { method: 'POST' });
      toast(OpeningLine.text(r.skipped) || (r.queued ? tr('It will run as soon as the bot is free') : r.started === 'script' ? tr('Script started. Nothing to report means nothing shows in the chat.') : tr('Started'))); // skipped: why it did not start, in the server's words
      refresh();
    } catch (e) { toast(e.message, true); }
  };
  const approve = $('[data-approve]', card);
  // Approve right here (the script is shown in the card).
  if (approve) approve.onclick = () => whileBusy(approve, tr('Approving…'), async () => {
    try {
      const job = await api(`${jobUrl()}/approve`, { method: 'POST', body: { approve: true } });
      $('.job-approve', card)?.remove();
      showStatus(job);
      toast(tr('Approved'));
      refresh();
    } catch (e) { toast(e.message, true); }
  });
}

// A script job's run in the chat: what it printed, no AI involved.
function scriptRunHTML(r) {
  const failed = r.status !== 'success';
  const meta = [msgTime(r.endedAt || r.startedAt), r.durationMs != null ? dur(r.durationMs) : null, tr('no AI')];
  return `
    <div class="bubble-row from-me"><span class="chip">⏰ ${esc(r.jobName || tr('Job'))} · ${esc(msgTime(r.startedAt))}</span></div>
    <div class="bubble-row from-bot"><div class="stack">
      <div class="bubble from-bot ${failed ? 'problem' : ''}">
        <div class="faint" style="font-size:12px;margin-bottom:4px">⚙️ ${failed ? tr('Ran its script: {error}', { error: esc(r.error || tr('it failed')) }) : tr('Ran its script')}</div>
        ${r.result && r.result.trim() ? `<pre class="script-out" data-expand><div class="clamp">${esc(r.result.trim())}</div></pre>` : `<div class="muted">${tr('No output.')}</div>`}
      </div>
      <div class="bubble-meta">${meta.map(esc).join(' · ')} · <button data-details="${esc(r.id)}">${tr('Details')}</button>${r.result?.trim() ? copyBtn(r.result.trim()) : ''}</div>
    </div></div>`;
}

// Jobs waiting for the owner's OK: in the Needs you banner and page.
const jobReq = { snoozed: new Set() };

// A change that waits beside an approved job or tile (docs/api.md, "A change that waits"): the job or the tile as
// proposed, or null. The approved one keeps running, so it is `approved` and found by its `change` alone.
const changeOf = (x) => (x && x.approved !== false && x.change && typeof x.change === 'object' ? x.change : null);
// Whether a job waits for the owner: one never approved, or an approved one with a change beside it.
const jobWaits = (j) => !j.approved || !!changeOf(j);
// Whether a yes on a waiting job approves a script: the job runs one, or its change says it would or carries one.
const touchesScript = (j) => j.kind === 'script' || changeOf(j)?.kind === 'script' || (typeof changeOf(j)?.script === 'string' && !!changeOf(j).script.trim());
// Whether a yes on a waiting job makes a connection (#154: a call or an address to tell): its change turns calls on, switches how they are
// let in, or gives an address to tell when a run ends. Its key or secret is made in the Vault, which takes seconds.
const callModeIn = (x) => (x.callMode === 'signed' ? 'signed' : 'bearer');
const createsConnection = (j) => {
  const c = changeOf(j);
  if (!c) return false;
  return (c.call === true && (!j.call || callModeIn(c) !== callModeIn(j))) || (typeof c.notifyUrl === 'string' && !!c.notifyUrl && c.notifyUrl !== j.notifyUrl);
};
// A yes on a waiting job, pressed: "Creating connection…" with a spinner when it turns on a call or a notify address, else "Approving…".
const whileApproving = (button, j, work) => (createsConnection(j) ? whileBusy(button, tr('Creating connection…'), work, true) : whileBusy(button, tr('Approving…'), work));

function pendingJobs() {
  return state.bots.flatMap((b) => (b.jobs || []).filter(jobWaits).map((j) => ({ bot: b, job: j })));
}

function showJobApprovals() { showNeeds(); }

// What a yes on a waiting job approves, as one string: what the job does, and the change that waits beside it.
const jobShown = (j) => JSON.stringify([j.approved, j.kind, j.cron, j.at || null, j.script || '', j.prompt || '', j.aiWhen || null, j.notify || null, changeOf(j)]);

// The dialog of one waiting job, from the banner and from the jobs panel: a job before its first OK, or a change to
// an approved one, with what goes struck above what comes (jobCard). Its buttons and its answer read the server's
// words where it sends them; nothing is asked in between.
function openJobApproval(bot, job) {
  jobReq.snoozed.add(`${job.id}:${job.script}:${job.cron}`);
  const c = jobCard(job);
  const script = c.isScript;
  const by = changeOf(job)?.by;
  const name = bot.name;
  const lead = c.change ? (by === 'bot' ? tr('{name} wants to change this job of its own:', { name }) : by === 'chief' ? tr('The Chief wants to change this job of {name}:', { name }) : tr('A change to this job of {name}:', { name }))
    : job.changedBy === 'bot' ? tr('{name} set this up for itself:', { name }) : job.changedBy === 'chief' ? tr('The Chief set this up for {name}:', { name }) : tr('This job of {name} changed:', { name });
  const block = (was, now, tag, style) => (goes(was, now) === null ? '' : `<${tag} class="${tag === 'pre' ? 'script-out ' : 'card '}faint-strike" style="${style}">${esc(was)}</${tag}>`)
    + (now ? `<${tag} class="${tag === 'pre' ? 'script-out' : 'card'}" style="${style}">${esc(now)}</${tag}>` : '');
  const scripts = block(c.scriptWas, c.script, 'pre', 'max-height:260px;overflow:auto');
  const prompts = block(c.promptWas, c.prompt, 'div', 'padding:10px 12px;white-space:pre-wrap;font-size:13px');
  const m = openModal(`
    <div class="modal-head"><h2>${c.change ? tr('Approve this change?') : tr('Approve this job?')}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
    <div class="modal-body">
      <p style="margin:0">${esc(lead)}</p>
      <div class="card" style="padding:12px 14px;display:grid;gap:6px">
        <div><b>${script ? '⚙️' : '🧠'} ${esc(c.name)}</b> · ${esc(c.change && c.when !== job.when ? tr('now {was} → {now}', { was: job.when, now: c.when }) : c.when)}</div>
        <div class="muted" style="font-size:13px">${script ? tr('A script that runs on this computer without AI. Then asks the AI: {when}.', { when: esc(AI_WHEN_TEXT[c.aiWhen] || c.aiWhen || '').toLowerCase() }) : tr('A run of the bot (uses AI each time).')}</div>
        ${c.summary ? `<div>${esc(c.summary)}</div>` : ''}
        ${c.also.map((l) => `<div class="muted" style="font-size:13px">${esc(l)}</div>`).join('')}
        ${c.assessment ? `<div class="job-why">💡 ${esc(c.assessment)}</div>` : ''}
        ${c.line ? `<div style="font-size:13px">${esc(c.line)}</div>` : ''}
      </div>
      ${scripts ? `<label class="field">${tr('The script')}${scripts}</label>
      ${script ? `<div class="req-note">${tr("It runs in {name}'s folder with your user's permissions. Only approve it if you're happy with what it does.", { name: esc(bot.name) })}</div>` : ''}` : ''}
      ${prompts ? `<label class="field">${script ? tr('What the AI does with the output') : tr('Task')}${prompts}</label>` : ''}
    </div>
    <div class="modal-foot">
      <button type="button" class="btn ${c.change ? '' : 'danger '}left" id="job-decline">${esc(c.change || said(job.no) ? c.no : tr('Decline and remove'))}</button>
      <button type="button" class="btn" data-dismiss>${tr('Not now')}</button>
      <button type="button" class="btn primary" id="job-approve">${esc(c.yes)}</button>
    </div>`);
  const answer = async (approve) => {
    try {
      // The page is not read again while a dialog is open, and the yes approves what waits at that moment: look
      // first whether it is still what this dialog shows. A job that changed meanwhile is shown again, not approved.
      if (approve) {
        const jobs = await api(`/bots/${bot.id}/jobs`);
        const now = Array.isArray(jobs) ? jobs.find((j) => j.id === job.id) : undefined; // an answer that is no list says nothing
        if (Array.isArray(jobs) && (!now || !jobWaits(now))) { m.close(); toast(tr('This no longer waits for your OK.')); return refresh(); }
        if (now && jobShown(now) !== jobShown(job)) { m.close(); toast(tr('It changed meanwhile: look at it again.')); refresh(); return openJobApproval(bot, now); }
      }
      const a = await api(`/bots/${bot.id}/jobs/${job.id}/approve`, { method: 'POST', body: { approve } });
      m.close();
      const carries = approve ? said(a?.carriesOn?.text) : '';
      const word = (approve && !c.change ? '' : said(a?.text)) || (c.change ? (approve ? tr('Approved') : tr('Declined')) : approve ? tr('Approved. {name}: {when}.', { name: job.name, when: job.when }) : tr('Declined and removed'));
      toast(carries ? `${word} · ${carries}` : word);
      refresh();
    } catch (e) { toast(e.message, true); }
  };
  $('#job-approve', m).onclick = () => whileApproving($('#job-approve', m), job, () => answer(true));
  $('#job-decline', m).onclick = () => whileBusy($('#job-decline', m), tr('Declining…'), () => answer(false)); // the button says what it does
}
