// ---------- login requests (secure pop-up) ----------

const loginReq = { pending: [], shown: null, snoozed: new Set(), saving: new Set() };

async function pollLoginRequests() {
  loginReq.polledAt = Date.now();
  let list;
  try { list = await api('/vault/requests'); } catch { return; }
  // Ones being saved in the background are as good as answered.
  loginReq.pending = list.filter((r) => !loginReq.saving.has(r.id));
  showNeeds();
  // Pop it up straight away unless the user is busy in another dialog or put it aside.
  const next = loginReq.pending.find((r) => !loginReq.snoozed.has(r.id));
  if (next && !loginReq.shown && !$('#modal').open) openLoginRequest(next);
  if (loginReq.shown && !list.some((r) => r.id === loginReq.shown) && $('#modal').open && $('#modal').dataset.request === loginReq.shown) {
    $('#modal').close(); // answered elsewhere (e.g. on the phone) or expired
  }
}

// A list of other logins longer than this gets a search field and scrolls inside the dialog.
const LOGIN_SEARCH_ABOVE = 6;

// Whether a login of another website stays in the list for what was typed: every typed word is in its name,
// username or website, whatever the case. Nothing typed keeps every login.
function loginRequestMatches(e, q) {
  const hay = [e.name, e.username, e.site].map((v) => String(v ?? '').toLowerCase());
  return String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.some((h) => h.includes(w)));
}

// "Use another saved login": the line that opens the saved logins of other websites (r.others, docs/api.md),
// and their list, with a search field when it is long. Nothing when there are none, so the dialog is as it was.
function loginRequestOthers(r) {
  const others = r.others || [];
  if (!others.length) return '';
  const long = others.length > LOGIN_SEARCH_ABOVE;
  return `<div class="req-others">
          <button type="button" class="link-btn" id="req-others-open" aria-expanded="false" aria-controls="req-others-list">Use another saved login</button>
          <fieldset id="req-others-list" hidden><legend>Saved for another website</legend>
            ${long ? '<input type="search" id="req-others-search" placeholder="Search" aria-label="Search the saved logins" autocomplete="off" autocapitalize="off" spellcheck="false">' : ''}
            <div class="req-others-rows${long ? ' long' : ''}">
            ${others.map((e) => `<div class="req-existing"><span>🔑 <b>${esc(e.name)}</b>${e.username ? ` · ${esc(e.username)}` : ''}<span class="req-other-site">${esc(e.site)}</span></span><button type="button" class="btn sm" data-other="${esc(e.id)}">Use it</button></div>`).join('')}
            </div>
            ${long ? '<div class="req-others-none faint" hidden>No saved login matches.</div>' : ''}
          </fieldset>
        </div>`;
}

// The second question, before a login saved for another website is used on the requested one: it names the
// login, its website and the requested host. Only its button sends the answer.
function loginRequestConfirm(r, e) {
  return `<div class="req-confirm" id="req-confirm">
          <div class="req-site">
            <div class="muted" style="font-size:12.5px">Use the login</div>
            <div class="site">${esc(e.name)}</div>
            <div class="muted" style="font-size:12.5px">${e.site ? `saved for <b>${esc(e.site)}</b>` : 'saved without a website'}</div>
            <div class="muted" style="font-size:12.5px;margin-top:8px">on</div>
            <div class="site">${esc(r.site)}</div>
          </div>
          <div class="req-note req-warn">⚠️ Its password will also be used on <b>${esc(r.site)}</b>, by ${esc(r.bot.name)}. Only continue if ${esc(r.site)} really takes this login: web pages can try to trick bots into asking.</div>
          <div class="req-error" role="alert" hidden></div>
          <div class="req-confirm-actions">
            <button type="button" class="btn" data-back>Back</button>
            <button type="button" class="btn primary" id="req-confirm-yes">Use it on ${esc(r.site)}</button>
          </div>
        </div>`;
}

