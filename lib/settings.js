// App-wide settings (data/settings.json): the default model and reasoning level for bots, and the
// Chief of Staff's own choice. A bot's own model/effort, when set, overrides the default.
//
// The model list isn't hard-coded: it's read from Anthropic's models overview page (refreshed at
// start-up and daily, cached in data/models-cache.json), and the reasoning levels from `claude --help`.
// The built-in lists below are only a fallback for when neither can be read.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DOCS_URL = 'https://platform.claude.com/docs/en/about-claude/models/overview.md';
const REFRESH_MS = 24 * 60 * 60 * 1000;

// Families Claude Code accepts as `--model <alias>` for "the newest model of this family".
const CLI_ALIASES = ['fable', 'opus', 'sonnet', 'haiku'];

const FALLBACK_MODELS = [
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', family: 'fable', price: [10, 50], effort: true, current: true },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', family: 'opus', price: [4, 20], effort: true, current: true },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', family: 'sonnet', price: [2, 10], effort: true, current: true },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', family: 'haiku', price: [1, 5], effort: false, current: true },
];
const FALLBACK_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// Plain-language labels and hints; unknown levels (new ones) still show, with their own name.
const EFFORT_TEXT = {
  low: ['Low', 'Quick and cheap. Fine for simple, routine jobs.'],
  medium: ['Medium', 'A balance of speed and care.'],
  high: ['High', 'Careful. A good choice for most bots.'],
  xhigh: ['Extra high', 'Thorough. Good for coding and long, multi-step tasks.'],
  max: ['Max', 'Deepest thinking, when getting it right matters more than cost or speed.'],
};

// The Chief of Staff's name (#41): what the owner calls it, asked in the first-run setup. '' is the role's own name.
const CHIEF_NAME = 'Chief of Staff';
const CHIEF_NAME_MAX = 40;
// A name as it is kept: on one line, spaces made plain, no control characters. Too long is an error, not a cut.
function cleanChiefName(name) {
  const n = String(name ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  if (n.length > CHIEF_NAME_MAX) throw new Error(`A name for the Chief of Staff has at most ${CHIEF_NAME_MAX} characters.`);
  return n === CHIEF_NAME ? '' : n;
}

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9.\-_:[\]]{0,80}$/; // aliases and full names, e.g. claude-opus-4-8[1m]
const cleanModel = (m) => (m && MODEL_RE.test(String(m).trim()) ? String(m).trim() : '');

// ---------- reading the docs page ----------

