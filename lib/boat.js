// @ts-check
// A bot's computer on boat.dev (#529, ADR 088): a cloud machine of its own (boat.dev calls it a sandbox) for a bot whose
// computer is 'boat', in place of the account's computer. Claude Code stays on this server: only the bot's commands and
// files go there, through boat.dev's API with the admin's key (no SSH, no key of the bot's). The bot has no screen or
// browser tools there yet; the owner watches and takes over its desktop through boat.dev's stream (#564). A Vault
// secret goes there for one command only (#560).
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
const vaultFiles = require('./vault-files');

const API = () => String(process.env.BOT_DOT_BOAT_URL || 'https://boat.dev/api/v1').replace(/\/+$/, '');
const KEY = /^[A-Za-z0-9_-]{8,300}$/;
// The sizes boat.dev makes (docs.boat.dev/machines), the account's choice (#539): its price per hour while it runs.
const SIZES = [
  { id: 'small', cpus: 2, memoryGB: 4, diskGB: 12, perHour: 0.018 },
  { id: 'default', cpus: 4, memoryGB: 8, diskGB: 50, perHour: 0.036 },
  { id: 'large', cpus: 8, memoryGB: 16, diskGB: 125, perHour: 0.072 },
  { id: 'xlarge', cpus: 16, memoryGB: 32, diskGB: 251, perHour: 0.2 },
];
const SIZE_IDS = SIZES.map((s) => s.id);
const DEFAULT_SIZE = 'default';
const cleanSize = (s) => (SIZE_IDS.includes(s) ? s : DEFAULT_SIZE);
const TTL_SECONDS = 2 * 3600; // the most a trial account allows
const EXTEND_AFTER_MS = 30 * 60_000;
const REST_AFTER_MS = Number(process.env.BOT_DOT_BOAT_REST_MS) || 30 * 60_000;
const READY = ['ready', 'idle', 'running'];
const STARTING = ['init', 'provisioning', 'provisioned', 'cloning'];
const STOPPED = ['archiving', 'archived'];
const FILE_MAX_BYTES = 1024 * 1024; // as read_file reads on the account's computer
const PACK_MAX_BYTES = 5 * 1024 * 1024; // boat.dev's file API
const ID = /^bx_[a-z0-9]{8}$/;
// How long boat.dev lets a new viewer open a desktop URL (docs.boat.dev/security): one that is open keeps playing.
const DESKTOP_URL_MS = 10 * 60_000;

let key = null;
// The admin's key as the front door handed it, or null to have none.
function setKey(k) {
  if (k !== null && !KEY.test(String(k || ''))) throw Object.assign(new Error('That is no boat.dev key.'), { status: 400 });
  key = k;
  return !!key;
}
const configured = () => !!key;

// The sizes, each with whether the admin's boat.dev account can make it now (boat.dev's own words when not). Without
// an answer from boat.dev every size is offered, and boat.dev refuses one it can't make when a machine starts.
let sizesSeen = null; // { at, types }
async function sizes({ fetch = globalThis.fetch, now = Date.now } = {}) {
  if (!sizesSeen || now() - sizesSeen.at > 10 * 60_000) {
    try {
      const { machineTypes } = await call('/limits', { fetch, ms: 10_000 });
      if (Array.isArray(machineTypes)) sizesSeen = { at: now(), types: machineTypes };
    } catch { /* offered as they are */ }
  }
  const of = (id) => sizesSeen?.types.find((t) => t.type === id);
  return SIZES.map((s) => ({ ...s, available: of(s.id)?.available !== false, ...(of(s.id)?.available === false && of(s.id).reason ? { reason: String(of(s.id).reason).slice(0, 200) } : {}) }));
}

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

