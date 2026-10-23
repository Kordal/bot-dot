// Connectors: apps (Gmail, Slack, GitHub, Notion…) that bots can use, through Composio (composio.dev).
// You connect an app once with Composio's own sign-in page; you then choose which bots may use it.
// The Composio API key is kept encrypted with the Vault's key, and all calls to Composio are made
// here on the server, so neither the key nor your app tokens ever reach a bot or the AI.
//
// The key is always one the owner made in their own Composio project and pasted on the Connectors page. botdot
// no longer makes Composio accounts: an unclaimed one stopped working within days. A key of an account botdot made
// before is used as long as Composio accepts it (`account: 'botdot'`), until the owner pastes their own.
const fs = require('./principal-fs');
const path = require('path');
const crypto = require('crypto');
const { encrypt, decrypt } = require('./vault');
const appErrors = require('./app-errors');
const { APPS } = require('./connected-apps');

const API = process.env.COMPOSIO_API_URL || 'https://backend.composio.dev/api/v3.1'; // override only for tests
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TOOL_RE = /^[A-Z0-9][A-Z0-9_]{0,127}$/;
const CARD_EVERY_MS = 24 * 3600e3; // a Reconnect card for one app, at most this often (#431)

// For files a bot hands an action ({"$file": …}).
const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', html: 'text/html', json: 'application/json', zip: 'application/zip', mp3: 'audio/mpeg', mp4: 'video/mp4', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };

const KEY_SCHEMES = ['API_KEY', 'BEARER_TOKEN', 'BASIC', 'BASIC_WITH_JWT'];
function connectMode(t) {
  if (t.no_auth) return 'none';
  if ((t.composio_managed_auth_schemes || []).length) return 'signin';
  const schemes = t.auth_schemes || [];
  if (schemes.some((x) => KEY_SCHEMES.includes(x))) return 'key';
  if (schemes.includes('DCR_OAUTH')) return 'signin'; // the app registers Composio by itself
  return 'developer';
}

// Category names arrive in mixed case ("email", "Developer Tools"): show them one way.
const ACRONYMS = new Set(['ai', 'crm', 'seo', 'hr', 'it', 'api', 'sms', 'mcp', 'erp', 'cms', 'pdf', 'ats', 'iot', 'ui', 'ux']);
const titleCase = (n) => String(n).trim().replace(/\s*\/\s*/g, ' / ').replace(/\b[a-z]+/g, (w) => (ACRONYMS.has(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)));

