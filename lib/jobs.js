// Scheduled jobs. A bot can have many, each with its own schedule. A job is either:
//   - an AI job: a Claude Code run with the job's own task (or the bot's main assignment), or
//   - a script job: a plain shell script that runs without AI (fast). It can hand its
//     output to the AI when needed, e.g. only when it printed something ("there's news").
// Scripts run on this machine, so a script job that you didn't write yourself (and any job a bot
// set up for itself) waits for your approval before it runs.
const { readJson, writeJson } = require('./jsonfile');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('./privilege-client');
const cron = require('./cron');
const cronWords = require('./cron-words');

const KINDS = ['ai', 'script'];
const AI_WHEN = ['never', 'output', 'failed', 'always']; // when a script job hands over to the AI
const MAX_JOBS = 20;
const MAX_TEXT = 20000;
const MAX_OUTPUT = 64 * 1024;

// How the Chief and the bots decide what kind of job to set up.
const JOB_GUIDE = `Scheduled jobs: before you set one up, first decide whether it needs AI at all, and say why in "assessment".
- Script job (kind "script", no AI: fast, reliable): mechanical work with a clear rule, e.g. is a site up, did a page or API result change since last time, did a price or number cross a limit, disk space, backups, pinging a host, tidying files. It's a bash script run in the bot's workspace on the owner's machine (curl and python3 are available). $JOB_STATE_DIR is a folder kept between runs, for remembering the last value. Print nothing when there's nothing to report; print a short plain message when there is. Scripts can't use Vault logins.
- AI job (kind "ai"): anything that needs judgement or language: reading, summarising, writing, research, deciding what matters, or using a browser or its computer.
- Often best: a script that does the checking, with aiWhen "output", so the AI is only called (with the script's output) when the script found something. aiWhen "failed" calls it when the script fails; "always" after every run; "never" just shows the output.
- Something that should happen only once ("tomorrow at 7", "on Friday"): give "at" (local date and time, e.g. 2026-10-02T07:00) instead of a schedule. It runs once and is then removed. The final reply of that one run always reaches the owner.
- Whether the owner hears from an AI job is its "notify". A job whose every run the owner expects to hear from (a daily summary, a digest, "send me … every morning") gets notify "always": each run's final reply reaches them. A job that watches for something gets "report-only" (the default): the owner hears from it only when the bot calls notify_owner.
- Script jobs, and jobs a bot sets up for itself, wait for the owner's approval before they first run; tell the owner to approve it on its card in Needs you. A change to the script, task or schedule of a job that is approved waits for the owner too, beside the job: until they answer the job runs on as it was approved, and their no keeps it as it was. The job you get back is then the approved one, with what you proposed in "change". When you change what a job does, say in "summary" what changes, from what to what, in one short plain sentence: it is what the owner reads on the card.`;

const newJobId = () => `j${crypto.randomBytes(3).toString('hex')}`;

// A one-time job has "at", a local date and time. Its cron is that minute, day and month, so the scheduler runs
// it like any other job. It's removed as it starts: an AI job as its run starts, at once or after the run its bot
// is busy with (bots.js startQueued), a script job as its script starts (bots.js tick).
const cronOf = (d) => `${d.getMinutes()} ${d.getHours()} ${d.getDate()} ${d.getMonth() + 1} *`;
function parseAt(at) {
  const d = new Date(String(at).trim().replace(' ', 'T')); // "2026-10-02T09:00" is local time
  if (Number.isNaN(d.getTime())) throw new Error(`"${at}" isn't a date and time. Use e.g. 2026-10-02T09:00 (local time).`);
  return d;
}

// What a job does, for spotting changes that need approval again.
const substance = (j) => JSON.stringify([j.kind, j.script, j.prompt, j.cron, j.aiWhen, j.at || null, j.notify || 'report-only', !!j.call]);

// Whether a new or changed job may run without asking the owner first.
const autoApproved = (by, kind) => by === 'you' || (by === 'chief' && kind === 'ai');

