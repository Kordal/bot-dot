// The words for a step of work, decided once (CONTEXT.md, "Working line"; docs/api.md, "The working line").
//
// A step goes in: a tool call of a bot or of the Chief of Staff ({ tool, input }), a phase ({ phase: 'computer' }: the bot's computer starts) or
// a job that runs ({ job: <its name> }). One short plain line comes out ("Reading nytimes.com"), or null for a
// step that has no words: the line then stays as it was.
//
// A line is plain text, cut here: a host name and not a whole address, a file's name and not its path, a
// command's description in the bot's own words (#232) or its tool's kind, never the command, and never what was
// typed, searched for or sent. No app tidies it.
//
// The same file holds the words a step has once it is done ("read https://…"), for the index of past runs and
// for the simple form of a run's stream, and the pace a line changes at.
const path = require('path');

const MAX = 80; // the words of a step, in characters. An opening line passes as it was read: up to 120 (opening-line.js)
const OPENER_MAX = 120; // so a working line is at most this long
const EVERY_MS = Number(process.env.BOT_DOT_LINE_EVERY_MS) > 0 ? Number(process.env.BOT_DOT_LINE_EVERY_MS) : 1000; // a test sets it short

// A piece of a line that came from outside (a name, a host): on one line, without what is not text, cut.
const piece = (t, n) => {
  if (typeof t !== 'string') return '';
  const flat = [...t.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim()];
  return flat.slice(0, n).join('').trim(); // no ellipsis: the apps draw their own after a line
};
// The host of a web address, without "www." and without the name or password an address may hold; '' for
// anything that is not one.
function hostOf(u) {
  try {
    const url = new URL(String(u));
    return /^https?:$/.test(url.protocol) ? piece(url.hostname.replace(/^www\./, ''), 60) : '';
  } catch { return ''; }
}
// A file's name, without the folders it is in.
const fileOf = (p) => (typeof p === 'string' ? piece(path.basename(p.replace(/\\/g, '/')), 40) : '');
// A name made of letters, digits and a few signs (a skill, a connected app): '' when it is anything else.
const nameOf = (t, n = 40) => (typeof t === 'string' && /^[\p{L}\p{N} _.:-]+$/u.test(t.trim()) ? piece(t, n) : '');

// A command step: the bot's own description of it, cut, else the tool's own phrase.
const told = (i, kind) => piece(i.description, MAX) || kind;

