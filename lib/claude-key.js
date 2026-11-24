// An Anthropic API key, which Claude Code can run on instead of a Claude subscription (#35). Kept in
// data/claude-key.json, encrypted with the Vault's key as the Composio key is (lib/connectors.js), with which of
// the two runs use: `use` is 'api-key' or 'subscription'. Saving a key picks it. The key is never answered whole
// (only its last four, `hint`) and never logged; it reaches a run or a Chief turn only as ANTHROPIC_API_KEY, the
// variable Claude Code reads, and only while the owner picked it (lib/identity.js runAs).
// Beside the Claude connection the account keeps any number of model providers (ADR 255, ADR 267, lib/llm-providers.js),
// at most one per preset: each its address, its key (encrypted the same way) and the models bots run on there. Which
// connection a run goes on is the run's model's to say (routeFor): `provider:<preset>:<model>` goes to that saved
// provider, anything else to the Claude connection. The subscription is never sent to a provider, a provider's key
// never to Anthropic or to another provider.
const fs = require('fs');
const path = require('path');
const { encrypt, decrypt } = require('./vault');
const providers = require('./llm-providers');

const API = () => process.env.BOT_DOT_ANTHROPIC_API_URL || 'https://api.anthropic.com'; // a stand-in only in tests
const KEY_RE = /^sk-ant-[A-Za-z0-9_-]{20,300}$/;
const USES = ['api-key', 'subscription'];