// What the owner's approval of a job covers, and so what of an edit waits with a change: what the job does (the
// fields of `substance`, which decide whether an edit asks at all), and its name, time limit and assessment as
// that edit has them. On or off is no part of it: a job is switched at once, by whoever may.
const SAID_WITH = ['name', 'timeoutSeconds', 'assessment'];
// `call` only when on, so that a change proposed before calls existed reads as it was.
const definitionOf = (j) => ({ kind: j.kind, script: j.script || '', prompt: j.prompt || '', cron: j.cron, aiWhen: j.aiWhen ?? null, at: j.at || null, notify: j.notify || 'report-only', ...(j.call ? { call: true } : {}), name: j.name, timeoutSeconds: j.timeoutSeconds, assessment: j.assessment || '' });

// A call (ADR 026): whether a device or service with the job's key may run it. What an edit asks for: `call` as
// given, when it differs from the job's own (a job passed on as it is kept carries its own); else what holds, and
// for the Chief and a bot what waits too. The owner's edit is made at once and drops a change that waits, as any of
// theirs. A bot's own routes pass `call` only from its propose_job_call (lib/routes/self.js): never from its other
// edits of a job. Whoever asks, a call that is turned on waits for the owner's OK (normalizeJob).
const callAsked = (input, prev, by) => {
  if (input.call !== undefined && !!input.call !== !!prev?.call) return input.call === true;
  return by === 'you' ? !!prev?.call : !!(prev?.change?.job?.call ?? prev?.call);
};
// A change that waits, once a call is off: without the call, and gone when nothing else of it is left.
function withoutCall(change, job) {
  if (!change?.job?.call) return change ? { change } : {};
  const { call: _, ...rest } = change.job;
  return JSON.stringify(rest) === JSON.stringify(definitionOf(job)) ? {} : { change: { ...change, job: rest } };
}

// What a change changes, in its proposer's one sentence for the owner (`summary`): one line of plain text, clipped.
const SUMMARY_MAX = 300;
const summaryOf = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_MAX) : '');

