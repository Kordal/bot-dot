// ---------- connectors (apps through Composio) ----------

const conn = { data: null, catalog: [], next: null, total: 0, search: '', category: '', categories: [], loading: false };
const CONN_STATUS = { ACTIVE: ['ok', tr('connected')], INITIATED: ['warn', tr('waiting for sign-in')], INITIALIZING: ['warn', tr('waiting for sign-in')], EXPIRED: ['err', tr('expired, connect again')], FAILED: ['err', tr('failed')], INACTIVE: ['warn', tr('switched off')] };

const appLogo = (a) => (a?.logo ? `<img class="app-logo" src="${esc(a.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="app-logo ph">${esc((a?.name || '?')[0])}</span>`);

// Where the owner makes a Composio API key: botdot makes no Composio account of its own.
const COMPOSIO_KEYS = 'https://platform.composio.dev';
const keyForm = (placeholder, label) => `<form id="conn-key" class="memory-add" autocomplete="off"><input type="password" name="key" placeholder="${esc(placeholder)}" required><button class="btn primary">${label}</button></form>`;
const getKey = `<a class="btn sm" href="${COMPOSIO_KEYS}" target="_blank" rel="noopener">${tr('Get a key at composio.dev')}</a>`;

// Only fetch when the page is opened or something changed, not on every regular refresh of the web page.
async function renderConnectors(force = false) {
  const root = $('#view-connectors');
  if (root.dataset.ready && !force) return; // the web page's regular refresh would wipe the search box
  root.dataset.ready = '1';
  if (!conn.data && state.view === 'connectors') root.innerHTML = connHead(); // its title at once, not a blank page while Composio answers
  try { conn.data = await api('/connectors'); } catch (e) { conn.data = { configured: false, error: e.message, connections: [] }; }
  const works = conn.data.configured && !conn.data.keyRejected;
  if (!works) { conn.catalog = []; conn.categories = []; conn.replacing = false; }
  if (works && !conn.catalog.length) await loadCatalog(true);
  if (works && !conn.categories.length) conn.categories = await api('/connectors/categories').catch(() => []);
  // A page that can't be drawn says why, never stays blank (#464).
  try { drawConnectors(); } catch (e) { root.innerHTML = `${connHead()}<div class="req-note">${tr("Couldn't show your apps: {why}", { why: esc(e.message) })}</div>`; }
}
const connHead = () => `${SUB_BACK}
    <div class="section-head"><div><h1>${tr('Connectors')}</h1></div></div>`;

async function loadCatalog(reset) {
  if (conn.loading) return;
  conn.loading = true;
  try {
    const q = new URLSearchParams({ ...(conn.search ? { search: conn.search } : {}), ...(conn.category ? { category: conn.category } : {}), ...(!reset && conn.next ? { offset: conn.next } : {}) });
    const d = await api(`/connectors/catalog?${q}`);
    conn.catalog = reset ? d.items : [...conn.catalog, ...d.items];
    conn.next = d.nextOffset;
    conn.total = d.total;
  } catch (e) { toast(e.message, true); } finally { conn.loading = false; }
}

