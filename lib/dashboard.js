// The owner's Board (data/dashboard.json): tiles the Chief puts together when asked, grouped under
// short headings. Each tile is one of a few kinds botdot draws itself on the web and in the apps:
//   switch  on/off with its state (a light), tap to switch
//   button  tap to do one thing ("All lights off")
//   value   a number or a short text (temperature, disk use), tap to refresh
//   list    a few lines (next calendar items)
//   note    a short text (a morning summary)
//   group   holds other tiles (parent: its id): one dot per tile inside, tap opens them below it
//   custom  nothing ready-made: what it shows and does comes only from its blocks
//
// Any tile can also be built from blocks (see tile-blocks.js): its face (what shows on it), a panel (the pop-up
// a tap opens, with sliders, a colour wheel, switches…), its dot, and what a tap does. It can have more named
// reads than its one read (reads) and named actions its controls run (actions), and a size: small, wide, big
// (two wide, two high) or a whole row. The six kinds above are ready-made looks the blocks can replace.
//
// Where a tile's value comes from (read) and what a tap does (do, or turnOn / turnOff for a switch):
//   http    an API call with a saved login, made by botdot itself (see vault-http.js). No AI, instant.
//   script  a small bash script in its bot's workspace, as that bot. Waits for the owner's OK first.
//   bot     (taps only) a message to its bot, which starts a run.
// A tile without a read source shows the last value its bot (set_tile) or the Chief gave it.
//
// Bots can suggest tiles (suggest_tile), when asked or when they notice the owner often asks for the
// same thing. A suggestion shows faded at the end of the Board and as a card in its bot's chat; it
// becomes a tile only when the owner taps Add (that is the approval, scripts included). After a ✕,
// that bot doesn't suggest that tile again. At most MAX_SUGGESTIONS wait at once.
//
// Values refresh only while someone has the Board open (each GET refreshes the stale ones), and
// straight after a tap. New values go out on the live feed as a "dashboard" event.
const fs = require('fs');
const path = require('path');
const { KEEP, APPROVE_CHANGE, DECLINE_NEW } = require('./asks');
const crypto = require('crypto');
const { pickValue } = require('./pick');
const blocks = require('./tile-blocks');

const KINDS = ['switch', 'button', 'value', 'list', 'note', 'group', 'custom'];
const SOURCES = ['http', 'script', 'bot'];
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const ACTIONS = ['do', 'turnOn', 'turnOff'];
const MAX_TILES = 60;
const MAX_LIST = 8;
const MAX_SUGGESTIONS = 3;

const text = (v, n) => String(v ?? '').trim().slice(0, n);

// How often a tile reads again while the Board is open, in seconds, as the owner chose it (#42): 10 seconds to a
// day, 60 when nobody said, and 0 for "only when tapped" (read once, then on a tap or a tap's re-read).
const everyOf = (v) => (v === 0 || v === '0' ? 0 : Math.min(Math.max(Math.round(Number(v)) || 60, 10), 86400));
// How long a picture is kept: a tile read only by hand fetches it again when it is read.
const pictureEvery = (t) => (t.every === 0 ? 86400 : Math.max(t.every || 60, 10));

// One source, checked. where: 'read' or an action name, for the error messages. isRead: it's read, not run on a tap.
function cleanSource(s, where, kind, isRead = where === 'read') {
  if (s == null) return null;
  if (typeof s !== 'object' || Array.isArray(s)) throw new Error(`${where}: give an object with a "type"`);
  const type = SOURCES.includes(s.type) ? s.type : null;
  if (!type) throw new Error(`${where}: type must be one of ${SOURCES.join(', ')}`);
  if (type === 'bot' && isRead) throw new Error(`${where}: a bot can't be a read source. Leave it out and let the bot fill the tile with set_tile.`);
  if (type === 'http') {
    const method = String(s.method || 'GET').toUpperCase();
    if (!METHODS.includes(method)) throw new Error(`${where}: method must be one of ${METHODS.join(', ')}`);
    if (isRead && !['GET', 'POST'].includes(method)) throw new Error(`${where}: use GET (or POST for a query, like Home Assistant's /api/template)`);
    if (s.image && !(isRead && method === 'GET' && where !== 'read')) throw new Error(`${where}: a picture is a named read with GET, e.g. reads: { camera: { type: "http", …, image: true } }`);
    const url = text(s.url, 2000);
    try { if (!/^https?:$/.test(new URL(url).protocol)) throw new Error(); } catch { throw new Error(`${where}: give the full address, e.g. https://home.example.ts.net:8123/api/states/light.living_room`); }
    const headers = {};
    for (const [k, v] of Object.entries(s.headers && typeof s.headers === 'object' ? s.headers : {})) headers[text(k, 100)] = text(v, 2000);
    const login = text(s.login, 200);
    if (!login) throw new Error(`${where}: say which saved login to use`);
    const body = s.body == null ? null : typeof s.body === 'string' ? s.body.slice(0, 20000) : s.body;
    if (Object.values(headers).some((v) => /\{\{\s*(value|rgb|onoff)\s*\}\}/.test(v))) throw new Error(`${where}: {{value}} goes in the address or the body, not in a header`);
    return { type, login, method, url, headers, body, pick: text(s.pick, 200), ...(s.image ? { image: true } : {}) };
  }
  if (type === 'script') {
    const script = String(s.script || '').slice(0, 20001);
    if (!script.trim()) throw new Error(`${where}: write the script`);
    if (script.length > 20000) throw new Error(`${where}: keep the script under 20,000 characters`);
    return { type, script, timeoutSeconds: Math.min(Math.max(Math.round(Number(s.timeoutSeconds) || 20), 1), 120), pick: text(s.pick, 200) };
  }
  const message = text(s.message, 4000);
  if (!message) throw new Error(`${where}: say what to ask the bot`);
  return { type, message };
}

