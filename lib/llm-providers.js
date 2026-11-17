// Other model providers Claude Code can run on instead of Anthropic (ADR 255): each speaks Anthropic's Messages API
// at its own address, so Claude Code stays the engine and only where it sends its requests changes. The presets are
// data the server hands out (GET /api/setup, `providers`); the apps draw them and hold none of their own. `big` is
// the model for everything a bot does, `small` the one for the short helper calls (what Claude Code names Haiku).
// An empty model is one the owner must name; `askUrl` one whose address the owner gives (its own is the suggestion). A subscription (Claude Pro or Max) never goes to any of these: it
// stays in Claude Code's own sign-in, which only Claude Code uses.
const PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com/anthropic', big: 'deepseek-v4-pro', small: 'deepseek-flash' },
  { id: 'glm', name: 'Z.ai GLM', url: 'https://api.z.ai/api/anthropic', big: 'glm-5.3', small: 'glm-5.3-flash' },
  { id: 'minimax', name: 'MiniMax', url: 'https://api.minimax.io/anthropic', big: 'MiniMax-M3', small: 'MiniMax-M3.1-Flash' },
  { id: 'opencode-go', name: 'OpenCode Go', url: 'https://opencode.ai/inference/go/anthropic', big: 'minimax-m3', small: 'qwen3.8-flash' },
  { id: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/api', big: '', small: '' },
  // On the owner's network (a machine's name or address, tailnet included): botdot's server runs in a container of its own, so no address of this machine is a given. No key.
  { id: 'ollama', name: 'Ollama', url: '', big: '', small: '', keyless: true, askUrl: true },
  { id: 'custom', name: 'Other', url: '', big: '', small: '', custom: true, askUrl: true },
];

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9.\-_:/[\]~@]{0,119}$/;
const KEY_RE = /^[\x21-\x7e]{6,500}$/; // printable, no spaces

const PRIVATE_HOST = /^(localhost|host\.docker\.internal|[a-z0-9-]+|[^.]+\.local|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+|\[::1\])$/i;

// The address as it is kept (no trailing slash), or an error in words. A key goes only over https, or over http to
// this machine or a private network, where the owner runs the model.
function cleanUrl(input) {
  let u;
  try { u = new URL(String(input || '').trim()); } catch { throw new Error("That isn't an address. It starts with https://."); }
  if (u.username || u.password || u.search || u.hash) throw new Error('The address has no password, query or fragment in it.');
  if (u.protocol === 'http:' && !PRIVATE_HOST.test(u.hostname)) throw new Error('A key goes over https. Plain http works only for this machine or your own network.');
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error("That isn't an address. It starts with https://.");
  return u.toString().replace(/\/+$/, '');
}

const cleanModel = (m) => { const s = String(m ?? '').trim(); return MODEL_RE.test(s) ? s : ''; };

const presetFor = (id) => PRESETS.find((p) => p.id === id);
const modelId = (preset, model) => `provider:${preset}:${model}`;
const readModelId = (id) => {
  const match = /^provider:([^:]+):(.+)$/.exec(id);
  return match && presetFor(match[1]) && cleanModel(match[2]) ? { preset: match[1], model: match[2] } : null;
};

function modelNames({ preset, big, small }) {
  const p = presetFor(preset);
  return [...new Set([big, small, p?.big, p?.small].filter(Boolean))];
}

const REASONING = {
  deepseek: { models: ['deepseek-v4-pro', 'deepseek-flash'], levels: ['low', 'high', 'max'] },
  glm: { models: ['glm-5.3', 'glm-5.3-flash'], levels: ['low', 'high', 'max'] },
  minimax: { models: ['MiniMax-M3.1-Flash'], levels: ['low', 'medium', 'high', 'xhigh', 'max'] },
};
const CLI_LEVELS = REASONING.minimax.levels;
const discoversEfforts = (preset) => ['openrouter', 'ollama'].includes(preset);

function effortsFor(provider, model) {
  const name = model.replace(/\[1m\]$/, '');
  if (discoversEfforts(provider.preset)) {
    return provider.reasoning?.find((entry) => entry.model === model)?.levels || [];
  }
  const profile = Object.hasOwn(REASONING, provider.preset) ? REASONING[provider.preset] : null;
  return profile?.models.includes(name) ? profile.levels : [];
}

