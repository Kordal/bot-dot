// A new bot writes the first message in its own chat (#511). Once a bot is made and its making has settled (no
// change to the bots for a while: the Chief adds its jobs, and the owner may set it up, right after create_bot),
// botdot starts one short run of it (trigger "hello"): it says what it does, when it runs next, what still waits
// for the owner's OK, and at most one question. It is not a run of its main assignment, it has no computer,
// connectors or web (it only writes, and may note a memory), and it is not the Chief's message (the Chief's three a
// day, lib/look.js, are the Chief's own). A bot that has a chat by then writes none. The wait lives in memory: a
// restart in it forgets the bot's first message, nothing worse.
const { inert } = require('./prompt-text');

const DELAY_MS = 20_000;
// BOT_DOT_HELLO_DELAY_MS: how long the making must have settled, in ms; "off" writes no first message (the tests).
function delayOf(env = process.env) {
  const v = env.BOT_DOT_HELLO_DELAY_MS;
  if (v === 'off') return null;
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : DELAY_MS;
}

// The waits of the bots made just now. start(botId): the wait is over. delayMs null: no first messages.
function create({ delayMs, start, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const waits = new Map();
  const arm = (id) => {
    clearTimer(waits.get(id));
    const t = setTimer(() => { waits.delete(id); start(id); }, delayMs);
    t?.unref?.();
    waits.set(id, t);
  };
  return {
    made: (id) => { if (delayMs != null) arm(id); },
    // A change to the bots: every wait starts again, so what the Chief does next is in the first message.
    changed: () => { for (const id of [...waits.keys()]) arm(id); },
    gone: (id) => { clearTimer(waits.get(id)); waits.delete(id); },
    waiting: (id) => waits.has(id),
  };
}

// One job that will run, as the run is told it: '"Morning news": Every day at 08:00 (next: 2026-10-18 08:00)'.
// words: when it runs, in the owner's words (jobs.js whenWords); nextAt: its next time in ms, or null. In the
// server's time zone, which is the owner's.
const two = (n) => String(n).padStart(2, '0');
function jobLine(job, words, nextAt) {
  const d = nextAt ? new Date(nextAt) : null;
  const at = d && !Number.isNaN(d.getTime()) ? ` (next: ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())})` : '';
  return `"${inert(job.name)}": ${words}${at}`;
}

// A bot's jobs as the first message tells them: next, the ones that will run (approved, switched on); waiting, what
// of them still waits for the owner's OK (a job never approved, or a change to an approved one).
function jobsSaid(jobs, { whenWords, nextRun }) {
  const on = (jobs || []).filter((j) => j.enabled);
  return {
    next: on.filter((j) => j.approved).map((j) => jobLine(j, whenWords(j), nextRun(j))),
    waiting: on.filter((j) => !j.approved || j.change).map((j) => (j.approved ? `your OK for the change to its job "${inert(j.name)}"` : `your OK for its job "${inert(j.name)}"`)),
  };
}

// The run's task. next: its jobs that will run, one line each, in the owner's words; waiting: what waits for the
// owner's OK, in the owner's words. The bot's own words are somebody's text: no "<" in them writes a tag.
function prompt({ bot, next = [], waiting = [] }) {
  return [
    'You were made just now, and the owner has not written to you yet. Write your first message in your own chat with the owner: one short message, a few short lines, that opens the conversation.',
    'Say, in your own words and in the language of your main assignment:',
    '- what you do for the owner;',
    `- when you run next: ${next.length ? next.join('; ') : 'you have no scheduled job yet, so you work when the owner writes to you'};`,
    `- what still waits for the owner: ${waiting.length ? `${waiting.join('; ')}. Say plainly that it waits for their OK in Needs you, and what you can't do until then` : 'Nothing waits for the owner. Say nothing about it'};`,
    '- at most one question, only if its answer would really make your work better (for example a topic, a place or a time). Ask none otherwise.',
    "Don't carry out your main assignment now, don't fetch or look anything up, and don't promise work you haven't been asked for. Don't greet with more than a word.",
    `Your main assignment:\n<main-assignment>\n${inert(bot.prompt)}\n</main-assignment>`,
  ].join('\n');
}

module.exports = { create, prompt, jobLine, jobsSaid, delayOf, DELAY_MS };
