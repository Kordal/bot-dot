// ---------- connectors (apps through Composio) ----------

const conn = { data: null, catalog: [], next: null, total: 0, search: '', category: '', categories: [], loading: false };
const CONN_STATUS = { ACTIVE: ['ok', 'connected'], INITIATED: ['warn', 'waiting for sign-in'], INITIALIZING: ['warn', 'waiting for sign-in'], EXPIRED: ['err', 'expired, connect again'], FAILED: ['err', 'failed'], INACTIVE: ['warn', 'switched off'] };

const appLogo = (a) => (a?.logo ? `<img class="app-logo" src="${esc(a.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="app-logo ph">${esc((a?.name || '?')[0])}</span>`);

// Where the owner makes a Composio API key: botdot makes no Composio account of its own.
const COMPOSIO_KEYS = 'https://platform.composio.dev';
const keyForm = (placeholder, label) => `<form id="conn-key" class="memory-add" autocomplete="off"><input type="password" name="key" placeholder="${placeholder}" required><button class="btn primary">${label}</button></form>`;
const getKey = `<a class="btn sm" href="${COMPOSIO_KEYS}" target="_blank" rel="noopener">Get a key at composio.dev</a>`;

// Only fetch when the page is opened or something changed, not on every regular refresh of the web page.
async function renderConnectors(force = false) {
  const root = $('#view-connectors');
  if (root.dataset.ready && !force) return; // the web page's regular refresh would wipe the search box
  root.dataset.ready = '1';
  try { conn.data = await api('/connectors'); } catch (e) { conn.data = { configured: false, error: e.message, connections: [] }; }
  const works = conn.data.configured && !conn.data.keyRejected;
  if (!works) { conn.catalog = []; conn.categories = []; conn.replacing = false; }
  if (works && !conn.catalog.length) await loadCatalog(true);
  if (works && !conn.categories.length) conn.categories = await api('/connectors/categories').catch(() => []);
  drawConnectors();
}

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
  const head = `${SUB_BACK}
    <div class="section-head"><div><h1>Connectors</h1></div></div>`;
  if (!d.configured || d.keyRejected) {
    // No key yet, or Composio refuses it (#409): nothing on the page works until one is pasted.
    const title = !d.configured ? 'Add your Composio key'
      : d.account === 'own' ? `Composio no longer accepts your key <span class="nowrap">${esc(d.keyHint || '')}</span>` : 'Composio no longer accepts botdot\'s Composio account';
    root.innerHTML = `${head}
      <div class="card setup-card">
        <h3>${title}</h3>
        ${d.error && !d.keyRejected ? `<div class="faint">${esc(d.error)}</div>` : ''}
        ${keyForm(d.configured ? 'New Composio API key' : 'Composio API key', 'Save')}
        <div>${getKey}</div>
      </div>`;
    $('#conn-key').onsubmit = async (e) => {
      e.preventDefault();
      const input = e.target.key;
      try { await api('/connectors/key', { method: 'PUT', body: { key: input.value } }); input.value = ''; conn.catalog = []; toast('Saved'); renderConnectors(true); } catch (err) { toast(err.message, true); }
    };
    return;
  }
  const botName = (id) => { const b = state.bots.find((x) => x.id === id); return b ? `<span class="chip">${botLabel(b)}</span>` : ''; };
  const connectedSlugs = new Set(d.connections.filter((c) => c.status === 'ACTIVE').map((c) => c.toolkit));
  const pending = new Set(d.connections.filter((c) => c.status !== 'ACTIVE').map((c) => c.toolkit));
  root.innerHTML = `${head}
    ${conn.replacing ? `<div class="key-line">${keyForm('New Composio API key', 'Save')}<button class="btn sm" id="conn-cancel">Cancel</button></div>`
      : `<div class="key-line"><span>Composio key ${esc(d.keyHint || '')}</span><button class="btn sm" id="conn-replace">Replace</button><button class="btn sm danger" id="conn-forget">Remove</button></div>`}
    ${d.error ? `<div class="req-note">${esc(d.error)}</div>` : ''}
    <h3 class="page-sub">Your apps</h3>
    ${d.connections.length || d.reconnect?.length ? `<div class="grid">${(d.reconnect || []).map((a) => `
      <article class="card app-card">
        <div class="app-top">${appLogo(a)}<div class="grow"><b>${esc(a.name)}</b></div></div>
        <div class="chips">${a.usedBy.map(botName).join('')}</div>
        <div class="app-actions">
          <button class="btn sm primary" data-connect="${esc(a.slug)}">Connect again</button>
          <button class="btn sm" data-forget-app="${esc(a.slug)}">Remove</button>
        </div>
      </article>`).join('')}${d.connections.map((c) => {
      const [tone, label] = CONN_STATUS[c.status] || ['', c.status.toLowerCase()];
      return `<article class="card app-card" data-conn="${esc(c.id)}">
        <div class="app-top">${appLogo(c.app)}<div class="grow"><b>${esc(c.app?.name || c.toolkit)}</b><div><span class="pill ${tone}">${esc(label)}</span></div></div></div>
        <div class="chips">${c.usedBy.map(botName).join('') || '<span class="faint" style="font-size:12.5px">No bot uses it yet</span>'}</div>
        <div class="app-actions">
          ${c.status === 'ACTIVE' ? `<button class="btn sm" data-app-bots="${esc(c.toolkit)}">Bots…</button>` : `<button class="btn sm primary" data-connect="${esc(c.toolkit)}">Connect again</button>`}
          <button class="btn sm danger" data-disconnect="${esc(c.id)}">Disconnect</button>
        </div>
      </article>`;
    }).join('')}</div>` : '<div class="card empty" style="padding:26px 20px">No apps connected yet. Pick one below.</div>'}
    <h3 class="page-sub">Marketplace <span class="faint">· ${conn.search || conn.category ? `${conn.total} match${conn.total === 1 ? '' : 'es'}` : `${conn.total} apps`}</span></h3>
    <div class="conn-filters">
      <input type="search" id="conn-search" placeholder="Search apps, e.g. gmail, calendar, notion" value="${esc(conn.search)}">
      <select id="conn-cat"><option value="">All categories</option>${conn.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === conn.category ? 'selected' : ''}>${esc(c.name)} (${c.count})</option>`).join('')}</select>
    </div>
    <div class="grid app-grid">${conn.catalog.map((t) => `
      <article class="card app-card">
        <div class="app-top">${appLogo(t)}<div class="grow"><b>${esc(t.name)}</b><div class="faint" style="font-size:12px">${esc([...t.categories.slice(0, 2), t.toolsCount ? `${t.toolsCount} action${t.toolsCount === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '))}</div></div></div>
        <p class="skill-desc">${esc(t.description)}</p>
        <div class="app-actions">
          ${connectedSlugs.has(t.slug) ? '<span class="pill ok">connected</span>'
            : t.noAuth ? `<button class="btn sm" data-app-bots="${esc(t.slug)}">Give to bots</button><span class="faint" style="font-size:12px">no sign-in needed</span>`
            : t.connect !== 'developer' ? `<button class="btn sm primary" data-connect="${esc(t.slug)}">${pending.has(t.slug) ? 'Finish connecting' : 'Connect'}</button>${t.connect === 'key' ? `<span class="faint" style="font-size:12px">asks for your ${esc(t.name)} API key</span>` : ''}`
            : `<button class="btn sm" data-connect="${esc(t.slug)}">Connect</button><span class="faint" style="font-size:12px">needs your own developer app in Composio</span>`}
        </div>
      </article>`).join('') || `<div class="faint">No apps match${conn.search ? ` "${esc(conn.search)}"` : ''}. Try another word.</div>`}</div>
    ${conn.next ? '<div style="text-align:center;margin:16px 0"><button class="btn" id="conn-more">Show more</button></div>' : ''}`;

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
    if (!confirm(`Disconnect ${c?.app?.name || c?.toolkit}? Bots lose access, and Composio revokes its access to your account.`)) return;
    try { const r = await api(`/connectors/connections/${encodeURIComponent(b.dataset.disconnect)}`, { method: 'DELETE' }); toast(r?.note || 'Disconnected'); } catch (e) { toast(e.message, true); }
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
    if (d.account === 'botdot' && d.connections.length && !confirm('Use your own Composio account? Apps connected so far need connecting again there.')) return;
    try { await api('/connectors/key', { method: 'PUT', body: { key: e.target.key.value } }); conn.replacing = false; conn.catalog = []; toast('Saved'); renderConnectors(true); } catch (err) { toast(err.message, true); }
  };
  const forget = $('#conn-forget');
  if (forget) forget.onclick = async () => {
    if (!confirm('Remove your Composio key? Connectors stop working until you add another.')) return;
    try { await api('/connectors/key', { method: 'DELETE' }); } catch (err) { return toast(err.message, true); }
    conn.catalog = [];
    conn.categories = [];
    renderConnectors(true);
  };
}

// A Reconnect card under the reply of a job's run (#431, docs/api.md "A Reconnect card"): an app it found signed out, and
// the button that connects it again as this page does. Once connected here, its cards say so.
const reconnected = new Set();
function reconnectCardsHTML(run) {
  const list = (Array.isArray(run?.reconnect) ? run.reconnect : []).filter((x) => x && typeof x.app === 'string');
  return list.map((x) => {
    const name = esc(String(x.name || x.app));
    return reconnected.has(x.app)
      ? `<div class="reconnect-card"><span><b>${name}</b> is connected</span></div>`
      : `<div class="reconnect-card"><span><b>${name}</b> is signed out</span><button class="btn sm primary" data-reconnect="${esc(x.app)}">Reconnect</button></div>`;
  }).join('');
}
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-reconnect]');
  if (!b) return;
  b.disabled = true;
  connectApp(b.dataset.reconnect, () => { reconnected.add(b.dataset.reconnect); if (state.view === 'bot') { delete $('#view-bot').dataset.sig; renderBotChat(); } }).finally(() => { b.disabled = false; });
});

