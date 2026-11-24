// The remote MCP servers an owner added to their account (ADR 266): a name, an https address and, if the server wants
// one, a key. botdot is the client (lib/mcp-client.js); a bot's run, the Chief's turn and a replay reach a server only
// through the stdio relay lib/custom-mcp.js, which asks botdot with the run's token. The key is kept encrypted with
// the Vault's key, as the Composio key is (lib/connectors.js), and is read only to make a call: it is in no view this
// file returns, no log, no error text and no file a bot can read.
//
// A server stands in the card machinery as an "app" with a slug of its own, `mcp-` and eight hex digits made when it is
// added, never one made from its name: so no name can be, or shadow, an app of Composio, and the grants "<slug>:<tool>"
// of one server are never another's.
const crypto = require('node:crypto');
const path = require('node:path');
const { encrypt, decrypt } = require('./vault');
const { readJson, writeJson } = require('./jsonfile');
const mcp = require('./mcp-client');

const { CUSTOM_APP: SLUG_RE } = require('./custom-app');
const NAME_MAX = 60;
const SERVERS_MAX = 20;
const CACHE_MS = 5 * 60_000; // how long a server's list of tools is kept
const oneLine = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// Whether a tool only reads, by what the server says of it. A hint of the server's, not a proof: the owner chose the
// server, which gets the call either way, so what the hint decides is only whether the owner is asked first. A tool with
// no hint, or with a conflicting one, is a write.
const readsOnly = (tool) => tool?.annotations?.readOnlyHint === true && tool.annotations.destructiveHint !== true;

