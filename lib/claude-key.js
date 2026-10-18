// An Anthropic API key, which Claude Code can run on instead of a Claude subscription (#35). Kept in
// data/claude-key.json, encrypted with the Vault's key as the Composio key is (lib/connectors.js), with which of
// the two runs use: `use` is 'api-key' or 'subscription'. Saving a key picks it. The key is never answered whole
// (only its last four, `hint`) and never logged; it reaches a run or a Chief turn only as ANTHROPIC_API_KEY, the
// variable Claude Code reads, and only while the owner picked it (lib/identity.js runAs).
const fs = require('fs');
const path = require('path');
const { encrypt, decrypt } = require('./vault');

const API = () => process.env.BOT_DOT_ANTHROPIC_API_URL || 'https://api.anthropic.com'; // a stand-in only in tests
const KEY_RE = /^sk-ant-[A-Za-z0-9_-]{20,300}$/;
const USES = ['api-key', 'subscription'];

function create(dataDir) {
  const FILE = path.join(dataDir, 'claude-key.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
  const save = (d) => {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  };

  // { using, apiKey }: which one runs use, and the saved key's last four ("…wxyz"), or null.
  function status() {
    const d = load();
    return { using: d.key && d.use === 'api-key' ? 'api-key' : 'subscription', apiKey: d.key ? d.hint || null : null };
  }

  // The key for a run: only while the owner picked it. Null otherwise, and for a key that cannot be read (the
  // Vault's key changed): the run then goes as it would on the subscription.
  function runKey() {
    const d = load();
    if (!d.key || d.use !== 'api-key') return null;
    try { return decrypt(d.key); } catch { return null; }
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

  function use(which) {
    if (!USES.includes(which)) throw new Error('Choose "api-key" or "subscription".');
    const d = load();
    if (which === 'api-key' && !d.key) throw new Error('Save an Anthropic API key first.');
    save({ ...d, use: which });
    return status();
  }

  function removeKey() {
    const { key, hint, savedAt, ...rest } = load();
    save({ ...rest, use: 'subscription' });
    return status();
  }

  return { status, runKey, saveKey, use, removeKey };
}

module.exports = { create };
