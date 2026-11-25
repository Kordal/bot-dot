// App-wide settings (data/settings.json): the default model and reasoning level for bots, and the
// Chief of Staff's own choice. A bot's own model/effort, when set, overrides the default.
//
// The model list isn't hard-coded: it's read from Anthropic's models overview page (refreshed at
// start-up and daily, cached in data/models-cache.json), and the reasoning levels from `claude --help`.
// The built-in lists below are only a fallback for when neither can be read.
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { tr } = require('./i18n');

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

// Plain-language labels and hints, in the language the pickers are drawn in (ADR 108); unknown levels (new ones)
// still show, with their own name.
const effortText = (lang) => ({
  low: [tr(lang, 'Low'), tr(lang, 'Quick and cheap. Fine for simple, routine jobs.')],
  medium: [tr(lang, 'Medium'), tr(lang, 'A balance of speed and care.')],
  high: [tr(lang, 'High'), tr(lang, 'Careful. A good choice for most bots.')],
  xhigh: [tr(lang, 'Extra high'), tr(lang, 'Thorough. Good for coding and long, multi-step tasks.')],
  max: [tr(lang, 'Max'), tr(lang, 'Deepest thinking, when getting it right matters more than cost or speed.')],
});

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
const providers = require('./llm-providers');
const cleanModel = (m) => {
  const id = String(m ?? '').trim();
  return (id.startsWith('provider:') ? providers.readModelId(id) : MODEL_RE.test(id)) ? id : '';
};

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