function drawConnectors() {
  const root = $('#view-connectors');
  if (state.view !== 'connectors' || !conn.data) return;
  const d = conn.data;
  const head = connHead();
  if (!d.configured || d.keyRejected) {
    // No key yet, or Composio refuses it (#409): nothing on the page works until one is pasted.
    const title = !d.configured ? tr('Add your Composio key')
      : d.account === 'own' ? tr('Composio no longer accepts your key {key}', { key: `<span class="nowrap">${esc(d.keyHint || '')}</span>` }) : tr("Composio no longer accepts botdot's Composio account");
    root.innerHTML = `${head}
      <div class="card setup-card">
        <h3>${title}</h3>
        ${d.error && !d.keyRejected ? `<div class="faint">${esc(d.error)}</div>` : ''}
        ${keyForm(d.configured ? tr('New Composio API key') : tr('Composio API key'), tr('Save'))}
        <div>${getKey}</div>
      </div>`;
    $('#conn-key').onsubmit = async (e) => {
      e.preventDefault();
      const input = e.target.key;
      try { await api('/connectors/key', { method: 'PUT', body: { key: input.value } }); input.value = ''; conn.catalog = []; toast(tr('Saved')); renderConnectors(true); } catch (err) { toast(err.message, true); }
    };
    return;
  }
  const botName = (id) => { const b = state.bots.find((x) => x.id === id); return b ? `<span class="chip">${botLabel(b)}</span>` : ''; };
  const connectedSlugs = new Set(d.connections.filter((c) => c.status === 'ACTIVE').map((c) => c.toolkit));
  const pending = new Set(d.connections.filter((c) => c.status !== 'ACTIVE').map((c) => c.toolkit));
  root.innerHTML = `${head}
    ${conn.replacing ? `<div class="key-line">${keyForm(tr('New Composio API key'), tr('Save'))}<button class="btn sm" id="conn-cancel">${tr('Cancel')}</button></div>`
      : `<div class="key-line"><span>${tr('Composio key {key}', { key: esc(d.keyHint || '') })}</span><button class="btn sm" id="conn-replace">${tr('Replace')}</button><button class="btn sm danger" id="conn-forget">${tr('Remove')}</button></div>`}
    ${d.error ? `<div class="req-note">${esc(d.error)}</div>` : ''}
    <h3 class="page-sub">${tr('Your apps')}</h3>
    ${d.connections.length || d.reconnect?.length ? `<div class="grid">${(d.reconnect || []).map((a) => `
      <article class="card app-card">
        <div class="app-top">${appLogo(a)}<div class="grow"><b>${esc(a.name)}</b></div></div>
        <div class="chips">${a.usedBy.map(botName).join('')}</div>
        <div class="app-actions">
          <button class="btn sm primary" data-connect="${esc(a.slug)}">${tr('Connect again')}</button>
          <button class="btn sm" data-forget-app="${esc(a.slug)}">${tr('Remove')}</button>
        </div>
      </article>`).join('')}${d.connections.map((c) => {
      const [tone, label] = CONN_STATUS[c.status] || ['', String(c.status || tr('unknown')).toLowerCase()];
      return `<article class="card app-card" data-conn="${esc(c.id)}">
        <div class="app-top">${appLogo(c.app)}<div class="grow"><b>${esc(c.app?.name || c.toolkit)}</b><div><span class="pill ${tone}">${esc(label)}</span></div></div></div>
        <div class="chips">${c.usedBy.map(botName).join('') || `<span class="faint" style="font-size:12.5px">${tr('No bot uses it yet')}</span>`}</div>
        <div class="app-actions">
          ${c.status === 'ACTIVE' ? `<button class="btn sm" data-app-bots="${esc(c.toolkit)}">${tr('Bots…')}</button>` : `<button class="btn sm primary" data-connect="${esc(c.toolkit)}">${tr('Connect again')}</button>`}
          <button class="btn sm danger" data-disconnect="${esc(c.id)}">${tr('Disconnect')}</button>
        </div>
      </article>`;
    }).join('')}</div>` : `<div class="card empty" style="padding:26px 20px">${tr('No apps connected yet. Pick one below.')}</div>`}
    <h3 class="page-sub">${tr('Marketplace')} <span class="faint">· ${conn.search || conn.category ? trn(conn.total, '{n} match', '{n} matches') : trn(conn.total, '{n} app', '{n} apps')}</span></h3>
    <div class="conn-filters">
      <input type="search" id="conn-search" placeholder="${esc(tr('Search apps, e.g. gmail, calendar, notion'))}" value="${esc(conn.search)}">
      <select id="conn-cat"><option value="">${tr('All categories')}</option>${conn.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === conn.category ? 'selected' : ''}>${esc(c.name)} (${c.count})</option>`).join('')}</select>
    </div>
    <div class="grid app-grid">${conn.catalog.map((t) => `
      <article class="card app-card">
        <div class="app-top">${appLogo(t)}<div class="grow"><b>${esc(t.name)}</b><div class="faint" style="font-size:12px">${esc([...t.categories.slice(0, 2), t.toolsCount ? trn(t.toolsCount, '{n} action', '{n} actions') : ''].filter(Boolean).join(' · '))}</div></div></div>
        <p class="skill-desc">${esc(t.description)}</p>
        <div class="app-actions">
          ${connectedSlugs.has(t.slug) ? `<span class="pill ok">${tr('connected')}</span>`
            : t.noAuth ? `<button class="btn sm" data-app-bots="${esc(t.slug)}">${tr('Give to bots')}</button><span class="faint" style="font-size:12px">${tr('no sign-in needed')}</span>`
            : t.connect !== 'developer' ? `<button class="btn sm primary" data-connect="${esc(t.slug)}">${pending.has(t.slug) ? tr('Finish connecting') : tr('Connect')}</button>${t.connect === 'key' ? `<span class="faint" style="font-size:12px">${tr('asks for your {app} API key', { app: esc(t.name) })}</span>` : ''}`
            : `<button class="btn sm" data-connect="${esc(t.slug)}">${tr('Connect')}</button><span class="faint" style="font-size:12px">${tr('needs your own developer app in Composio')}</span>`}
        </div>
      </article>`).join('') || `<div class="faint">${conn.search ? tr('No apps match "{search}". Try another word.', { search: esc(conn.search) }) : tr('No apps match. Try another word.')}</div>`}</div>
    ${conn.next ? `<div style="text-align:center;margin:16px 0"><button class="btn" id="conn-more">${tr('Show more')}</button></div>` : ''}`;

  let t;
  $('#conn-search').oninput = (e) => {
    clearTimeout(t);
    t = setTimeout(async () => {
      conn.search = e.target.value.trim();
      await loadCatalog(true);
      const pos = e.target.selectionStart;
      drawConnectors();
      const box = $('#conn-search');
      box.focus();
      box.setSelectionRange(pos, pos);
    }, 250);
  };
  $('#conn-cat').onchange = async (e) => { conn.category = e.target.value; await loadCatalog(true); drawConnectors(); };
  const more = $('#conn-more');
  if (more) more.onclick = async () => { more.disabled = true; await loadCatalog(false); drawConnectors(); };
  $$('[data-connect]', root).forEach((b) => (b.onclick = () => connectApp(b.dataset.connect)));
  $$('[data-forget-app]', root).forEach((b) => (b.onclick = async () => {
    try { await api(`/connectors/reconnect/${encodeURIComponent(b.dataset.forgetApp)}`, { method: 'DELETE' }); await refresh(); renderConnectors(true); } catch (e) { toast(e.message, true); }
  }));
  $$('[data-app-bots]', root).forEach((b) => (b.onclick = () => chooseAppBots(b.dataset.appBots)));
  $$('[data-disconnect]', root).forEach((b) => (b.onclick = async () => {
    const c = d.connections.find((x) => x.id === b.dataset.disconnect);
    if (!confirm(tr('Disconnect {app}? Bots lose access, and Composio revokes its access to your account.', { app: c?.app?.name || c?.toolkit }))) return;
    try { const r = await api(`/connectors/connections/${encodeURIComponent(b.dataset.disconnect)}`, { method: 'DELETE' }); toast(r?.note || tr('Disconnected')); } catch (e) { toast(e.message, true); }
    await refresh();
    renderConnectors(true);
  }));
  const replace = $('#conn-replace');
  if (replace) replace.onclick = () => { conn.replacing = true; drawConnectors(); $('#conn-key input').focus(); };
  const cancel = $('#conn-cancel');
  if (cancel) cancel.onclick = () => { conn.replacing = false; drawConnectors(); };
  const ownKey = $('#conn-key');
  if (ownKey) ownKey.onsubmit = async (e) => {
    e.preventDefault();
    if (d.account === 'botdot' && d.connections.length && !confirm(tr('Use your own Composio account? Apps connected so far need connecting again there.'))) return;
    try { await api('/connectors/key', { method: 'PUT', body: { key: e.target.key.value } }); conn.replacing = false; conn.catalog = []; toast(tr('Saved')); renderConnectors(true); } catch (err) { toast(err.message, true); }
  };
  const forget = $('#conn-forget');
  if (forget) forget.onclick = async () => {
    if (!confirm(tr('Remove your Composio key? Connectors stop working until you add another.'))) return;
    try { await api('/connectors/key', { method: 'DELETE' }); } catch (err) { return toast(err.message, true); }
    conn.catalog = [];
    conn.categories = [];
    renderConnectors(true);
  };
}

// A Reconnect card under the reply of a job's run (#431, docs/api.md "A Reconnect card"): an app it found signed out, and
// the button that connects it again as this page does. The card says where that is (#464): opening, waiting for the
// sign-in, connected, or what went wrong; the button is never stuck. Kept per app, so a chat drawn again keeps it.
const reconnecting = new Map(); // slug -> { state: 'opening' | 'waiting' | 'connected' | 'failed', error?, turn }
function reconnectCardHTML(x) {
  const name = esc(String(x.name || x.app));
  const s = reconnecting.get(x.app) || {};
  const card = (inner) => `<div class="reconnect-card" data-reconnect-card="${esc(x.app)}" data-name="${name}">${inner}</div>`;
  if (s.state === 'connected') return card(`<span>${tr('{app} is connected', { app: `<b>${name}</b>` })}</span>`);
  const button = s.state === 'opening' ? `<button class="btn sm primary" disabled>${tr('Opening…')}</button>`
    : `<button class="btn sm primary" data-reconnect="${esc(x.app)}">${s.state === 'failed' ? tr('Try again') : tr('Reconnect')}</button>`;
  return card(`<span>${s.state === 'waiting' ? tr('{app} waits for sign-in', { app: `<b>${name}</b>` }) : tr('{app} is signed out', { app: `<b>${name}</b>` })}</span>${button}${s.error ? `<div class="reconnect-error" role="alert">${esc(s.error)}</div>` : ''}`);
}
function reconnectCardsHTML(run) {
  return (Array.isArray(run?.reconnect) ? run.reconnect : []).filter((x) => x && typeof x.app === 'string').map(reconnectCardHTML).join('');
}
// Every card of the app on the page, drawn again where it stands: in a chat, a group or the Chief's.
function redrawReconnect(slug) {
  for (const el of document.querySelectorAll('[data-reconnect-card]')) if (el.dataset.reconnectCard === slug) el.outerHTML = reconnectCardHTML({ app: slug, name: el.dataset.name });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-reconnect]');
  if (!b) return;
  const slug = b.dataset.reconnect;
  // A second press starts a new sign-in: the first one's wait ends and says nothing more.
  const turn = (reconnecting.get(slug)?.turn || 0) + 1;
  const live = () => reconnecting.get(slug)?.turn === turn;
  const set = (state, error) => { if (!live()) return; reconnecting.set(slug, { state, turn, ...(error ? { error } : {}) }); redrawReconnect(slug); };
  reconnecting.set(slug, { state: 'opening', turn });
  redrawReconnect(slug);
  connectApp(slug, () => set('connected'), { live, opened: () => set('waiting'), failed: (msg) => set('failed', msg), ended: () => set('idle') });
});

// Composio's sign-in page opens in a new tab; this waits for the connection to become active.
// connected: what happens then, instead of this page's own list and its question of which bots may use it.
// on (a Reconnect card): opened() once the sign-in page is open, failed(message) instead of a toast, ended() when the
// sign-in tab was closed without connecting or the wait ran out, and live() false to stop waiting.
async function connectApp(slug, connected = null, on = {}) {
  const live = on.live || (() => true);
  const win = window.open('about:blank', '_blank'); // opened now, so pop-up blockers allow it
  const fail = (msg) => (on.failed ? on.failed(msg) : toast(msg, true));
  let r;
  try { r = await api('/connectors/connect', { method: 'POST', body: { app: slug } }); } catch (e) { win?.close(); return fail(e.message); }
  if (r.noAuth) { win?.close(); return connected ? connected() : chooseAppBots(slug); }
  if (win) win.location = r.redirectUrl; else location.assign(r.redirectUrl);
  if (on.opened) on.opened(); else toast(tr("Sign in on the page that opened. botdot notices when you're done."));
  const until = Date.now() + 10 * 60_000;
  let closed = 0;
  while (Date.now() < until && live()) {
    await new Promise((res) => setTimeout(res, 3000));
    if (!live()) return;
    const c = await api(`/connectors/connections/${encodeURIComponent(r.connectionId)}`).catch(() => null);
    if (c?.status === 'ACTIVE') {
      if (!on.opened) toast(tr('Connected'));
      if (connected) return connected();
      await renderConnectors(true);
      return chooseAppBots(slug, true);
    }
    if (c && ['FAILED', 'EXPIRED'].includes(c.status)) { fail(c.statusReason ? tr("Connecting didn't work: {why}", { why: c.statusReason }) : tr("Connecting didn't work")); return connected ? null : renderConnectors(true); }
    // The sign-in tab was closed without connecting: one more look (it may have just finished), then no more waiting.
    if (win?.closed && ++closed > 1) break;
  }
  on.ended?.();
}

function chooseAppBots(slug, justConnected = false) {
  const used = state.bots.filter((b) => (b.connectors || []).includes(slug)).map((b) => b.id);
  const app = conn.catalog.find((t) => t.slug === slug) || conn.data?.connections.find((c) => c.toolkit === slug)?.app || { name: slug };
  const m = openModal(`
    <form id="app-bots">
      <div class="modal-head"><h2>${justConnected ? tr('{app} is connected', { app: esc(app.name) }) : tr('Bots that may use {app}', { app: esc(app.name) })}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <p class="muted" style="margin:0" title="${esc(tr("They'll read freely, but only send, post, change or delete things when you (or their task) ask for it."))}">${tr('They act on your real account.')}</p>
        ${botCheckboxes(used).replaceAll(SKILLS_OFF_ATTR(), '')}
      </div>
      <div class="modal-foot"><button type="button" class="btn" data-dismiss>${tr('Cancel')}</button><button class="btn primary">${tr('Save')}</button></div>
    </form>`);
  $('#app-bots', m).onsubmit = async (e) => {
    e.preventDefault();
    const bots = $$('input[name=bot]:checked', m).map((c) => c.value);
    try {
      await api(`/connectors/apps/${encodeURIComponent(slug)}/bots`, { method: 'PUT', body: { bots } });
      m.close();
      toast(tr('Saved'));
      await refresh();
      renderConnectors(true);
    } catch (err) { toast(err.message, true); }
  };
}