// The admin's key, checked with one call before the front door keeps it: 'ok', 'refused', 'billing' (the key is
// good but its account has no plan or payment method yet) or 'unreachable'.
async function checkKey(k, { fetch = globalThis.fetch } = {}) {
  if (!KEY.test(String(k || ''))) return 'refused';
  try { await call('/me', { apiKey: k, fetch, ms: 10_000 }); return 'ok'; } catch (e) { return [401, 403].includes(e.status) ? 'refused' : e.status === 402 ? 'billing' : 'unreachable'; }
}

// A machine's name on boat.dev, so the admin sees there whose it is: botdot-<account>-<bot's name>-<bot id>.
// Lowercase letters, digits and dashes only, at most 120 (boat.dev's limit). Machines are found by their id, never
// by this name, so a new name never loses one.
const slug = (v) => String(v || '').replace(/[łŁ]/g, 'l').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function machineName(botId, { account = '', botName = '' } = {}) {
  const id = slug(botId);
  const head = ['botdot', slug(account).slice(0, 40)].filter(Boolean).join('-');
  const name = slug(botName).slice(0, 120 - head.length - id.length - 2).replace(/-+$/, '');
  return [head, name, id].filter(Boolean).join('-').slice(0, 120);
}

const shq = (v) => `'${String(v).replace(/'/g, "'\\''")}'`;
const none = (error) => ({ code: null, stdout: '', stderr: '', timedOut: false, error });

