// @ts-check
// A bot's computer on boat.dev (#529, ADR 088): a cloud machine (boat.dev calls it a sandbox) for a bot whose computer
// is 'boat', in place of the account's computer. The account has one there that its boat bots share, each in a folder
// of its own (#568, ADR 096); a bot that needs one of its own has it, as before. Claude Code stays on this server: only the bot's commands and
// files go there, through boat.dev's API with the admin's key (no SSH, no key of the bot's). Its screen tools work on the
// machine's own desktop with the screen kit botdot puts there (#563, ADR 094), and the owner watches and takes over
// that desktop through boat.dev's stream (#564). A Vault secret goes there for one command or one typed field only (#560).
//
// The key is the admin's: the front door hands it to this server (lib/routes/boat.js), which keeps it in memory alone
// (setKey), never in a file, a log or an answer. Which machine is the account's and which a bot's own is kept in
// boat-machines.json.
//
// A machine starts on the first computer tool of a bot on it and stops after REST_AFTER_MS unused (restIdle); boat.dev keeps its
// disk 14 days while it is stopped. boat.dev's own auto-stop (TTL_SECONDS, extended on use) is only the net under a
// botdot that stopped.
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJson } = require('./jsonfile');
const fs = require('fs');
const vaultFiles = require('./vault-files');
const computerMove = require('./computer-move');

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
// The account's machine, in boat-machines.json beside the bots' own (a bot id never holds an @), and a bot's folder
// there (#568): its commands start in it, as in /workspace/<bot> on the account's computer.
const ACCOUNT = '@account';
const folderOf = (botId) => `/home/user/workspace/${botId}`;
// The browser profile of the account's machine's one browser: every bot on it shares it, as its one desktop.
const ACCOUNT_PROFILE = 'account';
// How long boat.dev lets a new viewer open a desktop URL (docs.boat.dev/security): one that is open keeps playing.
const DESKTOP_URL_MS = 10 * 60_000;

// The screen kit (#563, ADR 094): what the desktop image carries for a screen, put on the machine by
// deploy/desktop/botdot-boat-kit. Its version is that of the script, so a changed kit is put there again; botdot's
// bridge (camoufox-browser), which changes more often, is replaced alone when it differs.
const DESKTOP = path.join(__dirname, '..', 'deploy', 'desktop');
const KIT = fs.readFileSync(path.join(DESKTOP, 'botdot-boat-kit'));
const BRIDGE = fs.readFileSync(path.join(DESKTOP, 'camoufox-browser'));
const KIT_VERSION = crypto.createHash('sha256').update(KIT).digest('hex').slice(0, 16);
const BRIDGE_SHA = crypto.createHash('sha256').update(BRIDGE).digest('hex');
const KIT_MS = Number(process.env.BOT_DOT_BOAT_KIT_MS) || 20 * 60_000;
// The machine's desktop is Xorg :0 (1920x1080); computer-server listens on the machine's loopback only, and the bridge
// on :0's socket and port, as camoufox-browser has them for display :0.
const SCREEN_PORT = 47100;
const BRIDGE_SOCKET = '/run/botdot-browser/bridge-0.sock';
const TYPE_SECRET = fs.readFileSync(path.join(DESKTOP, 'botdot-type-secret'), 'utf8');
// An HTTP request to computer-server, made in the machine: boat.dev's command API takes no input, so the body goes
// as base64 in an argument (it is no secret: a click, a text to type, a screenshot asked for). Exit 7: nothing listens
// (computer-server ended, and the request never reached it); 28: it took too long or broke off.
const HTTP_IN_MACHINE = `
import base64, sys, urllib.request, urllib.error
data = base64.b64decode(sys.argv[4]) or None
req = urllib.request.Request('http://127.0.0.1:%d' % int(sys.argv[3]) + sys.argv[1], data=data, headers={'Content-Type': 'application/json'})
try:
    with urllib.request.urlopen(req, timeout=float(sys.argv[2])) as r:
        sys.stdout.buffer.write(r.read())
except urllib.error.HTTPError as e:
    sys.stdout.buffer.write(e.read())
    sys.exit(22)
except urllib.error.URLError as e:
    sys.stdout.write(str(e.reason))
    sys.exit(7 if isinstance(e.reason, ConnectionRefusedError) else 28)
except ConnectionRefusedError as e:
    sys.stdout.write(str(e))
    sys.exit(7)
except OSError as e:
    sys.stdout.write(str(e))
    sys.exit(28)
`;

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