const COMPUTER = {
  open_browser: (i) => (hostOf(i.url) ? `Opening ${hostOf(i.url)}` : 'Opening the browser'),
  browser_goto: (i) => (hostOf(i.url) ? `Opening ${hostOf(i.url)}` : 'Opening a page'),
  type_login: () => 'Signing in with a saved login',
  type_card: () => 'Paying with a saved card',
  type_identity: () => 'Filling in a form',
  run_shell: (i) => told(i, 'Running a command on its computer'),
  run_with_login: (i) => told(i, 'Running a command with a saved login'),
  run_with_ssh_key: (i) => told(i, 'Running a command with a saved SSH key'),
  run_with_file: (i) => told(i, 'Running a command with a saved file'),
  place_secret_file: () => 'Keeping a saved secret in a file',
  start_program: (i) => told(i, 'Starting a program on its computer'),
  screenshot: () => 'Looking at its screen', click: () => 'Clicking', type_text: () => 'Typing', press_keys: () => 'Pressing keys', scroll: () => 'Scrolling',
  read_file: () => 'Reading a file on its computer', write_file: () => 'Saving a file on its computer',
};
const SELF = {
  recall: 'Looking through its memory', read_run: 'Reading an earlier run',
  list_jobs: 'Looking at its jobs', add_job: 'Setting up a job', update_job: 'Changing a job', remove_job: 'Removing a job',
  remind_me: 'Setting a reminder', list_reminders: 'Looking at its reminders', cancel_reminder: 'Cancelling a reminder',
  propose_job_call: 'Setting up a call', job_call: 'Looking at a call', job_call_off: 'Turning off a call',
  propose_job_notify: 'Setting up a notify address', job_notify_off: 'Turning off a notify address',
  ask_permission: 'Asking for your OK', ask_override: 'Asking for your OK', ask_skill: 'Asking for a skill', ask_chief_for_tool: 'Asking the Chief of Staff for a tool', ask_chief_for_app: 'Asking the Chief of Staff for an app',
  remember: 'Saving a note', update_memory: 'Correcting a note', remove_note: 'Removing a note', restore_note: 'Bringing a note back', forget: 'Forgetting', set_pin: 'Pinning a note',
  create_skill: 'Writing a skill', update_skill: 'Changing a skill',
  list_teammates: 'Looking at its teammates', send_to_chief: 'Writing to the Chief of Staff',
  set_tile: 'Updating the Board', suggest_tile: 'Suggesting a tile', update_instructions: 'Proposing a change to itself',
  attach_file: 'Attaching a file', pin_file: 'Keeping a file in mind', notify_owner: 'Writing to you',
};
const TOOLS = {
  WebFetch: (i) => (hostOf(i.url) ? `Reading ${hostOf(i.url)}` : 'Reading a web page'),
  WebSearch: () => 'Searching the web',
  Bash: (i) => told(i, 'Running a command'),
  Read: (i) => (fileOf(i.file_path) ? `Reading ${fileOf(i.file_path)}` : 'Reading a file'),
  Write: (i) => (fileOf(i.file_path) ? `Writing ${fileOf(i.file_path)}` : 'Writing a file'),
  Edit: (i) => (fileOf(i.file_path) ? `Changing ${fileOf(i.file_path)}` : 'Changing a file'),
  MultiEdit: (i) => (fileOf(i.file_path) ? `Changing ${fileOf(i.file_path)}` : 'Changing a file'),
  NotebookEdit: (i) => (fileOf(i.notebook_path) ? `Changing ${fileOf(i.notebook_path)}` : 'Changing a file'),
  Grep: () => 'Looking through its files', Glob: () => 'Looking through its files', LS: () => 'Looking through its files',
  Task: () => 'Asking a helper', Agent: () => 'Asking a helper',
  Skill: (i) => { const s = nameOf(String(i.skill || '').replace(/^botdot:/, '')); return s ? `Using the skill ${s}` : 'Using a skill'; },
  mcp__vault__request_login: () => 'Asking you for a login',
  mcp__vault__api_request: (i) => (hostOf(i.url) ? `Calling ${hostOf(i.url)}` : 'Calling an API'),
  mcp__connectors__connector_run: (i) => (nameOf(i.app) ? `Using ${nameOf(i.app)}` : 'Using a connected app'),
};
// The Chief of Staff's own tools (lib/mcp-server.js, "mcp__botdot__<name>"): its words while one of them runs, in
// the line under its name. For a tool a bot can also use the Chief's line reads the bot's words, above.
const CHIEF = {
  list_groups: 'Reading the groups', create_group: 'Making a group', update_group: 'Changing a group',
  list_vault: 'Checking your saved logins', request_login: 'Waiting for you to add the login', create_ssh_key: 'Making an SSH key', update_vault_item: 'Changing an SSH key', remove_vault_item: 'Asking you to remove a Vault entry',
  ask_install_skill: 'Asking you for a skill', list_skills: 'Checking the skills', create_skill: 'Writing a skill', update_skill: 'Updating a skill',
  find_tool: 'Looking for a tool', ask_install_tool: 'Asking you for a tool', list_tools: 'Checking the tools', remove_tool: 'Removing a tool',
  list_connectors: 'Checking the connected apps', connector_grants: 'Checking what it may do in apps', remove_connector_grant: 'Removing an app permission', after_web_grants: 'Checking what it may do after the web', remove_after_web_grant: 'Removing a permission',
  recall: 'Looking through memory', memory_status: 'Checking memory', set_memory_settings: 'Changing a setting', download_search_model: 'Getting the search model', review_memory: 'Reviewing memory',
  set_quiet_hours: 'Setting quiet hours', writing_first: 'Changing a setting', checkup_settings: 'Changing a setting', checkup: 'Doing a checkup', set_your_name: 'Changing its name',
  remember: 'Saving a note', list_notes: 'Reading notes', update_note: 'Correcting a note', remove_note: 'Removing a note', restore_note: 'Bringing a note back', forget: 'Forgetting',
  get_board: 'Looking at the Board', test_tile: 'Testing a tile', add_tile: 'Adding a tile', update_tile: 'Changing a tile', remove_tile: 'Removing a tile', arrange_board: 'Arranging the Board',
  list_bots: 'Checking your bots', get_bot: 'Looking at a bot', create_bot: 'Creating a bot', duplicate_bot: 'Copying a bot', update_bot: 'Updating a bot', delete_bot: 'Removing a bot', list_bot_files: "Checking a bot's files", delete_bot_file: 'Deleting a file',
  add_job: 'Setting up a job', update_job: 'Changing a job', remove_job: 'Removing a job', run_job: 'Starting a job',
  propose_job_call: 'Setting up a call', job_call: 'Looking at a call', new_job_call_key: 'Making a new key', job_call_off: 'Turning off a call',
  propose_job_notify: 'Setting up a notify address', new_job_notify_secret: 'Making a new secret', job_notify_off: 'Turning off a notify address',
  run_bot: 'Starting a bot', get_run: 'Checking results', list_runs: 'Checking recent runs', stop_run: 'Stopping a run',
  computer_status: "Checking the account's computer", computer_logs: "Reading the computer's logs", restart_computer: "Restarting the account's computer", reset_computer: "Asking you to reset the computer",
  remind_me: 'Setting a reminder', list_reminders: 'Checking the reminders', cancel_reminder: 'Cancelling a reminder',
};
const KINDS = [[/^mcp__computer__/, 'Using its computer'], [/^mcp__vault__/, 'Using a saved login'], [/^mcp__connectors__/, 'Using a connected app'], [/^mcp__self__/, 'Looking after its notes and jobs']];

