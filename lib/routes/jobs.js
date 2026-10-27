// A bot's scheduled jobs, as the apps and the Chief change them (/api/bots/:id/jobs, from bots.js), their call
// keys (ADR 026), and the schedule in words (/api/cron/preview). The bot itself uses /api/self/session/jobs (self.js).
const { NEXT, send, readBody, inTime } = require('./http');
const calls = require('../calls');
const notifyLib = require('../notify');
const cronWords = require('../cron-words');
const cron = require('../cron');
const B = require('../bots');
const chief = require('../chief');
const asksLib = require('../asks');

// A request that makes a job's key or secret waits for the Vault at most as long as inTime says (./http).
const NOTHING_APPROVED = { late: 'Nothing was approved: try again.', failed: 'Nothing was approved: try again.' };
const KEY_LATER = {
  late: 'The new one is made once it answers, and the old one stops then: look at the Vault item in a minute before you give it to the sender.',
  failed: 'The old one still works.',
};

function create(ctx) {
  const { callAddresses, callKeys, store, callRefusals, audit, jobView, changeJob, changeOf, askedOf, tellChiefOfAnswer,
    answerWordsOf, proposalAnswered, nameWord } = ctx;
  const callAddress = (botId, jobId) => callAddresses.of(botId, jobId);
  const making = new Map(); // "bot job" -> the Vault work of a request, until it ends
  // The Vault work of a request for a job's key or secret, one at a time for each job, until that work ends, also
  // when the request stopped waiting for it: a second press, another device or the Chief makes no second item, and
  // answers 409. Waits as inTime says.
  async function vaultWork(res, bot, jobId, make, words) {
    const key = `${bot.id} ${jobId}`;
    if (making.has(key)) { send(res, 409, { error: 'Its key is being made in the Vault already: wait a moment, then look again.' }); return false; }
    const work = make();
    making.set(key, work);
    work.catch(() => {}).finally(() => making.delete(key));
    await inTime(work, words);
    return true;
  }

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
  // A new secret for a job's signed calls (#37, section 2): kept in the Vault as an API token that no bot is given (the
  // item the job had, when it is still there), and, encrypted, where the signatures are checked. The old one stops at
  // once. Returns the Vault item's name.
  async function newCallSecret(bot, job) {
    const secret = notifyLib.newSecret();
    const name = calls.secretVaultName(bot.name, job.name);
    const itemId = B.callSecrets.vaultOf(bot.id, job.id)?.vaultId || (await store().list()).find((x) => x.name === name)?.id;
    const updated = itemId ? await store().update(itemId, { password: secret }) : null;
    const item = updated || await store().add({ name, site: callAddresses.host() || 'localhost', password: secret, type: 'api-token', allowedBots: [] });
    B.callSecrets.set(bot.id, job.id, secret, { id: item.id, name: item.name });
    return item.name;
  }
  // The key or the secret a call in `mode` is let in on: a new one, made and kept.
  const newCallCredential = (bot, job, mode) => (mode === 'signed' ? newCallSecret(bot, job) : newCallKey(bot, job));
  // A new signing secret for a job's notify address (#37): kept in the Vault as an API token that no bot is given (the
  // item the job had, when it is still there), and where botdot signs with it. The old one stops at once. Returns the
  // Vault item's name.
  async function newNotifySecret(bot, job) {
    const secret = notifyLib.newSecret();
    const name = notifyLib.vaultName(bot.name, job.name);
    const itemId = B.notifySecrets.vaultOf(bot.id, job.id)?.vaultId || (await store().list()).find((x) => x.name === name)?.id;
    const updated = itemId ? await store().update(itemId, { password: secret }) : null;
    const site = (() => { try { return new URL(job.notifyUrl || job.change?.job?.notifyUrl).hostname; } catch { return 'localhost'; } })();
    const item = updated || await store().add({ name, site, password: secret, type: 'api-token', allowedBots: [] });
    B.notifySecrets.set(bot.id, job.id, secret, { id: item.id, name: item.name });
    return item.name;
  }
  // A job's call as the Chief and the bot read it (docs/api.md, "Setting up a call"): whether it is on, whether a
  // proposal of one waits, its address, how it lets a call in (`mode`: "bearer" or "signed", and `waitingMode` for a
  // proposal) and the name of the Vault item that holds its key or its secret; and its notify address
  // ("Telling an address when a run ends"): the one approved, the one that waits, the Vault item of its secret and
  // the notifications that failed lately, newest first. Never the key or the secret.
  function callSetup(botId, jobId) {
    const now = (B.bots.get(botId)?.jobs || []).find((j) => j.id === jobId);
    const proposedUrl = changeOf(now)?.job?.notifyUrl || null;
    const mode = B.jobsLib.callModeOf(now);
    const proposedMode = B.jobsLib.callModeOf(changeOf(now)?.job);
    const waitingMode = proposedMode && proposedMode !== mode ? proposedMode : null;
    const item = (mode || waitingMode) === 'signed' ? B.callSecrets.vaultOf(botId, jobId) : callKeys.vaultOf(botId, jobId);
    return {
      name: now.name, call: !!now.call, waiting: !!waitingMode, mode, waitingMode, address: callAddress(botId, jobId), vaultItem: item?.vaultName || null,
      notifyUrl: now.notifyUrl || null, notifyWaiting: proposedUrl && proposedUrl !== now.notifyUrl ? proposedUrl : null,
      notifySecretItem: B.notifySecrets.vaultOf(botId, jobId)?.vaultName || null,
      notifyFailed: B.notifyFailures.of(botId, jobId).slice(-5).reverse(),
    };
  }
  // What a bot that proposed a call is told after the owner's yes, as it stands after "The owner allowed you to":
  // that the job takes calls, its address and where its key is, never the key (#37).
  // A signed call's words say so, and name its secret.
  const callAllowed = (bot, job, kind, vaultItem, mode) => {
    const address = callAddress(bot.id, job.id);
    return `let the ${kind} “${nameWord(job.name)}” take ${mode === 'signed' ? 'signed calls' : 'calls'}: ${address ? `its call address is ${address}` : 'its call address is not known yet (job_call gives it once botdot has been reached through its front door)'}, and its ${mode === 'signed' ? 'secret' : 'key'} is in the Vault item “${nameWord(vaultItem)}”, which no bot is given`;
  };
  // What a bot that proposed a notify address is told after the owner's yes: where each run's end goes and where the
  // secret is, never the secret (#37).
  const notifyAllowed = (job, kind, url, secretItem) => `tell ${url} when a run of the ${kind} “${nameWord(job.name)}” ends, signed with the secret in the Vault item “${nameWord(secretItem)}”, which no bot is given`;
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
  async function ofBot(req, res, url, { parts, m, by, chiefChat, standing, bot }) {
    // Scheduled jobs: the apps and the Chief (the bot itself uses /api/self/session/jobs).
    if (parts[2] === 'jobs') {
      const body = m === 'GET' ? {} : await readBody(req);
      const jobId = parts[3];
      if (!jobId && m === 'GET') return send(res, 200, (bot.jobs || []).map(jobView));
      // The Chief's job from a chat that read the web, let through in the owner's turn (ADR 075): kept with the web mark.
      const afterWeb = by === 'chief' && !!standing?.()?.web;
      if (!jobId && m === 'POST') return send(res, 201, changeJob(bot, 'add', body, { by, chatId: chiefChat, afterWeb }).job);
      const job = (bot.jobs || []).find((j) => j.id === jobId);
      if (!job) return send(res, 404, { error: 'Job not found' });
      if (!parts[4] && m === 'PUT') return send(res, 200, changeJob(bot, 'update', { ...body, id: jobId }, { by, chatId: chiefChat, afterWeb }).job);
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
      // A shadow run (ADR 100): a script beside this AI job for a week. POST starts it (or starts it over), GET is the
      // whole of it (its script, each compared run, both sides of one that differed), DELETE ends it. The Chief's and
      // the owner's; a bot changes its jobs through its own routes.
      if (parts[4] === 'shadow' && !parts[5]) {
        if (by === 'bot') return send(res, 403, { error: 'Only the Chief or the owner runs a shadow.' });
        if (m === 'POST') {
          try { B.startShadow(bot.id, jobId, body, { by, chatId: chiefChat }); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
          return send(res, 200, jobView(B.bots.get(bot.id).jobs.find((j) => j.id === jobId)));
        }
        if (m === 'DELETE') { B.shadows.end(jobId, 'stopped'); return send(res, 200, jobView(job)); }
        if (m === 'GET') return send(res, 200, B.shadows.detail(jobId) || { error: 'No shadow for this job.' });
        return send(res, 405, { error: 'Use GET, POST or DELETE' });
      }
      // Back to the AI job a shadow's script replaced, at once (ADR 100).
      if (parts[4] === 'back-to-ai' && !parts[5] && m === 'POST') {
        if (by === 'bot') return send(res, 403, { error: 'Only the Chief or the owner does this.' });
        const back = B.backToAi(bot.id, jobId, { by, chatId: chiefChat });
        return back ? send(res, 200, jobView(back)) : send(res, 409, { error: 'This job was not promoted from an AI job by a shadow run.' });
      }
      // A job's call (ADR 026): its address and where its key is, never the key. POST gives it a new key at once, or
      // a new secret to a job that takes signed calls (#37); DELETE turns its calls off at once, and takes back a
      // proposal of one that waits.
      if (parts[4] === 'call' && parts[5] === 'setup' && !parts[6]) {
        if (m === 'POST') {
          if (!job.call) return send(res, 409, { error: 'Calls to this job are turned off.' });
          if (!await vaultWork(res, bot, jobId, () => newCallCredential(bot, job, B.jobsLib.callModeOf(job)), KEY_LATER)) return;
        } else if (m === 'DELETE') B.bots.callOff(bot.id, jobId);
        else if (m !== 'GET') return send(res, 405, { error: 'Use GET, POST or DELETE' });
        return send(res, 200, { ...callSetup(bot.id, jobId), refused: callRefusals.of(bot.id, jobId).slice().reverse() });
      }
      // A job's notify address (#37): POST gives it a new signing secret at once; DELETE turns it off at once, and
      // takes back a proposal of one that waits. It is proposed as an edit of the job ({ notifyUrl, summary }).
      if (parts[4] === 'notify' && parts[5] === 'setup' && !parts[6]) {
        if (m === 'POST') {
          if (!job.notifyUrl) return send(res, 409, { error: 'This job has no notify address.' });
          if (!await vaultWork(res, bot, jobId, () => newNotifySecret(bot, job), KEY_LATER)) return;
        } else if (m === 'DELETE') B.bots.notifyOff(bot.id, jobId);
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
        const callMode = B.jobsLib.callModeOf(change?.job);
        const callOn = !!callMode && callMode !== B.jobsLib.callModeOf(job); // the change turns a call on (ADR 026), or a signed one (#37)
        const notifyOn = change?.job?.notifyUrl && change.job.notifyUrl !== job.notifyUrl ? change.job.notifyUrl : null; // a new notify address (#37)
        let vaultItem = null; // the Vault item of the key the yes made
        let secretItem = null; // the Vault item of the notify secret
        const answered = (yes) => {
          const told = asked?.chatId ? tellChiefOfAnswer({ chatId: asked.chatId, at: asked.at }, yes, answerWordsOf({ job: proposed, change: !!change, callOn, callMode, notifyOn }, bot)) : null;
          if (told) return { carriesOn: told };
          // A bot that proposed a call is told it takes calls, and where, and one that proposed a notify address where
          // the secret is (#37); "change the job" too when the change held more.
          const changed = `${change ? 'change' : 'add'} the ${kind} “${nameWord(proposed.name)}”`;
          const rest = (d) => { const { call: _c, callMode: _m, notifyUrl: _n, ...r } = d; return JSON.stringify(r); };
          const more = !!change && rest(change.job) !== rest(B.jobsLib.definitionOf(job));
          const words = (callOn || notifyOn) && yes ? [...(more ? [changed] : []), ...(callOn ? [callAllowed(bot, job, kind, vaultItem, callMode)] : []), ...(notifyOn ? [notifyAllowed(job, kind, notifyOn, secretItem)] : [])] : [changed];
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
        if (callOn || notifyOn) {
          const made = await vaultWork(res, bot, jobId, async () => {
            if (callOn) vaultItem = await newCallCredential(bot, proposed, callMode);
            // A new notify address: its secret is made and kept first, as a call's key, unless the job has one
            // already (a new address keeps the secret; the Chief makes a new one when asked).
            if (notifyOn) secretItem = B.notifySecrets.secretOf(bot.id, jobId) ? B.notifySecrets.vaultOf(bot.id, jobId)?.vaultName : await newNotifySecret(bot, { ...job, notifyUrl: notifyOn });
          }, NOTHING_APPROVED);
          if (!made) return;
        }
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