// Composio's sign-in page opens in a new tab; this waits for the connection to become active.
// connected: what happens then, instead of this page's own list and its question of which bots may use it.
async function connectApp(slug, connected = null) {
  const win = window.open('about:blank', '_blank'); // opened now, so pop-up blockers allow it
  let r;
  try { r = await api('/connectors/connect', { method: 'POST', body: { app: slug } }); } catch (e) { win?.close(); return toast(e.message, true); }
  if (r.noAuth) { win?.close(); return connected ? connected() : chooseAppBots(slug); }
  if (win) win.location = r.redirectUrl; else location.assign(r.redirectUrl);
  toast('Sign in on the page that opened. botdot notices when you\'re done.');
  const until = Date.now() + 10 * 60_000;
  while (Date.now() < until) {
    await new Promise((res) => setTimeout(res, 3000));
    const c = await api(`/connectors/connections/${encodeURIComponent(r.connectionId)}`).catch(() => null);
    if (c?.status === 'ACTIVE') {
      toast('Connected');
      if (connected) return connected();
      await renderConnectors(true);
      return chooseAppBots(slug, true);
    }
    if (c && ['FAILED', 'EXPIRED'].includes(c.status)) { toast(`Connecting didn't work${c.statusReason ? `: ${c.statusReason}` : ''}`, true); return connected ? null : renderConnectors(true); }
  }
}

