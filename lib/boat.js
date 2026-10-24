// @ts-check
// A bot's computer on boat.dev (#529, ADR 086): a cloud machine of its own (boat.dev calls it a sandbox) for a bot whose
// computer is 'boat', in place of the account's computer. Claude Code stays on this server: only the bot's commands and
// files go there, through boat.dev's API with the admin's key (no SSH, no key of the bot's). It has no screen, no
// browser and no Vault secret.
//
// The key is the admin's: the front door hands it to this server (lib/routes/boat.js), which keeps it in memory alone
// (setKey), never in a file, a log or an answer. Which machine is which bot's is kept in boat-machines.json.
//
// A machine starts on its bot's first computer tool and stops after REST_AFTER_MS unused (restIdle); boat.dev keeps its
// disk 14 days while it is stopped. boat.dev's own auto-stop (TTL_SECONDS, extended on use) is only the net under a
// botdot that stopped.
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJson } = require('./jsonfile');

const API = () => String(process.env.BOT_DOT_BOAT_URL || 'https://boat.dev/api/v1').replace(/\/+$/, '');
const KEY = /^[A-Za-z0-9_-]{8,300}$/;
const TYPE = 'default'; // 4 vCPU, 8 GB
const TTL_SECONDS = 2 * 3600; // the most a trial account allows
const EXTEND_AFTER_MS = 30 * 60_000;
const REST_AFTER_MS = Number(process.env.BOT_DOT_BOAT_REST_MS) || 30 * 60_000;
const READY = ['ready', 'idle', 'running'];
const STARTING = ['init', 'provisioning', 'provisioned', 'cloning'];
const STOPPED = ['archiving', 'archived'];
const FILE_MAX_BYTES = 1024 * 1024; // as read_file reads on the account's computer
const PACK_MAX_BYTES = 5 * 1024 * 1024; // boat.dev's file API
const ID = /^bx_[a-z0-9]{8}$/;

let key = null;
// The admin's key as the front door handed it, or null to have none.
function setKey(k) {
  if (k !== null && !KEY.test(String(k || ''))) throw Object.assign(new Error('That is no boat.dev key.'), { status: 400 });
  key = k;
  return !!key;
}
const configured = () => !!key;