// chatId: the Chief chat a job was asked for in. runId: the bot's run that set it up or changed it. What waits
// for the owner keeps one of them with the moment, so that the Chief is told there of the answer, or the bot
// carries on (ADR 009): a job that was never approved as `chatId` or `runId` with `askedAt`, a change in `change`.
// An approved job keeps its approved definition (ADR 013). A change to it that needs the owner's OK is stored
// beside it: `change`, { job: the proposed definition (definitionOf), by, at, summary?, chatId?, runId? }, and whoever
// reads the job (the scheduler, "Run now", the Chief's run_job) reads the approved one. One change waits: a
// second replaces the first. An edit that changes nothing of what the job does needs no OK and is made at once,
// on the job and on a change that waits alike (a name, its time limit); on or off is the job's alone. An edit
// that is approved at once and changes what the job does (the owner's, the Chief's of an AI job, one of a job
// that is always approved) drops a waiting change: it was proposed against a definition that is gone.
function normalizeJob(input = {}, prev = null, by = 'you', { chatId = null, runId = null } = {}) {
  const kind = KINDS.includes(input.kind) ? input.kind : prev?.kind || 'ai';
  const job = {
    id: prev?.id || newJobId(),
    name: String(input.name ?? prev?.name ?? '').trim().slice(0, 60) || (kind === 'script' ? 'Script job' : 'Scheduled run'),
    enabled: input.enabled === undefined ? prev?.enabled !== false : input.enabled !== false,
    kind,
    notify: input.notify ?? prev?.notify ?? 'report-only',
    cron: String(input.cron ?? prev?.cron ?? '0 9 * * *').trim(),
    at: null, // set below for a one-time job
    // AI job: its task ('' = the bot's main assignment). Script job: what the AI should do with the output.
    prompt: String(input.prompt ?? prev?.prompt ?? '').slice(0, MAX_TEXT),
    script: kind === 'script' ? String(input.script ?? prev?.script ?? '').slice(0, MAX_TEXT + 1) : '',
    aiWhen: kind === 'script' ? (AI_WHEN.includes(input.aiWhen) ? input.aiWhen : AI_WHEN.includes(prev?.aiWhen) ? prev.aiWhen : 'never') : null,
    timeoutSeconds: Math.min(3600, Math.max(10, Math.round(Number(input.timeoutSeconds ?? prev?.timeoutSeconds) || 300))),
    assessment: String(input.assessment ?? prev?.assessment ?? '').trim().slice(0, 400),
    // The owner said "always approve" this job: later changes to it by the bot or the Chief need no OK. Only the owner sets it.
    alwaysApprove: by === 'you' && input.alwaysApprove !== undefined ? !!input.alwaysApprove : !!prev?.alwaysApprove,
    call: callAsked(input, prev, by),
    createdBy: prev?.createdBy || by,
    createdAt: prev?.createdAt || new Date().toISOString(),
  };
  // A call is proposed only on a job the owner approved, so that its card is a change beside it (ADR 013).
  if (job.call && !prev?.call && (!prev || prev.approved === false)) throw new Error(`Job "${job.name}": a call can be proposed only on a job the owner has approved.`);
  if (!['report-only', 'always'].includes(job.notify)) throw new Error('notify must be report-only or always');
  const at = input.at !== undefined ? input.at : prev?.at;
  if (at) {
    const d = parseAt(at);
    if (input.at !== undefined && input.at !== prev?.at && d.getTime() < Date.now() - 60e3) throw new Error(`Job "${job.name}": ${input.at} has already passed.`);
    job.at = d.toISOString();
    job.cron = cronOf(d);
  }
  try { cron.parse(job.cron); } catch (e) { throw new Error(`Job "${job.name}": ${e.message}`); }
  if (kind === 'script' && !job.script.trim()) throw new Error(`Job "${job.name}": write the script`);
  if (job.script.length > MAX_TEXT) throw new Error(`Job "${job.name}": keep the script under 20,000 characters`);
  const changed = !prev || substance(prev) !== substance(job);
  const from = by === 'chief' && chatId ? { chatId } : by === 'bot' && runId ? { runId } : null;
  if (prev && prev.approved !== false) {
    // An approved job. Nothing of what it does changed: it stays approved, and so does a change that waits.
    job.approved = true;
    // A call is turned on only by the owner's OK on a card, whoever asks; it is turned off at once.
    const callOn = job.call && !prev.call;
    const callOff = !job.call && !!prev.call;
    if (callOff && substance({ ...job, call: true }) === substance(prev)) return { ...job, ...withoutCall(prev.change, job) };
    if (!changed) {
      if (!prev.change) return job;
      const edited = Object.fromEntries(SAID_WITH.filter((k) => job[k] !== prev[k]).map((k) => [k, job[k]]));
      return { ...job, change: Object.keys(edited).length ? { ...prev.change, job: { ...prev.change.job, ...edited } } : prev.change };
    }
    if (!callOn && (autoApproved(by, kind) || job.alwaysApprove)) return job;
    const proposed = definitionOf(job);
    const same = prev.change && JSON.stringify(prev.change.job) === JSON.stringify(proposed);
    const summary = summaryOf(input.summary);
    return { ...job, ...definitionOf(prev), call: !!prev.call && !callOff, change: same ? (summary && summary !== prev.change.summary ? { ...prev.change, summary } : prev.change) : { job: proposed, by, at: new Date().toISOString(), ...(summary ? { summary } : {}), ...from } };
  }
  // A job that was never approved has no approved definition to keep: it waits whole, and is written over.
  job.approved = changed ? autoApproved(by, kind) || job.alwaysApprove : false;
  if (job.approved) return job;
  if (changed) Object.assign(job, { changedBy: by }, from ? { ...from, askedAt: new Date().toISOString() } : {}); // who asked for it, shown on its card
  else Object.assign(job, prev.changedBy ? { changedBy: prev.changedBy } : {}, prev.chatId ? { chatId: prev.chatId, askedAt: prev.askedAt } : prev.runId ? { runId: prev.runId, askedAt: prev.askedAt } : {});
  return job;
}

