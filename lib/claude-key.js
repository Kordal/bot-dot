// An Anthropic API key, which Claude Code can run on instead of a Claude subscription (#35). Kept in
// data/claude-key.json, encrypted with the Vault's key as the Composio key is (lib/connectors.js), with which of
// the two runs use: `use` is 'api-key' or 'subscription'. Saving a key picks it. The key is never answered whole
// (only its last four, `hint`) and never logged; it reaches a run or a Chief turn only as ANTHROPIC_API_KEY, the
// variable Claude Code reads, and only while the owner picked it (lib/identity.js runAs).
// A third choice is another model provider (ADR 255, lib/llm-providers.js): its address, its key (encrypted the same
// way), and the models bots run on there. `use` is then 'provider'. The subscription is never sent to it.
const fs = require('fs');
const path = require('path');
const { encrypt, decrypt } = require('./vault');
const providers = require('./llm-providers');

const API = () => process.env.BOT_DOT_ANTHROPIC_API_URL || 'https://api.anthropic.com'; // a stand-in only in tests
const KEY_RE = /^sk-ant-[A-Za-z0-9_-]{20,300}$/;
const USES = ['api-key', 'subscription', 'provider'];

function create(dataDir) {
  const FILE = path.join(dataDir, 'claude-key.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
  const save = (d) => {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  };

  const onProvider = (d) => d.use === 'provider' && d.provider && d.provider.url;

  // { using, apiKey, provider }: which one runs use, the saved key's last four ("…wxyz"), or null, and the saved
  // provider ({ preset, name, key: last four or null, big, small }), or null. Never a key whole.
  function status() {
    const d = load();
    const p = d.provider;
    return {
      using: onProvider(d) ? 'provider' : d.key && d.use === 'api-key' ? 'api-key' : 'subscription',
      apiKey: d.key ? d.hint || null : null,
      provider: p && p.url ? { preset: p.preset, name: p.name || p.preset, key: p.key ? p.hint || null : null, big: p.big, small: p.small } : null,
    };
  }

  // The key for a run: only while the owner picked it. Null otherwise, and for a key that cannot be read (the
  // Vault's key changed): the run then goes as it would on the subscription.
  function runKey() {
    const d = load();
    if (!d.key || d.use !== 'api-key') return null;
    try { return decrypt(d.key); } catch { return null; }
  }

  // The provider for a run: only while the owner picked it. { url, key, big, small }, or null (also for a key that
  // cannot be read: the run then goes as it would on the subscription).
  function runProvider() {
    const d = load();
    if (!onProvider(d)) return null;
    const p = d.provider;
    try { return { preset: p.preset, name: p.name, url: p.url, key: p.key ? decrypt(p.key) : '', big: p.big, small: p.small, reasoning: p.reasoning }; } catch { return null; }
  }

  // The provider's models: what a run's model is turned into.
  function providerModels() {
    const p = runProvider(); // null too for a key that cannot be read: the run then goes as on the subscription, with Claude's names
    return p ? { preset: p.preset, name: p.name, big: p.big, small: p.small, reasoning: p.reasoning } : null;
  }

  // What the runs now go on, as one string that changes when it does (never logged or answered): a key, a provider's
  // address, key and models, or null on the subscription.
  function credential() {
    const k = runKey();
    if (k) return `api-key:${k}`;
    const p = runProvider();
    return p ? `provider:${p.url}:${p.key}:${p.big}:${p.small}` : null;
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
    save({ ...load(), key: encrypt(key), hint: `…${key.slice(-4)}`, use: 'api-key', savedAt: new Date().toISOString() });
    return status();
  }

  // Checked with the provider (a short real request) before it is kept, and picked.
  async function saveProvider(input, { fetchImpl } = {}) {
    const p = providers.clean(input);
    await providers.check(p, { fetchImpl });
    const reasoning = await providers.discoverEfforts(p, { fetchImpl });
    const { key, ...rest } = p;
    save({ ...load(), provider: { ...rest, ...(reasoning?.length ? { reasoning } : {}), ...(key ? { key: encrypt(key), hint: `…${key.slice(-4)}` } : {}), savedAt: new Date().toISOString() }, use: 'provider' });
    return status();
  }

  async function refreshProviderEfforts() {
    const before = load();
    if (!onProvider(before) || !providers.discoversEfforts(before.provider.preset)) return null;
    const reasoning = await providers.discoverEfforts(before.provider);
    if (!reasoning) return false;
    const current = load();
    // A provider saved while the request was pending owns its own reasoning information.
    if (current.provider && current.provider.savedAt === before.provider.savedAt && current.provider.url === before.provider.url) {
      save({ ...current, provider: { ...current.provider, reasoning } });
    }
    return true;
  }

  function use(which) {
    if (!USES.includes(which)) throw new Error('Choose "api-key", "provider" or "subscription".');
    const d = load();
    if (which === 'api-key' && !d.key) throw new Error('Save an Anthropic API key first.');
    if (which === 'provider' && !(d.provider && d.provider.url)) throw new Error('Save a provider first.');
    save({ ...d, use: which });
    return status();
  }

  function removeKey() {
    const { key, hint, savedAt, ...rest } = load();
    save({ ...rest, use: onProvider(rest) ? 'provider' : 'subscription' }); // the provider's own choice stays when its key was the unused one
    return status();
  }

  function removeProvider() {
    const { provider, ...rest } = load();
    save({ ...rest, use: rest.use === 'provider' ? 'subscription' : rest.use });
    return status();
  }

  return { status, runKey, runProvider, providerModels, credential, saveKey, saveProvider, refreshProviderEfforts, use, removeKey, removeProvider };
}

module.exports = { create };