const stripLinks = (s) => String(s).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
const stripTicks = (s) => String(s).replace(/`/g, '').trim();

// Parse the "Compare models" table (one column per current model) and the "Legacy models" line.
function parseModelsDoc(md) {
  const start = md.indexOf('## Compare models');
  if (start < 0) throw new Error('no "Compare models" section');
  const next = md.indexOf('\n## ', start + 5);
  const section = md.slice(start, next > 0 ? next : undefined);
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const lines = section.split('\n').filter((l) => l.trim().startsWith('|'));
  if (lines.length < 4) throw new Error('model table not found');
  const names = cells(lines[0]).slice(1).map(stripLinks);
  const rows = {};
  for (const l of lines.slice(2)) {
    const c = cells(l);
    rows[stripLinks(c[0]).toLowerCase()] = c.slice(1);
  }
  const idRow = rows['claude api alias'] || rows['claude api id'];
  if (!idRow) throw new Error('no model ID row');
  const models = names.map((name, i) => {
    const id = stripTicks(idRow[i] || '');
    const price = (rows.pricing?.[i] || '').match(/\$([\d.]+)\s*\/\s*input MTok,\s*\$([\d.]+)\s*\/\s*output/i);
    const effort = stripTicks(rows['default effort']?.[i] || '');
    return {
      id,
      name,
      family: (name.match(/^Claude\s+([A-Za-z]+)/) || [])[1]?.toLowerCase() || null,
      description: stripLinks(rows.description?.[i] || ''),
      speed: stripLinks(rows['comparative latency']?.[i] || ''),
      price: price ? [Number(price[1]), Number(price[2])] : null,
      effort: effort ? !/not supported/i.test(effort) : true,
      defaultEffort: /^[a-z]+$/.test(effort) ? effort : null,
      current: true,
    };
  }).filter((m) => /^claude-[a-z0-9-]+$/.test(m.id));
  if (!models.length) throw new Error('no models in the table');

  // "Legacy models (still available): [Claude Opus 5](…/models/opus-5/overview), …"
  const legacyLine = md.split('\n').find((l) => /^Legacy models/i.test(l.trim())) || '';
  for (const [, name, slug] of legacyLine.matchAll(/\[([^\]]+)\]\([^)]*\/models\/([a-z0-9-]+)\/overview\)/g)) {
    const id = `claude-${slug}`;
    if (!models.some((m) => m.id === id)) {
      models.push({ id, name, family: (name.match(/^Claude\s+([A-Za-z]+)/) || [])[1]?.toLowerCase() || null, current: false, effort: !/haiku/i.test(id) });
    }
  }
  return models;
}

// Reasoning levels this Claude Code version accepts, from `claude --help` ("--effort <level> … (low, …)").
function readEffortsFromCli(claudeBin) {
  return new Promise((resolve) => {
    if (!claudeBin) return resolve(null);
    execFile(claudeBin, ['--help'], { timeout: 15_000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
      const text = String(stdout || '').replace(/\s+/g, ' ');
      const m = text.match(/--effort <level>[^(]*\(([a-z, ]+)\)/i);
      resolve(!err && m ? m[1].split(',').map((x) => x.trim()).filter(Boolean) : null);
    });
  });
}

// ---------- the store ----------

function create(dataDir, { claudeBin } = {}) {
  const FILE = path.join(dataDir, 'settings.json');
  const CACHE = path.join(dataDir, 'models-cache.json');
  const DEFAULTS = { defaultModel: '', defaultEffort: '', chiefModel: '', chiefEffort: '', chiefRules: '', chiefName: '', chiefSkills: [], unaskedPerDay: 3 };

  let catalog = { models: FALLBACK_MODELS, efforts: FALLBACK_EFFORTS, source: 'built-in', checkedAt: null, error: null };
  try {
    const cached = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    if (Array.isArray(cached.models) && cached.models.length) catalog = { ...catalog, ...cached, error: null };
  } catch { /* no cache yet */ }

  let refreshing = null;
  function refreshCatalog() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const next = { ...catalog, error: null };
      try {
        const res = await fetch(DOCS_URL, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`the models page answered ${res.status}`);
        next.models = parseModelsDoc(await res.text());
        next.source = 'docs';
        next.checkedAt = new Date().toISOString();
      } catch (e) {
        next.error = `Couldn't update the model list (${e.message}). Showing ${catalog.source === 'docs' ? 'the last saved list' : 'the built-in list'}.`;
      }
      const efforts = await readEffortsFromCli(claudeBin);
      if (efforts && efforts.length) next.efforts = efforts;
      catalog = next;
      if (!next.error) fs.writeFileSync(CACHE, JSON.stringify({ models: next.models, efforts: next.efforts, source: next.source, checkedAt: next.checkedAt }, null, 2));
      return catalog;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  function startAutoRefresh() {
    const stale = !catalog.checkedAt || Date.now() - new Date(catalog.checkedAt).getTime() > REFRESH_MS;
    if (stale) refreshCatalog().catch(() => {});
    else readEffortsFromCli(claudeBin).then((e) => { if (e && e.length) catalog = { ...catalog, efforts: e }; });
    setInterval(() => refreshCatalog().catch(() => {}), REFRESH_MS).unref();
  }

  const cleanEffort = (e) => (catalog.efforts.includes(e) ? e : '');

  // A model (full name or family alias) that is known not to take a reasoning level.
  function supportsEffort(model) {
    if (!model) return true;
    const byId = catalog.models.find((m) => m.id === model);
    if (byId) return byId.effort !== false;
    const latest = catalog.models.find((m) => m.current && m.family === String(model).toLowerCase());
    if (latest) return latest.effort !== false;
    return !/haiku/i.test(model);
  }

  const get = () => {
    try { return { ...DEFAULTS, quietHours: require('./reporting').quietHours(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { return { ...DEFAULTS, quietHours: require('./reporting').quietHours() }; }
  };

  const update = (input = {}) => {
    const s = get();
    for (const k of ['defaultModel', 'chiefModel']) if (input[k] !== undefined) s[k] = cleanModel(input[k]);
    for (const k of ['defaultEffort', 'chiefEffort']) if (input[k] !== undefined) s[k] = cleanEffort(input[k]);
    // The owner's own lasting instructions for the Chief (its Settings page), added to its built-in ones.
    if (input.chiefRules !== undefined) s.chiefRules = String(input.chiefRules || '').replace(/\r\n/g, '\n').trim().slice(0, 4000);
    if (input.chiefName !== undefined) s.chiefName = cleanChiefName(input.chiefName);
    // The library skills the owner gave the Chief, by name, as a bot's `skills` (the server keeps only library ones).
    if (input.chiefSkills !== undefined) {
      if (!Array.isArray(input.chiefSkills)) throw new Error('chiefSkills must be a list of skill names');
      s.chiefSkills = [...new Set(input.chiefSkills.map((x) => String(x).trim().toLowerCase()))].filter((x) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(x)).slice(0, 200);
    }
    // How many unasked messages a day the Chief may write after its looks (ADR 006): 0 = it never writes first.
    if (input.unaskedPerDay !== undefined) {
      if (!Number.isInteger(input.unaskedPerDay) || input.unaskedPerDay < 0 || input.unaskedPerDay > 3) throw new Error('unaskedPerDay must be 0, 1, 2 or 3');
      s.unaskedPerDay = input.unaskedPerDay;
    }
    if (input.quietHours !== undefined) s.quietHours = require('./reporting').quietHours(input.quietHours);
    // The owner's own times for the looks (#416): up to four "HH:MM" outside quiet hours; [] spreads them over the day.
    if (input.lookTimes !== undefined) s.lookTimes = require('./look').namedTimes(input.lookTimes, s.quietHours);
    // The checkup (ADR 023): on or off, its days and time, and whether it may search the web. Only what is passed changes.
    if (input.checkup !== undefined) s.checkup = require('./checkup').changed(s.checkup, input.checkup || {}, s.quietHours);
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
    fs.renameSync(tmp, FILE);
    return s;
  };

  // The types of the Chief's changes that the owner let through after the web for good (#280, asks.js
  // AFTER_WEB_TYPES): only the owner's "Always allow" on a card adds one; the Chief removes one when the owner asks.
  const afterWeb = () => { const t = get().chiefAfterWeb; return Array.isArray(t) ? t.filter((x) => typeof x === 'string') : []; };
  const setAfterWeb = (types) => {
    const s = { ...get(), chiefAfterWeb: [...new Set(types)] };
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(s, null, 2));
    fs.renameSync(FILE + '.tmp', FILE);
    return s.chiefAfterWeb;
  };

  // The model and reasoning level a run should use: its own setting, else the default.
  const pick = (model, effort) => {
    const s = get();
    const m = cleanModel(model) || s.defaultModel;
    let e = cleanEffort(effort) || s.defaultEffort;
    if (!supportsEffort(m)) e = '';
    return { model: m, effort: e };
  };

  // What the pickers show: "newest of each family" aliases (with what they point to today),
  // current models, then older ones that are still available.
  function choices() {
    const current = catalog.models.filter((m) => m.current);
    const models = [];
    for (const fam of CLI_ALIASES) {
      const now = current.find((m) => m.family === fam);
      if (!now) continue;
      const label = `${fam[0].toUpperCase()}${fam.slice(1)} (latest)`;
      models.push({ id: fam, label, group: 'Always the newest', note: `Currently ${now.name}. ${now.description ? now.description.replace(/\.?\s*$/, '.') : ''}`.trim(), price: now.price, effort: now.effort !== false });
    }
    for (const m of catalog.models) {
      models.push({
        id: m.id,
        label: m.name,
        group: m.current ? 'Current models' : 'Older models (still available)',
        note: [m.description ? m.description.replace(/\.?\s*$/, '.') : '', m.speed ? `Speed: ${m.speed.toLowerCase()}.` : ''].filter(Boolean).join(' '),
        price: m.price || null,
        effort: m.effort !== false,
      });
    }
    const efforts = catalog.efforts.map((id) => ({ id, label: EFFORT_TEXT[id]?.[0] || id, note: EFFORT_TEXT[id]?.[1] || '' }));
    return { models, efforts, catalog: { source: catalog.source, checkedAt: catalog.checkedAt, error: catalog.error } };
  }

  return {
    get,
    update,
    choices,
    refreshCatalog,
    startAutoRefresh,
    supportsEffort,
    cleanEffort,
    forBot: (bot) => pick(bot.model, bot.effort),
    afterWeb,
    allowAfterWeb: (type) => setAfterWeb([...afterWeb(), type]),
    removeAfterWeb: (type) => setAfterWeb(afterWeb().filter((t) => t !== type)),
    // The name the owner gave the Chief, or the role's own.
    chiefName: () => get().chiefName || CHIEF_NAME,
    forChief: () => { const s = get(); return pick(s.chiefModel, s.chiefEffort); },
    // CLI flags for a resolved choice ('' = leave it to Claude Code).
    args: ({ model, effort }) => [...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : [])],
  };
}

module.exports = { create, cleanModel, parseModelsDoc, cleanChiefName, CHIEF_NAME };
