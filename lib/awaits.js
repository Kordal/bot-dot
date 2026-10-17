// A bot that asks teammates something (priority messages) waits for their answers. botdot keeps track of
// who it asked, collects their replies in its inbox, and once everyone has answered (or their runs ended
// without answering, or it waited long enough) starts it once more with all of them, so it can finish
// what it was asked. It starts also when nobody answered: it is then given how each teammate's run ended
// (bots.js followUpPrompt), so a hand-off always comes back. Without this, answers only woke it when one
// happened to be sent with priority, and that run didn't know what the answers were for.
const path = require('path');
const { readJson, writeJson } = require('./jsonfile');

const QUIET_MS = 10 * 60e3; // no answer yet, and the bot isn't working on it: stop waiting for it
const MAX_MS = 60 * 60e3; // stop waiting, even for bots still working

// The teammates of a wait, in the order they were asked. `waiting` alone does not keep it: a bot id that is
// all digits is listed before the others, whatever was added first. A wait saved before `order` has none.
const asked = (wait) => [...new Set([...(wait.order || []), ...Object.keys(wait.waiting)])].filter((id) => wait.waiting[id]);

function create(dataDir) {
  const file = path.join(dataDir, 'awaits.json');
  let list = readJson(file, []);
  const save = () => writeJson(file, list);

  // A run asked a teammate: it now waits for that teammate's answer.
  // run: { runId, botId, chainId, hop, replyTo }
  function ask(run, toId) {
    let a = list.find((x) => x.runId === run.runId);
    if (!a) list.push((a = { ...run, askedAt: null, waiting: {}, answers: [] }));
    a.askedAt = new Date().toISOString(); // the clock restarts with each question
    if (!a.waiting[toId]) {
      a.waiting[toId] = 'pending';
      a.order = [...asked(a).filter((id) => id !== toId), toId];
    }
    save();
  }

  // The question never reached toId (its queue was full): this run does not wait for it after all.
  function unask(runId, toId) {
    const a = list.find((x) => x.runId === runId);
    if (!a || a.waiting[toId] !== 'pending') return;
    delete a.waiting[toId];
    a.order = asked(a);
    if (!Object.keys(a.waiting).length) list = list.filter((x) => x !== a);
    save();
  }

  // fromId sends toId a message in this chain. When toId is waiting for fromId's answer, this is it:
  // returns the wait it answers (the message then goes to toId's inbox, starting nothing).
  function answer(fromId, toId, chainId, hop) {
    const a = list.find((x) => x.botId === toId && x.chainId === chainId && x.waiting[fromId]);
    if (!a) return null;
    a.waiting[fromId] = 'answered';
    if (!a.answers.includes(fromId)) a.answers.push(fromId);
    a.hop = Math.max(a.hop || 0, hop || 0);
    save();
    return a;
  }

  // Whether this bot is itself still waiting for answers in this chain.
  const isWaiting = (botId, chainId) => list.some((x) => x.botId === botId && x.chainId === chainId);

  // A run of botId in this chain ended. If someone was waiting for its answer and it sent none, it won't
  // come (its reply is in its own chat), unless it's still waiting for answers of its own. The wait keeps
  // which run that was (`ended`), so the asking bot can be given how it ended.
  function runEnded(botId, chainId, runId = null) {
    if (!chainId || isWaiting(botId, chainId)) return;
    let changed = false;
    for (const a of list) {
      if (a.chainId !== chainId || a.waiting[botId] !== 'pending') continue;
      a.waiting[botId] = 'done';
      if (runId) a.ended = { ...a.ended, [botId]: runId };
      changed = true;
    }
    if (changed) save();
  }

  // The waits that are over: everyone answered or finished, or it waited long enough.
  // working(botId): whether that bot is running now (a bot still at work gets more time).
  // They stay until their follow-up has started (started) or their bot is gone (settle): a follow-up that couldn't
  // be queued, or that was queued and couldn't start, is tried again next time.
  const pendingOf = (a) => Object.keys(a.waiting).filter((id) => a.waiting[id] === 'pending');
  function isDue(a, working) {
    const pending = pendingOf(a);
    const waited = Date.now() - Date.parse(a.askedAt);
    return !pending.length || waited > MAX_MS || (waited > QUIET_MS && !pending.some(working));
  }
  const due = (working) => list.filter((a) => isDue(a, working));

  // These waits are done with: there was nothing to follow up (their bot is gone).
  function settle(waits) {
    if (!waits.length) return;
    list = list.filter((a) => !waits.includes(a));
    save();
  }

  // What the follow-up of this run starts with now (a copy), or null when it has no wait: the wait as it is then,
  // with what came while the follow-up waited its turn. Until it starts the wait stays, also while its follow-up is
  // queued: one whose start fails is queued again from it, so a hand-off is never lost. A teammate asked after the
  // follow-up was queued (not in `queued`, the wait as it was then) and still at work is left out while the wait is
  // not over: it has a follow-up of its own.
  function forFollowUp(runId, working, queued) {
    const a = list.find((x) => x.runId === runId);
    if (!a) return null;
    const told = structuredClone(a);
    if (isDue(a, working)) return told;
    for (const id of pendingOf(a)) if (!queued?.waiting?.[id]) delete told.waiting[id];
    told.order = asked(told);
    return told;
  }

  // The follow-up of a run has started with `told` (forFollowUp): the teammates it was told of are done with.
  function started(told) {
    const a = list.find((x) => x.runId === told.runId);
    if (!a) return;
    for (const id of Object.keys(a.waiting).filter((x) => told.waiting[x])) {
      delete a.waiting[id];
      if (a.ended) delete a.ended[id];
    }
    a.answers = a.answers.filter((id) => a.waiting[id]);
    a.order = asked(a);
    if (!Object.keys(a.waiting).length) list = list.filter((x) => x !== a);
    save();
  }

  // Whether asker still waits for botId's answer in this chain: botId's reply then reaches it when botId's run ends.
  const awaited = (asker, botId, chainId) => list.some((x) => x.botId === asker && x.chainId === chainId && x.waiting[botId] === 'pending');

  // Whether this bot waits for answers at all (its figure shows it).
  const waitsForAnswers = (botId) => list.some((x) => x.botId === botId);

  return { ask, unask, answer, isWaiting, awaited, waitsForAnswers, runEnded, due, settle, forFollowUp, started };
}

module.exports = { create, asked, QUIET_MS, MAX_MS };