// The whole list, matched to the previous one by id (unknown ids become new jobs).
function normalizeJobs(list, prevList = [], by = 'you', from = {}) {
  if (!Array.isArray(list)) return prevList;
  if (list.length > MAX_JOBS) throw new Error(`A bot can have up to ${MAX_JOBS} jobs`);
  return list.map((j) => normalizeJob(j, prevList.find((p) => p.id === j?.id) || null, by, from));
}

// Bots saved before jobs existed had one schedule for their main assignment. A job named before the rename keeps its
// old name: renaming it would change its mention handle.
function fromOldSchedule(schedule) {
  if (!schedule || !schedule.enabled) return [];
  try { cron.parse(schedule.cron); } catch { return []; }
  return [{ id: newJobId(), name: 'Main assignment', enabled: true, kind: 'ai', cron: schedule.cron, prompt: '', script: '', aiWhen: null, timeoutSeconds: 300, assessment: '', createdBy: 'you', createdAt: new Date().toISOString(), approved: true }];
}

// Whether a job's time is this minute (cron.due: once on a day the clock moves). A one-time job's cron comes round
// every year, so its year counts too.
function dueAt(job, now) {
  return cron.due(job.cron, now) && (!job.at || new Date(job.at).getFullYear() === now.getFullYear());
}

function nextRun(job, from = new Date()) {
  if (job.at) return new Date(job.at) > from ? new Date(job.at) : null; // one-time: only that once
  try { return cron.next(job.cron, from); } catch { return null; }
}

// Run a script job's bash script. Resolves with its combined output (capped) and exit code.
// input: what the script reads on stdin (a call's body, ADR 026); without it stdin is closed.
// The promise has `stop()`: it ends the script as its time limit does, by killing its whole process group. Who
// stopped it is the caller's to keep (bots.js stopScript).
function runScript(job, { cwd, env, uid, gid, botdotPrincipal, input = null }) {
  let stop = () => {};
  const running = new Promise((resolve) => {
    const started = Date.now();
    let output = '';
    let truncated = false;
    let timedOut = false;
    const child = spawn('/bin/bash', ['-c', job.script], { cwd, env, botdotPrincipal, ...(uid !== undefined ? { uid, gid } : {}), stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'], detached: true });
    if (input !== null) {
      child.stdin.on('error', () => {}); // a script that does not read it all ends before it is written
      child.stdin.end(input);
    }
    const add = (chunk) => {
      if (truncated) return;
      output += chunk;
      if (output.length > MAX_OUTPUT) { output = output.slice(0, MAX_OUTPUT); truncated = true; }
    };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const killAll = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } };
    const timer = setTimeout(() => { timedOut = true; killAll(); }, job.timeoutSeconds * 1000);
    stop = killAll;
    const done = (exitCode, error) => {
      clearTimeout(timer);
      resolve({ exitCode, output: output + (truncated ? '\n[output cut off]' : ''), timedOut, error: error || null, durationMs: Date.now() - started });
    };
    child.on('error', (e) => done(null, e.message));
    child.on('close', (code) => done(code));
  });
  return Object.assign(running, { stop: () => stop() });
}

// Whether a finished script should be handed to the AI.
function wantsAi(job, r) {
  const failed = r.exitCode !== 0 || r.timedOut;
  return job.aiWhen === 'always' || (job.aiWhen === 'output' && !!r.output.trim()) || (job.aiWhen === 'failed' && failed);
}

