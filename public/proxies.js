// The account's proxies (ADR 171): Settings → Proxy (the one the bots use, each proxy with its test, add and change in
// a dialog) and the Proxy row of a bot's settings. On a server with `proxies` only. A login's password never comes
// back from the server: an empty password field keeps the saved one.
const Proxies = (() => {
  let list = null; // { proxies, default } from GET /api/proxies, once read
  const on = () => (state.features || []).includes('proxies');
  async function load() {
    if (!on()) return null;
    try { list = await api('/proxies'); } catch { /* the rows stay as they are */ }
    return list;
  }
  const byId = (id) => list?.proxies.find((p) => p.id === id) || null;
  const flag = (cc) => (/^[A-Z]{2}$/.test(cc || '') ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '');
  // Where a test came out, in a few words: "🇵🇱 Warsaw", or that it doesn't work.
  const where = (t) => (!t ? '' : t.ok ? [flag(t.country), t.city || t.country].filter(Boolean).join(' ') : tr('Not working'));
  const dot = (t) => `<span class="px-dot${!t ? '' : t.ok ? ' ok' : ' bad'}"></span>`;
  const said = (error) => String(error || '').replace(/^./, (c) => c.toUpperCase());

  // ---------- Settings → Proxy ----------

  function rowHTML() {
    if (!on()) return '';
    return `<details class="bs-row bs-more" id="settings-proxy">
      <summary><b>${tr('Proxy')}</b><span class="bs-val" data-proxy-val></span>${CHEV}</summary>
      <div class="bs-body" data-proxy-body><span class="faint">${tr('Loading…')}</span></div>
    </details>`;
  }
  function itemHTML(p) {
    const t = p.lastTest;
    return `<div class="px-item" data-proxy="${esc(p.id)}">${dot(t)}<b>${esc(p.name)} <span class="mono">${esc(p.host)}:${p.port}</span></b>
      <span class="px-where${t && !t.ok ? ' bad' : ''}"${t && !t.ok ? tipAttrs(said(t.error)) : ''}>${esc(where(t))}</span>
      <button type="button" class="btn sm" data-proxy-test>${tr('Test')}</button>
      <button type="button" class="btn ghost sm" data-proxy-edit aria-label="${esc(tr('Edit'))}">⋯</button></div>`;
  }
  function draw(root) {
    const row = $('#settings-proxy', root);
    if (!row || !list) return;
    $('[data-proxy-val]', row).textContent = byId(list.default)?.name || tr('None');
    const body = $('[data-proxy-body]', row);
    body.innerHTML = `${list.proxies.length ? `<label class="bs-row"><b>${tr('Bots use')}</b><select data-proxy-default aria-label="${esc(tr('Bots use'))}">
        <option value="">${tr('No proxy')}</option>${list.proxies.map((p) => `<option value="${esc(p.id)}"${p.id === list.default ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>${CHEV}</label>
      <div class="px-list">${list.proxies.map(itemHTML).join('')}</div>` : ''}
      <button type="button" class="btn sm px-add" data-proxy-add>${tr('Add proxy')}</button>`;
    const pick = $('[data-proxy-default]', body);
    if (pick) pick.onchange = async () => {
      try { list = await api('/proxies/default', { method: 'PUT', body: { proxy: pick.value } }); flashSaved(root); } catch (e) { toast(e.message, true); }
      draw(root);
    };
    $('[data-proxy-add]', body).onclick = () => openForm(null, root);
    $$('[data-proxy]', body).forEach((item) => {
      const id = item.dataset.proxy;
      $('[data-proxy-edit]', item).onclick = () => openForm(byId(id), root);
      const test = $('[data-proxy-test]', item);
      test.onclick = async () => {
        test.disabled = true;
        test.classList.add('spin');
        try { await api(`/proxies/${encodeURIComponent(id)}/test`, { method: 'POST' }); await load(); } catch (e) { toast(e.message, true); }
        draw(root);
      };
    });
  }
  async function wireSettings(root) {
    if (!$('#settings-proxy', root)) return;
    await load();
    draw(root);
  }

  // ---------- the dialog ----------

  // A pasted address (socks5://user:pass@host:port, http://host:port, host:port:user:pass) fills the fields, as the
  // server reads it (lib/proxies.js parsed).
  function pasted(text) {
    const raw = String(text || '').trim();
    const url = raw.match(/^(socks5h?|socks|https?):\/\/(.+)$/i);
    if (url) {
      try {
        const u = new URL(`http://${url[2]}`);
        return { type: /^socks/i.test(url[1]) ? 'socks5' : 'http', host: u.hostname.replace(/^\[|\]$/g, ''), port: u.port, username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
      } catch { return null; }
    }
    const parts = raw.split(':');
    if (parts.length === 4 && /^\d+$/.test(parts[1])) return { host: parts[0], port: parts[1], username: parts[2], password: parts[3] };
    if (parts.length === 2 && /^\d+$/.test(parts[1])) return { host: parts[0], port: parts[1] };
    return null;
  }
  function testLineHTML(r) {
    if (!r) return '';
    if (!r.ok) return `<div class="px-test">${dot(r)}<span>${esc(said(r.error))}</span></div>`;
    return `<div class="px-test">${dot(r)}<span>${esc(where(r))}</span><span class="mono">${esc(r.ip)}</span><span class="ms">${Math.round(r.ms)} ms</span></div>`;
  }
  function openForm(p, root) {
    const m = openModal(`
      <form id="proxy-form" autocomplete="off">
        <div class="modal-head"><h2>${p ? tr('Edit proxy') : tr('Add proxy')}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
        <div class="modal-body">
          <label class="field">${tr('Name')}<input type="text" name="name" maxlength="60" value="${esc(p?.name || '')}"></label>
          <div class="px-seg" role="radiogroup" aria-label="${esc(tr('Type'))}">${[['socks5', 'SOCKS5'], ['http', 'HTTP']].map(([v, label]) => `<label><input type="radio" name="type" value="${v}"${(p?.type || 'socks5') === v ? ' checked' : ''}><span>${label}</span></label>`).join('')}</div>
          <div class="px-two"><label class="field">${tr('Host')}<input type="text" name="host" required value="${esc(p?.host || '')}" autocapitalize="off" spellcheck="false"></label>
            <label class="field">${tr('Port')}<input type="text" name="port" required inputmode="numeric" value="${p?.port || ''}"></label></div>
          <div class="px-two even"><label class="field">${tr('Login')}<input type="text" name="username" value="${esc(p?.username || '')}" autocapitalize="off" spellcheck="false"></label>
            <label class="field">${tr('Password')}<input type="password" name="password" autocomplete="new-password" placeholder="${p?.hasPassword ? '••••••••' : ''}"></label></div>
          <div data-proxy-result role="status">${testLineHTML(p?.lastTest)}</div>
        </div>
        <div class="modal-foot">
          ${p ? `<button type="button" class="btn danger left" data-proxy-remove>${tr('Remove')}</button>` : ''}
          <button type="button" class="btn${p ? '' : ' left'}" data-proxy-try>${tr('Test')}</button>
          <button class="btn primary" data-proxy-save>${tr('Save')}</button>
        </div>
      </form>`);
    const form = $('#proxy-form', m);
    const read = () => ({ name: form.name.value.trim(), type: form.type.value, host: form.host.value.trim(), port: Number(form.port.value), username: form.username.value.trim(), password: form.password.value });
    form.host.addEventListener('input', () => {
      const got = pasted(form.host.value);
      if (!got || !/[:@]/.test(form.host.value)) return;
      if (got.type) form.type.value = got.type;
      form.host.value = got.host;
      if (got.port) form.port.value = got.port;
      if (got.username) form.username.value = got.username;
      if (got.password) form.password.value = got.password;
    });
    const result = $('[data-proxy-result]', m);
    const tryBtn = $('[data-proxy-try]', m);
    tryBtn.onclick = async () => {
      if (!form.reportValidity()) return;
      tryBtn.disabled = true;
      tryBtn.classList.add('spin');
      try { result.innerHTML = testLineHTML(await api('/proxies/test', { method: 'POST', body: { ...read(), ...(p ? { id: p.id } : {}) } })); } catch (e) { result.innerHTML = testLineHTML({ ok: false, error: e.message }); }
      tryBtn.disabled = false;
      tryBtn.classList.remove('spin');
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const save = $('[data-proxy-save]', m);
      save.disabled = true;
      try {
        const body = read();
        const saved = (p ? await api(`/proxies/${encodeURIComponent(p.id)}`, { method: 'PUT', body }) : await api('/proxies', { method: 'POST', body })).proxy;
        m.close();
        await api(`/proxies/${encodeURIComponent(saved.id)}/test`, { method: 'POST' }).catch(() => {}); // its dot in the list
        await load();
        draw(root);
      } catch (err) { toast(err.message, true); save.disabled = false; }
    };
    const remove = $('[data-proxy-remove]', m);
    if (remove) remove.onclick = async () => {
      if (!(await askFirst(tr('Remove {name}?', { name: p.name }), tr('Remove')))) return;
      try { list = await api(`/proxies/${encodeURIComponent(p.id)}`, { method: 'DELETE' }); m.close(); } catch (e) { toast(e.message, true); }
      draw(root);
    };
  }

  // ---------- a bot's Proxy row ----------

  // In a bot's settings, beside its computer: the account's (named), none, or one of the account's proxies. Only on the
  // account's computer, and once there is a proxy to pick.
  function botRowHTML(b) {
    if (!list || (!list.proxies.length && !b.proxy)) return '';
    const account = byId(list.default)?.name || tr('No proxy');
    const options = [['', tr("Account's ({name})", { name: account })], ['none', tr('No proxy')], ...list.proxies.map((p) => [p.id, p.name])];
    return `<label class="bs-row"><b>${tr('Proxy')}</b><select name="proxy" aria-label="${esc(tr('Proxy'))}">${options.map(([v, label]) => `<option value="${esc(v)}"${(b.proxy || '') === v ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>${CHEV}</label>`;
  }
  async function fillBotRow(slot, b) {
    if (!slot || !on()) return;
    if (!list) await load();
    if (slot.isConnected) slot.innerHTML = botRowHTML(b);
  }

  return { rowHTML, wireSettings, fillBotRow, botRowHTML, pasted, load };
})();