function create(dataDir) {
  const FILE = path.join(dataDir, 'connectors.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
  const save = (d) => {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  };

  // Everything in Composio belongs to one "user"; botdot has a single owner, so one fixed id.
  function userId() {
    const d = load();
    if (!d.userId) { d.userId = `botdot-${crypto.randomBytes(6).toString('hex')}`; save(d); }
    return d.userId;
  }
  const apiKey = () => { const d = load(); try { return d.key ? decrypt(d.key) : null; } catch { return null; } };
  const configured = () => !!load().key;

  // Composio refused the key it was given (401): set while it does, so the apps can say so and offer the fix.
  let rejected = false;
  const rejectedError = () => {
    const s = status();
    const e = new Error(s.account === 'own'
      ? `Composio no longer accepts your Composio key ${s.keyHint || ''}. Fix it on the Connectors page of botdot's web page.`.replace('  ', ' ')
      : 'Composio no longer accepts the key of the Composio account botdot made earlier. Paste your own Composio key on the Connectors page of botdot\'s web page.');
    e.code = 'key-rejected';
    return e;
  };

  async function call(pathname, { method = 'GET', query, body, key } = {}) {
    const trying = !!key; // a key being checked before it is saved
    key ||= apiKey();
    if (!key) throw Object.assign(new Error('Connectors need a Composio key: the owner pastes one on the Connectors page of botdot\'s web page.'), { code: 'not-configured' });
    const url = new URL(API + pathname);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    const send = (k) => fetch(url, {
      method,
      headers: { 'x-api-key': k, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const res = await send(key);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      if (trying) throw new Error('Composio doesn\'t accept that key. Copy a project API key from Composio\'s dashboard (Settings → API keys).');
      rejected = true;
      throw Object.assign(rejectedError(), { status: 401 });
    }
    // Composio may still list its catalogue on a dead key: only the owner's own connections prove the key works again.
    if (!trying && pathname === '/connected_accounts') rejected = false;
    if (!res.ok) throw Object.assign(new Error(data?.error?.message || data?.message || `Composio answered ${res.status}`), { status: res.status });
    return data;
  }

  // ---------- setup ----------

  // The owner's Composio project key. A key of the account botdot made before is dropped with it.
  async function setKey(key) {
    key = String(key || '').trim();
    if (!key) throw new Error('Paste your Composio API key');
    await call('/toolkits', { query: { limit: 1 }, key }); // check it works before saving
    const d = load();
    keepForReconnect(d);
    delete d.agent;
    d.key = encrypt(key);
    d.keyHint = `…${key.slice(-4)}`;
    d.own = true;
    d.connectedAt = new Date().toISOString();
    save(d);
    userId();
    all = null;
    rejected = false;
    return status();
  }
  // Stop using the key: Connectors wait for a new one.
  function removeKey() { const d = load(); keepForReconnect(d); delete d.agent; delete d.key; delete d.keyHint; d.own = false; save(d); all = null; connected = null; rejected = false; }
  const status = () => {
    const d = load();
    const account = d.key ? (d.own || !d.agent ? 'own' : 'botdot') : null;
    return {
      configured: !!d.key,
      account,
      keyHint: account === 'own' ? d.keyHint || null : null,
      since: d.connectedAt || null,
      keyRejected: !!d.key && rejected,
    };
  };

  // ---------- marketplace ----------

  const view = (t) => ({
    slug: t.slug,
    name: t.name,
    description: t.meta?.description || '',
    logo: t.meta?.logo || null,
    toolsCount: t.meta?.tools_count ?? null,
    categories: [...new Set((t.meta?.categories || []).map((c) => titleCase(c.name || '')).filter(Boolean))],
    noAuth: !!t.no_auth,
    // How you connect it: 'none' (no sign-in), 'signin' (Composio's own login for the app), 'key' (you
    // paste your API key / token on Composio's page), or 'developer' (OAuth with your own developer app).
    connect: connectMode(t),
    easyConnect: connectMode(t) !== 'developer',
    authSchemes: t.auth_schemes || [],
  });

  // The whole catalogue (~1,500 apps) is loaded once and kept for a few hours, so search is instant
  // and forgiving: any word order, partial words, small typos, names, descriptions and categories.
  let all = null; // { at, items }
  let loadingAll = null;
  async function allToolkits() {
    if (all && Date.now() - all.at < 6 * 3600_000) return all.items;
    loadingAll ||= (async () => {
      const items = [];
      let cursor;
      for (let page = 0; page < 20; page++) {
        const d = await call('/toolkits', { query: { limit: 1000, sort_by: 'usage', cursor } });
        items.push(...(d.items || []));
        cursor = d.next_cursor;
        if (!cursor || !(d.items || []).length) break;
      }
      all = { at: Date.now(), items: items.filter((t) => t.deprecated !== true).map(view) };
      return all.items;
    })().finally(() => { loadingAll = null; });
    return loadingAll;
  }

  const norm = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
  // At most one typo (swap, missing, extra or wrong letter) for words of 4+ letters.
  function nearly(a, b) {
    if (Math.abs(a.length - b.length) > 1 || a.length < 4) return false;
    let i = 0; let j = 0; let edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a[i + 1] === b[j] && a[i] === b[j + 1]) { i += 2; j += 2; continue; } // swapped letters
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }
  function score(t, words) {
    const name = norm(t.name); const slug = norm(t.slug); const desc = norm(t.description); const cats = norm(t.categories.join(' '));
    const nameWords = `${name} ${slug}`.split(' ');
    let total = 0;
    for (const w of words) {
      let s = 0;
      if (name === w || slug === w) s = 120;
      else if (nameWords.some((x) => x.startsWith(w))) s = 80;
      else if (name.replace(/ /g, '').includes(w) || slug.replace(/ /g, '').includes(w)) s = 60;
      else if (w.length >= 3 && cats.includes(w)) s = 35;
      else if (nameWords.some((x) => nearly(x, w))) s = 30;
      else if (w.length < 3) s = 0; // very short words only match names
      else if (desc.split(' ').some((x) => x.startsWith(w))) s = 15;
      else if (w.length >= 5 && desc.split(' ').some((x) => nearly(x, w))) s = 8;
      if (!s) return 0; // every word has to match something
      total += s;
    }
    return total;
  }

  const catKey = (n) => norm(n).replace(/ /g, '-');

  async function catalog({ search, category, offset = 0, limit = 60 } = {}) {
    let items = await allToolkits();
    if (category) items = items.filter((t) => t.categories.some((c) => catKey(c) === category));
    const words = norm(search).split(' ').filter(Boolean);
    if (words.length) {
      // Popular apps (the list comes most used first) get a boost, so "email" finds Gmail before niche tools.
      items = items.map((t, i) => { const s = score(t, words); return { t, s: s && s + Math.max(0, 45 - i / 8), i }; })
        .filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.t);
    }
    offset = Math.max(0, Number(offset) || 0);
    return { items: items.slice(offset, offset + limit), nextOffset: offset + limit < items.length ? offset + limit : null, total: items.length };
  }

  // Categories as the apps list them (Composio's own list has near-duplicates), most used first.
  async function categories() {
    const counts = new Map();
    for (const t of await allToolkits()) for (const c of t.categories) {
      const k = catKey(c);
      if (!k) continue;
      const e = counts.get(k) || { id: k, name: c, count: 0 };
      e.count++;
      counts.set(k, e);
    }
    return [...counts.values()].filter((c) => c.count >= 3).sort((a, b) => b.count - a.count);
  }

  const toolkitCache = new Map();
  async function toolkit(slug) {
    if (!SLUG_RE.test(String(slug))) throw new Error('Unknown app');
    if (!toolkitCache.has(slug)) toolkitCache.set(slug, view(await call(`/toolkits/${encodeURIComponent(slug)}`)));
    return toolkitCache.get(slug);
  }

  // An app's name where it is already at hand (a toolkit or the catalogue was loaded), or null: asked without waiting.
  const nameOf = (slug) => toolkitCache.get(slug)?.name || all?.items.find((t) => t.slug === slug)?.name || null;

  // ---------- connections ----------

  async function connections() {
    if (!configured()) { connected = []; return []; }
    const d = await call('/connected_accounts', { query: { user_ids: userId(), limit: 100 } });
    // One the owner disconnected is gone here, whatever Composio still lists (its delete keeps the record, #463).
    const gone = load().gone || [];
    const list = (d.items || []).filter((a) => !gone.includes(a.id)).map((a) => ({ id: a.id, toolkit: a.toolkit?.slug, status: a.status, statusReason: a.status_reason || null, alias: a.alias || null, createdAt: a.created_at }));
    connected = [...new Set(list.filter((c) => c.status === 'ACTIVE' && c.toolkit).map((c) => c.toolkit))].sort();
    // Kept on disk: the apps to offer again after a switch to another Composio account (#409).
    const now = load();
    const left = (now.reconnect || []).filter((x) => !connected.includes(x));
    // An app connected again may have its Reconnect card at once the next time it signs out (reconnectCardDue).
    const cards = Object.fromEntries(Object.entries(now.cards || {}).filter(([slug]) => !connected.includes(slug)));
    // A disconnected id Composio no longer lists needs no keeping.
    const stillGone = gone.filter((id) => (d.items || []).some((a) => a.id === id));
    for (const c of list) seen.set(c.id, c.toolkit);
    if ((connected.length && JSON.stringify(now.apps) !== JSON.stringify(connected)) || left.length !== (now.reconnect || []).length || Object.keys(cards).length !== Object.keys(now.cards || {}).length || stillGone.length !== gone.length) {
      if (connected.length) now.apps = connected;
      now.gone = stillGone;
      now.reconnect = left;
      now.cards = cards;
      save(now);
    }
    return list;
  }
  // A job's run that found this app signed out may show the owner a Reconnect card (#431): once a day per app, kept
  // as `cards` ({ slug: when }). True when it may now, and that card is counted from now.
  function reconnectCardDue(slug, now = Date.now()) {
    const d = load();
    const at = Date.parse(d.cards?.[slug] || '');
    if (now - at < CARD_EVERY_MS) return false;
    d.cards = { ...(d.cards || {}), [slug]: new Date(now).toISOString() };
    save(d);
    return true;
  }
  // The apps connected before a switch to another Composio account, not connected again yet: [slug].
  const reconnect = () => load().reconnect || [];
  function forgetReconnect(slug) { const d = load(); d.reconnect = (d.reconnect || []).filter((x) => x !== slug); save(d); }
  // On a switch, everything that worked in the old account is to be connected again in the new one.
  const keepForReconnect = (d) => { d.reconnect = [...new Set([...(d.reconnect || []), ...(d.apps || []), ...(connected || [])])].sort(); };
  // The apps that have a working connection, as Composio last said (every read of the connections), or null before
  // the first: what a Chief turn is given as it starts (ADR 047), a moment that cannot wait for Composio.
  // connectedApps() asks Composio now, for a call that must not take a disconnected app.
  let connected = null;
  const seen = new Map(); // connection id -> app, as last listed: what a disconnect removes when Composio can't say
  const knownApps = () => (configured() ? connected : []);
  async function connectedApps() { await connections(); return connected; }

  // A login setup ("auth config") for the app in your Composio project: one you made in the Composio
  // dashboard, else Composio's own login, else one that just asks for your key. Made once, then reused.
  async function authConfigFor(slug, t) {
    const existing = (await call('/auth_configs', { query: { toolkit_slug: slug, limit: 20 } })).items || [];
    const usable = existing.filter((c) => c.status !== 'DISABLED');
    const cfg = usable.find((c) => !c.is_composio_managed) || usable[0];
    if (cfg) return cfg;
    if (t.connect === 'signin' && (await call(`/toolkits/${encodeURIComponent(slug)}`)).composio_managed_auth_schemes?.length) {
      return (await call('/auth_configs', { method: 'POST', body: { toolkit: { slug }, auth_config: { type: 'use_composio_managed_auth' } } })).auth_config;
    }
    // A mode that needs nothing from a developer (e.g. your API key, entered on Composio's page).
    const details = (await call(`/toolkits/${encodeURIComponent(slug)}`)).auth_config_details || [];
    const easy = details.find((d) => !(d.fields?.auth_config_creation?.required || []).length);
    if (easy) {
      return (await call('/auth_configs', { method: 'POST', body: { toolkit: { slug }, auth_config: { type: 'use_custom_auth', authScheme: easy.mode, name: `botdot ${t.name}` } } })).auth_config;
    }
    const need = (details[0]?.fields?.auth_config_creation?.required || []).map((f) => f.displayName || f.name).join(', ');
    throw new Error(`${t.name} only signs in through your own developer app${need ? ` (it needs: ${need})` : ''}. Create it once in the Composio dashboard under Auth Configs, then press Connect again.`);
  }

  // The app's sign-in page (Composio's), where you log in or paste your key.
  async function connect(slug, callbackUrl) {
    const t = await toolkit(slug);
    if (t.noAuth) return { noAuth: true };
    const cfg = await authConfigFor(slug, t);
    const link = await call('/connected_accounts/link', { method: 'POST', body: { auth_config_id: cfg.id, user_id: userId(), callback_url: callbackUrl } });
    return { redirectUrl: link.redirect_url, connectionId: link.connected_account_id, expiresAt: link.expires_at };
  }

  async function connection(id) {
    const a = await call(`/connected_accounts/${encodeURIComponent(id)}`);
    if (a.user_id !== userId()) throw Object.assign(new Error('Not your connection'), { code: 'not-yours' });
    return { id: a.id, toolkit: a.toolkit?.slug, status: a.status, statusReason: a.status_reason || null };
  }

  // Disconnect always takes the app off the owner's list and off the bots (#463), whatever Composio answers: the id
  // is kept in `gone` and left out of every read of the connections. Already gone in Composio (404) is done; a refused
  // key or Composio's failure comes back as `note`, as the connection may still be there. Returns { toolkit, left, note }:
  // left, another working connection of the same app.
  async function disconnect(id) {
    let toolkit = seen.get(id) || null;
    let note = null;
    try {
      toolkit = (await connection(id)).toolkit || toolkit; // only ours
      // Revoke, then delete (Composio's delete alone leaves the app's token): one already revoked at the app fails here.
      await call(`/connected_accounts/${encodeURIComponent(id)}/revoke`, { method: 'POST' }).catch((e) => { if (e.status === 401) throw e; });
      await call(`/connected_accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (e) {
      if (e.code === 'not-yours') throw e;
      if (e.status !== 404) note = `${nameOf(toolkit) || APPS[toolkit]?.name || toolkit || 'The app'} is off your list, but Composio didn't confirm removing it, so it may still be connected there.`;
    }
    const d = load();
    d.gone = [...new Set([...(d.gone || []), id])];
    save(d);
    const left = !!toolkit && (await connections().catch(() => [])).some((c) => c.toolkit === toolkit && c.status === 'ACTIVE');
    if (toolkit && !left) {
      if (connected) connected = connected.filter((x) => x !== toolkit);
      const now = load();
      if ((now.apps || []).includes(toolkit)) { now.apps = now.apps.filter((x) => x !== toolkit); save(now); }
    }
    return { toolkit, left, note };
  }

  // ---------- bots using them ----------

  // An app's actions, for a bot to pick from (short list; the full input schema only for a named tool).
  async function tools(slug, { search, tool } = {}) {
    if (!SLUG_RE.test(String(slug))) throw new Error('Unknown app');
    if (tool) {
      if (!TOOL_RE.test(String(tool))) throw new Error('Unknown action');
      const t = await call(`/tools/${encodeURIComponent(tool)}`);
      if (t.toolkit?.slug !== slug) throw new Error(`${tool} isn't an action of ${slug}`);
      return [{ slug: t.slug, name: t.name, description: t.description, input: t.input_parameters }];
    }
    const d = await call('/tools', { query: { toolkit_slug: slug, search: search || undefined, limit: search ? 20 : 60 } });
    return (d.items || []).filter((t) => !t.is_deprecated).map((t) => ({ slug: t.slug, name: t.name, description: String(t.description || '').slice(0, 240) }));
  }

  // A file the bot names in its arguments as {"$file": "<path>"}: botdot puts in what the action wants, so the
  // model never types out a file's bytes. A file field (Composio's FileUploadable) gets the file uploaded to
  // Composio and its reference; any other field gets the file's base64. `open` finds the file: { abs, name }.
  async function withFiles(tool, schema, args, open) {
    const isFile = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v.$file === 'string';
    const wantsUpload = (sch) => /"file_uploadable":true|"title":"FileUploadable"/.test(JSON.stringify(sch || {}));
    const fill = async (v, sch) => {
      if (isFile(v)) {
        const { abs, name } = open(v.$file);
        const data = fs.readFileSync(abs);
        return wantsUpload(sch) ? upload(tool, name || path.basename(abs), data) : data.toString('base64');
      }
      if (Array.isArray(v)) return Promise.all(v.map((x) => fill(x, sch?.items || sch)));
      if (v && typeof v === 'object') {
        const out = {};
        for (const [k, x] of Object.entries(v)) out[k] = await fill(x, sch?.properties?.[k] || (sch?.anyOf || []).find((o) => o.properties?.[k])?.properties?.[k]);
        return out;
      }
      return v;
    };
    return fill(args, schema);
  }

  // Upload a file for an action's file field (to Composio's storage). Returns the FileUploadable it takes.
  async function upload(tool, name, data) {
    const mimetype = MIME[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream';
    const md5 = crypto.createHash('md5').update(data).digest('hex');
    const r = await call('/files/upload/request', { method: 'POST', body: { toolkit_slug: tool.toolkit.slug, tool_slug: tool.slug, filename: name, mimetype, md5 } });
    const url = r.new_presigned_url || r.newPresignedUrl;
    if (url && r.type !== 'existing') {
      const headers = { 'Content-Type': mimetype, ...(r.metadata?.storage_backend === 'azure_blob_storage' ? { 'x-ms-blob-type': 'BlockBlob' } : {}) };
      const put = await fetch(url, { method: 'PUT', headers, body: data, signal: AbortSignal.timeout(120_000) });
      if (!put.ok) throw new Error(`Couldn't upload ${name} to Composio (${put.status})`);
    }
    return { name, mimetype, s3key: r.key };
  }

  // Run one action as the owner's connected account. openFile: finds the files named with {"$file": …}.
  // authorize(action): asked before anything is run or uploaded, with the action as Composio describes it; it
  // returns (also later, as a promise) when the action may run, and throws when it may not (connector-approvals.js).
  async function execute(slug, tool, args, openFile = null, authorize = () => { throw new Error('Owner authorization required'); }) {
    if (!TOOL_RE.test(String(tool))) throw new Error('Unknown action');
    const t = await call(`/tools/${encodeURIComponent(tool)}`);
    if (t.toolkit?.slug !== slug) throw new Error(`${tool} isn't an action of ${slug}`);
    if (t.slug !== tool) throw new Error('The action metadata does not match the requested action');
    await authorize(t);
    let accountId;
    if (!t.no_auth) {
      // The newest working connection: one made again (Reconnect) replaces one that lacks a permission.
      const acc = (await connections()).filter((c) => c.toolkit === slug && c.status === 'ACTIVE').sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
      if (!acc) throw Object.assign(new Error(`${slug} isn't connected (or its connection expired). Ask the owner to connect it on the Connectors page.`), { notConnected: slug });
      accountId = acc.id;
    }
    if (openFile && JSON.stringify(args || {}).includes('"$file"')) args = await withFiles(t, t.input_parameters, args, openFile);
    const r = await call(`/tools/execute/${encodeURIComponent(tool)}`, { method: 'POST', body: { user_id: userId(), connected_account_id: accountId, arguments: args || {} } });
    // The app's own error (often its API's JSON) in plain words, the app's words kept as detail (app-errors.js).
    if (!r.successful) {
      const e = appErrors.appError(r.error || 'The action failed', { app: slug, name: nameOf(slug) || t.toolkit?.name || APPS[slug]?.name || slug });
      if (e.code === 'app-signed-out') e.notConnected = slug; // a job's run gets the Reconnect card (#431)
      throw e;
    }
    return r.data;
  }

  return { status, rejectedError, setKey, removeKey, reconnect, forgetReconnect, reconnectCardDue, configured, catalog, categories, toolkit, connections, knownApps, connectedApps, connect, connection, disconnect, tools, execute, nameOf, SLUG_RE };
}

module.exports = { create };