// The line of a tool call, or null. who(to): the name of the bot a message goes to, or '' (the caller knows the
// bots). whose(runId): the name of the bot whose run the Chief waits for, or ''.
function toolWords(tool, input, who, whose) {
  if (typeof tool !== 'string') return null;
  const i = input && typeof input === 'object' ? input : {};
  if (tool === 'mcp__botdot__wait_for_run') {
    const name = piece(typeof whose === 'function' && typeof i.runId === 'string' ? whose(i.runId) : '', 40);
    return name ? `Waiting for ${name}` : 'Waiting for the bot to finish';
  }
  if (tool.startsWith('mcp__botdot__')) return Object.hasOwn(CHIEF, tool.slice(13)) ? CHIEF[tool.slice(13)] : null;
  if (tool === 'mcp__self__message_bot') {
    const name = piece(typeof who === 'function' ? who(i.to) : '', 40);
    return name ? `Messaging ${name}` : 'Messaging a teammate';
  }
  if (tool.startsWith('mcp__computer__') && Object.hasOwn(COMPUTER, tool.slice(15))) return COMPUTER[tool.slice(15)](i);
  if (tool.startsWith('mcp__self__') && Object.hasOwn(SELF, tool.slice(11))) return SELF[tool.slice(11)];
  if (Object.hasOwn(TOOLS, tool)) return TOOLS[tool](i);
  return KINDS.find(([re]) => re.test(tool))?.[1] || null; // a tool nobody knows, or Claude Code's own housekeeping: no words
}

// A step in, one short plain line or null out.
//   { tool, input }       a tool call
//   { phase: 'computer' } the bot's computer starts
//   { job: 'Disk check' } a job runs
// who, whose: see toolWords.
function words(step, { who, whose } = {}) {
  if (!step || typeof step !== 'object') return null;
  const said = step.phase === 'computer' ? 'Starting its computer'
    : typeof step.job === 'string' ? (piece(step.job, 60) ? `Running ${piece(step.job, 60)}` : null)
      : toolWords(step.tool, step.input, who, whose);
  return said ? piece(said, MAX) || null : null;
}

// No flicker: a line changes at most once in `everyMs`, and the last change always goes out. say(text) hands in
// what the line reads now; send(text) is called at once when the last change is old enough, else when it is, with
// the newest text only. A text that is the one already sent is not sent again. end(): nothing more goes out.
// now, later, cancel: the clock, for a test that does not wait.
function pacer(send, { everyMs = EVERY_MS, now = Date.now, later = setTimeout, cancel = clearTimeout } = {}) {
  let sent = null;
  let sentAt = -Infinity;
  let next = null; // what waits for its time
  let timer = null;
  let over = false;
  const go = () => {
    timer = null;
    const text = next;
    next = null;
    if (over || text === null || text === sent) return;
    sent = text;
    sentAt = now();
    send(text);
  };
  return {
    say(text) {
      if (over || typeof text !== 'string' || !text) return;
      next = text;
      if (timer !== null) return;
      const wait = sentAt + everyMs - now();
      if (wait <= 0) return go();
      timer = later(go, wait);
      timer?.unref?.();
    },
    end() { over = true; if (timer !== null) cancel(timer); timer = null; next = null; },
    // What was said so far is not the line: the change that waits is dropped and nothing is kept. Nothing is sent
    // (a line has no empty text), and the next change still waits for its second.
    forget() { if (timer !== null) cancel(timer); timer = null; next = null; sent = null; },
    sent: () => sent,
  };
}