function openLoginRequest(r) {
  if (r.kind === 'card') return openCardApproval(r);
  loginReq.shown = r.id;
  const reusable = r.existing.filter((e) => !e.allowed);
  const m = openModal(`
    <form id="login-request" autocomplete="off">
      <div class="modal-head"><h2>🔐 ${botLabel(r.bot)} needs a login</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <div class="req-site">
          <div class="muted" style="font-size:12.5px">Website</div>
          <div class="site">${esc(r.site)}</div>
          <div class="muted" style="font-size:12.5px">It will only ever be used with this address, and only by ${esc(r.bot.name)}.</div>
        </div>
        ${r.reason ? `<div class="req-reason"><span class="muted">${r.from === 'chief' ? 'The Chief says' : 'The bot says'}:</span> “${esc(r.reason)}”</div>` : ''}
        ${reusable.length ? `
          <fieldset><legend>Already in your Vault</legend>
            ${reusable.map((e) => `<div class="req-existing"><span>🔑 <b>${esc(e.name)}</b> ${e.username ? `· ${esc(e.username)}` : ''}</span><button type="button" class="btn sm" data-allow="${esc(e.id)}">Let ${esc(r.bot.name)} use it</button></div>`).join('')}
          </fieldset>` : ''}
        ${loginRequestOthers(r)}
        ${reusable.length || (r.others || []).length ? '<div class="faint" style="font-size:12px;text-align:center">or save a new one:</div>' : ''}
        ${state.bw?.configured && state.bw.unlocked ? `<div class="req-note bw-hint">Already in your Bitwarden? Move it into the <b>bot-dot</b> folder there (edit the item → Folder), then <button type="button" class="link-btn" id="req-recheck">check Bitwarden again</button>.</div>` : ''}
        ${vaultTypeControl(r.type)}
        ${vaultTypeFields(r.type, { username: r.username })}
        <label class="toggle"><input type="checkbox" name="insecureTls"> Accept a self-signed certificate <span class="hint muted" style="font-weight:400">for your own servers</span></label>
        <label class="field">Save as<input type="text" name="name" value="${esc(r.name)}"></label>
        ${state.bw?.configured && !state.bw.unlocked ? '<label class="field">Bitwarden master password <span class="hint">Bitwarden is locked; this unlocks it so the login is saved there</span><input type="password" name="unlockPassword" autocomplete="current-password" required></label>' : ''}
        <div class="req-note">🛡 Goes straight into ${state.bw?.configured ? 'your Bitwarden (bot-dot folder)' : 'your encrypted Vault'}. The AI never sees it, and it isn't written to the chat or logs.
          Only continue if you expected this request: web pages can try to trick bots into asking.</div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn danger left" id="req-decline">Decline</button>
        <button type="button" class="btn" id="req-later">Later</button>
        <button class="btn primary" type="submit">Save and continue</button>
      </div>
    </form>`);
  m.dataset.request = r.id;
  const form = $('#login-request', m);
  wireVaultType(form, { username: r.username });
  setTimeout(() => (r.username || !form.username ? form.password : form.username).focus(), 50);
  const answer = async (body, msg) => {
    try {
      await api(`/vault/requests/${r.id}`, { method: 'POST', body });
      form.password.value = '';
      m.close();
      toast(msg);
      pollLoginRequests();
    } catch (e) { toast(e.message, true); }
  };
  $$('[data-allow]', m).forEach((b) => (b.onclick = () => whileBusy(b, 'Allowing…', () => answer({ action: 'allow', loginId: b.dataset.allow }, `${r.bot.name} can now use it and will continue`))));
  // A login of another website: its list opens from one line, and a pick is asked a second time in the dialog.
  const othersOpen = $('#req-others-open', m);
  if (othersOpen) othersOpen.onclick = () => {
    const list = $('#req-others-list', m);
    list.hidden = !list.hidden;
    othersOpen.setAttribute('aria-expanded', String(!list.hidden));
    if (!list.hidden) $('#req-others-search', m)?.focus();
  };
  // The search of a long list: the page filters the rows itself, each found by the login its button names.
  const othersSearch = $('#req-others-search', m);
  if (othersSearch) {
    othersSearch.oninput = () => {
      let left = 0;
      $$('#req-others-list .req-existing', m).forEach((row) => {
        const e = r.others.find((x) => x.id === $('[data-other]', row).dataset.other);
        row.hidden = !e || !loginRequestMatches(e, othersSearch.value);
        if (!row.hidden) left++;
      });
      $('.req-others-none', m).hidden = left > 0;
    };
    // Enter here searches; it must not save a new login.
    othersSearch.onkeydown = (e) => { if (e.key === 'Enter') e.preventDefault(); };
  }
  $$('[data-other]', m).forEach((b) => (b.onclick = () => {
    const e = r.others.find((x) => x.id === b.dataset.other);
    if (!e) return;
    $('.modal-body', m).insertAdjacentHTML('beforeend', loginRequestConfirm(r, e));
    form.classList.add('confirming');
    const c = $('#req-confirm', m);
    const yes = $('#req-confirm-yes', c);
    $('[data-back]', c).onclick = () => { c.remove(); form.classList.remove('confirming'); };
    $('[data-back]', c).focus();
    yes.onclick = () => whileBusy(yes, 'Allowing…', async () => {
      try {
        await api(`/vault/requests/${r.id}`, { method: 'POST', body: { action: 'allow', loginId: e.id } });
        m.close();
        toast(`${r.bot.name} can now use it on ${r.site} and will continue`);
        pollLoginRequests();
      } catch (err) {
        // The server's sentence (the login has 20 additional hosts already, say); the request stays open.
        const box = $('.req-error', c);
        box.textContent = err.message;
        box.hidden = false;
      }
    });
  }));
  $('#req-decline', m).onclick = () => whileBusy($('#req-decline', m), 'Declining…', () => answer({ action: 'decline' }, 'Declined'));
  const recheck = $('#req-recheck', m);
  if (recheck) recheck.onclick = async () => {
    recheck.disabled = true; recheck.textContent = 'checking…';
    try {
      await api('/vault/bitwarden/sync', { method: 'POST' });
      const fresh = (await api('/vault/requests')).find((x) => x.id === r.id);
      const found = fresh ? fresh.existing.filter((e) => !e.allowed).length : 0;
      m.close(); // the regular check reopens it with what's in Bitwarden now
      if (fresh) toast(found ? 'Found it. Choose it to let the bot use it.' : `Nothing for ${fresh.site} in the bot-dot folder yet. Check the item's website address in Bitwarden too.`, !found);
    } catch (e) { toast(e.message, true); recheck.disabled = false; recheck.textContent = 'check Bitwarden again'; }
  };
  $('#req-later', m).onclick = () => { loginReq.snoozed.add(r.id); m.close(); };
  $('[data-dismiss]', m).onclick = () => { loginReq.snoozed.add(r.id); m.close(); };
  form.onsubmit = (e) => {
    e.preventDefault();
    const body = { action: 'save', name: form.name.value.trim(), ...vaultTypeBody(form), password: form.password.value, insecureTls: form.insecureTls.checked };
    if (form.unlockPassword) { body.unlockPassword = form.unlockPassword.value; form.unlockPassword.value = ''; }
    loginReq.saving.add(r.id);
    m.close();
    saveLoginInBackground(r, body);
  };
  m.addEventListener('close', () => { loginReq.shown = null; delete m.dataset.request; form.password.value = ''; pollLoginRequests(); }, { once: true });
}

// Saving to Bitwarden (and unlocking it first, if it's locked) takes a few seconds: like unlocking,
// it runs in the background with the pill in the corner, and the bot continues once it's saved.
async function saveLoginInBackground(r, body) {
  unlockPill('busy', 'Saving login…');
  try {
    await api(`/vault/requests/${r.id}`, { method: 'POST', body });
    unlockPill('ok', `Saved. ${r.bot.name} will continue.`);
    if (body.unlockPassword) pollBitwarden();
  } catch (err) {
    // Opened again with the type the owner chose and the username they typed, so the next try saves what they meant.
    const again = () => { const x = loginReq.pending.find((y) => y.id === r.id); if (x && !$('#modal').open) openLoginRequest({ ...x, type: body.type, username: body.username ?? x.username }); };
    unlockPill('err', /not right/i.test(err.message) ? 'Wrong master password, login not saved' : `Login not saved: ${err.message}`, again);
    loginReq.snoozed.add(r.id); // reopened from the pill, not popped up again by itself
  } finally {
    body.password = body.unlockPassword = null;
    loginReq.saving.delete(r.id);
    pollLoginRequests();
  }
}