// Discover only the configured models. The metadata is optional and never blocks using a reachable endpoint.
async function discoverEfforts(provider, { fetchImpl = fetch } = {}) {
  if (!discoversEfforts(provider.preset)) return [];
  const json = async (url, options) => {
    const response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Could not read model metadata');
    return response.json();
  };
  const models = modelNames(provider);
  try {
    if (provider.preset === 'openrouter') {
      const { data } = await json(`${provider.url}/v1/models`);
      return models.map((model) => {
        const values = data.find((entry) => entry.id === model)?.reasoning?.supported_efforts;
        return { model, levels: CLI_LEVELS.filter((level) => values === null || (Array.isArray(values) && values.includes(level))) };
      });
    }
    return await Promise.all(models.map(async (model) => {
      const { thinking } = await json(`${provider.url}/api/show`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model }),
      });
      const values = thinking?.values;
      return { model, levels: CLI_LEVELS.filter((level) => Array.isArray(values) && values.includes(level)) };
    }));
  } catch { return null; }
}

// What a save carries → what is kept, or an error in words. `key` is optional for a keyless preset.
function clean({ preset, key, url, big, small } = {}) {
  const p = PRESETS.find((x) => x.id === preset);
  if (!p) throw new Error(`preset must be one of ${PRESETS.map((x) => x.id).join(', ')}`);
  const address = cleanUrl(p.askUrl ? url || p.url : p.url);
  const k = String(key ?? '').trim();
  if (k ? !KEY_RE.test(k) : !p.keyless) throw new Error(`That isn't a key for ${p.name}. Copy all of it.`);
  const b = cleanModel(big || p.big);
  if (small && !cleanModel(small)) throw new Error("That isn't a model name.");
  const s = cleanModel(small || p.small || big);
  if (!b) throw new Error('Name the model bots run on.');
  return { preset: p.id, name: p.name, url: address, key: k, big: b, small: s || b };
}

// A short real request, as the Anthropic key's check is a list of models, but a model must answer here: it also says
// whether the model's name is right. A few tokens.
async function check({ url, key, small }, { fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(`${url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': key || 'none', authorization: `Bearer ${key || 'none'}` },
      body: JSON.stringify({ model: small, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with OK.' }] }),
      redirect: 'error',
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new Error("Couldn't reach it to check. Check the address and the server's connection, and try again.");
  }
  if (res.status === 401 || res.status === 403) throw new Error('It refused this key. Check that you copied all of it.');
  if (res.status === 404 || res.status === 400) throw new Error("It doesn't know that address or model.");
  if (!res.ok) throw new Error(`It couldn't check just now (it answered ${res.status}). Try again in a little while.`);
}

// What Claude Code reads to send its requests there. The small model also answers what Claude Code runs on its own.
function envFor({ url, key, big, small }) {
  return {
    ANTHROPIC_BASE_URL: url,
    ANTHROPIC_AUTH_TOKEN: key || 'none',
    ANTHROPIC_API_KEY: '', // Claude Code would send an Anthropic key instead of the token (OpenRouter's docs say so)
    ANTHROPIC_MODEL: big,
    ANTHROPIC_DEFAULT_OPUS_MODEL: big,
    ANTHROPIC_DEFAULT_SONNET_MODEL: big,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: small,
    ANTHROPIC_SMALL_FAST_MODEL: small,
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1', // keeps Anthropic-only beta features out of requests to providers that may refuse them
  };
}

// The model a run asks for, in the provider's names: the small helper model for Haiku, the big one for the rest.
function modelFor(model, provider) {
  if (!model) return '';
  const chosen = readModelId(model);
  if (chosen) return chosen.preset === provider.preset && modelNames(provider).includes(chosen.model) ? chosen.model : '';
  return /haiku/i.test(model) ? provider.small : provider.big;
}

// Declare the capabilities of the model actually used for this run, including per-bot choices.
function reasoningEnv(args, env) {
  const effortAt = args.indexOf('--effort');
  if (effortAt < 0 || !CLI_LEVELS.includes(args[effortAt + 1])) return {};
  if (!env.ANTHROPIC_BASE_URL || !env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY !== '' || env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS !== '1') return {};
  const modelAt = args.indexOf('--model');
  const model = modelAt < 0 ? env.ANTHROPIC_MODEL : args[modelAt + 1];
  if (!model) return {};
  return { ANTHROPIC_CUSTOM_MODEL_OPTION: model, ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES: 'effort,thinking,adaptive_thinking' };
}

module.exports = { PRESETS, clean, cleanUrl, check, envFor, modelFor, modelId, readModelId, modelNames, effortsFor, discoversEfforts, discoverEfforts, reasoningEnv };
