// What a bot or the Chief asks the owner for (lib/asks.js), and the owner's yes or no on it, one function per kind.
const { NEXT, send, httpError, readBody } = require('./http');
const B = require('../bots');
const asksLib = require('../asks');

function create(ctx) {
  const { asks, bitwarden, store, connectorApprovals, tools, doHeldAction, withJobViews, carryOnAfter, writeSkill,
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
    const { carries } = connectorApprovals.approve(a, always);
    return { ok: true, ...(carries ? { carriesOn: { who: 'bot', text: carries === 'started' ? 'it carries on' : 'it carries on when it is free' } } : {}) };
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
      // A switch of a saved login (`vault-switch`) and what the Chief asked to do after it read the web
      // (`chief-action`, ADR 033) are listed only for an app that asks for that kind by name (vault-switch=1,
      // chief-action=1): one from before it would draw it as a skill to install, with a yes that does it unseen.
      if (!parts[1] && m === 'GET') {
        connectorApprovals.look();
        const asked = (kind) => !['vault-switch', 'chief-action'].includes(kind) || url.searchParams.get(kind) === '1';
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
        return send(res, 200, await installSkill(a));
      }
    }
    return NEXT;
  };
}

module.exports = { create };