// The working line of one run or one reply, as its work goes on. It reads, first of these that there is: the
// phase it is in, the words of its latest step that had words, its opening line, its job. (The step that comes
// with the opening line is what that line announced: who reads the run does not hand it in, see bots.js.)
// send(text): the line changed (paced, see pacer). opts: pacer's, and `who` for words().
function follow(send, opts = {}) {
  const pace = pacer(send, opts);
  const at = { job: null, opener: null, step: null, phase: null };
  const say = () => pace.say(at.phase || at.step || at.opener || at.job || '');
  return {
    job(name) { at.job = words({ job: name }); say(); },
    opener(text) { if (typeof text === 'string' && text.trim()) { at.opener = piece(text, OPENER_MAX); say(); } },
    step(tool, input) { const w = words({ tool, input }, opts); if (w) { at.step = w; say(); } },
    phase(name) { at.phase = name ? words({ phase: name }) : null; say(); },
    // A new start of the same run (its sign-in was renewed): what the first start said is not its line. The line is
    // its job again, also for the apps: a change of the first start that still waited is dropped, and the job is
    // sent when something else was. A run that is no job's has no line again; the apps cannot be told that (a line
    // has no empty text), and need not be: bots.js starts a run again only when it took no step, so only a job's
    // name was ever sent.
    again() {
      at.opener = null; at.step = null; at.phase = null;
      if (at.job) say(); else pace.forget();
    },
    end: pace.end,
    line: pace.sent, // what was sent last: what a client that comes now is given
  };
}

// ---------- a step that is done ----------

const clip = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const wholeHost = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

// A run step in plain words, for the index of past runs. Only the bot's own choices (where it went, what it
// searched for); clicks, screenshots and the like aren't worth recalling. These are read by the bot when it
// recalls a run and by the owner in a finished run's steps, never in the working line.
function describeStep(name, input = {}) {
  const c = String(name || '').startsWith('mcp__computer__') ? name.slice(15) : null;
  if (c === 'open_browser') return `opened ${input.url ? clip(input.url, 120) : 'the browser'}`;
  if (c === 'browser_goto') return input.url ? `opened ${clip(input.url, 120)}` : null;
  if (c === 'type_login') return input.field === 'password' ? `signed in with the saved login ${clip(input.login, 60)}` : null;
  if (c === 'type_card') return input.field === 'number' ? `paid with the saved card ${clip(input.card, 40)}${input.amount ? ` (${clip(input.amount, 30)})` : ''}` : null;
  if (c === 'run_shell') return `ran a command on its computer: ${clip(input.command, 100)}`;
  if (c === 'run_with_login') return `ran a command with the saved login ${clip(input.login, 60)}: ${clip(input.command, 100)}`;
  if (c === 'run_with_ssh_key') return `ran a command with the saved SSH key ${clip(input.key, 60)}: ${clip(input.command, 100)}`;
  if (c === 'run_with_file') return `ran a command with the saved file ${clip(input.file, 60)}: ${clip(input.command, 100)}`;
  if (c === 'place_secret_file') return `kept saved secrets in the file ${clip(input.path, 100)}`;
  if (c) return null;
  if (name === 'WebFetch') return `read ${clip(input.url, 160)}`;
  if (name === 'WebSearch') return `searched the web for "${clip(input.query, 100)}"`;
  if (name === 'Bash') return input.description ? clip(input.description, 120) : `ran a command: ${clip(input.command, 80)}`;
  if (name === 'Write' || name === 'Edit' || name === 'MultiEdit') return `changed the file ${path.basename(String(input.file_path || ''))}`;
  if (name === 'Read') return `read the file ${path.basename(String(input.file_path || ''))}`;
  if (name === 'Skill') return `used the skill ${String(input.skill || '').replace(/^botdot:/, '')}`;
  if (name === 'mcp__vault__api_request') return `called ${wholeHost(input.url) || 'an API'} with the saved login ${clip(input.login, 60)}`;
  if (name === 'mcp__vault__request_login') return `asked the owner for the ${clip(input.site, 60)} login`;
  if (name === 'mcp__connectors__connector_run') return `used ${input.app}: ${String(input.action || '').toLowerCase().replace(/_/g, ' ')}`;
  if (name === 'mcp__self__add_job') return `set up the job "${clip(input.name, 60)}"`;
  return null;
}
// The same, with the two steps that name someone. label(to): the bot a message went to, as the run's steps say it.
const stepDone = (name, input, label) => (name === 'mcp__self__message_bot' ? `messaged ${label(input?.to)}`
  : name === 'mcp__self__send_to_chief' ? 'sent the Chief a suggestion' : describeStep(name, input));
// A step of the simple form of a run's stream (docs/api.md, `?simple`): every step has words there.
const GENERIC_STEP = [[/^mcp__computer__/, 'used its computer'], [/^mcp__self__/, 'looked after its notes and jobs'], [/^mcp__vault__/, 'used a saved login'], [/^mcp__connectors__/, 'used a connected app'], [/^(Grep|Glob|LS)$/, 'looked through its files'], [/^Task|^Agent$/, 'asked a helper']];
const simpleStep = (name, input, label) => stepDone(name, input, label) || GENERIC_STEP.find(([re]) => re.test(name))?.[1] || 'worked on it';

module.exports = { MAX, OPENER_MAX, EVERY_MS, words, pacer, follow, describeStep, stepDone, simpleStep };