function chooseAppBots(slug, justConnected = false) {
  const used = state.bots.filter((b) => (b.connectors || []).includes(slug)).map((b) => b.id);
  const app = conn.catalog.find((t) => t.slug === slug) || conn.data?.connections.find((c) => c.toolkit === slug)?.app || { name: slug };
  const m = openModal(`
    <form id="app-bots">
      <div class="modal-head"><h2>${justConnected ? `${esc(app.name)} is connected` : `Bots that may use ${esc(app.name)}`}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <p class="muted" style="margin:0">They act on your real account. They'll read freely, but only send, post, change or delete things when you (or their task) ask for it.</p>
        ${botCheckboxes(used).replaceAll(' disabled title="Skills are turned off for this bot"', '')}
      </div>
      <div class="modal-foot"><button type="button" class="btn" data-dismiss>Cancel</button><button class="btn primary">Save</button></div>
    </form>`);
  $('#app-bots', m).onsubmit = async (e) => {
    e.preventDefault();
    const bots = $$('input[name=bot]:checked', m).map((c) => c.value);
    try {
      await api(`/connectors/apps/${encodeURIComponent(slug)}/bots`, { method: 'PUT', body: { bots } });
      m.close();
      toast('Saved');
      await refresh();
      renderConnectors(true);
    } catch (err) { toast(err.message, true); }
  };
}