// One call: its JSON, or an Error with boat.dev's own code and status.
async function call(pathname, { method = 'GET', body, apiKey = key, fetch = globalThis.fetch, ms = 60_000 } = {}) {
  if (!apiKey) throw Object.assign(new Error('boat.dev has no key on this machine: the admin sets one on the admin page'), { code: 'no-key' });
  let res;
  try {
    res = await fetch(`${API()}${pathname}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(ms),
    });
  } catch { throw Object.assign(new Error("boat.dev can't be reached"), { code: 'unreachable' }); }
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.ok !== false) return data;
  const code = data?.code || data?.error?.code || '';
  const said = res.status === 401 ? "boat.dev doesn't accept the admin's key"
    : res.status === 402 ? "boat.dev wants a plan or a payment method on the admin's account first"
      : `boat.dev answered ${res.status}${code ? ` (${code})` : ''}`;
  throw Object.assign(new Error(said), { status: res.status, code });
}

// The admin's key, checked with one call before the front door keeps it: 'ok', 'refused' or 'unreachable'.
async function checkKey(k, { fetch = globalThis.fetch } = {}) {
  if (!KEY.test(String(k || ''))) return 'refused';
  try { await call('/me', { apiKey: k, fetch, ms: 10_000 }); return 'ok'; } catch (e) { return [401, 403].includes(e.status) ? 'refused' : 'unreachable'; }
}

const shq = (v) => `'${String(v).replace(/'/g, "'\\''")}'`;
const none = (error) => ({ code: null, stdout: '', stderr: '', timedOut: false, error });

function create(dataDir, { fetch = globalThis.fetch, now = Date.now, restAfterMs = REST_AFTER_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), startMs = 180_000 } = {}) {
  const file = path.join(dataDir, 'boat-machines.json');
  const machines = readJson(file, {}); // botId -> { id }
  const save = () => writeJson(file, machines);
  const api = (pathname, opts = {}) => call(pathname, { fetch, ...opts });

  // The machines started here and not stopped since, when each was last used and how many calls on it still run.
  const up = new Map(); // botId -> { id, extendedAt }
  const usedAt = new Map();
  const busy = new Map();
  const starting = new Map(); // botId -> Promise of its machine's id
  // A machine running from before botdot started counts as used now, so it stops too when nothing uses it.
  for (const botId of Object.keys(machines)) usedAt.set(botId, now());

  async function waitReady(id) {
    const until = now() + startMs;
    for (;;) {
      const { sandbox } = await api(`/sandboxes/${id}`);
      if (READY.includes(sandbox?.state)) return;
      if (!STARTING.includes(sandbox?.state) || now() > until) throw new Error(`the boat.dev machine didn't start (${sandbox?.state || 'no state'})`);
      await sleep(2000);
    }
  }
  async function make(botId) {
    const { sandbox } = await api('/sandboxes', { method: 'POST', body: { type: TYPE, name: `botdot-${botId}`, ttlSeconds: TTL_SECONDS } });
    if (!ID.test(String(sandbox?.id))) throw new Error("boat.dev didn't say which machine it made");
    machines[botId] = { id: sandbox.id };
    save();
    return sandbox.id;
  }
  // The bot's machine, running: its own, started again when it stopped, or a new one when it has none or boat.dev no
  // longer keeps its disk.
  async function bring(botId) {
    let id = machines[botId]?.id;
    let state = null;
    if (id) {
      try { state = (await api(`/sandboxes/${id}`)).sandbox?.state; } catch (e) { if (e.status !== 404) throw e; }
    }
    if (!state || ['error', 'cancelled'].includes(state)) id = await make(botId);
    else if (STOPPED.includes(state)) {
      try { await api(`/sandboxes/${id}/resume`, { method: 'POST', body: { ttlSeconds: TTL_SECONDS } }); } catch (e) {
        if (e.code !== 'snapshot_data_expired') throw e;
        id = await make(botId);
      }
    }
    await waitReady(id);
    up.set(botId, { id, extendedAt: now() });
    return id;
  }
  function ensure(botId) {
    if (up.has(botId)) return Promise.resolve(up.get(botId).id);
    if (!starting.has(botId)) starting.set(botId, bring(botId).finally(() => starting.delete(botId)));
    return starting.get(botId);
  }
  // One use of the bot's machine: started first, counted as used while it runs, its auto-stop pushed back now and then.
  async function using(botId, work) {
    busy.set(botId, (busy.get(botId) || 0) + 1);
    usedAt.set(botId, now());
    try {
      const id = await ensure(botId);
      const m = up.get(botId);
      if (m && now() - m.extendedAt > EXTEND_AFTER_MS) {
        m.extendedAt = now();
        api(`/sandboxes/${id}`, { method: 'PATCH', body: { ttlSeconds: TTL_SECONDS } }).catch(() => {});
      }
      return await work(id);
    } finally {
      busy.set(botId, busy.get(botId) - 1);
      usedAt.set(botId, now());
    }
  }

  // One command in the bot's machine, as lib/computers.js resolves one: { code, stdout, stderr, timedOut, error }.
  async function command(id, cmd, seconds) {
    try {
      const r = await api(`/sandboxes/${id}/commands`, { method: 'POST', body: { command: cmd, timeoutSeconds: seconds }, ms: (seconds + 90) * 1000 });
      const cut = r.stdoutTruncated || r.stderrTruncated ? 'the output was cut off' : undefined;
      return { code: r.timedOut ? 124 : (typeof r.exitCode === 'number' ? r.exitCode : null), stdout: String(r.stdout || ''), stderr: String(r.stderr || ''), timedOut: !!r.timedOut, ...(cut ? { error: cut } : {}) };
    } catch (e) { return none(e.code === 'boat_direct_failed' ? 'boat.dev lost the command; it may have run' : e.message); }
  }
  const seconds = (n) => Math.min(Math.max(Math.round(Number(n) || 120), 1), 600);

  const runShell = (botId, { command: cmd, timeoutSeconds = 120 }) => using(botId, (id) => command(id, cmd, seconds(timeoutSeconds)));
  const readFile = (botId, { path: f }) => using(botId, (id) => command(id, `exec head -c ${FILE_MAX_BYTES} -- ${shq(f)}`, 60));
  // Bytes go through boat.dev's file API to a file of its own in /tmp (only there and in /home/user may it write),
  // then a command moves them where the bot said: any path, relative to its folder as on the account's computer.
  async function put(id, bytes) {
    const tmp = `/tmp/botdot-${crypto.randomBytes(8).toString('hex')}`;
    await api(`/sandboxes/${id}/files`, { method: 'PUT', body: { path: tmp, content: Buffer.from(bytes).toString('base64'), encoding: 'base64' } });
    return tmp;
  }
  const writeFile = (botId, { path: f, content }) => using(botId, async (id) => {
    let tmp;
    try { tmp = await put(id, Buffer.from(String(content), 'utf8')); } catch (e) { return none(e.message); }
    return command(id, `d=$(dirname -- ${shq(f)}); mkdir -p -- "$d" && mv -f -- ${tmp} ${shq(f)} || { rm -f -- ${tmp}; exit 1; }`, 60);
  });
  const unpackFolder = (botId, { path: dir, tar }) => using(botId, async (id) => {
    let tmp;
    try { tmp = await put(id, Buffer.from(tar, 'base64')); } catch (e) { return none(e.message); }
    const d = shq(dir);
    return command(id, `if [ -e ${d} ] && [ -n "$(ls -A -- ${d} 2>/dev/null)" ]; then rm -f -- ${tmp}; echo "${String(dir).replace(/["$`\\]/g, '')} is not empty: give a new folder" >&2; exit 3; fi; mkdir -p -- ${d} && tar -xf ${tmp} -C ${d} --no-same-owner --no-same-permissions; s=$?; rm -f -- ${tmp}; exit $s`, 60);
  });
  // A folder as a tar of plain files: made in /tmp by a command, read back through the file API. Resolves like
  // lib/computers.js packFolder: { code, tar (base64), stderr, error }.
  const packFolder = (botId, { path: dir }) => using(botId, async (id) => {
    const tmp = `/tmp/botdot-${crypto.randomBytes(8).toString('hex')}.tar`;
    const made = await command(id, `[ -d ${shq(dir)} ] || { echo "${String(dir).replace(/["$`\\]/g, '')} is not a folder on your computer" >&2; exit 2; }; tar --format=ustar -cf ${tmp} -C ${shq(dir)} . && [ "$(stat -c %s ${tmp})" -le ${PACK_MAX_BYTES} ] || { rm -f ${tmp}; echo "the folder is too large for a page (over 5 MB)" >&2; exit 2; }`, 120);
    if (made.code !== 0) return { code: made.code, tar: '', stderr: made.stderr.trim().slice(-500), error: made.error || null };
    try {
      const r = await api(`/sandboxes/${id}/files?path=${encodeURIComponent(tmp)}&encoding=base64`);
      return { code: 0, tar: String(r.content || ''), stderr: '' };
    } catch (e) { return { code: null, tar: '', stderr: '', error: e.message }; } finally {
      command(id, `rm -f ${tmp}`, 30).catch(() => {});
    }
  });

  // The machines unused for longer than the rest time stop, each once: boat.dev keeps their disk, and the bot's next
  // computer tool starts its machine again. The bots whose machine stopped.
  async function restIdle() {
    const stopped = [];
    for (const [botId, at] of usedAt) {
      if (busy.get(botId) || starting.has(botId) || now() - at <= restAfterMs) continue;
      const id = machines[botId]?.id;
      usedAt.delete(botId);
      up.delete(botId);
      if (!id || !key) continue;
      try { await api(`/sandboxes/${id}/stop`, { method: 'POST', body: {} }); stopped.push(botId); } catch (e) {
        if (e.status !== 409) console.warn(`[boat] couldn't stop the idle machine of ${botId}: ${e.message}`);
      }
    }
    return stopped;
  }
  // A deleted bot, or one that no longer works on boat.dev: its machine stops and is forgotten. Its disk is not
  // erased: boat.dev drops it 14 days after it stopped.
  async function forget(botId) {
    const id = machines[botId]?.id;
    up.delete(botId); usedAt.delete(botId);
    if (!id) return;
    delete machines[botId];
    save();
    if (key) await api(`/sandboxes/${id}/stop`, { method: 'POST', body: {} }).catch(() => {});
  }
  const has = (botId) => !!machines[botId];
  const isUp = (botId) => up.has(botId);
  return { ensure, runShell, readFile, writeFile, packFolder, unpackFolder, restIdle, forget, has, isUp };
}

module.exports = { create, setKey, configured, checkKey, KEY, REST_AFTER_MS };
