// A bot's scheduled jobs, as the apps and the Chief change them (/api/bots/:id/jobs, from bots.js), their call
// keys (ADR 026), and the schedule in words (/api/cron/preview). The bot itself uses /api/self/session/jobs (self.js).
const { NEXT, send, readBody } = require('./http');
const calls = require('../calls');
const cronWords = require('../cron-words');
const cron = require('../cron');
const B = require('../bots');
const chief = require('../chief');
const asksLib = require('../asks');

function create(ctx) {
  const { callAddresses, callKeys, store, callRefusals, audit, jobView, changeJob, changeOf, askedOf, tellChiefOfAnswer,
    answerWordsOf, proposalAnswered, nameWord } = ctx;
  const callAddress = (botId, jobId) => callAddresses.of(botId, jobId);

  // A new key for a job: kept in the Vault as an API token that no bot is given (the item the job had, when it is
  // still there), and its hash where calls are checked. The old key stops at once. Returns the Vault item's name.
  async function newCallKey(bot, job) {
    const key = calls.newKey();
    const name = calls.vaultName(bot.name, job.name);
    const itemId = callKeys.vaultOf(bot.id, job.id)?.vaultId || (await store().list()).find((x) => x.name === name)?.id;
    const updated = itemId ? await store().update(itemId, { password: key }) : null;
    const item = updated || await store().add({ name, site: callAddresses.host() || 'localhost', password: key, type: 'api-token', allowedBots: [] });
    callKeys.set(bot.id, job.id, key, { id: item.id, name: item.name });
    return item.name;
  }
  // A job's call as the Chief and the bot read it (docs/api.md, "Setting up a call"): whether it is on, whether a
  // proposal of one waits, its address and the name of the Vault item that holds its key. Never the key.
  function callSetup(botId, jobId) {
    const now = (B.bots.get(botId)?.jobs || []).find((j) => j.id === jobId);
    return { name: now.name, call: !!now.call, waiting: !!changeOf(now)?.job?.call, address: callAddress(botId, jobId), vaultItem: callKeys.vaultOf(botId, jobId)?.vaultName || null };
  }
  // What a bot that proposed a call is told after the owner's yes, as it stands after "The owner allowed you to":
  // that the job takes calls, its address and where its key is, never the key (#37).
  const callAllowed = (bot, job, kind, vaultItem) => {
    const address = callAddress(bot.id, job.id);
    return `let the ${kind} “${nameWord(job.name)}” take calls: ${address ? `its call address is ${address}` : 'its call address is not known yet (job_call gives it once botdot has been reached through its front door)'}, and its key is in the Vault item “${nameWord(vaultItem)}”, which no bot is given`;
  };
  // Tried by api() in its turn: NEXT when none of them is asked for.
  async function preview(req, res, url, { parts, m }) {
    // A schedule the owner is typing: its words and its next three runs, or why it is not one.
    if (parts[0] === 'cron' && parts[1] === 'preview' && m === 'POST') {
      const { expr } = await readBody(req);
      const when = cronWords.describe(expr);
      try {
        const out = [];
        let d = new Date();
        for (let i = 0; i < 3; i++) { d = cron.next(expr, d); if (!d) break; out.push(d.toISOString()); }
        return send(res, 200, { when, next: out });
      } catch (e) {
        return send(res, 200, { error: e.message, when });
      }
    }
    return NEXT;
  }
  // Handed on from bots.js: NEXT when none of them is asked for.
  async function ofBot(req, res, url, { parts, m, by, chiefChat, bot }) {
    // Scheduled jobs: the apps and the Chief (the bot itself uses /api/self/session/jobs).
    if (parts[2] === 'jobs') {
      const body = m === 'GET' ? {} : await readBody(req);
      const jobId = parts[3];
      if (!jobId && m === 'GET') return send(res, 200, (bot.jobs || []).map(jobView));
      if (!jobId && m === 'POST') return send(res, 201, changeJob(bot, 'add', body, { by, chatId: chiefChat }).job);
      const job = (bot.jobs || []).find((j) => j.id === jobId);
      if (!job) return send(res, 404, { error: 'Job not found' });
      if (!parts[4] && m === 'PUT') return send(res, 200, changeJob(bot, 'update', { ...body, id: jobId }, { by, chatId: chiefChat }).job);
      if (!parts[4] && m === 'DELETE') { changeJob(bot, 'remove', { id: jobId }, { by }); return send(res, 200, { ok: true }); }
      if (parts[4] === 'run' && m === 'POST') {
        const { waitsAs, scriptRun, ...ran } = B.runJob(bot, job, 'manual');
        // The Chief's run_job: a Stop in that chat ends the run, or takes it away where it still waits, and ends a
        // script it started, with the AI's look at what it printed (ADR 012).
        if (by === 'chief' && chiefChat) {
          if (ran.run) chief.ranFrom(chiefChat, ran.run.id);
          else if (waitsAs) chief.ranJobFrom(chiefChat, bot.id, waitsAs);
          else if (scriptRun) chief.ranScriptFrom(chiefChat, scriptRun);
        }
        return send(res, 200, ran);
      }
      // A job's call (ADR 026): its address and where its key is, never the key. POST gives it a new key at once;
      // DELETE turns its calls off at once, and takes back a proposal of one that waits.
      if (parts[4] === 'call' && parts[5] === 'setup' && !parts[6]) {
        if (m === 'POST') {
          if (!job.call) return send(res, 409, { error: 'Calls to this job are turned off.' });
          await newCallKey(bot, job);
        } else if (m === 'DELETE') B.bots.callOff(bot.id, jobId);
        else if (m !== 'GET') return send(res, 405, { error: 'Use GET, POST or DELETE' });
        return send(res, 200, { ...callSetup(bot.id, jobId), refused: callRefusals.of(bot.id, jobId).slice().reverse() });
      }
      // Only the owner approves (the Chief's tools don't offer this).
      if (parts[4] === 'approve' && m === 'POST') {
        if (by !== 'you') return send(res, 403, { error: 'Only the owner can approve a job' });
        // What waits: the job itself, never approved, or a change beside the approved job (ADR 013).
        const change = changeOf(job);
        const proposed = change ? { ...job, ...change.job, name: job.name } : job; // by the name the owner knows it by
        const asked = askedOf(job);
        const script = job.kind === 'script' || proposed.kind === 'script';
        const kind = proposed.kind === 'script' ? 'script' : 'job';
        // The Chief asked for it in a chat: it is told there of the answer ("Always approve" is a yes). A bot set
        // it up in a run: after the yes it carries on with that run's request (ADR 009).
        const callOn = !!change?.job?.call && !job.call; // the change turns a call on (ADR 026)
        let vaultItem = null; // the Vault item of the key the yes made
        const answered = (yes) => {
          const told = asked?.chatId ? tellChiefOfAnswer({ chatId: asked.chatId, at: asked.at }, yes, answerWordsOf({ job: proposed, change: !!change, callOn }, bot)) : null;
          if (told) return { carriesOn: told };
          // A bot that proposed a call is told it takes calls, and where (#37); "change the job" too when the change held more.
          const changed = `${change ? 'change' : 'add'} the ${kind} “${nameWord(proposed.name)}”`;
          const words = callOn && yes ? [...(B.jobsLib.withoutCall(change, job).change ? [changed] : []), callAllowed(bot, job, kind, vaultItem)] : [changed];
          return proposalAnswered(bot.id, asked, words, yes);
        };
        if (body.approve === false) {
          // The no removes only a job that was never approved. On an approved job it keeps the job as it is: with
          // a change beside it the change goes, and without one (a card that is out of date) nothing does.
          if (job.approved !== false) {
            if (change) { B.bots.keepJob(bot.id, jobId); if (script) audit('job.declined', by); answered(false); }
            return send(res, 200, { ok: true, kept: true, text: asksLib.keptWords(cronWords.describe(job.cron)) });
          }
          changeJob(bot, 'remove', { id: jobId }, { by });
          if (script) audit('job.declined', by);
          answered(false);
          return send(res, 200, { ok: true, removed: true, text: asksLib.DECLINED_NEW });
        }
        // A yes from a card that is out of date, on an approved job with no change beside it, approved nothing: the
        // audit log says nothing of it, as for a tile.
        // "Always approve" from such a card approves nothing either, but it does begin the standing trust in the
        // job's later changes: that is written, once.
        const waited = job.approved === false || !!change;
        const trusts = body.always === true && !job.alwaysApprove;
        // The yes turns a call on: its key is made and kept first, so that a Vault that cannot take it (a locked
        // Bitwarden) leaves the call waiting (ADR 026). Never for a bot that skips every check, whenever it was set.
        if (callOn && bot.permissionMode === 'bypassPermissions') return send(res, 409, { error: `${bot.name} runs with bypassPermissions, so its jobs can't be called. Say no to this card, or change its permissions first.` });
        if (callOn) vaultItem = await newCallKey(bot, proposed);
        const approved = B.bots.approveJob(bot.id, jobId, { always: body.always === true });
        if (script && (waited || trusts)) audit('job.approved', by);
        return send(res, 200, { ...jobView(approved), ...(change ? { text: asksLib.changedWords(cronWords.describe(approved.cron)) } : {}), ...(asked ? answered(true) : {}) });
      }
    }
    return NEXT;
  }
  return { preview, ofBot, callSetup };
}

module.exports = { create };
