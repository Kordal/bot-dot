// What a bot or the Chief asks the owner for (lib/asks.js), and the owner's yes or no on it, one function per kind.
const { NEXT, send, httpError, readBody, inTime } = require('./http');
const B = require('../bots');
const crypto = require('crypto');
const asksLib = require('../asks');
const { whereOf } = require('../secret-files');

function create(ctx) {
  const { asks, secretFiles, audit, bitwarden, store, connectorApprovals, tools, doHeldAction, withJobViews, carryOnAfter, writeSkill,
    attachSkill, askText, yesOn, thenField, groupOfCard, runOfAsk, askSkill, chiefReview } = ctx;
  // The owner's yes, one function per kind of ask: each returns the answer's body.
  function allowPermission(a) {
    const bot = B.bots.get(a.botId);
    const taken = asks.take(a.id);
    if (!bot) return { ok: true };
    const perm = asksLib.PERMISSIONS[a.permission];
    const change = { allowedTools: [...new Set([...bot.allowedTools, ...perm.tools])] };
    if (a.permission === 'files' && bot.permissionMode === 'dontAsk') change.permissionMode = 'acceptEdits'; // as ticking "Can change files" does
    const updated = B.bots.update(bot.id, change, { by: 'you' });
    return { ok: true, bot: withJobViews(updated), ...carryOnAfter(taken, true) };
  }
  // A switch of a saved login a bot asked for (ask_vault_switch): turned on for that login, and nothing else of it
  // changes. The login must still be there and still be shared with that bot; otherwise nothing changes and the
  // card goes. Bitwarden that is locked refuses the change, and the card stays.
  async function allowVaultSwitch(a) {
    const bot = B.bots.get(a.botId);
    if (!bot) { asks.take(a.id); throw httpError(404, 'That bot is gone.'); }
    if (bitwarden.configured() && !bitwarden.unlocked()) throw httpError(409, 'Your Bitwarden is locked. Unlock it, then allow this again.');
    const login = store().list().find((e) => e.id === a.loginId);
    if (!login || !(login.allowedBots || []).includes(bot.id)) {
      asks.take(a.id);
      throw httpError(409, `The login “${a.loginName}” is no longer shared with ${bot.name}, so nothing was changed.`);
    }
    await store().update(login.id, { [a.vaultSwitch]: true });
    console.log(`[vault] the owner turned on ${a.vaultSwitch} for "${login.name}", asked by ${bot.id}`);
    return { ok: true, ...carryOnAfter(asks.take(a.id), true) };
  }
  // Secrets a bot asked to keep in a file (place_secret_file, #253): that place may be written from now on, by that bot;
  // the run that waited carries on and writes it. Nothing is written here.
  function allowVaultFile(a) {
    const bot = B.bots.get(a.botId);
    if (!bot) { asks.take(a.id); throw httpError(404, 'That bot is gone.'); }
    const r = secretFiles.allow(a);
    audit('secret-file.allowed', 'you', { bot: bot.id, where: whereOf(r) });
    return { ok: true, ...carryOnAfter(asks.take(a.id), true) };
  }
  // One of a bot's own rules it asked to lift for one action (ask_override, #253). Once: the run that carries on is
  // told, or, when none can, the bot's next run. Always: the bot's `overrides` get it, which only this yes sets
  // (bots.js OVERRIDES), and every later run is told; the owner takes it back in the bot's settings. Both are logged.
  function allowOverride(a, always) {
    const bot = B.bots.get(a.botId);
    if (!bot) { asks.take(a.id); throw httpError(404, 'That bot is gone.'); }
    const same = (o) => o.rule === a.rule && o.action === a.action;
    const kept = (bot.overrides || []).filter((o) => !same(o));
    if (always && kept.length >= B.MAX_OVERRIDES) throw httpError(409, `${bot.name} has ${B.MAX_OVERRIDES} lifted rules already. Take one back in its settings, or allow this once.`);
    const taken = asks.take(a.id); // first: a second answer to the card fails here, before anything is kept
    const grant = { id: crypto.randomUUID().slice(0, 8), rule: a.rule, action: a.action, at: new Date().toISOString() };
    if (always) B.bots.update(bot.id, { [B.OVERRIDES]: [...kept, grant] }, { by: 'you' });
    audit('override.allowed', 'you', { bot: bot.id, override: grant.id });
    const answer = { ok: true, ...carryOnAfter({ ...taken, always }, true) };
    if (!always && !answer.carriesOn) {
      const later = B.bots.get(bot.id);
      B.bots.update(bot.id, { [B.OVERRIDES_ONCE]: [...(later.overridesOnce || []).filter((o) => !same(o)), grant] }, { by: 'you' });
    }
    return answer;
  }
  // A Vault entry a bot asked to remove (remove_login, #132): moved to Bitwarden's Trash, through the queue every bw
  // command waits in (lib/bitwarden.js), never deleted for good. The entry must still be in the Vault and in the bots'
  // list; otherwise nothing changes and the card goes. Bitwarden that is locked refuses it, and the card stays. One
  // removal at a time for each card: a second press while Bitwarden works answers 409. A Bitwarden that answers late
  // gets a 503 in time; the removal goes on, and the card goes once it is done.
  const removing = new Set(); // ids of the cards whose entry is being moved to the Trash
  // The Chief asks for it too (#183): its card has no bot, and its yes tells the Chief in the chat it asked in.
  async function allowVaultRemove(a) {
    const bot = a.botId ? B.bots.get(a.botId) : null;
    if (a.botId && !bot) { asks.take(a.id); throw httpError(404, 'That bot is gone.'); }
    if (removing.has(a.id)) throw httpError(409, 'It is being moved to the Trash already: wait a moment, then look again.');
    if (!bitwarden.configured()) { asks.take(a.id); throw httpError(409, 'Your Vault is not in Bitwarden, which has the Trash, so nothing was removed.'); }
    if (!bitwarden.unlocked()) throw httpError(409, 'Your Bitwarden is locked. Unlock it, then allow this again.');
    const entry = bitwarden.list().find((e) => e.id === a.itemId && !e.reprompt);
    if (!entry) { asks.take(a.id); throw httpError(409, `“${a.loginName}” is no longer in the Vault, so nothing was removed.`); }
    removing.add(a.id);
    const work = bitwarden.remove(entry.id).then(() => {
      console.log(`[vault] the owner moved "${entry.name}" to Bitwarden's Trash, asked by ${bot ? bot.id : 'the Chief'}`);
      // Another bot's card for the same entry has nothing left to ask.
      asks.drop((x) => x.kind === 'vault-remove' && x.itemId === entry.id && x.id !== a.id);
      // A no given meanwhile took the card already: the entry is in the Trash all the same, and nothing carries on.
      return asks.list().some((x) => x.id === a.id) ? carryOnAfter(asks.take(a.id), true) : {};
    }).finally(() => removing.delete(a.id));
    work.catch(() => {});
    return { ok: true, ...(await inTime(work, { late: 'It goes to the Trash once it answers.', failed: 'Nothing was removed: try again.' })) };
  }
  // The owner's yes on a skill a bot wrote after it read content from others (`written`, ADR 015). What held when
  // the bot wrote it must still hold: the name is free or the skill is still that bot's, and still with it.
  function approveWrittenSkill(a) {
    const bot = B.bots.get(a.botId);
    if (!bot) { asks.take(a.id); throw httpError(404, 'That bot is gone.'); }
    const existing = B.skills.read(a.written.name);
    if (existing && (existing.createdBy !== `bot:${bot.id}` || !bot.skills.includes(existing.name))) throw httpError(409, `A skill called "${a.written.name}" is there now and is not this bot's to change. Decline this one.`);
    const saved = writeSkill(bot, a.written);
    asks.take(a.id);
    return { ok: true, skill: saved.name };
  }
  // A proposal of the Chief's memory review (#117): it does what the card says, or 409 when that changed since.
  function approveReviewSkill(a) {
    const done = chiefReview.approve(a); // its error carries the status
    asks.take(a.id);
    return { ok: true, ...done };
  }
  async function installSkill(a) {
    if (chiefReview.fromReview(a)) return approveReviewSkill(a);
    if (a.written) return approveWrittenSkill(a);
    const p = await B.skills.previewImport(a.url); // fresh: what's there now (if this fails, the card stays)
    const skill = B.skills.confirmImport(p.id);
    const taken = asks.take(a.id); // as it is now: another ask of the same run may have been answered while GitHub was read
    attachSkill(skill.name, [...(a.forBots || []), ...(a.botId ? [a.botId] : [])].filter((id) => B.bots.get(id)));
    return { ok: true, skill: skill.name, ...carryOnAfter(taken, true) };
  }
  // An action in a connected app (ADR 010). While its run waits, the yes lets that run's call through and starts
  // nothing. Once the run stopped waiting, it starts the bot again, with the grant for the run it starts.
  // An action too long to show in full (its rows have `more`) cannot be allowed once: "Allow once" sends the stored
  // arguments, and no card shows them all. Asked of the rows the card is drawn from, before anything changes: the
  // card stays, for a no or for "Always allow this action", which grants the action whatever its arguments.
  function allowAction(a, always) {
    if (!always && asksLib.actionRows(a.arguments).more) throw httpError(409, "This is too long to show in full, so it can't be allowed once. Decline it, or always allow this action.");
    const { carries, chief } = connectorApprovals.approve(a, always);
    // The Chief's card: a late yes gives it a turn in its chat, now or after the reply that is going there (ADR 047).
    const said = chief ? { who: 'chief', text: carries === 'started' ? 'the Chief does it now' : 'the Chief does it when it is free' }
      : { who: 'bot', text: carries === 'started' ? 'it carries on' : 'it carries on when it is free' };
    return { ok: true, ...(carries ? { carriesOn: said } : {}) };
  }
  // A changed bot. The proposal is bound to the values it was made against: a bot that changed since is not
  // overwritten (docs/archive/security-issue-90.md), and the card stays for the owner to decline.
  async function approveChange(a) {
    const bot = B.bots.get(a.botId);
    if (!bot) { asks.take(a.id); throw httpError(404, 'That bot is gone.'); }
    if (asksLib.staleChange(a, bot)) throw httpError(409, 'The bot changed since this proposal. Decline it and ask for a fresh proposal.');
    const updated = B.bots.update(bot.id, a.changes, { by: 'you', reason: a.reason, runId: a.runId });
    // The change is saved and the card answered: what follows starts now, also when its computer cannot be set up below.
    const after = carryOnAfter(asks.take(a.id), true);
    if (updated.computer !== bot.computer || updated.computerAlwaysOn !== bot.computerAlwaysOn) {
      B.applyComputerPower(updated).catch((e) => console.error(`[computers] ${e.message}`));
    }
    return { ok: true, bot: withJobViews(updated), ...after };
  }
  return async function routes(req, res, url, { parts, m, by, chiefChat }) {
    // What bots and the Chief asked for: the owner's yes or no (Needs you). The Chief may only ask for a skill or a tool.
    if (parts[0] === 'asks') {
      // A tool's pinned list stays on the server: the card shows how many packages it is, not which. A tool from a link has none.
      // A skill a bot wrote says that it did (`written: true`) and has the text a yes would save in `skill.instructions`:
      // what the owner approves, the owner can read. A skill from a link is read at its link.
      const shown = (a) => (a.kind === 'tool' && a.tool.list ? { ...a, tool: { ...a.tool, list: undefined, packages: a.tool.list.length } } : a.written ? { ...a, written: true, skill: { ...a.skill, instructions: a.written.instructions } } : a);
      // The runs that wait for an ask stay on the server, with the moments they and the Chief's chat count from: its
      // card gets `then`, what a yes would start.
      const view = (a) => { const b = a.botId && B.bots.get(a.botId); return { ...shown(a), runs: undefined, runsAt: undefined, chatAt: undefined, ...asksLib.proposalView(a, b?.name, { appName: B.appName }), text: askText(a), ...yesOn(a), ...thenField(a), ...groupOfCard(runOfAsk(a)), bot: b ? { id: b.id, name: b.name, color: b.color } : null, forBots: (a.forBots || []).map((id) => B.bots.get(id)).filter(Boolean).map((b) => ({ id: b.id, name: b.name, color: b.color })), ...(a.kind === 'permission' ? { what: asksLib.PERMISSIONS[a.permission] } : {}) }; };
      // Read for the cards: an action in a connected app that nobody waits for, and whose yes could start nothing
      // any more, goes now and is not drawn (ADR 010).
      // A switch of a saved login (`vault-switch`), a Vault entry a bot asks to remove (`vault-remove`, #132) and what
      // the Chief asked to do after it read the web (`chief-action`, ADR 033) are listed only for an app that asks for
      // that kind by name (vault-switch=1, vault-remove=1, chief-action=1): one from before it would draw it as a skill
      // to install, with a yes that does it unseen.
      if (!parts[1] && m === 'GET') {
        connectorApprovals.look();
        const asked = (kind) => !['vault-switch', 'vault-remove', 'vault-file', 'override', 'chief-action'].includes(kind) || url.searchParams.get(kind) === '1';
        return send(res, 200, asks.list().filter((a) => asked(a.kind)).map(view));
      }
      const body = await readBody(req);
      if (!parts[1] && m === 'POST') {
        // A tool for one bot: resolved into a pinned list now (or, from a link, downloaded for its checksum), installed only on the owner's Install.
        const text = (value) => (typeof value === 'string' ? value : null);
        if (body.kind === 'tool') return send(res, 201, view((await tools.ask({ botId: body.bot, name: body.name, reason: body.reason, chatId: text(body.chatId), run: text(body.run), link: text(body.link), command: text(body.command), version: text(body.version), what: text(body.what) })).ask));
        if (body.kind !== 'skill') return send(res, 400, { error: 'Only a skill or a tool can be asked for here.' });
        const a = await askSkill({ url: body.url, botId: null, forBots: Array.isArray(body.bots) ? body.bots.filter((id) => B.bots.get(id)) : [], reason: body.reason, chatId: chiefChat });
        return send(res, 201, view(a));
      }
      if (parts[1] && m === 'POST') {
        if (by === 'chief') return send(res, 403, { error: 'Only the owner answers these.' });
        const a = asks.list().find((x) => x.id === parts[1]);
        if (!a) return send(res, 404, { error: 'That request was already answered.' });
        if (body.yes !== true) {
          // An entry that is being moved to the Trash after a yes can't be said no to any more.
          if (a.kind === 'vault-remove' && removing.has(a.id)) return send(res, 409, { error: 'It is being moved to the Trash already: wait a moment, then look again.' });
          // A no starts nothing by itself. For a run that waited for several asks and was allowed another, it is the last answer.
          if (a.kind === 'tool') tools.decline(a); else carryOnAfter(asks.take(a.id, { declined: true }), false);
          if (a.kind === 'connector-action') connectorApprovals.declined(a); // a run that waits for it is told
          if (chiefReview.fromReview(a)) chiefReview.declined(a); // the review does not propose it again
          return send(res, 200, { ok: true, declined: true });
        }
        // The card is answered now; the install goes on by itself and its result reaches the Chief chat that asked.
        if (a.kind === 'tool') { tools.approve(a); return send(res, 200, { ok: true, installing: true }); }
        if (a.kind === 'connector-action') return send(res, 200, allowAction(a, body.always === true));
        if (a.kind === 'bot-change') return send(res, 200, await approveChange(a));
        if (a.kind === 'chief-action') return send(res, 200, await doHeldAction(a));
        if (a.kind === 'permission') return send(res, 200, allowPermission(a));
        if (a.kind === 'vault-switch') return send(res, 200, await allowVaultSwitch(a));
        if (a.kind === 'vault-remove') return send(res, 200, await allowVaultRemove(a));
        if (a.kind === 'vault-file') return send(res, 200, allowVaultFile(a));
        if (a.kind === 'override') return send(res, 200, allowOverride(a, body.always === true));
        return send(res, 200, await installSkill(a));
      }
    }
    return NEXT;
  };
}

module.exports = { create };
