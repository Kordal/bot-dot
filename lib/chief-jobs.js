// The Chief of Staff's own scheduled jobs (#408, ADR 073): a task in the owner's words, on a schedule (`cron`) or
// once (`at`), that a run of the Chief's own does as a look does (ADR 006): it reads the web, botdot's records and the
// connected apps, changes nothing, and its last words are the Chief's message to the owner. Kept in the data folder,
// { jobs: [{ id, name, task, cron | at, on, chatId, createdAt, lastRunAt }] }. Running it is the Chief's (chief.js);
// this file only keeps the list and says which job is due, so its clock can be set by a test.
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJson } = require('./jsonfile');
const cron = require('./cron');
const cronWords = require('./cron-words');
const { parseAt } = require('./jobs');

const MAX = 20;
const NAME_MAX = 60;
const TASK_MAX = 4000;

const refused = (message, status = 400) => Object.assign(new Error(message), { status });
const line = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// When a job runs, in words: its schedule's, or the moment of a one-time job.
function whenOf(job) {
  if (job.at) return `Once, ${new Date(job.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`;
  return cronWords.describe(job.cron);
}

// A job as the apps and the Chief read it.
const view = (job) => ({ id: job.id, name: job.name, task: job.task, ...(job.cron ? { cron: job.cron } : { at: job.at }), on: job.on !== false, when: whenOf(job), lastRunAt: job.lastRunAt || null });

// What a new or changed job holds, checked. prev: the job as it was, for a change.
function clean(input = {}, prev = null) {
  const job = { ...(prev || {}) };
  if (input.name !== undefined || !prev) {
    job.name = line(input.name, NAME_MAX);
    if (!job.name) throw refused('Give the job a short name.');
  }
  if (input.task !== undefined || !prev) {
    job.task = String(input.task ?? '').replace(/\r\n/g, '\n').trim().slice(0, TASK_MAX);
    if (!job.task) throw refused('Say what the job does: its task, in the owner\'s words.');
  }
  const hasCron = input.cron !== undefined && input.cron !== null && input.cron !== '';
  const hasAt = input.at !== undefined && input.at !== null && input.at !== '';
  if (hasCron && hasAt) throw refused('Give either a schedule (cron) or a moment (at), not both.');
  if (hasCron) {
    const expr = line(input.cron, 100);
    try { cron.parse(expr); } catch { throw refused(`"${expr}" is not a schedule. Use five cron fields, e.g. "0 8 * * 1-5".`); }
    job.cron = expr;
    delete job.at;
  } else if (hasAt) {
    const d = parseAt(input.at);
    if (d.getTime() <= Date.now()) throw refused('That moment has passed. Give a time still to come.');
    job.at = d.toISOString();
    delete job.cron;
  }
  if (!job.cron && !job.at) throw refused('Say when it runs: a schedule (cron, e.g. "0 8 * * 1-5") or a moment (at, e.g. 2026-10-02T09:00).');
  if (input.on !== undefined) job.on = !!input.on;
  return job;
}

function create(dataDir) {
  const file = path.join(dataDir, 'chief-jobs.json');
  const load = () => { const d = readJson(file, null); return Array.isArray(d?.jobs) ? d.jobs : []; };
  const save = (jobs) => writeJson(file, { jobs });
  const find = (jobs, id) => {
    const job = jobs.find((j) => j.id === id);
    if (!job) throw refused(`There is no job of yours with the id "${line(id, 40)}". list_my_jobs lists them.`, 404);
    return job;
  };

  function list() { return load().map(view); }
  function get(id) { return load().find((j) => j.id === id) || null; }

  // chatId: the chat it was set up in, where its messages go.
  function add(input, { chatId = null } = {}) {
    const jobs = load();
    if (jobs.length >= MAX) throw refused(`You have ${MAX} jobs already. Remove one first.`);
    const job = { id: `cj${crypto.randomBytes(5).toString('hex')}`, ...clean(input), on: input.on === undefined ? true : !!input.on, ...(chatId ? { chatId } : {}), createdAt: new Date().toISOString(), lastRunAt: null };
    save([...jobs, job]);
    return view(job);
  }

  function update(id, input) {
    const jobs = load();
    const was = find(jobs, id);
    const job = clean(input, was);
    save(jobs.map((j) => (j.id === id ? job : j)));
    return view(job);
  }

  function remove(id) {
    const jobs = load();
    const job = find(jobs, id);
    save(jobs.filter((j) => j.id !== id));
    return view(job);
  }

  // A run started: kept before it ends, so a slow run is not started twice. A one-time job goes.
  function ran(id, now = new Date()) {
    const jobs = load();
    const job = jobs.find((j) => j.id === id);
    if (!job) return null;
    save(job.at ? jobs.filter((j) => j.id !== id) : jobs.map((j) => (j.id === id ? { ...j, lastRunAt: now.toISOString() } : j)));
    return job;
  }

  // The first job that is due at `now` and has not run in this minute, or null. A one-time job whose moment passed
  // while botdot was off runs once it is back; a repeating one is not caught up.
  function due(now = new Date()) {
    const minute = cron.minuteOf(now).getTime();
    for (const job of load()) {
      if (job.on === false) continue;
      if (job.at) { if (Date.parse(job.at) <= now.getTime()) return job; continue; }
      if (job.lastRunAt && cron.minuteOf(job.lastRunAt).getTime() >= minute) continue;
      try { if (cron.due(job.cron, now)) return job; } catch { /* a schedule that no longer parses never runs */ }
    }
    return null;
  }

  return { list, get, add, update, remove, ran, due };
}

module.exports = { create, view, clean, whenOf, MAX };