// Every source of a tile: its read and named reads, its tap actions and named actions.
const sourcesOf = (t) => [t.read, ...Object.values(t.reads || {}), ...ACTIONS.map((a) => t[a]), ...Object.values(t.actions || {})].filter(Boolean);
const actionOf = (t, name) => t.actions?.[name] || (ACTIONS.includes(name) ? t[name] : null) || null;
// What needs the owner's OK again when it changes: the scripts.
const scriptsOf = (t) => sourcesOf(t).filter((s) => s.type === 'script').map((s) => s.script);
const needsOk = (t) => scriptsOf(t).length > 0;

// What a source said (text; JSON when it is JSON), with its pick applied.
function parseOutput(raw, pick) {
  let data = String(raw ?? '').trim();
  try { data = JSON.parse(data); } catch { /* plain text */ }
  return pickValue(data, pick);
}

// The devices a tile talks to, as Home Assistant entity ids found anywhere in its sources.
const ENTITY = /\b(?:light|switch|fan|cover|climate|media_player|lock|input_boolean|input_number|input_select|number|select|sensor|binary_sensor|vacuum|humidifier|water_heater|valve|siren)\.[a-z0-9_]+/g;
const devicesOf = (t) => [...new Set(sourcesOf(t).flatMap((s) => JSON.stringify(s).match(ENTITY) || []))];

const ON = /^(on|true|1|yes|open|opened|home|playing|unlocked|active|running|heat|cool|auto)$/i;
const UNKNOWN = /^(unavailable|unknown|none|null|)$/i;
const hasReads = (t) => !!t.read || Object.keys(t.reads || {}).length > 0;
// What a read said, as the tile keeps it; an answer too big to keep is left out (a pick makes it smaller).
const keep = (v) => (v !== undefined && JSON.stringify(v).length > 64000 ? '(too long to keep: use pick)' : v);
const short = (v) => (v == null ? '' : typeof v === 'object' ? (v.title ?? v.name ?? v.summary ?? v.message ?? v.text ?? JSON.stringify(v)) : v);

// A value as its tile shows it: switch → true/false/null, value → { text, level }, list → [lines], note → text.
function shape(tile, v) {
  if (tile.kind === 'switch') {
    if (v == null || UNKNOWN.test(String(v))) return null;
    return tile.onValue ? String(v) === tile.onValue : v === true || ON.test(String(v));
  }
  if (tile.kind === 'list') {
    const lines = Array.isArray(v) ? v.map(short) : String(v ?? '').split('\n');
    return lines.map((l) => text(l, 200)).filter(Boolean).slice(0, MAX_LIST);
  }
  if (tile.kind === 'note') return text(Array.isArray(v) ? v.map(short).join('\n') : short(v), 2000);
  if (tile.kind === 'value') {
    const s = text(Array.isArray(v) ? v.map(short).join(', ') : short(v), 60);
    const n = Number(s);
    let level = null;
    if (s !== '' && Number.isFinite(n) && tile.levels) {
      const { warn, bad } = tile.levels;
      const up = bad >= warn; // "warn at 70, bad at 90" goes up; "warn at 20, bad at 10" goes down
      level = (up ? n >= bad : n <= bad) ? 'bad' : (up ? n >= warn : n <= warn) ? 'warn' : 'ok';
    }
    return { text: s, level };
  }
  return null;
}