function create(dataDir, { client = mcp.create() } = {}) {
  const file = path.join(dataDir, 'custom-mcp.json');
  const load = () => { const d = readJson(file, {}); return Array.isArray(d.servers) ? d.servers : []; };
  const save = (servers) => writeJson(file, { servers }, { mode: 0o600 });
  const find = (ref) => {
    const r = String(ref ?? '').trim().toLowerCase();
    return load().find((s) => s.id === r) || load().find((s) => s.name.toLowerCase() === r) || null;
  };
  // What a call needs, with the key read out: used inside this file only.
  const target = (s) => ({ url: s.url, header: s.header || undefined, key: s.key ? decrypt(s.key) : undefined });
  // What the apps are given: nothing secret, not even a part of the key.
  const view = (s) => ({ id: s.id, name: s.name, url: s.url, hasKey: !!s.key, ...(s.header ? { header: s.header } : {}), toolCount: s.toolCount ?? null, addedAt: s.addedAt });

  const isCustom = (slug) => SLUG_RE.test(String(slug));
  const list = () => load().map(view);
  const nameOf = (slug) => (isCustom(slug) ? find(slug)?.name || null : null);

  // The tools of each server, as last listed: id -> { at, tools }. In memory only.
  const cache = new Map();
  async function toolsOf(s, { fresh = false, deadline } = {}) {
    const hit = cache.get(s.id);
    if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.tools;
    const tools = await client.tools(target(s), { deadline });
    cache.set(s.id, { at: Date.now(), tools });
    return tools;
  }

  // ---------- the owner's changes ----------

  const sameAddress = (a, b) => String(a).replace(/\/+$/, '').toLowerCase() === String(b).replace(/\/+$/, '').toLowerCase();

  // Adds a server after botdot has asked it what it is. Throws an Error in words the owner reads: an address that is
  // refused (`code: 'bad-address'`), a server that wants a key it was not given (`code: 'auth'`) or does not answer.
  async function add({ name, url, key, header } = {}) {
    const u = mcp.parseAddress(url);
    if (load().length >= SERVERS_MAX) throw Object.assign(new Error(`That is ${SERVERS_MAX} servers already. Remove one first.`), { code: 'too-many' });
    const text = String(key ?? '').trim();
    if (text.length > 4000) throw Object.assign(new Error('That key is too long.'), { code: 'bad-key' });
    const head = String(header ?? '').trim();
    mcp.authHeader(text || undefined, head || undefined); // the header's name and the key's form are judged here, before anything is sent
    if (load().some((s) => sameAddress(s.url, u.href))) throw Object.assign(new Error('That server is already added.'), { code: 'exists' });
    await mcp.assertPublic(u);
    const probe = { url: u.href, ...(text ? { key: text } : {}), ...(head ? { header: head } : {}) };
    const found = await client.check(probe);
    const label = oneLine(name, NAME_MAX) || oneLine(found.serverName, NAME_MAX) || u.hostname;
    if (load().some((s) => s.name.toLowerCase() === label.toLowerCase())) throw Object.assign(new Error(`You already have a server called "${label}". Give this one another name.`), { code: 'exists' });
    const record = { id: `mcp-${crypto.randomBytes(4).toString('hex')}`, name: label, url: u.href, ...(text ? { key: encrypt(text) } : {}), ...(head ? { header: head } : {}), toolCount: found.tools, addedAt: new Date().toISOString(), botsOff: [] };
    save([...load(), record]);
    return view(record);
  }

  // A new key (or none, to take the key away) for a server, checked before it is kept.
  async function setKey(ref, { key, header } = {}) {
    const s = find(ref);
    if (!s) throw Object.assign(new Error('There is no such server.'), { code: 'unknown' });
    const text = String(key ?? '').trim();
    const head = String(header ?? '').trim();
    mcp.authHeader(text || undefined, head || undefined);
    const found = await client.check({ url: s.url, ...(text ? { key: text } : {}), ...(head ? { header: head } : {}) });
    const next = { ...s, toolCount: found.tools };
    delete next.key; delete next.header;
    if (text) next.key = encrypt(text);
    if (text && head) next.header = head;
    save(load().map((x) => (x.id === s.id ? next : x)));
    cache.delete(s.id);
    return view(next);
  }

  function remove(ref) {
    const s = find(ref);
    if (!s) return false;
    save(load().filter((x) => x.id !== s.id));
    cache.delete(s.id);
    return s.id; // the server's own slug, never the name it was found by
  }

  // ---------- which bots have a server (ADR 231: every bot, less the ones the owner took it from) ----------

  const mayUse = (botId, id) => { const s = find(id); return !!s && !(s.botsOff || []).includes(botId); };
  const forBot = (botId) => load().filter((s) => !(s.botsOff || []).includes(botId)).map((s) => ({ id: s.id, name: s.name }));
  // The bots that have a server, out of all of them.
  const botsOf = (id, all) => { const s = find(id); return s ? all.filter((b) => !(s.botsOff || []).includes(b)) : []; };
  // The owner's pick of the bots that have the server: the others are taken from, and a bot made later has it.
  function setBots(id, has, all) {
    const s = find(id);
    if (!s) return null;
    const keep = new Set(has);
    s.botsOff = all.filter((b) => !keep.has(b));
    save(load().map((x) => (x.id === s.id ? s : x)));
    return botsOf(id, all);
  }

  // ---------- what a run does with one ----------

  // The tools, for a bot or the Chief to pick from: names and a line each, or one tool whole (its input schema).
  // `deadline`, here and in toolFor() and run(): the time (ms, as Date.now()) by which the whole of it must be over, the
  // listing and the call alike, so the one request that asked can answer in its own words before the relay gives up on it.
  async function tools(ref, { search, tool, deadline } = {}) {
    const s = find(ref);
    if (!s) throw new Error('There is no such server.');
    const all = await toolsOf(s, { deadline });
    if (tool) {
      const t = all.find((x) => x.name === tool);
      if (!t) throw new Error(`${s.name} has no tool called ${oneLine(tool, 80)}.`);
      return [{ name: t.name, description: t.description, input: t.inputSchema, readOnly: readsOnly(t) }];
    }
    const words = String(search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((t) => words.every((w) => `${t.name} ${t.description}`.toLowerCase().includes(w))).slice(0, 80)
      .map((t) => ({ name: t.name, description: t.description.slice(0, 240), readOnly: readsOnly(t) }));
  }

  // The tool as the card machinery wants it (lib/connector-approvals.js authorize): `slug` its name, and `tags` the one
  // that says it reads (reads()), or none. Throws when the server has no such tool: nothing is asked for one.
  async function toolFor(ref, name, { deadline } = {}) {
    const s = find(ref);
    if (!s) throw new Error('There is no such server.');
    let t = (await toolsOf(s, { deadline })).find((x) => x.name === name);
    if (!t) t = (await toolsOf(s, { fresh: true, deadline })).find((x) => x.name === name); // added since it was listed
    if (!t) throw new Error(`${s.name} has no tool called ${oneLine(name, 80)}. Its tools: ${(cache.get(s.id)?.tools || []).slice(0, 30).map((x) => x.name).join(', ') || 'none'}.`);
    return { slug: t.name, tags: readsOnly(t) ? ['readOnlyHint'] : [], title: t.annotations?.title || null };
  }

  // The call itself, after the owner's OK where one was needed: the tool's answer as text. An answer that says it is an
  // error is an Error with the server's words.
  async function run(ref, name, args, { deadline } = {}) {
    const s = find(ref);
    if (!s) throw new Error('There is no such server.');
    const r = await client.call(target(s), name, args || {}, { deadline });
    const text = mcp.resultText(r);
    if (r.isError) throw Object.assign(new Error(`${s.name} reported an error: ${text.slice(0, 1500)}`), { fromServer: true });
    return text;
  }

  return { SLUG_RE, isCustom, list, find, nameOf, add, setKey, remove, mayUse, forBot, botsOf, setBots, tools, toolFor, run, sameAddress };
}

module.exports = { create, SLUG_RE, readsOnly, NAME_MAX, SERVERS_MAX };