// Last result per job (quiet runs aren't kept as runs, so this is where "last checked" lives), and the job's
// row: its failed scheduled runs one after another (`row`: { failures, since, held }; bots.js noteJobRun).
function stateStore(dataDir) {
  const FILE = path.join(dataDir, 'job-state.json');
  let cache = null;
  const load = () => { if (!cache) cache = readJson(FILE, {}); return cache; };
  return {
    get: (jobId) => load()[jobId] || null,
    all: () => load(),
    // at: when it was, now unless given. The row outlives a result that says nothing of it; `row: null` ends it.
    set(jobId, value) {
      const prev = load()[jobId];
      const next = { ...value, at: value.at || new Date().toISOString() };
      if (!('row' in value) && prev?.row) next.row = prev.row;
      if (!next.row) delete next.row;
      cache[jobId] = next;
      writeJson(FILE, cache);
    },
    remove(jobIds) {
      const s = load();
      let changed = false;
      for (const id of jobIds) if (s[id]) { delete s[id]; changed = true; }
      if (changed) writeJson(FILE, s);
    },
  };
}

// ---------- a job's line ----------

// Why a job's time passed without a run: the end of its line (docs/api.md, "A job's line").
const WHY = {
  off: () => 'botdot was off.',
  running: () => 'its last run was still going.',
  full: (botName, max) => `${botName} had ${max} things waiting.`,
  signedOut: () => 'Claude was signed out.',
};

// Times of the day are the owner's: the server's time zone is the one they set (setup.js).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clock = (at) => { const d = new Date(at); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
// "14:00", or with its day when that was not today: "4 Oct at 14:00".
function timeWords(at, now) {
  const d = new Date(at);
  return d.toDateString() === now.toDateString() ? clock(d) : `${d.getDate()} ${MONTHS[d.getMonth()]} at ${clock(d)}`;
}
const ENDED_WORDS = { success: 'done', quiet: 'nothing to report', held: 'held till morning', error: 'failed', stopped: 'stopped', interrupted: 'cut off' };

// A job's last result as the API hands it out, from its state: with `text`, the whole line for under the job, and
// `failures` and `since` while its last run failed in a row. problem: what went wrong, in plain words (bots.js jobLast).
function lastOf(state, { now = new Date(), problem = '' } = {}) {
  if (!state) return null;
  const { row, why, ...last } = state;
  const day = (at) => (new Date(at).toDateString() === now.toDateString() ? 'at' : 'on');
  if (last.status === 'missed') return { ...last, text: `Did not run ${day(last.at)} ${timeWords(last.at, now)}: ${why}` };
  const failures = last.status === 'error' ? row?.failures || 0 : 0;
  if (failures) Object.assign(last, { failures, since: row.since });
  const often = failures > 1 ? `, ${failures} times in a row since ${timeWords(row.since, now)}` : '';
  last.text = `Last run ${day(last.at)} ${timeWords(last.at, now)}: ${ENDED_WORDS[last.status] || last.status}${often}.${last.status === 'error' && problem ? ` ${problem}` : ''}`;
  return last;
}

// The latest minute after `after` and before `before` at which a repeating job was due, or null: the time it
// missed while botdot was off. Looked for backwards from `before`, minute by minute, a few weeks at most; a
// rarer job's first missed time stands for it.
function lastDueBetween(job, after, before) {
  let first;
  try { first = cron.next(job.cron, after); } catch { return null; }
  const end = cron.minuteOf(before);
  if (!first || first >= end) return null;
  for (let t = end.getTime() - 60_000, n = 0; t > first.getTime() && n < 50_000; t -= 60_000, n++) {
    const d = new Date(t);
    if (cron.due(job.cron, d)) return d;
  }
  return first;
}

// When a job runs, in the server's words, as every app shows them: its schedule's words, with ", and when called"
// for a job that takes calls (ADR 026), or "When called" when its schedule never comes round.
function whenWords(job) {
  const words = cronWords.describe(job.cron);
  if (!job.call) return words;
  return words === cronWords.NEVER ? 'When called' : `${words}, and when called`;
}

module.exports = { whenWords, withoutCall, parseAt, definitionOf, KINDS, AI_WHEN, MAX_JOBS, JOB_GUIDE, normalizeJob, normalizeJobs, fromOldSchedule, nextRun, dueAt, runScript, wantsAi, stateStore, autoApproved, WHY, lastOf, lastDueBetween };