// A machine's name on boat.dev, so the admin sees there whose it is: botdot-<account> for the account's, and
// botdot-<account>-<bot's name>-<bot id> for a bot's own.
// Lowercase letters, digits and dashes only, at most 120 (boat.dev's limit). Machines are found by their id, never
// by this name, so a new name never loses one.
const slug = (v) => String(v || '').replace(/[łŁ]/g, 'l').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function machineName(botId, { account = '', botName = '' } = {}) {
  const head = ['botdot', slug(account).slice(0, 40)].filter(Boolean).join('-');
  if (botId === ACCOUNT) return head;
  const id = slug(botId);
  const name = slug(botName).slice(0, 120 - head.length - id.length - 2).replace(/-+$/, '');
  return [head, name, id].filter(Boolean).join('-').slice(0, 120);
}

const shq = (v) => `'${String(v).replace(/'/g, "'\\''")}'`;
const none = (error) => ({ code: null, stdout: '', stderr: '', timedOut: false, error });

// size: the account's choice of size (#539), read when a machine is made or started. account: this server's account
// (BOT_DOT_ACCOUNT); nameOf: a bot's name. Both go in its machine's name. ownOf(botId): whether the bot wants a machine
// of its own (#568), each one's own unless told.
function create(dataDir, { fetch = globalThis.fetch, now = Date.now, restAfterMs = REST_AFTER_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), startMs = 180_000, size = () => DEFAULT_SIZE, account = process.env.BOT_DOT_ACCOUNT || '', nameOf = () => null, ownOf = () => true } = {}) {
  const file = path.join(dataDir, 'boat-machines.json');
  const machines = readJson(file, {}); // ACCOUNT or a bot's id -> { id, type, name }
  const save = () => writeJson(file, machines);
  const api = (pathname, opts = {}) => call(pathname, { fetch, ...opts });

  // Which machine a bot works on: its own while it has one (one made before #568 too, until its files moved to the
  // account's) or wants one, else the account's. Below, `box` is ACCOUNT or the bot's id.
  const boxOf = (botId) => (machines[botId] || ownOf(botId) ? botId : ACCOUNT);
  // Where a bot's commands start on that machine: its home on its own, its folder on the account's.
  const dirOn = (box, botId) => (box === ACCOUNT ? folderOf(botId) : '/home/user');
  const inDir = (box, botId) => (box === ACCOUNT ? `mkdir -p -- ${shq(folderOf(botId))} && cd -- ${shq(folderOf(botId))} || exit 1\n` : '');

  // The machines started here and not stopped since, when each was last used and how many calls on it still run.
  const up = new Map(); // box -> { id, extendedAt }
  const usedAt = new Map();
  const busy = new Map();
  const starting = new Map(); // box -> Promise of its machine's id
  const stopping = new Map(); // box -> Promise of its stop, sent and not yet done
  const screens = new Map(); // box -> Promise of its screen up on the machine, since the machine last started
  // A machine running from before botdot started counts as used now, so it stops too when nothing uses it.
  for (const box of Object.keys(machines)) usedAt.set(box, now());

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
    screens.delete(botId); // a machine that starts again has nothing of its screen running
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
  function ensureBox(box) {
    if (up.has(box)) return Promise.resolve(up.get(box).id);
    if (!starting.has(box)) starting.set(box, bring(box).finally(() => starting.delete(box)));
    return starting.get(box);
  }
  const ensure = (botId) => ensureBox(boxOf(botId));
  // One use of a machine: started first, counted as used while it runs, its auto-stop pushed back now and then.
  async function usingBox(box, work) {
    busy.set(box, (busy.get(box) || 0) + 1);
    usedAt.set(box, now());
    try {
      const id = await ensureBox(box);
      const m = up.get(box);
      if (m && now() - m.extendedAt > EXTEND_AFTER_MS) {
        m.extendedAt = now();
        api(`/sandboxes/${id}`, { method: 'PATCH', body: { ttlSeconds: TTL_SECONDS } }).catch(() => {});
      }
      return await work(id);
    } finally {
      busy.set(box, busy.get(box) - 1);
      usedAt.set(box, now());
    }
  }
  // One use of the machine the bot works on: work(id, box).
  const using = (botId, work) => { const box = boxOf(botId); return usingBox(box, (id) => work(id, box)); };

  // One command in the bot's machine, as lib/computers.js resolves one: { code, stdout, stderr, timedOut, error }.
  async function command(id, cmd, seconds) {
    try {
      const r = await api(`/sandboxes/${id}/commands`, { method: 'POST', body: { command: cmd, timeoutSeconds: seconds }, ms: (seconds + 90) * 1000 });
      const cut = r.stdoutTruncated || r.stderrTruncated ? 'the output was cut off' : undefined;
      return { code: r.timedOut ? 124 : (typeof r.exitCode === 'number' ? r.exitCode : null), stdout: String(r.stdout || ''), stderr: String(r.stderr || ''), timedOut: !!r.timedOut, ...(cut ? { error: cut } : {}) };
    } catch (e) { return none(e.code === 'boat_direct_failed' ? 'boat.dev lost the command; it may have run' : e.message); }
  }
  const seconds = (n) => Math.min(Math.max(Math.round(Number(n) || 120), 1), 600);

  const runShell = (botId, { command: cmd, timeoutSeconds = 120 }) => using(botId, (id, box) => command(id, `${inDir(box, botId)}${cmd}`, seconds(timeoutSeconds)));
  const readFile = (botId, { path: f }) => using(botId, (id, box) => command(id, `${inDir(box, botId)}exec head -c ${FILE_MAX_BYTES} -- ${shq(f)}`, 60));
  // Bytes go through boat.dev's file API to a file of its own in /tmp (only there and in /home/user may it write),
  // then a command moves them where the bot said: any path, relative to its folder as on the account's computer.
  async function put(id, bytes, prefix = 'botdot-') {
    const tmp = `/tmp/${prefix}${crypto.randomBytes(8).toString('hex')}`;
    await api(`/sandboxes/${id}/files`, { method: 'PUT', body: { path: tmp, content: Buffer.from(bytes).toString('base64'), encoding: 'base64' } });
    return tmp;
  }
  const writeFile = (botId, { path: f, content }) => using(botId, async (id, box) => {
    let tmp;
    try { tmp = await put(id, Buffer.from(String(content), 'utf8')); } catch (e) { return none(e.message); }
    return command(id, `${inDir(box, botId)}d=$(dirname -- ${shq(f)}); mkdir -p -- "$d" && mv -f -- ${tmp} ${shq(f)} || { rm -f -- ${tmp}; exit 1; }`, 60);
  });
  const unpackFolder = (botId, { path: dir, tar }) => using(botId, async (id, box) => {
    let tmp;
    try { tmp = await put(id, Buffer.from(tar, 'base64')); } catch (e) { return none(e.message); }
    const d = shq(dir);
    return command(id, `${inDir(box, botId)}if [ -e ${d} ] && [ -n "$(ls -A -- ${d} 2>/dev/null)" ]; then rm -f -- ${tmp}; echo "${String(dir).replace(/["$`\\]/g, '')} is not empty: give a new folder" >&2; exit 3; fi; mkdir -p -- ${d} && tar -xf ${tmp} -C ${d} --no-same-owner --no-same-permissions; s=$?; rm -f -- ${tmp}; exit $s`, 60);
  });
  // A folder as a tar of plain files: made in /tmp by a command, read back through the file API. Resolves like
  // lib/computers.js packFolder: { code, tar (base64), stderr, error }.
  const packFolder = (botId, { path: dir }) => using(botId, async (id, box) => {
    const tmp = `/tmp/botdot-${crypto.randomBytes(8).toString('hex')}.tar`;
    const made = await command(id, `${inDir(box, botId)}[ -d ${shq(dir)} ] || { echo "${String(dir).replace(/["$`\\]/g, '')} is not a folder on your computer" >&2; exit 2; }; tar --format=ustar -cf ${tmp} -C ${shq(dir)} . && [ "$(stat -c %s ${tmp})" -le ${PACK_MAX_BYTES} ] || { rm -f ${tmp}; echo "the folder is too large for a page (over 5 MB)" >&2; exit 2; }`, 120);
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
  const runWithLogin = (botId, { command: cmd, username = '', password = '', env, timeoutSeconds = 120 }) => using(botId, (id, box) => {
    const vars = Object.entries(env || { BOTDOT_USERNAME: String(username), BOTDOT_PASSWORD: String(password) });
    if (vars.some(([name]) => !ENV_NAME.test(name))) return none('a login name makes no variable');
    const s = within(timeoutSeconds);
    return withSecret(id, Buffer.from(vars.map(([name, v]) => `export ${name}=${shq(v)}\n`).join('')),
      (f) => command(id, `${SWEEP}. ${f}; a=$?; rm -f -- ${f}; [ $a = 0 ] || exit 1; ${inDir(box, botId).replace(/\n$/, '; ')}exec timeout -k 5 ${s} sh -c ${shq(cmd)}`, s + 30));
  });
  const runWithSshKey = (botId, { command: cmd, privateKey = '', timeoutSeconds = 120 }) => using(botId, (id, box) => {
    const s = within(timeoutSeconds);
    const key = String(privateKey).endsWith('\n') ? String(privateKey) : `${privateKey}\n`;
    return withSecret(id, Buffer.from(key), (f) => command(id, [
      SWEEP,
      `command -v ssh-agent >/dev/null && command -v ssh-add >/dev/null || { rm -f -- ${f}; echo "your machine has no ssh-agent: install it with sudo apt-get install -y openssh-client, then try again" >&2; exit 127; }`,
      `chmod 600 ${f}; eval "$(ssh-agent -s -t ${s + 60})" >/dev/null || { rm -f -- ${f}; exit 1; }`,
      `ssh-add -q ${f} 2>/dev/null; a=$?; rm -f -- ${f}`,
      '[ $a = 0 ] || { ssh-agent -k >/dev/null 2>&1; echo "the SSH key could not be loaded" >&2; exit 1; }',
      `${box === ACCOUNT ? `mkdir -p -- ${shq(folderOf(botId))} && cd -- ${shq(folderOf(botId))} || { ssh-agent -k >/dev/null 2>&1; exit 1; }\n` : ''}timeout -k 5 ${s} sh -c ${shq(cmd)}; s=$?; ssh-agent -k >/dev/null 2>&1; exit $s`,
    ].join('\n'), s + 30));
  });
  const runWithFile = (botId, { command: cmd, fileName, content = '', timeoutSeconds = 120 }) => using(botId, (id, box) => {
    const s = within(timeoutSeconds);
    const name = vaultFiles.FILE_NAME.test(String(fileName)) ? String(fileName) : 'file';
    return withSecret(id, Buffer.from(String(content), 'base64'), (f) => command(id, [
      SWEEP,
      `mkdir -m 700 ${f}.d && mv -f -- ${f} ${f}.d/${name} && chmod 600 ${f}.d/${name} || { rm -rf -- ${f} ${f}.d; exit 1; }`,
      `${box === ACCOUNT ? `mkdir -p -- ${shq(folderOf(botId))} && cd -- ${shq(folderOf(botId))} || { rm -rf -- ${f}.d; exit 1; }\n` : ''}BOTDOT_FILE=${f}.d/${name} timeout -k 5 ${s} sh -c ${shq(cmd)}; s=$?; rm -rf -- ${f}.d; exit $s`,
    ].join('\n'), s + 30));
  });

  // The bot's folder copied to or from another of its computers (#556, #568, lib/computer-move.js): its folder (its own
  // machine's /home/user, or its folder on the account's) packed into one gzipped tar in /tmp (boat.dev's caches and
  // the shell's own dotfiles left out), handed out and taken in pieces through the file API, unpacked (a file of the
  // same name is replaced) and dropped. own: its own machine's side, else the account's. Its browser's profile (#565),
  // /home/browser/profiles/<bot>, the same way through sudo: Camoufox closed first, the profile taken in replacing the
  // old one whole, owned by the browser user, who is made as the screen kit makes it when the kit isn't there yet. A
  // copy to or from the account's machine takes no profile (its one browser is its bots', ADR 096).
  // Resolves as lib/computers.js moveFiles: { code, size?, data? (base64), stderr, error }.
  // One tar a bot for its folder: bots on the account's machine may move at once.
  const movesOf = (botId) => ({
    files: { tar: `/tmp/botdot-move-${botId}.tgz`, part: `/tmp/botdot-move-${botId}.part` },
    profile: { tar: '/tmp/botdot-profile.tgz', part: '/tmp/botdot-profile.part' },
  });
  const LEFT_OUT = ['.cache', '.npm', '.bashrc', '.profile', '.bash_logout', '.bash_history'].map((f) => `--exclude=./${f}`).join(' ');
  // The profile as "$P", never one word of the command, so pkill can't match the command itself.
  const profileOf = (botId) => `b=${shq(botId)}; P="/home/browser/profiles/$b"; `;
  const CLOSE_PROFILE = 'sudo -n pkill -u browser -f "$P( |/|\\$)" 2>/dev/null; for _ in $(seq 1 50); do sudo -n pgrep -u browser -f "$P( |/|\\$)" >/dev/null 2>&1 || break; sleep 0.2; done; ';
  const BROWSER_USER = 'id browser >/dev/null 2>&1 || sudo -n useradd --create-home --shell /usr/sbin/nologin --groups user browser || exit 1; '
    + 'sudo -n chmod 0700 /home/browser && sudo -n install -d -o browser -g browser -m 0700 /home/browser/profiles || exit 1; ';
  const moved = (r, more = {}) => (r.code === 0 ? { code: 0, ...more } : { code: r.code, stderr: r.stderr.trim().slice(-500), error: r.error || null });
  const moveFiles = (botId, { op, part = 'files', offset = 0, length = 0, data = '' }, { own = true } = {}) => usingBox(own ? botId : ACCOUNT, async (id) => {
    const box = own ? botId : ACCOUNT;
    const dir = shq(dirOn(box, botId));
    const at = Math.max(0, Math.floor(offset));
    const m = movesOf(botId)[part];
    if (!m) throw new Error('No such step of a copy');
    if (op === 'pack' && part === 'profile') {
      const T = m.tar;
      const r = await command(id, `${profileOf(botId)}sudo -n rm -f ${T}; sudo -n test -d "$P" || { echo 0; exit 0; }; ${CLOSE_PROFILE}sudo -n tar --ignore-failed-read -czf ${T} -C "$P" ${computerMove.PROFILE_LEFT_OUT} .; s=$?; [ $s -le 1 ] || exit $s; sudo -n chown "$(id -u)" ${T} && stat -c %s ${T}`, 600);
      return moved(r, { size: Number(r.stdout.trim()) || 0 });
    }
    if (op === 'pack') {
      const r = await command(id, `mkdir -p -- ${dir} && rm -f ${m.tar}; tar --ignore-failed-read -czf ${m.tar} -C ${dir} ${box === ACCOUNT ? '' : `${LEFT_OUT} `}.; s=$?; [ $s -le 1 ] || exit $s; stat -c %s ${m.tar}`, 600);
      return moved(r, { size: Number(r.stdout.trim()) || 0 });
    }
    if (op === 'read') {
      const r = await command(id, `tail -c +${at + 1} ${m.tar} | head -c ${Math.min(Math.max(0, Math.floor(length)), PACK_MAX_BYTES - 1024 * 1024)} > ${m.part}`, 120);
      if (r.code !== 0) return moved(r);
      try { return { code: 0, data: String((await api(`/sandboxes/${id}/files?path=${encodeURIComponent(m.part)}&encoding=base64`)).content || '') }; } catch (e) { return none(e.message); }
    }
    if (op === 'write') {
      try { await api(`/sandboxes/${id}/files`, { method: 'PUT', body: { path: m.part, content: data, encoding: 'base64' } }); } catch (e) { return none(e.message); }
      return moved(await command(id, `${at === 0 ? `: > ${m.tar} || exit 1; ` : ''}[ "$(stat -c %s ${m.tar})" = ${at} ] || { echo "a piece came out of order" >&2; exit 4; }; cat ${m.part} >> ${m.tar}; s=$?; rm -f ${m.part}; exit $s`, 120));
    }
    if (op === 'unpack' && part === 'profile') {
      const T = m.tar;
      return moved(await command(id, `${profileOf(botId)}${BROWSER_USER}${CLOSE_PROFILE}sudo -n rm -rf "$P.new" && sudo -n mkdir -p "$P.new" && sudo -n tar -xzf ${T} -C "$P.new" --no-same-owner `
        + `&& sudo -n chown -R browser:browser "$P.new" && sudo -n chmod 0700 "$P.new" && sudo -n rm -rf "$P" && sudo -n mv "$P.new" "$P"; s=$?; sudo -n rm -rf "$P.new"; rm -f ${T}; exit $s`, 600));
    }
    if (op === 'unpack') return moved(await command(id, `mkdir -p -- ${dir} && tar -xzf ${m.tar} -C ${dir} --no-same-owner; s=$?; rm -f ${m.tar}; exit $s`, 600));
    // A profile's tar is root's until its pack ends.
    if (op === 'drop') return moved(await command(id, `${part === 'profile' ? 'sudo -n ' : ''}rm -f ${m.tar} ${m.part}`, 60));
    throw new Error('No such step of a copy');
  });

  // A command started in the background on the bot's machine: it runs on after the call, until the machine stops.
  const detached = (id, cmd) => api(`/sandboxes/${id}/commands`, { method: 'POST', body: { command: cmd, detached: true } });

  // The bot's screen on its machine (#563, ADR 094): the machine's own desktop (:0), with cua's computer-server and
  // Camoufox's bridge as on the account's computer, started on the first screen tool after the machine started. The
  // kit is put on the machine first when it hasn't this version of it; the tool waits for that, and says why it failed.
  // An install still running (one that took longer than KIT_MS before) is waited for, never started twice.
  const KIT_STATE = `if [ -f /opt/botdot/kit-failed ]; then echo failed; cat /opt/botdot/kit-failed; tail -n 3 /opt/botdot/kit.log; elif [ "$(cat /opt/botdot/kit-version 2>/dev/null)" = ${KIT_VERSION} ]; then echo done; fi`;
  const INSTALLING = "pgrep -f 'botdot-[b]oat-kit' >/dev/null";
  async function putKit(id) {
    const dir = `/tmp/botdot-kit-${crypto.randomBytes(8).toString('hex')}`;
    const made = await command(id, `if ${INSTALLING}; then echo installing; else sudo -n rm -f /opt/botdot/kit-version /opt/botdot/kit-failed && mkdir -p ${dir}; fi`, 60);
    if (made.code !== 0) throw new Error(`botdot couldn't put the screen kit on your machine: ${(made.stderr || made.error || '').trim().slice(0, 300)}`);
    if (made.stdout.trim() !== 'installing') {
      for (const [name, bytes] of [['botdot-boat-kit', KIT], ['camoufox-browser', BRIDGE]]) await api(`/sandboxes/${id}/files`, { method: 'PUT', body: { path: `${dir}/${name}`, content: bytes.toString('base64'), encoding: 'base64' } });
      await detached(id, `exec sudo -n sh ${dir}/botdot-boat-kit ${KIT_VERSION} ${dir}`);
    }
    for (const until = now() + KIT_MS; ;) {
      await sleep(5000);
      const said = (await command(id, `${INSTALLING} && exit 0; ${KIT_STATE}`, 30)).stdout.trim();
      if (said === 'done') return;
      if (said.startsWith('failed')) throw new Error(`botdot couldn't put the screen kit on your machine, at ${said.slice(7).trim().slice(0, 500)}`);
      if (now() > until) throw new Error(`botdot's screen kit is still being put on your machine after ${Math.round(KIT_MS / 60_000)} minutes: try again in a few minutes`);
    }
  }
  // Ready once computer-server answers and the bridge listens on its socket.
  const screenUp = async (id) => (await command(id, `sudo -n test -S ${BRIDGE_SOCKET} || exit 9; ${httpCommand('/status', undefined, 3)}`, 20)).code === 0;
  // What runs of the screen, in one command: the kit's version first, then, with this kit, what is running, the bridge's
  // hash and the browser user let onto :0, which is kept awake. /run is new on each start of the machine.
  const PREP = [
    `[ "$(cat /opt/botdot/kit-version 2>/dev/null)" = ${KIT_VERSION} ] || { echo kit; exit 0; }`,
    'sudo -n install -d -o browser -g browser -m 0700 /run/botdot-browser || exit 1',
    'export DISPLAY=:0',
    'xhost +SI:localuser:browser >/dev/null 2>&1 || { echo "the machine\'s desktop (:0) did not let botdot in" >&2; exit 3; }',
    'xset s off s noblank -dpms 2>/dev/null',
    `pgrep -f 'computer_[s]erver --host 127.0.0.1 --port ${SCREEN_PORT}' >/dev/null && echo server`,
    "pgrep -f 'camoufox-[b]rowser --serve :0 ' >/dev/null && echo bridge",
    'echo "sha $(sha256sum /usr/local/bin/camoufox-browser 2>/dev/null | cut -c1-64)"',
    'exit 0',
  ].join('\n');
  // The bridge serves the bot's own profile on its own machine, the account machine's one profile on that machine.
  async function startScreen(box, id) {
    let prep = await command(id, PREP, 60);
    if (prep.code === 0 && prep.stdout.trim() === 'kit') { await putKit(id); prep = await command(id, PREP, 60); }
    if (prep.code !== 0 || prep.stdout.trim() === 'kit') throw new Error(`your machine's screen didn't start: ${(prep.stderr || prep.error || 'the screen kit is not there').trim().slice(0, 300)}`);
    const said = prep.stdout.split('\n').map((l) => l.trim());
    let bridge = said.includes('bridge');
    // A newer bridge than the machine's goes there alone, and one running of the old one ends.
    if (!said.includes(`sha ${BRIDGE_SHA}`)) {
      const tmp = await put(id, BRIDGE);
      const swapped = await command(id, `sudo -n install -m 0755 ${tmp} /usr/local/bin/camoufox-browser; s=$?; rm -f ${tmp}; [ $s = 0 ] || exit $s; sudo -n pkill -f 'camoufox-[b]rowser --serve :0 '; sudo -n pkill -u browser -f '/home/browser/profiles/'; exit 0`, 60);
      if (swapped.code !== 0) throw new Error(`your machine's screen didn't start: ${(swapped.stderr || swapped.error || '').trim().slice(0, 300)}`);
      bridge = false;
    }
    if (!said.includes('server')) await detached(id, `cd /home/user && exec env DISPLAY=:0 PYTHONUNBUFFERED=1 /opt/computer-server/venv/bin/python -m computer_server --host 127.0.0.1 --port ${SCREEN_PORT}`);
    if (!bridge) await detached(id, `cd / && exec sudo -n -u browser env HOME=/home/browser DISPLAY=:0 XDG_CACHE_HOME=/opt/camoufox-cache BOTDOT_DOWNLOADS=/home/user/Downloads /usr/local/bin/camoufox-browser --serve :0 ${shq(box === ACCOUNT ? ACCOUNT_PROFILE : box)}`);
    for (const until = now() + 60_000; !(await screenUp(id));) {
      if (now() > until) throw new Error("your machine's screen didn't start in time");
      await sleep(1500);
    }
  }
  function screenOf(box, id) {
    if (!screens.has(box)) screens.set(box, startScreen(box, id).catch((e) => { screens.delete(box); throw e; }));
    return screens.get(box);
  }
  const ensureScreen = (botId) => using(botId, (id, box) => screenOf(box, id));
  function httpCommand(pathname, body, seconds) {
    const b64 = body === undefined ? '' : Buffer.from(JSON.stringify(body)).toString('base64');
    return `python3 -I -c ${shq(HTTP_IN_MACHINE)} ${shq(pathname)} ${seconds} ${SCREEN_PORT} ${shq(b64)}`;
  }
  // A request to the screen's computer-server, as lib/computers.js request: { ok, text }. A computer-server that
  // ended (boat.dev stopped the machine meanwhile) is started again and asked again, once: the request never reached
  // it. One that took too long is not asked again.
  const request = (botId, pathname, body, { timeoutSeconds = 120 } = {}) => using(botId, async (id, box) => {
    await screenOf(box, id);
    const ask = () => command(id, httpCommand(pathname, body, timeoutSeconds), Math.min(timeoutSeconds + 15, 600));
    let r = await ask();
    if (r.code === 7) { screens.delete(box); await screenOf(box, id); r = await ask(); }
    return { ok: r.code === 0, text: r.code === 0 ? r.stdout : (r.stdout || r.stderr || r.error || '').trim() };
  });
  // The bridge in Camoufox, as lib/computers.js askBridge: botdot's own copy of botdot-type-secret, run as the browser
  // user, hands it one JSON request. A browser tool's goes as base64 in an argument; a typed secret goes through the
  // file API to a file of its own, which the command opens and removes before the helper starts, so it is in no
  // file while it is typed and never on a command line (as ADR 092). Answers, never throws.
  const UNREACHABLE = { ok: false, error: "Couldn't reach the bot's browser." };
  const toBridge = (input) => `${input} | sudo -n -u browser /usr/bin/python3 -I -c ${shq(TYPE_SECRET)} ${BRIDGE_SOCKET}`;
  const answer = (r) => { try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch { return r.error ? { ok: false, error: r.error } : UNREACHABLE; } };
  const browserTool = (botId, payload) => using(botId, async (id, box) => {
    await screenOf(box, id);
    return answer(await command(id, toBridge(`printf %s ${shq(Buffer.from(JSON.stringify(payload)).toString('base64'))} | base64 -d`), 60));
  }).catch((e) => ({ ok: false, error: `Couldn't reach the browser: ${e.message}` }));
  const typeSecret = (botId, payload) => using(botId, async (id, box) => {
    await screenOf(box, id);
    let tmp;
    try { tmp = await put(id, Buffer.from(JSON.stringify(payload)), 'botdot-secret-'); } catch (e) { return { ok: false, error: e.message }; }
    return answer(await command(id, `${SWEEP}exec 3< ${tmp} && rm -f -- ${tmp} || { rm -f -- ${tmp}; exit 1; }\n${toBridge('cat <&3')}`, 60));
  }).catch((e) => ({ ok: false, error: `Couldn't reach the browser: ${e.message}` }));
  // A program on the machine's screen, detached: it ends when the machine stops.
  const startProgram = (botId, cmd) => using(botId, async (id, box) => {
    await screenOf(box, id);
    await detached(id, `${box === ACCOUNT ? inDir(box, botId) : 'cd /home/user && '}exec env DISPLAY=:0 sh -c ${shq(cmd)}`);
  });

  // The machine's desktop for the owner (#564): a new stream URL from boat.dev each time the app asks, never kept or
  // logged (anyone who has it may attach to the desktop, and may open it for DESKTOP_URL_MS). A machine that is not on
  // starts in the background and answers { starting: true } until it runs, as boat.dev does while it readies its
  // desktop. Each ask counts as use: the app asks again every few minutes while the owner watches.
  const startFailed = new Map(); // box -> what went wrong in a start the owner's ask began
  async function desktop(botId) {
    const box = boxOf(botId);
    usedAt.set(box, now());
    if (!up.has(box)) {
      const failed = startFailed.get(box);
      if (failed) { startFailed.delete(box); throw new Error(failed); }
      if (!starting.has(box)) ensureBox(box).catch((e) => { startFailed.set(box, e.message); });
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

  // The machines unused for longer than the rest time (by every bot on it) stop, each once: boat.dev keeps their disk,
  // and the next computer tool starts one again. The machines that stopped: the account's (ACCOUNT) or a bot's id.
  async function restIdle() {
    const stopped = [];
    for (const [box, at] of usedAt) {
      if (busy.get(box) || starting.has(box) || now() - at <= restAfterMs) continue;
      const id = machines[box]?.id;
      if (id && !key) continue; // stopped once a key is back
      usedAt.delete(box);
      up.delete(box);
      screens.delete(box);
      if (!id) continue;
      const stop = api(`/sandboxes/${id}/stop`, { method: 'POST', body: {} }).then(() => { stopped.push(box); }, (e) => {
        if (e.status !== 409) console.warn(`[boat] couldn't stop the idle machine of ${box}: ${e.message}`);
      }).finally(() => stopping.delete(box));
      stopping.set(box, stop);
      await stop;
    }
    return stopped;
  }
  // A deleted bot, or one that no longer works on a machine of its own on boat.dev: its own machine stops and is
  // forgotten. Its disk is not erased: boat.dev drops it 14 days after it stopped. The account's machine is no one
  // bot's: its folder there stays, as the bots' folders on the account's computer do.
  async function forget(botId) {
    if (botId === ACCOUNT) return;
    const id = machines[botId]?.id;
    up.delete(botId); usedAt.delete(botId); screens.delete(botId);
    if (!id) return;
    delete machines[botId];
    save();
    if (key) await api(`/sandboxes/${id}/stop`, { method: 'POST', body: {} }).catch(() => {});
  }
  // Whether the bot has a machine of its own, made before #568 too.
  const has = (botId) => botId !== ACCOUNT && !!machines[botId];
  const isUp = (botId) => up.has(boxOf(botId));
  // The machine the bot works on as the owner sees it: its state, its size, whether the account's bots share it, and a
  // line in the server's words. One not made yet is described at the size it will be made at.
  function info(botId) {
    const box = boxOf(botId);
    const state = up.has(box) ? 'running' : starting.has(box) ? 'starting' : machines[box] ? 'stopped' : 'none';
    const s = SIZES.find((x) => x.id === cleanSize(machines[box]?.type || size()));
    const words = { running: 'on', starting: 'starting', stopped: 'stopped', none: 'not made yet' }[state];
    return { state, size: s.id, shared: box === ACCOUNT, text: `boat.dev · ${s.cpus} CPUs · ${s.memoryGB} GB · ${words}` };
  }
  return { ensure, ensureScreen, desktop, request, browserTool, typeSecret, startProgram, runShell, readFile, writeFile, runWithLogin, runWithSshKey, runWithFile, packFolder, unpackFolder, moveFiles, restIdle, forget, has, isUp, info };
}

module.exports = { create, ACCOUNT, folderOf, DESKTOP_URL_MS, KIT_VERSION, BRIDGE_SHA, machineName, setKey, configured, checkKey, sizes, cleanSize, SIZE_IDS, DEFAULT_SIZE, KEY, REST_AFTER_MS };
