// First-run setup (data/setup.json): whether you've finished it, the time zone schedules use, and
// signing in to Claude from the browser.
//
// Sign-in runs `claude auth login`, which prints a link and then waits for the code the sign-in page
// shows. The page shows that link, and passes the code you paste back in. No terminal needed, so it
// works the same in Docker, on a Linux VM and on a Mac.
const fs = require('fs');
const path = require('path');
const { spawn, execFile, execFileSync } = require('child_process');
const { claudeTooOld } = require('./problems');

const LOGIN_TIMEOUT_MS = 10 * 60_000; // an abandoned sign-in is stopped after this
const TZ_RE = /^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+){0,2}$/;

function validTimezone(tz) {
  if (!TZ_RE.test(String(tz || ''))) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}

// What botdot knows of the Claude Code it starts, asked of the program itself, once per botdot start:
// { version, promptFile }. version: what `claude --version` says, or null. promptFile: whether it takes its
// appended prompt from a file (ADR 014). Its help text does not list that flag and botdot keeps no table of
// versions, so it is asked: started with the flag and a file that does not exist, a Claude Code that knows the
// flag says the file is missing, and one that does not says "unknown option". Both end at once, signed in or not,
// and ask no model. Only that second answer counts as "does not know": whatever else it says, a run started with
// the flag shows it, and no run is ever started with the prompt as an argument.
const PROMPT_FILE_FLAG = '--append-system-prompt-file';
const NO_SUCH_FILE = path.join(path.sep, 'botdot-asks', 'no-such-prompt-file');
const asked = new Map(); // claudeBin -> { version, promptFile }
function claudeCode(claudeBin) {
  if (!claudeBin) return { version: null, promptFile: true }; // no Claude Code at all is said in its own words
  if (asked.has(claudeBin)) return asked.get(claudeBin);
  const run = (args) => execFileSync(claudeBin, args, { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const facts = { version: null, promptFile: true };
  try { facts.version = run(['--version']).trim() || null; } catch { /* it does not say */ }
  // It ends with an error either way: what it wrote says which.
  try { run(['-p', PROMPT_FILE_FLAG, NO_SUCH_FILE]); } catch (e) { facts.promptFile = !/unknown option\W+--append-system-prompt-file/i.test(`${e.stderr || ''}\n${e.stdout || ''}`); }
  asked.set(claudeBin, facts);
  return facts;
}

// What one check says of Claude's sign-in (claudeStatus): true (signed in), false (signed out), or null when
// botdot could not tell: the check failed, took too long or answered something unreadable (`error`), or Claude
// Code is not installed. "Could not tell" is never "signed out": the apps and the scheduler hear nothing of it.
// A status whose `error` is about something else, a Claude Code too old for botdot, keeps what its check said
// (`said`): the apps show that sentence, and botdot still knows whether Claude is signed in.
const said = new WeakMap(); // such a status -> what its check said
const signedIn = (status) => (said.has(status) ? said.get(status) : status && status.installed && !status.error ? status.loggedIn === true : null);

function create(dataDir, { claudeBin }) {
  const FILE = path.join(dataDir, 'setup.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
  const save = (d) => {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n');
  };

  // A time zone chosen here wins over TZ from the environment. Node picks the change up at once,
  // and new runs inherit it.
  const saved = load().timezone;
  if (saved && validTimezone(saved)) process.env.TZ = saved;
  const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  // chiefNameAsked: the owner answered (or skipped) the question for the Chief's name (#41); the name itself is a setting.
  function update({ done, timezone: tz, chiefNameAsked } = {}) {
    const d = load();
    if (done !== undefined) d.done = !!done;
    if (chiefNameAsked !== undefined) d.chiefNameAsked = !!chiefNameAsked;
    if (tz !== undefined) {
      if (!validTimezone(tz)) throw new Error(`"${tz}" isn't a time zone botdot knows.`);
      d.timezone = tz;
      process.env.TZ = tz;
    }
    save(d);
    return d;
  }

  // ---------- Claude sign-in ----------

  let claudeCache = null; // { at, value }
  // Counts the sign-ins and sign-outs, each as it starts and as it ends. A check that saw one of them begin or
  // end while it ran asks again: its answer may be from before, and would undo the change (a sign-out that holds
  // what waits, then a late "signed in" that starts it).
  let changes = 0;
  // What Claude Code says of its sign-in. `error`: botdot could not tell (the check failed, took too long, or
  // answered something it cannot read). That is never "signed out": `loggedIn` says nothing then (signedIn).
  function claudeStatus(force = false) {
    if (!force && claudeCache && Date.now() - claudeCache.at < 20_000) return Promise.resolve(claudeCache.value);
    return new Promise((resolve) => {
      if (!claudeBin) return resolve({ installed: false, loggedIn: false });
      const since = changes;
      execFile(claudeBin, ['auth', 'status', '--json'], { timeout: 20_000 }, (err, stdout) => {
        if (since !== changes) return resolve(claudeStatus(true));
        let value;
        try {
          const j = JSON.parse(stdout);
          if (typeof j?.loggedIn !== 'boolean') throw new Error('it does not say');
          value = { installed: true, loggedIn: !!j.loggedIn, email: j.email || null, method: j.authMethod || null, org: j.orgName || null, fromEnv: !!process.env.CLAUDE_CODE_OAUTH_TOKEN };
        } catch {
          value = { installed: true, loggedIn: false, error: 'Could not ask Claude Code whether it is signed in.' };
        }
        // A Claude Code too old for the private prompt file (ADR 014): the checklist says that sentence in the
        // place of its sign-in, which is of no use until Claude Code is updated.
        const code = claudeCode(claudeBin);
        if (!code.promptFile) {
          const check = signedIn(value);
          value = { ...value, error: claudeTooOld(code.version) };
          said.set(value, check);
        }
        claudeCache = { at: Date.now(), value };
        resolve(value);
      });
    });
  }

  let login = null; // { proc, url, output, exited, code }

  function stopLogin() {
    if (login && !login.exited) { try { login.proc.kill(); } catch { /* gone */ } }
    if (login) clearTimeout(login.timer);
    login = null;
  }

  // Start signing in; resolves with the link to open.
  function startLogin() {
    stopLogin();
    if (!claudeBin) return Promise.reject(new Error('Claude Code isn\'t installed on this machine.'));
    const proc = spawn(claudeBin, ['auth', 'login', '--claudeai'], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    const L = { proc, url: null, output: '', exited: false, code: null };
    L.timer = setTimeout(() => { if (login === L) stopLogin(); }, LOGIN_TIMEOUT_MS);
    L.timer.unref?.();
    login = L;
    return new Promise((resolve, reject) => {
      const onData = (d) => {
        L.output = (L.output + d).slice(-20_000);
        const m = !L.url && L.output.match(/https:\/\/\S*oauth\/authorize\?\S+/);
        if (m) { L.url = m[0]; resolve({ url: L.url }); }
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);
      proc.on('error', (e) => { L.exited = true; reject(e); });
      proc.on('exit', (code) => {
        L.exited = true;
        L.code = code;
        changes++;
        claudeCache = null;
        if (!L.url) reject(new Error(loginError(L.output) || 'Claude Code stopped before showing a sign-in link.'));
      });
      setTimeout(() => { if (!L.url) { reject(new Error('Claude Code didn\'t show a sign-in link. Try again.')); if (login === L) stopLogin(); } }, 30_000).unref?.();
    });
  }

  function loginError(out) {
    const m = String(out).match(/Login failed:?\s*([^\n]*)/i) || String(out).match(/Error:?\s*([^\n]*)/);
    return m ? m[0].trim() : '';
  }

  // Pass the code from the sign-in page; resolves with the new status: signed in, or a check that could not tell.
  async function submitCode(code) {
    code = String(code || '').trim();
    if (!code || code.length > 1000 || /\s/.test(code)) throw new Error('Paste the whole code from the sign-in page.');
    const L = login;
    if (!L || L.exited) throw new Error('The sign-in expired. Start again.');
    const before = L.output.length;
    L.proc.stdin.write(code + '\n');
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 60_000);
      L.proc.on('exit', () => { clearTimeout(t); resolve(); });
    });
    const status = await claudeStatus(true);
    const after = L.output.slice(before);
    if (login === L) stopLogin();
    // Only a check that says "signed out" means the code did not work: one that could not tell is answered as
    // it is, with its `error`.
    if (signedIn(status) === false) {
      const why = loginError(after);
      throw new Error(`That code didn't work${why ? ` (${why.replace(/^Login failed:?\s*/i, '')})` : ''}. Codes work once and only for a few minutes, so start again and paste the new one.`);
    }
    return status;
  }

  // Sign out: forget botdot's saved sign-in. A token set in the server's environment can't be
  // removed from here. Resolves with the new status: signed out, or a check that could not tell, which is not
  // taken for signed out (signedIn).
  function logout() {
    stopLogin();
    if (!claudeBin) return Promise.reject(new Error('Claude Code isn\'t installed on this machine.'));
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return Promise.reject(new Error('Claude is signed in with a token from the server\'s settings, so it can\'t be signed out here.'));
    changes++;
    return new Promise((resolve, reject) => {
      execFile(claudeBin, ['auth', 'logout'], { timeout: 20_000 }, async (err, stdout, stderr) => {
        changes++;
        claudeCache = null;
        const status = await claudeStatus(true);
        if (signedIn(status) === true) return reject(new Error(`Couldn't sign out of Claude${err ? `: ${String(stderr || err.message).trim().split('\n')[0]}` : ''}.`));
        resolve(status);
      });
    });
  }

  return {
    get: () => ({ done: !!load().done, timezone: timezone(), savedTimezone: load().timezone || null, chiefNameAsked: !!load().chiefNameAsked }),
    update,
    claudeStatus,
    startLogin,
    submitCode,
    cancelLogin: stopLogin,
    logout,
    validTimezone,
  };
}

module.exports = { create, validTimezone, signedIn, claudeCode, PROMPT_FILE_FLAG };