// Whether the Claude subscription is positively signed out, asked of the program itself and only at that start. A
// check that fails, cannot be read or has no Claude Code to ask is not "signed out" (lib/setup.js signedIn).
function subscriptionSignedOut(claudeBin) {
  if (!claudeBin) return false;
  let out;
  try { out = execFileSync(claudeBin, ['auth', 'status', '--json'], { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { out = e.stdout; }
  try { return JSON.parse(String(out)).loggedIn === false; } catch { return false; }
}

// ---------- the store ----------

function create(dataDir, { claudeBin } = {}) {
  const claudeKey = require('./claude-key').create(dataDir);
  const FILE = path.join(dataDir, 'settings.json');
  const CACHE = path.join(dataDir, 'models-cache.json');
  const DEFAULTS = { defaultModel: '', defaultEffort: '', chiefModel: '', chiefEffort: '', chiefRules: '', chiefName: '', chiefSkills: [], unaskedPerDay: 8, care: true, careQuiet: [], boatSize: 'default', computerPlace: '', language: 'en', proxy: '', advanced: false };

  // An account saved while it ran on one provider (ADR 255, before ADR 267): that provider's model becomes the account
  // default, unless the default already is a model of it, and the bots that had none keep running on it. A Claude name
  // the account default had was turned into that provider's models then (Haiku into its small one).
  // When the account's Claude connection can't run either (the subscription is signed out and no key is in use), the
  // Chief's model and each bot's own Claude name were turned the same way, and on Claude they would fail now: they are
  // translated once, the same way (a Haiku name into the small model, any other Claude name into the big one). Claude
  // able to run, or a check that could not tell, leaves them as they are.
  try {
    const was = claudeKey.takeLegacy();
    if (was) {
      let now = {};
      try { now = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* no settings yet */ }
      const to = (id) => providers.modelId(was.preset, /haiku/i.test(id || '') ? was.small : was.big);
      const claudeName = (id) => typeof id === 'string' && id !== '' && !providers.readModelId(id);
      const claudeCannotRun = claudeKey.runKey() === null && subscriptionSignedOut(claudeBin);
      const next = { ...now };
      if (providers.readModelId(now.defaultModel || '')?.preset !== was.preset) next.defaultModel = to(now.defaultModel);
      if (claudeCannotRun && claudeName(now.chiefModel)) next.chiefModel = to(now.chiefModel);
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(next, null, 2));
      fs.renameSync(`${FILE}.tmp`, FILE);
      if (claudeCannotRun) {
        // Each bot's own model is in bots.json; it is read by lib/bots.js only after this runs.
        const BOTS = path.join(dataDir, 'bots.json');
        let bots = null;
        try { bots = JSON.parse(fs.readFileSync(BOTS, 'utf8')); } catch { /* no bots yet */ }
        if (Array.isArray(bots) && bots.some((b) => claudeName(b?.model))) {
          fs.writeFileSync(`${BOTS}.tmp`, JSON.stringify(bots.map((b) => (claudeName(b?.model) ? { ...b, model: to(b.model) } : b)), null, 2));
          fs.renameSync(`${BOTS}.tmp`, BOTS);
        }
      }
    }
  } catch (e) { console.error(`[settings] couldn't move the account's provider to its default model: ${e.message}`); }

  // Advanced (ADR 200): an account that had settings before the switch existed keeps seeing what it saw, so it
  // starts on; a new account starts off.
  try {
    const was = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (was && typeof was === 'object' && !('advanced' in was)) { fs.writeFileSync(FILE + '.tmp', JSON.stringify({ ...was, advanced: true }, null, 2)); fs.renameSync(FILE + '.tmp', FILE); }
  } catch { /* no settings yet: a new account */ }

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

  // Every level any connected provider's model takes joins Claude's own, so a saved level stays valid.
  function cleanEffort(e) {
    if (catalog.efforts.includes(e)) return e;
    const all = claudeKey.allProviderModels();
    return all.some((provider) => providers.modelNames(provider).some((model) => providers.effortsFor(provider, model).includes(e))) ? e : '';
  }

  // A model (full name or family alias, or a provider's `provider:<preset>:<model>`) that is known not to take a reasoning level.
  function supportsEffort(model) {
    const route = claudeKey.routeFor(model);
    if (route) return providers.effortsFor(route.provider, route.model).length > 0;
    if (!model || providers.readModelId(model)) return true;
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
      if (!Number.isInteger(input.unaskedPerDay) || input.unaskedPerDay < 0 || input.unaskedPerDay > 10) throw new Error('unaskedPerDay must be a whole number from 0 to 10');
      s.unaskedPerDay = input.unaskedPerDay;
    }
    // Whether the Chief worries a little about the owner (ADR 212), and the kinds of it they silenced.
    if (input.care !== undefined) {
      if (typeof input.care !== 'boolean') throw new Error('care must be true or false');
      s.care = input.care;
    }
    if (input.careQuiet !== undefined) {
      const kinds = require('./care').KINDS;
      if (!Array.isArray(input.careQuiet) || input.careQuiet.some((k) => !kinds.includes(k))) throw new Error(`careQuiet must be a list of ${kinds.join(', ')}`);
      s.careQuiet = [...new Set(input.careQuiet)];
    }
    // The size of the account's boat.dev machines (#539): one of boat.dev's sizes.
    if (input.boatSize !== undefined) {
      if (!require('./boat').SIZE_IDS.includes(input.boatSize)) throw new Error(`boatSize must be one of ${require('./boat').SIZE_IDS.join(', ')}`);
      s.boatSize = input.boatSize;
    }
    // Where every bot of the account with a computer has it (#579, ADR 098): this machine or boat.dev. '' = not chosen
    // yet, which lib/bots.js reads from where the bots' computers are.
    if (input.computerPlace !== undefined) {
      if (!['linux', 'boat'].includes(input.computerPlace)) throw new Error('computerPlace must be linux or boat');
      s.computerPlace = input.computerPlace;
    }
    // The interface's language (#645, ADR 108): the apps' words and the server's sentences to the owner.
    if (input.language !== undefined) {
      if (!require('./i18n').LANGUAGES.includes(input.language)) throw new Error(`language must be one of ${require('./i18n').LANGUAGES.join(', ')}`);
      s.language = input.language;
    }
    // The account's proxy (ADR 171): a saved proxy's id, '' for none (lib/routes/proxies.js checks that it is one).
    if (input.proxy !== undefined) { const ref = require('./proxies').cleanRef(input.proxy); s.proxy = ref === 'none' ? '' : ref; }
    // "Advanced" (ADR 192): shows what only a technical owner needs, first the token usage. Off for a new account.
    if (input.advanced !== undefined) {
      if (typeof input.advanced !== 'boolean') throw new Error('advanced must be true or false');
      s.advanced = input.advanced;
    }
    if (input.quietHours !== undefined) s.quietHours = require('./reporting').quietHours(input.quietHours);
    // The owner's own times for the looks (#416): up to four "HH:MM" outside quiet hours; [] spreads them over the day.
    if (input.lookTimes !== undefined) s.lookTimes = require('./look').namedTimes(input.lookTimes, s.quietHours);
    // The checkup (ADR 023): its days and time. Only what is passed changes.
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

  // The model and reasoning level a run should use: its own setting, else the default. A model of a provider that is
  // not saved (any more), or that has no such model, is unknown: the default is used, and when that is unknown too,
  // Claude's own choice. The model decides which connection the run goes on (claude-key.js routeFor).
  const pick = (model, effort) => {
    const s = get();
    const known = (id) => !providers.readModelId(id) || !!claudeKey.routeFor(id);
    const m = [cleanModel(model), s.defaultModel].find((id) => id && known(id)) || '';
    const route = claudeKey.routeFor(m);
    if (route) {
      const levels = providers.effortsFor(route.provider, route.model);
      return { model: m, effort: [effort, s.defaultEffort].find((level) => levels.includes(level)) || '' };
    }
    let e = cleanEffort(effort) || s.defaultEffort;
    if (!supportsEffort(m)) e = '';
    return { model: m, effort: e };
  };

  // A short call that asks for a small Claude model (the group router, the notes, an error explained, a memory
  // review): it goes to the provider of the account default model, which answers with its helper model for Haiku and
  // its main one for the rest, as ADR 255 turned Claude's names. With a Claude default it goes as asked.
  const forHelper = ({ model = '', effort = '' } = {}) => {
    if (!model || providers.readModelId(model)) return pick(model, effort);
    const route = claudeKey.routeFor(get().defaultModel);
    if (!route) return { model, effort: cleanEffort(effort) && supportsEffort(model) ? effort : '' };
    const name = /haiku/i.test(model) ? route.provider.small : route.provider.big;
    const id = providers.modelId(route.provider.preset, name);
    const levels = providers.effortsFor(route.provider, name);
    return { model: id, effort: levels.includes(effort) ? effort : '' };
  };

  // The provider as a list of choices: its models, each in its own group.
  const providerChoices = (provider) => {
    const labels = new Map(provider.catalog?.models.map((model) => [model.id, model.label]));
    const id = (model) => providers.modelId(provider.preset, model);
    return providers.modelNames(provider).map((name) => {
      const efforts = providers.effortsFor(provider, name);
      return { id: id(name), label: labels.get(name) || name, group: provider.name, provider: provider.preset, effort: efforts.length > 0, efforts };
    });
  };

  // What the pickers show: Claude's models ("newest of each family" aliases with what they point to today, current
  // models, then older ones still available), then each connected provider's, in a group of its own by its name.
  // lang: the language of the words around the models' own names and descriptions, which stay as their makers write them.
  function choices(lang = 'en') {
    const claude = claudeChoices(lang);
    const connected = claudeKey.allProviderModels();
    if (!connected.length) return claude;
    const words = effortText(lang);
    const models = [...claude.models, ...connected.flatMap(providerChoices)];
    const seen = new Set(claude.efforts.map((level) => level.id));
    const extra = FALLBACK_EFFORTS.filter((level) => !seen.has(level) && models.some((model) => model.efforts?.includes(level)));
    const unavailable = connected.find((provider) => provider.catalog?.limited);
    // `provider` is the account default's provider, for the apps that knew one provider at a time (ADR 255).
    const route = claudeKey.routeFor(get().defaultModel);
    const main = route && connected.find((provider) => provider.preset === route.provider.preset);
    return {
      ...(main ? { provider: { name: main.name, main: providers.modelId(main.preset, main.big), helper: providers.modelId(main.preset, main.small), refreshable: providers.discoversEfforts(main.preset) } } : {}),
      providers: connected.map((provider) => ({ preset: provider.preset, name: provider.name, refreshable: providers.discoversEfforts(provider.preset) })),
      models,
      efforts: [...claude.efforts, ...extra.map((level) => ({ id: level, label: words[level][0], note: '' }))],
      catalog: { ...claude.catalog, error: claude.catalog.error || (unavailable ? tr(lang, 'Model list unavailable. Showing known models.') : null) },
    };
  }

  // What a resolved choice (forBot, forChief, forHelper) runs on, in words for the owner: the model's name as the
  // pickers show it, the connection it goes on (the Claude subscription, an Anthropic API key, or a provider's name) and
  // the reasoning level that is sent. Never a key, an address or a price. `saved` is the model the bot, the Chief or the
  // account asked for: when it is not the one that runs (its provider was removed), the answer says what it runs on
  // instead: the account default, or Claude Code's own choice when the default's provider is gone too.
  function describer(lang = 'en') {
    const models = choices(lang).models;
    const claude = claudeKey.runKey() ? 'Anthropic API key' : 'Claude subscription';
    return ({ model, effort }, { saved = '' } = {}) => {
      const route = claudeKey.routeFor(model);
      const named = (id) => models.find((m) => m.id === id)?.label || providers.readModelId(id)?.model || id;
      return {
        model: model ? named(model) : "Claude Code's own choice",
        provider: route ? route.provider.name : claude,
        reasoning: effort || "the model's own",
        ...(saved && saved !== model ? { note: `It asked for ${named(saved)}, which is not available any more (its provider was removed), so it runs on ${model ? `the account default, ${named(model)}` : "Claude Code's own choice"}.` } : {}),
      };
    };
  }

  function claudeChoices(lang) {
    const anthropic = claudeKey.activeAnthropicCatalog();
    if (anthropic?.models && (!anthropic.limited || anthropic.models.length)) {
      const words = effortText(lang);
      return {
        models: anthropic.models.map((model) => ({
          ...model, group: 'Anthropic',
          effort: supportsEffort(model.id),
        })),
        efforts: catalog.efforts.map((id) => ({ id, label: words[id]?.[0] || id, note: words[id]?.[1] || '' })),
        catalog: { source: 'anthropic-key', checkedAt: anthropic.checkedAt,
          error: anthropic.limited ? tr(lang, 'Model list unavailable. Showing known models.') : null },
      };
    }
    const current = catalog.models.filter((m) => m.current);
    const models = [];
    for (const fam of CLI_ALIASES) {
      const now = current.find((m) => m.family === fam);
      if (!now) continue;
      const label = tr(lang, '{family} (latest)', { family: `${fam[0].toUpperCase()}${fam.slice(1)}` });
      models.push({ id: fam, label, group: tr(lang, 'Always the newest'), note: `${tr(lang, 'Currently {model}.', { model: now.name })} ${now.description ? now.description.replace(/\.?\s*$/, '.') : ''}`.trim(), price: now.price, effort: now.effort !== false });
    }
    for (const m of catalog.models) {
      models.push({
        id: m.id,
        label: m.name,
        group: m.current ? tr(lang, 'Current models') : tr(lang, 'Older models (still available)'),
        note: [m.description ? m.description.replace(/\.?\s*$/, '.') : '', m.speed ? tr(lang, 'Speed: {speed}.', { speed: m.speed.toLowerCase() }) : ''].filter(Boolean).join(' '),
        price: m.price || null,
        effort: m.effort !== false,
      });
    }
    const words = effortText(lang);
    const efforts = catalog.efforts.map((id) => ({ id, label: words[id]?.[0] || id, note: words[id]?.[1] || '' }));
    return { models, efforts, catalog: {
      source: anthropic ? 'anthropic-key' : catalog.source,
      checkedAt: anthropic ? anthropic.checkedAt || null : catalog.checkedAt,
      error: anthropic?.limited ? tr(lang, 'Model list unavailable. Showing known models.') : catalog.error,
    } };
  }

  return {
    get,
    update,
    choices,
    describer,
    refreshCatalog,
    // Claude's models and every connected provider's, at once: one that fails leaves the others' lists as they were.
    async refreshModelCatalog() {
      await Promise.all([claudeKey.refreshProviderCatalogs(), claudeKey.refreshProviderEfforts().catch(() => false), claudeKey.refreshAnthropicCatalog() || refreshCatalog()]);
    },
    async refreshChoices() {
      const refreshed = await claudeKey.refreshProviderEfforts();
      if (refreshed === null) await refreshCatalog();
      return refreshed !== false;
    },
    startAutoRefresh,
    supportsEffort,
    cleanEffort,
    forBot: (bot) => pick(bot.model, bot.effort),
    // Which connection a resolved model runs on: 'claude' (the subscription or the Anthropic API key) or a saved provider's
    // preset (ADR 267, #1668). A short helper call goes where the account default goes.
    connectionOf: (model) => claudeKey.routeFor(model)?.provider.preset || 'claude',
    helperConnection: () => claudeKey.routeFor(get().defaultModel)?.provider.preset || 'claude',
    connectionName: (connection) => (connection === 'claude' ? 'Claude' : claudeKey.providerModels(connection)?.name || connection),
    forHelper,
    afterWeb,
    allowAfterWeb: (type) => setAfterWeb([...afterWeb(), type]),
    removeAfterWeb: (type) => setAfterWeb(afterWeb().filter((t) => t !== type)),
    // The name the owner gave the Chief, or the role's own.
    chiefName: () => get().chiefName || CHIEF_NAME,
    forChief: () => { const s = get(); return pick(s.chiefModel, s.chiefEffort); },
    // CLI flags for a resolved choice ('' = leave it to Claude Code). A provider's model goes by its own name, with
    // the level only when that model takes it; any other is Claude's.
    args: ({ model, effort }) => {
      const route = claudeKey.routeFor(model);
      if (route) return ['--model', route.model, ...(providers.effortsFor(route.provider, route.model).includes(effort) ? ['--effort', effort] : [])];
      return [...(model && !providers.readModelId(model) ? ['--model', model] : []), ...(effort ? ['--effort', effort] : [])];
    },
  };
}

module.exports = { create, cleanModel, parseModelsDoc, cleanChiefName, CHIEF_NAME };