function create(dataDir, { run, feed } = {}) {
  const FILE = path.join(dataDir, 'dashboard.json');
  let data = null;
  const load = () => {
    if (data) return data;
    try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { data = {}; }
    data.sections = Array.isArray(data.sections) ? data.sections : [];
    data.tiles = Array.isArray(data.tiles) ? data.tiles : [];
    data.values = data.values && typeof data.values === 'object' ? data.values : {};
    data.suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
    data.declined = Array.isArray(data.declined) ? data.declined : []; // [{ botId, title, url }]: not again
    return data;
  };
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(load()), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  };
  // Tiles' values change often (each read, each tap): those are saved together, a moment later.
  const saveSoon = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(save, 1500);
    saveTimer.unref?.();
  };
  process.on('exit', () => { if (saveTimer) save(); }); // what's waiting isn't lost on a restart
  const changed = () => { save(); feed?.emit('dashboard', { changed: true }); };

  // A tile as clients see it: its settings (scripts and requests left out), its last value, and its look: the
  // dot, face and panel filled in (tile-blocks.js), and what a tap does (tap: toggle, act, refresh, panel,
  // chat, group or none).
  function view(t) {
    const v = load().values[t.id] || {};
    const acts = ACTIONS.filter((a) => t[a]);
    const size = sizeOf(t);
    const bucket = Math.floor(Date.now() / (pictureEvery(t) * 1000)); // a picture is fetched again this often
    const look = blocks.look(t, { data: v.data || { value: v.value?.text ?? v.value }, shaped: v.value ?? null, history: v.history, times: v.times, at: bucket });
    const tapAction = t.tap && actionOf(t, t.tap);
    return {
      id: t.id, kind: t.kind, title: t.title, section: t.section, parent: t.parent || null, size, wide: size !== 'small', color: t.color, bot: t.bot, unit: t.unit,
      ...(hasReads(t) ? { every: everyOf(t.every) } : {}), // how often it reads again, for its pop-up to say
      approved: t.approved, createdBy: t.createdBy,
      // What the two buttons of a tile that waits read (docs/api.md, "Decline" and "A change that waits").
      ...(waits(t) ? { change: changeView(t), no: KEEP, yes: APPROVE_CHANGE } : t.approved === false ? { no: DECLINE_NEW } : {}),
      tappable: acts.length > 0 || (!!t.read && t.kind === 'value') || ['act', 'toggle', 'refresh', 'panel'].includes(look.tap),
      asks: tapAction ? tapAction.type === 'bot' : acts.some((a) => t[a].type === 'bot'), // a tap starts a run of its bot, not instant
      value: v.value ?? null, at: v.at || null, error: v.error || null,
      // Where its value comes from, quietly ("script · 30 s"); and whether a bot or the Chief wrote it (`ai`).
      ...(hasReads(t) ? { source: sourceWords(t) } : v.by && v.by !== 'you' ? { ai: true } : {}),
      look,
    };
  }
  const sizeOf = (t) => t.size || (t.wide ? 'wide' : 'small');
  // "http · 1 min", "script · 30 s", "script · on tap": its read's type and how often it reads again.
  const sourceWords = (t) => {
    const n = everyOf(t.every);
    const every = t.every === 0 ? 'on tap' : n % 86400 === 0 ? `${n / 86400} d` : n % 3600 === 0 ? `${n / 3600} h` : n % 60 === 0 ? `${n / 60} min` : `${n} s`;
    return `${(t.read || Object.values(t.reads || {})[0]).type} · ${every}`;
  };
  // A change that waits beside an approved tile (ADR 013): `change` on the tile, { tile: the tile as proposed,
  // by, at, chatId? }. The approved tile reads and acts on until the owner answers: everything that runs a tile
  // reads the tile itself, never its change. As the apps get it: the proposed tile with every script it would
  // run, who proposed it and when, and what its two buttons read (docs/api.md, "A change that waits").
  const waits = (t) => t.approved !== false && !!t.change;
  // Whether a tile reads something else than before: its kept value is then no longer its own.
  const readsDiffer = (a, b) => JSON.stringify([a.read, a.reads]) !== JSON.stringify([b.read, b.reads]) || a.kind !== b.kind;
  const changeView = (t) => ({ ...t.change.tile, scripts: scriptsOf(t.change.tile), by: t.change.by, at: t.change.at });
  // In full, for the Chief and the approval card.
  const full = (t) => ({ ...t, ...view(t) });

  // The tiles in the order they're shown: those without a heading first, then by heading.
  function ordered() {
    const d = load();
    const names = [...d.sections, ...d.tiles.map((t) => t.section).filter((s) => s && !d.sections.includes(s))];
    const unique = [...new Set(names)];
    return [...d.tiles.filter((t) => !t.section), ...unique.flatMap((s) => d.tiles.filter((t) => t.section === s))];
  }
  function list({ detail = false } = {}) {
    const d = load();
    const used = new Set(d.tiles.map((t) => t.section).filter(Boolean));
    const sections = [...new Set([...d.sections, ...d.tiles.map((t) => t.section).filter(Boolean)])].filter((s) => used.has(s));
    return { sections, tiles: ordered().map(detail ? full : view), suggestions: d.suggestions.map(suggestionView) };
  }
  const get = (id) => load().tiles.find((t) => t.id === id) || null;

  // A tile from the Chief's (or a bot's) fields, checked; prev: the tile it changes. testing: only its sources
  // and blocks are checked (test_tile tries a read before the tile is whole). chatId: the Chief chat it was asked
  // for in: a tile that waits for the owner keeps it with the moment (`chatId`, `askedAt`), so the Chief is told
  // there of the answer (ADR 009); an approved tile has neither.
  function clean(input, prev, { by, testing = false, chatId = null }) {
    const pick = (k) => (input[k] !== undefined ? input[k] : prev?.[k]);
    const kind = pick('kind');
    if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`);
    const title = text(pick('title'), 40);
    if (!title) throw new Error('Give the tile a short title, e.g. "Living room light"');
    const size = input.size !== undefined && input.size !== null ? input.size
      : input.wide !== undefined ? (input.wide ? 'wide' : 'small') : prev ? sizeOf(prev) : 'small';
    if (!blocks.SIZES.includes(size)) throw new Error(`size is one of ${blocks.SIZES.join(', ')}`);
    const t = {
      id: prev?.id || `t_${crypto.randomBytes(5).toString('hex')}`,
      kind, title,
      section: text(pick('section'), 30),
      parent: text(pick('parent'), 40) || null,
      size, wide: size !== 'small',
      color: /^#[0-9a-f]{6}$/i.test(String(pick('color') || '')) ? String(pick('color')).toLowerCase() : null,
      bot: pick('bot') ? text(pick('bot'), 80) : null,
      unit: text(pick('unit'), 12),
      onValue: text(pick('onValue'), 40) || null,
      levels: null,
      every: everyOf(pick('every')),
      read: cleanSource(pick('read'), 'read', kind),
      do: null, turnOn: null, turnOff: null,
      createdBy: prev?.createdBy || by,
      createdAt: prev?.createdAt || new Date().toISOString(),
    };
    for (const a of ACTIONS) t[a] = cleanSource(pick(a), a, kind);
    t.reads = blocks.checkNamed(pick('reads'), 'reads', (s, w) => cleanSource(s, w, kind, true), ['value']);
    t.actions = blocks.checkNamed(pick('actions'), 'actions', (s, w) => cleanSource(s, w, kind, false), [...ACTIONS, ...blocks.TAPS]);
    Object.assign(t, blocks.check({ dot: pick('dot'), face: pick('face'), panel: pick('panel'), tap: pick('tap') }, t));
    const lv = pick('levels');
    if (lv && Number.isFinite(Number(lv.warn)) && Number.isFinite(Number(lv.bad))) t.levels = { warn: Number(lv.warn), bad: Number(lv.bad) };
    if (kind === 'group' && (sourcesOf(t).length || t.face || t.panel)) throw new Error('A group only holds other tiles: leave its sources and blocks out');
    if (t.parent) {
      const g = get(t.parent);
      if (!g || g.kind !== 'group') throw new Error(`No group tile with id ${t.parent}. Make one with kind "group" first.`);
      if (kind === 'group') throw new Error("A group can't go inside another group");
      t.section = g.section; // it sits where its group sits
    }
    if (!testing) {
      if (kind === 'switch' && !t.read) throw new Error('A switch needs a read source, so it shows whether it is on');
      if (kind === 'switch' && !t.do && !(t.turnOn && t.turnOff)) throw new Error('A switch needs turnOn and turnOff (or do, to toggle)');
      if (kind === 'button' && !t.do && !t.tap) throw new Error('A button needs do: what a tap does');
      if (kind !== 'switch' && (t.turnOn || t.turnOff)) throw new Error('Only a switch has turnOn and turnOff; use do, or named actions');
      if (['list', 'note'].includes(kind) && t.do) throw new Error('A tap on a list or note opens its bot\'s chat; leave do out');
    }
    if (sourcesOf(t).length && !t.bot) throw new Error('Say whose tile it is (bot): its saved logins, workspace or chat are used');
    // Scripts run on this machine: a new or changed one waits for the owner.
    const same = prev && JSON.stringify(scriptsOf(prev)) === JSON.stringify(scriptsOf(t));
    t.approved = !needsOk(t) || by === 'you' || !!(same && prev.approved !== false);
    if (!t.approved) t.changedBy = by;
    if (!t.approved && same && prev.approved === false && prev.chatId) Object.assign(t, { chatId: prev.chatId, askedAt: prev.askedAt }); // the scripts that wait are the same: asked for where they were
    else if (!t.approved && by === 'chief' && chatId) Object.assign(t, { chatId, askedAt: new Date().toISOString() });
    return t;
  }

  function add(input, { by = 'chief', chatId = null } = {}) {
    const d = load();
    if (d.tiles.length >= MAX_TILES) throw new Error(`The Board is full (${MAX_TILES} tiles). Remove some first.`);
    const t = clean(input, null, { by, chatId });
    if (d.tiles.some((x) => x.title.toLowerCase() === t.title.toLowerCase() && x.section === t.section && (x.parent || null) === t.parent)) throw new Error(`There's already a tile called "${t.title}" there. Change that one with update_tile.`);
    d.tiles.push(t);
    if (t.section && !d.sections.includes(t.section)) d.sections.push(t.section);
    if (input.value !== undefined && !t.read) d.values[t.id] = given(t, input.value, by);
    changed();
    return full(t);
  }

  // A value given to a tile (by its bot, or the Chief): shown as its kind shows it, and there for its blocks.
  // by: who gave it ("bot", "chief" or "you"); a value a bot or the Chief wrote is shown as written by AI.
  function given(t, value, by = 'chief') {
    const prev = load().values[t.id] || {};
    const data = { ...(prev.data || {}), value: keep(value) };
    return { value: shape(t, value), data, ...record(t, data, prev), at: new Date().toISOString(), by };
  }
  // The recent values of its charts, kpis and value (blocks.historyPaths): each read (or given value) adds one,
  // with its time (epoch ms, in `times` beside `history`), up to MAX_HISTORY. prev: what the tile kept before.
  function record(t, data, prev = {}) {
    const paths = blocks.historyPaths(t);
    if (!paths.length) return {};
    const history = {};
    const times = {};
    const now = Date.now();
    for (const p of paths) {
      const v = pickValue(data, p);
      const n = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
      const add = !Array.isArray(v) && v !== '' && v != null && Number.isFinite(n);
      const was = prev.history?.[p] || [];
      const at = prev.times?.[p] || [];
      const wasAt = at.length === was.length ? at : [...Array(Math.max(was.length - at.length, 0)).fill(null), ...at].slice(-was.length); // kept before times were
      history[p] = [...was, ...(add ? [n] : [])].slice(-blocks.MAX_HISTORY);
      times[p] = [...wasAt, ...(add ? [now] : [])].slice(-blocks.MAX_HISTORY);
    }
    return { history, times };
  }

  function update(id, input, { by = 'chief', chatId = null } = {}) {
    const d = load();
    const i = d.tiles.findIndex((t) => t.id === id);
    if (i < 0) throw new Error(`No tile with id ${id}. Use get_board to see them.`);
    const prev = d.tiles[i];
    const t = clean(input, prev, { by, chatId });
    if (t.kind !== 'group' && d.tiles.some((x) => x.parent === id)) throw new Error('It holds tiles: take them out first, or keep it a group');
    if (prev.approved !== false && !t.approved) {
      // Its scripts changed and need the owner's OK: the approved tile stays as it is, and the tile as proposed
      // waits beside it, whole, since a tile's fields are checked together. One change waits: a second replaces
      // the first; one with the scripts that wait already was asked for where and when they were.
      const { approved: _, changedBy: __, chatId: ___, askedAt: ____, ...proposed } = t;
      const had = prev.change && JSON.stringify(scriptsOf(prev.change.tile)) === JSON.stringify(scriptsOf(proposed)) ? prev.change : null;
      const asked = by === 'chief' && chatId ? { at: new Date().toISOString(), chatId } : had ? { at: had.at, ...(had.chatId ? { chatId: had.chatId } : {}) } : { at: new Date().toISOString() };
      prev.change = { tile: proposed, by, ...asked };
      changed();
      return full(prev);
    }
    // Changed without a script that needs the OK: at once. A waiting change stays, and gets the same edit, so
    // that its yes does not take back what was changed meanwhile (a title, a colour, a size). Where the edit does
    // not fit the tile as proposed, or would leave it with the approved scripts, the change waits as it was. Only
    // when the owner themselves changed the scripts is it dropped: their version is approved.
    if (prev.change && prev.approved !== false && JSON.stringify(scriptsOf(prev)) === JSON.stringify(scriptsOf(t))) {
      t.change = prev.change;
      try {
        const { approved: _, changedBy: __, chatId: ___, askedAt: ____, ...laid } = clean(input, prev.change.tile, { by: 'you' });
        if (JSON.stringify(scriptsOf(laid)) !== JSON.stringify(scriptsOf(t))) t.change = { ...prev.change, tile: laid };
      } catch { /* as it was */ }
    }
    if (readsDiffer(t, prev)) delete d.values[id];
    d.tiles[i] = t;
    if (t.kind === 'group') for (const x of d.tiles) if (x.parent === id) x.section = t.section; // its tiles move with it
    if (t.section && !d.sections.includes(t.section)) d.sections.push(t.section);
    if (input.value !== undefined && !t.read) d.values[t.id] = given(t, input.value, by);
    changed();
    return full(t);
  }

  // A group goes with its tiles (withTiles), or they come out of it and stay.
  function remove(id, { withTiles = false } = {}) {
    const d = load();
    const t = get(id);
    if (!t) return false;
    const inside = d.tiles.filter((x) => x.parent === id);
    for (const x of inside) { if (withTiles) delete d.values[x.id]; else x.parent = null; }
    d.tiles = d.tiles.filter((x) => x.id !== id && !(withTiles && x.parent === id));
    delete d.values[id];
    changed();
    return true;
  }

  // Headings in this order, tiles in this order, or a heading renamed.
  function arrange({ sections, tiles, rename } = {}) {
    const d = load();
    if (rename?.from) {
      const to = text(rename.to, 30);
      for (const t of d.tiles) if (t.section === rename.from) t.section = to;
      d.sections = d.sections.map((s) => (s === rename.from ? to : s)).filter(Boolean);
    }
    if (Array.isArray(sections)) d.sections = [...new Set([...sections.map((s) => text(s, 30)).filter(Boolean), ...d.sections])];
    if (Array.isArray(tiles)) {
      const place = new Map(tiles.map((id, i) => [id, i]));
      d.tiles.sort((a, b) => (place.get(a.id) ?? 1e6) - (place.get(b.id) ?? 1e6));
    }
    changed();
    return list({ detail: true });
  }

  // The owner dragged a tile: under this heading (section), into this group (parent) or loose (null), before
  // the tile `before` (null: at the end there). A group takes its tiles along to the new heading.
  function move(id, { section, parent = null, before = null } = {}) {
    const d = load();
    const t = get(id);
    if (!t) throw new Error('That tile is gone.');
    if (parent) {
      const g = get(parent);
      if (!g || g.kind !== 'group') throw new Error('That group is gone.');
      if (t.kind === 'group') throw new Error("A group can't go inside another group");
      t.parent = g.id;
      t.section = g.section;
    } else {
      t.parent = null;
      if (section !== undefined) t.section = text(section, 30);
    }
    if (t.kind === 'group') for (const x of d.tiles) if (x.parent === t.id) x.section = t.section;
    if (t.section && !d.sections.includes(t.section)) d.sections.push(t.section);
    d.tiles = d.tiles.filter((x) => x.id !== id);
    const at = before ? d.tiles.findIndex((x) => x.id === before) : -1;
    d.tiles.splice(at < 0 ? d.tiles.length : at, 0, t);
    changed();
    return view(t);
  }

  function approve(id, yes) {
    const t = get(id);
    if (!t) throw new Error('That tile is gone.');
    if (!yes) return remove(id);
    t.approved = true;
    delete t.changedBy;
    delete t.chatId; // answered: where it was asked for no longer counts
    delete t.askedAt;
    changed();
    refresh([id]).catch(() => {});
    return true;
  }

  // The owner's answer to the change that waits beside an approved tile. Yes: the tile as proposed takes the
  // approved one's place, where the tile sits now. No: the change goes and nothing else. On an approved tile
  // without a change neither does anything: a no from a card that is out of date removes nothing.
  // Returns the change that was answered, or null.
  function answerChange(id, yes) {
    const d = load();
    const i = d.tiles.findIndex((x) => x.id === id);
    const t = d.tiles[i];
    if (!t) throw new Error('That tile is gone.');
    if (!waits(t)) return null;
    const { change, ...kept } = t;
    if (yes) {
      const next = { ...kept, ...change.tile, id: t.id, section: t.section, parent: t.parent || null, approved: true, createdBy: t.createdBy, createdAt: t.createdAt };
      if (readsDiffer(next, t)) delete d.values[id];
      d.tiles[i] = next;
    } else d.tiles[i] = kept;
    changed();
    if (yes) refresh([id]).catch(() => {});
    return change;
  }

  // A bot (or the Chief) giving a tile its value.
  function setValue(id, value, { botId = null, by = 'chief' } = {}) {
    const t = get(id);
    if (!t) throw new Error(`No tile with id ${id}`);
    if (botId && t.bot !== botId) throw new Error('That tile isn\'t yours to fill.');
    if (t.read) throw new Error('That tile reads its value itself.');
    if (value !== undefined && JSON.stringify(value).length > 20000) throw new Error('Keep it short: it\'s glanced at, not read.');
    load().values[id] = given(t, value, botId ? 'bot' : by);
    saveSoon();
    feed?.emit('dashboard', { tile: view(t) });
    return view(t);
  }

  // Whether a tile is due to be read again: never read yet, or older than its `every`; one read only by hand
  // (every 0) only when it has no value yet.
  const stale = (t, now) => {
    const at = load().values[t.id]?.at;
    return !at || (t.every !== 0 && now - Date.parse(at) >= everyOf(t.every) * 1000);
  };

  // Read tiles again: the stale ones (default), or these ids. One refresh per tile at a time. A tile's read
  // and its named reads go together; each one's answer (after its pick) is kept for its blocks.
  const busy = new Map();
  function refresh(ids = null) {
    const d = load();
    const now = Date.now();
    const due = d.tiles.filter((t) => hasReads(t) && t.approved && (ids ? ids.includes(t.id) : stale(t, now)));
    return Promise.all(due.map((t) => {
      if (busy.has(t.id)) return busy.get(t.id);
      const p = (async () => {
        const prev = d.values[t.id] || {};
        const jobs = [...(t.read ? [['value', t.read]] : []), ...Object.entries(t.reads || {}).filter(([, s]) => !s.image)];
        const got = await Promise.all(jobs.map(async ([name, s]) => {
          try { return { name, v: parseOutput(await run(t, s, name === 'value' ? 'read' : name), s.pick) }; } catch (e) { return { name, error: text(e.message, 200) }; }
        }));
        await Promise.all(Object.entries(t.reads || {}).filter(([, s]) => s.image).map(([name]) => refreshImage(t.id, name).catch(() => {})));
        const data = { ...(prev.data || {}) };
        for (const g of got) if (!g.error) data[g.name] = keep(g.v);
        const error = got.find((g) => g.error)?.error;
        const readOk = t.read && !got.find((g) => g.name === 'value')?.error;
        const next = { value: readOk ? shape(t, data.value) : prev.value ?? null, data, ...record(t, data, prev), at: new Date().toISOString(), ...(error ? { error } : {}) };
        if (!get(t.id)) return; // removed meanwhile
        d.values[t.id] = next;
        saveSoon();
        if (JSON.stringify([next.value, next.error, next.data]) !== JSON.stringify([prev.value, prev.error, prev.data]) || next.history) feed?.emit('dashboard', { tile: view(get(t.id)) });
      })().finally(() => busy.delete(t.id));
      busy.set(t.id, p);
      return p;
    }));
  }

  // Tiles that likely show what a tap on t changes: those in its group, and those naming the same device
  // (a Home Assistant entity like light.living_room in a URL, body or script). They're read again after it.
  function related(t) {
    const keys = devicesOf(t);
    return load().tiles.filter((x) => x.id !== t.id && hasReads(x) && x.approved
      && ((t.parent && x.parent === t.parent) || devicesOf(x).some((k) => keys.includes(k)))).map((x) => x.id);
  }

  // The owner tapped a tile. on: what a switch should become (else it toggles).
  async function tap(id, { on } = {}) {
    const t = get(id);
    if (!t) throw new Error('That tile is gone.');
    if (!t.approved) throw new Error('This tile waits for your OK.');
    if (t.tap === 'refresh' || (!t.tap && t.kind === 'value' && !t.do)) { await refresh([id]); return view(get(id)); }
    let action = 'do';
    if (t.tap && !blocks.TAPS.includes(t.tap)) action = t.tap; // a tap runs one of its actions
    else if (t.kind === 'switch') {
      const now = load().values[id]?.value;
      const want = typeof on === 'boolean' ? on : !(now === true);
      if (t.turnOn && t.turnOff) action = want ? 'turnOn' : 'turnOff';
      // Show the new state straight away; the read after it says whether it took.
      load().values[id] = { ...(load().values[id] || {}), value: want, error: null };
      feed?.emit('dashboard', { tile: view(t) });
    }
    const source = actionOf(t, action);
    if (!source) throw new Error('Tapping this tile does nothing.');
    return runAction(t, action, source);
  }

  // The owner used one of a tile's controls (block: its key, like "p1"): a switch, button, slider, colour or
  // choice. Its action runs with what they picked; the tile shows it at once, and the read after it says whether it took.
  async function act(id, { block, value } = {}) {
    const t = get(id);
    if (!t) throw new Error('That tile is gone.');
    if (!t.approved) throw new Error('This tile waits for your OK.');
    const c = blocks.control(t, block, value);
    const source = actionOf(t, c.action);
    if (!source) throw new Error('That control does nothing.');
    if (c.bind && c.value !== undefined) {
      const entry = load().values[id] || (load().values[id] = {});
      entry.data = JSON.parse(JSON.stringify(entry.data || {}));
      blocks.setAt(entry.data, c.bind, c.value);
      if (t.read && t.kind !== 'custom') entry.value = shape(t, entry.data.value);
      feed?.emit('dashboard', { tile: view(t) });
    }
    return runAction(t, c.action, blocks.fillSource(source, c.vars), { vars: c.vars });
  }

  // Run one of a tile's actions, then read it (and the tiles showing the same device) again.
  async function runAction(t, name, source, extra) {
    const again = [...(hasReads(t) ? [t.id] : []), ...related(t)];
    let result = null;
    try {
      result = await run(t, source, name, extra);
    } catch (e) {
      if (again.length) refresh(again).catch(() => {});
      throw e;
    }
    // Home Assistant and friends take a moment to report the new state (a dimming light fades), so read
    // again soon and once more a little later. Only real changes go out on the feed.
    if (again.length) {
      const soon = source.type === 'bot' ? [0] : [1200, 5000];
      for (const ms of soon) setTimeout(() => refresh(again).catch(() => {}), ms);
    }
    // queued: its bot was busy, so the run it asked for waits its turn (ADR 011).
    return { ...view(get(t.id) || t), ...(result && typeof result === 'object' && result.runId ? { runId: result.runId, ...(result.queued ? { queued: true } : {}) } : {}) };
  }

  // GET only reads this cache. A protected refresh or image POST fetches from the login host.
  const pictures = new Map();
  function image(id, name) {
    const t = get(id);
    const hit = pictures.get(`${id}/${name}`);
    return t?.approved && t.reads?.[name]?.image && hit?.tile === t ? hit : null;
  }
  const pictureBusy = new Map();
  async function refreshImage(id, name) {
    const t = get(id);
    if (!t || !t.approved) throw new Error('That tile is gone.');
    const s = t.reads?.[name];
    if (!s?.image) throw new Error('That tile has no such picture.');
    const k = `${id}/${name}`;
    const hit = image(id, name);
    if (hit && Date.now() - hit.at < 5000) return hit;
    if (pictureBusy.has(k)) return pictureBusy.get(k);
    const work = (async () => {
      const r = await run(t, s, name, { image: true });
      const pic = { tile: t, at: Date.now(), type: r.type, data: r.data, maxAge: pictureEvery(t) };
      if (get(id) === t && t.approved) pictures.set(k, pic);
      if (pictures.size > 30) pictures.delete(pictures.keys().next().value);
      return pic;
    })().finally(() => pictureBusy.delete(k));
    pictureBusy.set(k, work);
    return work;
  }

  // Test a tile's reads once, before adding it (the Chief checks what comes back, and with blocks, what they show).
  async function test(input) {
    const t = clean({ ...input, kind: KINDS.includes(input.kind) ? input.kind : 'value', title: input.title || 'Test', parent: undefined }, null, { by: 'chief', testing: true });
    const jobs = [...(t.read ? [['value', t.read]] : []), ...Object.entries(t.reads || {}).filter(([, s]) => !s.image)];
    if (!jobs.length) throw new Error('Give a read source to test');
    if (jobs.some(([, s]) => s.type !== 'http')) throw new Error('Only http reads can be tested before the owner approves the tile. Scripts run once it is approved.');
    const answers = {};
    const data = {};
    for (const [name, s] of jobs) {
      const raw = String((await run(t, s, name === 'value' ? 'read' : name)) ?? '');
      answers[name] = raw.length > 3000 ? `${raw.slice(0, 3000)}… (cut off)` : raw;
      try { data[name] = parseOutput(raw, s.pick); } catch { data[name] = undefined; }
    }
    const shows = t.read ? shape(t, data.value) : null;
    const out = { answer: answers.value ?? Object.values(answers)[0], picked: JSON.stringify(data.value)?.slice(0, 2000) ?? 'nothing there', shows };
    if (Object.keys(answers).length > 1 || !t.read) out.answers = answers;
    if (t.face || t.panel || t.dot) {
      const { dot, face, panel } = blocks.look(t, { data, shaped: shows });
      out.looks = { dot, face, panel };
    }
    return out;
  }

  // A deleted bot's tiles go with it.
  function forgetBot(botId) {
    const d = load();
    const before = d.tiles.length;
    d.tiles = d.tiles.filter((t) => t.bot !== botId);
    const had = d.suggestions.length;
    d.suggestions = d.suggestions.filter((x) => x.botId !== botId);
    if (d.tiles.length !== before || d.suggestions.length !== had) changed();
  }

  // ---------- suggestions from bots ----------

  // A suggestion as clients see it: the tile it would be, and why. The sources too, so the card can show a script.
  const suggestionView = (x) => ({ id: x.id, bot: x.botId, reason: x.reason, at: x.at, tile: { ...x.tile, scripts: scriptsOf(x.tile) } });
  const same = (a, b) => a.title.toLowerCase() === b.title.toLowerCase() || (a.read?.url && a.read.url === b.read?.url && (a.read.pick || '') === (b.read?.pick || ''));

  // runId: the bot's run that suggests it; kept with the suggestion, so that the bot carries on after Add (ADR 009).
  function suggest(botId, input, reason, { runId = null } = {}) {
    const d = load();
    const t = clean({ ...input, bot: botId }, null, { by: 'bot' });
    const why = text(reason, 300);
    if (!why) throw new Error('Say in one line why the owner would want it (what you noticed).');
    if (d.declined.some((x) => x.botId === botId && same({ title: x.title, read: x.url ? { url: x.url, pick: x.pick } : null }, t))) throw new Error("The owner said no to this tile. Don't suggest it again.");
    if (d.tiles.some((x) => same(x, t))) throw new Error("It's already on the Board.");
    if (d.suggestions.some((x) => same(x.tile, t))) throw new Error('That suggestion is already waiting for the owner.');
    if (d.suggestions.length >= MAX_SUGGESTIONS) throw new Error(`${MAX_SUGGESTIONS} suggestions already wait for the owner. Don't suggest more for now.`);
    const x = { id: `s_${crypto.randomBytes(5).toString('hex')}`, botId, reason: why, at: new Date().toISOString(), tile: t, ...(runId ? { runId } : {}) };
    d.suggestions.push(x);
    changed();
    return suggestionView(x);
  }

  // The owner's answer: Add puts it on the Board (approved, it was shown in full), ✕ drops it for good.
  function answer(id, yes) {
    const d = load();
    const x = d.suggestions.find((s) => s.id === id);
    if (!x) throw new Error('That suggestion is gone.');
    d.suggestions = d.suggestions.filter((s) => s.id !== id);
    if (!yes) {
      d.declined.push({ botId: x.botId, title: x.tile.title, url: x.tile.read?.url || null, pick: x.tile.read?.pick || '', at: new Date().toISOString() });
      d.declined = d.declined.slice(-200);
      changed();
      return null;
    }
    const { id: _, createdBy, createdAt, approved, changedBy, ...fields } = x.tile;
    if (fields.parent && get(fields.parent)?.kind !== 'group') fields.parent = null; // its group is gone: loose
    let t;
    try { t = add(fields, { by: 'you' }); } catch (e) { changed(); throw e; }
    get(t.id).createdBy = 'bot';
    save();
    refresh([t.id]).catch(() => {});
    return full(get(t.id));
  }

  // Waiting for the owner's OK, in full and with every script as a string, so the approval can show them (as a suggestion's tile has them).
  // A tile with a change beside it is here too, with its approved scripts: its card shows what goes and what comes.
  const suggestion = (id) => load().suggestions.find((x) => x.id === id) || null; // as it is kept, with the run that made it
  const pending = () => load().tiles.filter((t) => !t.approved || waits(t)).map((t) => ({ ...full(t), scripts: scriptsOf(t) }));
  const pushable = (botId) => load().tiles.filter((t) => t.bot === botId && !t.read).map((t) => ({ id: t.id, kind: t.kind, title: t.title }));

  // What a bot is told about the Board: its tiles, what waits, and what the owner turned down.
  const forBot = (botId) => {
    const d = load();
    return { tiles: d.tiles.filter((t) => t.bot === botId).map((t) => t.title), waiting: d.suggestions.filter((x) => x.botId === botId).map((x) => x.tile.title), declined: d.declined.filter((x) => x.botId === botId).map((x) => x.title) };
  };

  // A tile with a chart keeps reading (at most once a minute) while nobody looks, so its chart has no gaps.
  const charts = setInterval(() => {
    const d = load();
    const now = Date.now();
    const due = d.tiles.filter((t) => t.approved && hasReads(t) && blocks.chartPaths(t).length && t.every !== 0 && now - Date.parse(d.values[t.id]?.at || 0) >= Math.max(everyOf(t.every), 60) * 1000);
    if (due.length) refresh(due.map((t) => t.id)).catch(() => {});
  }, 30_000);
  charts.unref?.();

  return { list, get, add, update, remove, arrange, move, approve, answerChange, suggestion, setValue, refresh, tap, act, image, refreshImage, test, forgetBot, pending, pushable, view, full, suggest, answer, forBot, MAX_SUGGESTIONS };
}

module.exports = { create, KINDS, SOURCES, pickValue, parseOutput, shape };