// size: the account's choice of size (#539), read when a machine is made or started. account: this server's account
// (BOT_DOT_ACCOUNT); nameOf: a bot's name. Both go in its machine's name.
function create(dataDir, { fetch = globalThis.fetch, now = Date.now, restAfterMs = REST_AFTER_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), startMs = 180_000, size = () => DEFAULT_SIZE, account = process.env.BOT_DOT_ACCOUNT || '', nameOf = () => null } = {}) {
  const file = path.join(dataDir, 'boat-machines.json');
  const machines = readJson(file, {}); // botId -> { id, type, name }
  const save = () => writeJson(file, machines);
  const api = (pathname, opts = {}) => call(pathname, { fetch, ...opts });

  // The machines started here and not stopped since, when each was last used and how many calls on it still run.
  const up = new Map(); // botId -> { id, extendedAt }
  const usedAt = new Map();
  const busy = new Map();
  const starting = new Map(); // botId -> Promise of its machine's id
  const stopping = new Map(); // botId -> Promise of its stop, sent and not yet done
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
  const nameFor = (botId) => machineName(botId, { account, botName: nameOf(botId) });
  async function make(botId) {
    const type = cleanSize(size());
    const name = nameFor(botId);
    const { sandbox } = await api('/sandboxes', { method: 'POST', body: { type, name, ttlSeconds: TTL_SECONDS } });
    if (!ID.test(String(sandbox?.id))) throw new Error("boat.dev didn't say which machine it made");
    machines[botId] = { id: sandbox.id, type, name };
    save();
    return sandbox.id;
  }
  // A machine made under an older name (botdot-<bot id>, or the bot's name before it changed) takes its new one when it
  // is next used. Its disk is untouched; a refused rename is tried again on its next start.
  async function rename(botId, id) {
    const name = nameFor(botId);
    if (machines[botId]?.name === name) return;
    try { await api(`/sandboxes/${id}`, { method: 'PATCH', body: { name } }); } catch { return; }
    if (machines[botId]?.id === id) { machines[botId].name = name; save(); }
  }
  // The bot's machine, running: its own, started again when it stopped (at the account's size now, when that changed),
  // or a new one when it has none or boat.dev no longer keeps its disk.
  async function bring(botId) {
    // A stop sent a moment ago: boat.dev may still say running, so wait until it says stopped, then start it again.
    const wasStopping = stopping.has(botId);
    await stopping.get(botId);
    let id = machines[botId]?.id;
    let state = null;
    const look = async () => { try { state = (await api(`/sandboxes/${id}`)).sandbox?.state; } catch (e) { if (e.status !== 404) throw e; state = null; } };
    if (id) await look();
    for (const until = now() + startMs; wasStopping && READY.includes(state) && now() < until;) { await sleep(2000); await look(); }
    if (!state || ['error', 'cancelled'].includes(state)) id = await make(botId);
    else if (STOPPED.includes(state)) {
      const was = machines[botId].type || DEFAULT_SIZE;
      const type = cleanSize(size());
      const resume = (body) => api(`/sandboxes/${id}/resume`, { method: 'POST', body: { ttlSeconds: TTL_SECONDS, ...body } });
      try {
        if (type === was) await resume({});
        else {
          // A size boat.dev won't make now: it starts at its old size.
          try { await resume({ type }); machines[botId].type = type; save(); } catch (e) { if (e.code === 'snapshot_data_expired' || !e.status || e.status >= 500) throw e; await resume({}); }
        }
      } catch (e) {
        if (e.code !== 'snapshot_data_expired') throw e;
        id = await make(botId);
      }
    }
    await waitReady(id);
    await rename(botId, id);
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
  async function put(id, bytes, prefix = 'botdot-') {
    const tmp = `/tmp/${prefix}${crypto.randomBytes(8).toString('hex')}`;
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

  // run_with_login, run_with_ssh_key and run_with_file on the bot's machine (#560, ADR 092), as lib/computers.js runs
  // them on the account's computer. The secret never goes on a command line sent to boat.dev: it goes through the file
  // API to a file of its own in /tmp, which botdot's command reads and removes before the bot's command starts (a
  // login, an SSH key, loaded into an ssh-agent of that command), or removes when it ends (a file). A file left by a
  // command boat.dev lost goes on the next one (SWEEP), and botdot asks for it to go at once as well.
  const SWEEP = "find /tmp -maxdepth 1 -name 'botdot-secret-*' -mmin +15 -exec rm -rf {} + 2>/dev/null; ";
  const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,250}$/;
  // The bot's command inside `timeout`, so botdot's cleanup after it still runs within boat.dev's own time limit.
  const within = (n) => Math.min(seconds(n), 570);
  const ended = (r) => (r.code === 124 ? { ...r, timedOut: true } : r);
  async function withSecret(id, bytes, run) {
    let tmp;
    try { tmp = await put(id, bytes, 'botdot-secret-'); } catch (e) { return none(e.message); }
    try { return ended(await run(tmp)); } finally { command(id, `rm -rf -- ${tmp} ${tmp}.d`, 30).catch(() => {}); }
  }
  // With several logins (#228) `env` holds each one's BOTDOT_<NAME>_USERNAME and BOTDOT_<NAME>_PASSWORD in their place.
  const runWithLogin = (botId, { command: cmd, username = '', password = '', env, timeoutSeconds = 120 }) => using(botId, (id) => {
    const vars = Object.entries(env || { BOTDOT_USERNAME: String(username), BOTDOT_PASSWORD: String(password) });
    if (vars.some(([name]) => !ENV_NAME.test(name))) return none('a login name makes no variable');
    const s = within(timeoutSeconds);
    return withSecret(id, Buffer.from(vars.map(([name, v]) => `export ${name}=${shq(v)}\n`).join('')),
      (f) => command(id, `${SWEEP}. ${f}; a=$?; rm -f -- ${f}; [ $a = 0 ] || exit 1; exec timeout -k 5 ${s} sh -c ${shq(cmd)}`, s + 30));
  });
  const runWithSshKey = (botId, { command: cmd, privateKey = '', timeoutSeconds = 120 }) => using(botId, (id) => {
    const s = within(timeoutSeconds);
    const key = String(privateKey).endsWith('\n') ? String(privateKey) : `${privateKey}\n`;
    return withSecret(id, Buffer.from(key), (f) => command(id, [
      SWEEP,
      `command -v ssh-agent >/dev/null && command -v ssh-add >/dev/null || { rm -f -- ${f}; echo "your machine has no ssh-agent: install it with sudo apt-get install -y openssh-client, then try again" >&2; exit 127; }`,
      `chmod 600 ${f}; eval "$(ssh-agent -s -t ${s + 60})" >/dev/null || { rm -f -- ${f}; exit 1; }`,
      `ssh-add -q ${f} 2>/dev/null; a=$?; rm -f -- ${f}`,
      '[ $a = 0 ] || { ssh-agent -k >/dev/null 2>&1; echo "the SSH key could not be loaded" >&2; exit 1; }',
      `timeout -k 5 ${s} sh -c ${shq(cmd)}; s=$?; ssh-agent -k >/dev/null 2>&1; exit $s`,
    ].join('\n'), s + 30));
  });
  const runWithFile = (botId, { command: cmd, fileName, content = '', timeoutSeconds = 120 }) => using(botId, (id) => {
    const s = within(timeoutSeconds);
    const name = vaultFiles.FILE_NAME.test(String(fileName)) ? String(fileName) : 'file';
    return withSecret(id, Buffer.from(String(content), 'base64'), (f) => command(id, [
      SWEEP,
      `mkdir -m 700 ${f}.d && mv -f -- ${f} ${f}.d/${name} && chmod 600 ${f}.d/${name} || { rm -rf -- ${f} ${f}.d; exit 1; }`,
      `BOTDOT_FILE=${f}.d/${name} timeout -k 5 ${s} sh -c ${shq(cmd)}; s=$?; rm -rf -- ${f}.d; exit $s`,
    ].join('\n'), s + 30));
  });

  // The bot's folder copied to or from the account's computer (#556, lib/computer-move.js): /home/user packed into one
  // gzipped tar in /tmp (boat.dev's caches and the shell's own dotfiles left out), handed out and taken in pieces
  // through the file API, unpacked (a file of the same name is replaced) and dropped. Resolves as lib/computers.js
  // moveFiles: { code, size?, data? (base64), stderr, error }.
  const MOVE_TAR = '/tmp/botdot-move.tgz';
  const MOVE_PART = '/tmp/botdot-move.part';
  const LEFT_OUT = ['.cache', '.npm', '.bashrc', '.profile', '.bash_logout', '.bash_history'].map((f) => `--exclude=./${f}`).join(' ');
  const moved = (r, more = {}) => (r.code === 0 ? { code: 0, ...more } : { code: r.code, stderr: r.stderr.trim().slice(-500), error: r.error || null });
  const moveFiles = (botId, { op, offset = 0, length = 0, data = '' }) => using(botId, async (id) => {
    const at = Math.max(0, Math.floor(offset));
    if (op === 'pack') {
      const r = await command(id, `rm -f ${MOVE_TAR}; tar --ignore-failed-read -czf ${MOVE_TAR} -C /home/user ${LEFT_OUT} .; s=$?; [ $s -le 1 ] || exit $s; stat -c %s ${MOVE_TAR}`, 600);
      return moved(r, { size: Number(r.stdout.trim()) || 0 });
    }
    if (op === 'read') {
      const r = await command(id, `tail -c +${at + 1} ${MOVE_TAR} | head -c ${Math.min(Math.max(0, Math.floor(length)), PACK_MAX_BYTES - 1024 * 1024)} > ${MOVE_PART}`, 120);
      if (r.code !== 0) return moved(r);
      try { return { code: 0, data: String((await api(`/sandboxes/${id}/files?path=${encodeURIComponent(MOVE_PART)}&encoding=base64`)).content || '') }; } catch (e) { return none(e.message); }
    }
    if (op === 'write') {
      try { await api(`/sandboxes/${id}/files`, { method: 'PUT', body: { path: MOVE_PART, content: data, encoding: 'base64' } }); } catch (e) { return none(e.message); }
      return moved(await command(id, `${at === 0 ? `: > ${MOVE_TAR} || exit 1; ` : ''}[ "$(stat -c %s ${MOVE_TAR})" = ${at} ] || { echo "a piece came out of order" >&2; exit 4; }; cat ${MOVE_PART} >> ${MOVE_TAR}; s=$?; rm -f ${MOVE_PART}; exit $s`, 120));
    }
    if (op === 'unpack') return moved(await command(id, `mkdir -p /home/user && tar -xzf ${MOVE_TAR} -C /home/user --no-same-owner; s=$?; rm -f ${MOVE_TAR}; exit $s`, 600));
    if (op === 'drop') return moved(await command(id, `rm -f ${MOVE_TAR} ${MOVE_PART}`, 60));
    throw new Error('No such step of a copy');
  });

  // The machine's desktop for the owner (#564): a new stream URL from boat.dev each time the app asks, never kept or
  // logged (anyone who has it may attach to the desktop, and may open it for DESKTOP_URL_MS). A machine that is not on
  // starts in the background and answers { starting: true } until it runs, as boat.dev does while it readies its
  // desktop. Each ask counts as use: the app asks again every few minutes while the owner watches.
  const startFailed = new Map(); // botId -> what went wrong in a start the owner's ask began
  async function desktop(botId) {
    usedAt.set(botId, now());
    if (!up.has(botId)) {
      const failed = startFailed.get(botId);
      if (failed) { startFailed.delete(botId); throw new Error(failed); }
      if (!starting.has(botId)) ensure(botId).catch((e) => { startFailed.set(botId, e.message); });
      return { starting: true };
    }
    return using(botId, async (id) => {
      let r;
      try { r = await api(`/sandboxes/${id}/desktop`, { method: 'POST', body: {}, ms: 30_000 }); } catch (e) {
        if (['desktop_not_ready', 'sandbox_not_ready'].includes(e.code)) return { starting: true };
        throw e;
      }
      if (r.provisioning || !r.desktopUrl) return { starting: true };
      const url = String(r.desktopUrl);
      if (!/^https:\/\/[^\s"'<>]+$/.test(url)) throw new Error("boat.dev's desktop address was not one to open");
      return { url, expiresAt: new Date(now() + DESKTOP_URL_MS).toISOString() };
    });
  }

  // The machines unused for longer than the rest time stop, each once: boat.dev keeps their disk, and the bot's next
  // computer tool starts its machine again. The bots whose machine stopped.
  async function restIdle() {
    const stopped = [];
    for (const [botId, at] of usedAt) {
      if (busy.get(botId) || starting.has(botId) || now() - at <= restAfterMs) continue;
      const id = machines[botId]?.id;
      if (id && !key) continue; // stopped once a key is back
      usedAt.delete(botId);
      up.delete(botId);
      if (!id) continue;
      const stop = api(`/sandboxes/${id}/stop`, { method: 'POST', body: {} }).then(() => { stopped.push(botId); }, (e) => {
        if (e.status !== 409) console.warn(`[boat] couldn't stop the idle machine of ${botId}: ${e.message}`);
      }).finally(() => stopping.delete(botId));
      stopping.set(botId, stop);
      await stop;
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
  // The bot's machine as the owner sees it: its state, its size and a line in the server's words. One not made yet
  // is described at the size it will be made at.
  function info(botId) {
    const state = up.has(botId) ? 'running' : starting.has(botId) ? 'starting' : machines[botId] ? 'stopped' : 'none';
    const s = SIZES.find((x) => x.id === cleanSize(machines[botId]?.type || size()));
    const words = { running: 'on', starting: 'starting', stopped: 'stopped', none: 'not made yet' }[state];
    return { state, size: s.id, text: `boat.dev · ${s.cpus} CPUs · ${s.memoryGB} GB · ${words}` };
  }
  return { ensure, desktop, runShell, readFile, writeFile, runWithLogin, runWithSshKey, runWithFile, packFolder, unpackFolder, moveFiles, restIdle, forget, has, isUp, info };
}

module.exports = { create, DESKTOP_URL_MS, machineName, setKey, configured, checkKey, sizes, cleanSize, SIZE_IDS, DEFAULT_SIZE, KEY, REST_AFTER_MS };