function create(dataDir) {
  const FILE = path.join(dataDir, 'claude-key.json');
  // The file as it was saved before the providers were several (ADR 255): one `provider`, and `use: 'provider'` when
  // it was the one the account ran on. Read as the saved providers' map, with `legacy` the preset that was running; a
  // save writes the new shape (`providers`, and `use` only the Claude connection's).
  const normalize = (raw) => {
    const { provider, ...d } = raw && typeof raw === 'object' ? raw : {};
    const saved = { ...(d.providers && typeof d.providers === 'object' ? d.providers : {}) };
    if (provider?.url && provider.preset && !saved[provider.preset]) saved[provider.preset] = provider;
    const legacy = d.use === 'provider' && provider?.url ? provider.preset : null;
    return { ...d, providers: saved, use: d.use === 'provider' ? 'subscription' : d.use, ...(legacy ? { legacy } : {}) };
  };
  const load = () => { try { return normalize(JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch { return normalize({}); } };
  const save = (d) => {
    const { legacy: _legacy, ...kept } = d;
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(kept, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  };

  const savedProviders = (d) => Object.values(d.providers).filter((p) => p && p.url);

  // The provider as a run needs it: { preset, name, url, key, big, small, reasoning, catalog }, or null for one whose
  // key cannot be read (the Vault's key changed): a run of its models then goes as a Claude one does.
  const open = (p) => {
    try { return { preset: p.preset, name: p.name, url: p.url, key: p.key ? decrypt(p.key) : '', big: p.big, small: p.small, reasoning: p.reasoning, catalog: p.catalog }; } catch { return null; }
  };
  const providerFor = (preset, d = load()) => {
    const p = d.providers[preset];
    return p && p.url ? open(p) : null;
  };
  const modelsOf = (p) => (p ? { preset: p.preset, name: p.name, big: p.big, small: p.small, reasoning: p.reasoning, catalog: p.catalog } : null);

  // A run's model → the connection it goes on: { provider, model } for `provider:<preset>:<model>` of a saved provider
  // whose model it has, null for any other (a Claude name or alias, none, a model of a provider that is gone): the
  // Claude connection. Settings turns the model into arguments and identity into the environment from this one answer.
  function routeFor(modelId, d = load()) {
    const chosen = providers.readModelId(String(modelId || ''));
    if (!chosen) return null;
    const p = providerFor(chosen.preset, d);
    return p && providers.modelNames(p).includes(chosen.model) ? { provider: p, model: chosen.model } : null;
  }

  // The models of each saved provider (never its key or address), the provider's name first when sorted for a list.
  function allProviderModels(d = load()) {
    return savedProviders(d).map(open).map(modelsOf).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }
  const providerModels = (preset) => modelsOf(providerFor(preset));

  const shown = (p) => ({ preset: p.preset, name: p.name || p.preset, key: p.key ? p.hint || null : null, big: p.big, small: p.small, ...(providers.PRESETS.find((preset) => preset.id === p.preset)?.askUrl ? { url: p.url } : {}) });

  // { using, connection, apiKey, provider, providers }: `using` and `provider` say what the account default model runs on, as
  // the apps that knew one provider read them ('provider' and its connection, else which of the two Claude connections),
  // `connection` which of those two the Claude models run on ('api-key' or 'subscription'),
  // `apiKey` the saved key's last four ("…wxyz") or null, `providers` every saved provider ({ preset, name, key: last
  // four or null, big, small }). Never a key whole.
  function status({ defaultModel = '' } = {}) {
    const d = load();
    const route = routeFor(defaultModel, d);
    return {
      using: route ? 'provider' : d.key && d.use === 'api-key' ? 'api-key' : 'subscription',
      connection: d.key && d.use === 'api-key' ? 'api-key' : 'subscription',
      apiKey: d.key ? d.hint || null : null,
      provider: route ? shown(d.providers[route.provider.preset]) : null,
      providers: savedProviders(d).map(shown),
    };
  }

  // The key for a run on the Claude connection: only while the owner picked it. Null otherwise, and for a key that
  // cannot be read (the Vault's key changed): the run then goes as it would on the subscription.
  function runKey(d = load()) {
    if (!d.key || d.use !== 'api-key') return null;
    try { return decrypt(d.key); } catch { return null; }
  }

  // What the Claude connection goes on, as one string that changes when it does (never logged or answered): the API
  // key, or null on the subscription. A provider saved or removed does not change it: it is no run's on Claude.
  function credential() {
    const k = runKey();
    return k ? `api-key:${k}` : null;
  }

  // Asked of Anthropic before it is kept, as the Composio key is: a list of one model costs nothing.
  async function check(key) {
    let res;
    try {
      res = await fetch(`${API()}/v1/models?limit=1`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new Error("Couldn't reach Anthropic to check the key. Check the server's connection and try again.");
    }
    if (res.status === 401 || res.status === 403) throw new Error('Anthropic refused this API key. Check that you copied all of it.');
    if (!res.ok) throw new Error(`Anthropic couldn't check the key just now (it answered ${res.status}). Try again in a little while.`);
  }

  async function saveKey(input) {
    const key = String(input || '').trim();
    if (!KEY_RE.test(key)) throw new Error("That isn't an Anthropic API key: it starts with sk-ant-. Copy it from the Claude Console (console.anthropic.com → API keys).");
    await check(key);
    const { anthropicCatalog: _oldCatalog, ...stored } = load();
    save({ ...stored, key: encrypt(key), hint: `…${key.slice(-4)}`, use: 'api-key', savedAt: new Date().toISOString() });
    return status();
  }

  // A stored key can be reused only for the same preset and exact provider address.
  function providerInput(input, saved = load().providers[input?.preset]) {
    if (input?.reuseKey !== true) return input;
    if (String(input.key || '').trim()) return { ...input, reuseKey: false };
    const preset = providers.PRESETS.find((entry) => entry.id === input.preset);
    const url = preset && providers.cleanUrl(preset.askUrl ? input.url || saved?.url : preset.url);
    if (!saved?.key || !url || saved.preset !== input.preset || saved.url !== url) {
      throw new Error('Enter the API key for this provider.');
    }
    let key;
    try { key = decrypt(saved.key); } catch { throw new Error('Enter the API key for this provider.'); }
    return { ...input, key, url };
  }

  function providerCatalog(input) {
    const saved = load().providers[input?.preset];
    return providers.catalog(providerInput(input, saved), saved).then((found) => ({ ...found, models: found.models.map(({ id, label }) => ({ id, label })) }));
  }

  // Check each distinct model before the provider is kept. It is kept beside the others and picks nothing: a model
  // of it is chosen in Settings (ADR 267).
  async function saveProvider(input, { fetchImpl } = {}) {
    const p = providers.clean(providerInput(input));
    await providers.check(p, { fetchImpl });
    const reasoning = await providers.discoverEfforts(p, { fetchImpl });
    const { key, ...rest } = p;
    const d = load();
    save({ ...d, providers: { ...d.providers, [p.preset]: { ...rest, ...(reasoning?.length ? { reasoning } : {}), ...(key ? { key: encrypt(key), hint: `…${key.slice(-4)}` } : {}), savedAt: new Date().toISOString() } } });
    return status();
  }

  const catalogRefreshes = new Map(); // preset → { savedAt, promise }
  function refreshProviderCatalog(preset) {
    const before = load();
    const p = providerFor(preset, before);
    if (!p) return null;
    const savedAt = before.providers[preset].savedAt;
    const running = catalogRefreshes.get(preset);
    if (running?.savedAt === savedAt) return running.promise;
    // Coalesce open Model rows for the same credential, and discard a reply after a provider change.
    const promise = (async () => {
      const found = await providers.catalog({ ...p, reuseKey: true }, before.providers[preset]);
      const current = load();
      const now = current.providers[preset];
      if (!now || now.savedAt !== savedAt || now.url !== p.url) return;
      const kept = new Map((now.catalog?.models || []).map((model) => [model.id, model]));
      const models = new Map(found.limited ? kept : []);
      // A model the catalog lists without its levels (a saved choice kept through an outage) keeps the levels it had.
      for (const model of found.models) {
        const had = kept.get(model.id)?.efforts;
        models.set(model.id, model.efforts || !had ? model : { ...model, efforts: had });
      }
      const catalog = { models: [...models.values()], checkedAt: new Date().toISOString(), limited: found.limited };
      save({ ...current, providers: { ...current.providers, [preset]: { ...now, catalog } } });
    })().finally(() => { if (catalogRefreshes.get(preset)?.promise === promise) catalogRefreshes.delete(preset); });
    catalogRefreshes.set(preset, { savedAt, promise });
    return promise;
  }
  // Every saved provider's catalog, or null when none is saved. One that fails does not stop the others.
  function refreshProviderCatalogs() {
    const presets = savedProviders(load()).map((p) => p.preset);
    if (!presets.length) return null;
    return Promise.all(presets.map((preset) => Promise.resolve(refreshProviderCatalog(preset)).catch(() => {})));
  }

  function activeAnthropicCatalog() {
    const d = load();
    return runKey(d) ? d.anthropicCatalog || {} : null;
  }

  function refreshAnthropicCatalog() {
    const before = load();
    const key = runKey(before);
    if (!key) return null;
    return (async () => {
      const found = await providers.anthropicCatalog(API(), key);
      const current = load();
      if (current.use !== 'api-key' || current.savedAt !== before.savedAt || !current.key) return;
      const models = new Map((found.limited ? current.anthropicCatalog?.models || [] : []).map((model) => [model.id, model]));
      for (const model of found.models) models.set(model.id, model);
      save({ ...current, anthropicCatalog: { models: [...models.values()], checkedAt: new Date().toISOString(), limited: found.limited } });
    })();
  }

  // The reasoning levels of every saved provider that tells them: null when none does, false when one could not be
  // read (what was known stays), true when all were.
  async function refreshProviderEfforts() {
    const targets = savedProviders(load()).filter((p) => providers.discoversEfforts(p.preset)).map((p) => p.preset);
    if (!targets.length) return null;
    const results = await Promise.all(targets.map(async (preset) => {
      const before = providerFor(preset);
      if (!before) return true;
      const savedAt = load().providers[preset]?.savedAt;
      const reasoning = await providers.discoverEfforts(before);
      if (!reasoning) return false;
      const current = load();
      // A provider saved while the request was pending owns its own reasoning information.
      const now = current.providers[preset];
      if (now && now.savedAt === savedAt && now.url === before.url) save({ ...current, providers: { ...current.providers, [preset]: { ...now, reasoning } } });
      return true;
    }));
    return results.every(Boolean);
  }

  // The Claude connection: the subscription or the API key. A provider is never "used": its models are picked.
  function use(which) {
    if (!USES.includes(which)) throw new Error('Choose "api-key" or "subscription". A provider\'s models are picked in Settings → Model.');
    const d = load();
    if (which === 'api-key' && !d.key) throw new Error('Save an Anthropic API key first.');
    save({ ...d, use: which });
    return status();
  }

  function removeKey() {
    const { key, hint, savedAt, anthropicCatalog: _oldCatalog, ...rest } = load();
    save({ ...rest, use: 'subscription' });
    return status();
  }

  // A model of it then runs as an unknown one does: on what the account default runs on (lib/settings.js pick).
  function removeProvider(preset) {
    const d = load();
    const { [preset]: _gone, ...left } = d.providers;
    save({ ...d, providers: left });
    return status();
  }

  // The account as it was saved before the providers were several (ADR 255): the preset it ran on, once, and the
  // file is written in the new shape. null for an account that was not on a provider. lib/settings.js asks it at
  // start and makes that provider's model the account default.
  function takeLegacy() {
    const d = load();
    let raw;
    try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; }
    if (!raw || typeof raw !== 'object' || !('provider' in raw)) return null;
    save(d);
    const p = d.legacy ? d.providers[d.legacy] : null;
    return p ? { preset: p.preset, big: p.big, small: p.small } : null;
  }

  return { status, runKey, providerFor, routeFor, providerModels, allProviderModels, credential, saveKey, saveProvider, providerCatalog, refreshProviderCatalog, refreshProviderCatalogs, activeAnthropicCatalog, refreshAnthropicCatalog, refreshProviderEfforts, use, removeKey, removeProvider, takeLegacy };
}

module.exports = { create };
