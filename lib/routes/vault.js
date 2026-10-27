// The vault: saved logins (the built-in one or Bitwarden), the bot side of using them, and login requests.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const loginRequests = require('../login-requests');
const connectedAppsLib = require('../connected-apps');
const asksLib = require('../asks');
const vaultHttp = require('../vault-http');
const { notDone } = require('../replay'); // what a replay's write answers (ADR 102)
const githubApp = require('../github-app');
const { siteToType } = require('../vault-type');
const { hostname, loopbackHost, MAX_EXACT_HOSTS } = require('../network-address');
const vaultLib = require('../vault');
const { VAULT_SAY } = require('../chief-tools');
const { whereOf } = require('../secret-files');

// What a bot is told when its remove_login is refused (#132).
const BOT_REMOVE_SAY = {
  noEntry: 'Say which entry to remove, by the name list_logins shows.',
  noTrash: "The owner's Vault is not in Bitwarden, and only Bitwarden keeps a removed entry in its Trash, so it can't be removed from here. Tell the owner which entry is no longer needed.",
  locked: "The owner's Bitwarden is locked. Ask them to unlock it in botdot, then try again.",
  list: 'list_logins',
  declined: "The owner said no to this recently. Don't ask again; leave the entry as it is.",
};
// What a bot is told when it asks again for a login the owner said no to (#611).
const SAY_DECLINED = "The owner said no to a login for this site recently, so nothing was asked. Do what you can without it, or explain what's missing. Only if the owner has since asked you in a message to ask for it again, call request_login with again: true.";
// What a bot is told when it asks for a login of its own computer (#611).
const SAY_LOOPBACK = "That address is your own computer. A secret a program there made (a local mail bridge's password, a token) is only on the computer, so the owner can't type it in: read it there when you need it, and never ask the owner for it.";

function create(ctx) {
  const { vault, bitwarden, store, computerRoutes, readyForSecrets, asks, audit, secretFiles, setUnlockWanted, unlockWanted,
    groupOfCard, holdAfterWeb } = ctx;
  const cardApprovals = new Map(); // `${runId}:${cardId}:${host}` -> until (ms)

  // Copy the built-in vault's logins into Bitwarden (once), then empty it.
  async function moveOldVault() {
    const old = vault.exportAll();
    let moved = 0;
    for (const e of old) {
      await bitwarden.upsert({ name: e.name, site: e.site, username: e.username, password: e.password, insecureTls: e.insecureTls, inComputer: e.inComputer, allowedBots: e.allowedBots, allowedHosts: e.allowedHosts, type: e.type });
      e.password = null;
      vault.remove(e.id);
      moved++;
    }
    return moved;
  }

  // A pending request as the apps see it (with the bot's name, and any login it could reuse).
  function requestView(r) {
    const bot = B.bots.get(r.botId);
    const { existing, others } = loginRequests.logins(store(), r);
    return {
      ...r,
      ...groupOfCard(r.runId),
      bot: bot ? { id: bot.id, name: bot.name, emoji: bot.emoji, color: bot.color, computer: bot.computer } : { id: r.botId, name: r.botId, emoji: '🤖', color: null },
      existing: existing.map(({ id, name, username, allowedBots }) => ({ id, name, username, allowed: allowedBots.includes(r.botId) })),
      ...(others ? { others: others.map(({ id, name, username, site }) => ({ id, name, username, site })) } : {}),
    };
  }

  // Wait for an answer in 25 s slices so the HTTP call stays short; the caller loops.
  async function waitAnswer(res, id) {
    const r = await loginRequests.wait(id);
    if (!r) return send(res, 404, { ok: false, error: 'Request not found' });
    return send(res, 200, { status: r.status, loginName: r.loginName });
  }

  // Hand a secret to the Camoufox inside a bot's computer via stdin (never on a command line).
  function typeInComputer(session, payload) {
    return B.computers.typeSecret(session.botId, payload);
  }
  // An ask to remove an entry of the Vault (remove_login, #132; the Chief's remove_vault_item, #183): the card of kind
  // 'vault-remove', whose yes moves the entry to Bitwarden's Trash (lib/routes/asks.js allowVaultRemove). Nothing is
  // removed here, and no secret of the entry is read. who: { botId, runId } of a bot's run, or { botId: null, chatId }
  // of the Chief's chat. say: the sentences of the refusals, for the one who asks. Returns { id, name }, or
  // { status, error } and no card.
  function askRemove({ botId, runId = null, chatId = null, entry: ref, reason }, say) {
    if (!String(ref || '').trim()) return { status: 400, error: say.noEntry };
    if (!bitwarden.configured()) return { status: 400, error: say.noTrash };
    if (!bitwarden.unlocked()) return { status: 423, error: say.locked };
    let entry;
    try { entry = bitwarden.listedItem(ref); } catch (e) { return { status: 400, error: e.message.replace('list_logins', say.list) }; }
    if (asks.removeDeclined(botId, entry.id)) return { status: 400, error: say.declined };
    const a = asks.add({ kind: 'vault-remove', botId, ...(chatId ? { chatId } : {}), itemId: entry.id, loginName: entry.name, site: entry.site, reason }, { runId });
    return { id: a.id, name: entry.name };
  }
  // An API call with the logins a call names (listed: vaultHttp.loginList), each shared with the bot, as botdot makes
  // it for a bot's api_request and a script job's botdot-request (ADR 085). Answers apiRequest's { ok, status, text,
  // body }, or { ok: false, text } with why nothing was sent. No secret stays in what is kept after it.
  async function withLogins(botId, body, listed, who = botId) {
    if (listed.error) return { ok: false, text: listed.error };
    await readyForSecrets(botId);
    const used = [];
    const refused = [];
    for (const ref of listed.refs) {
      try { used.push({ key: ref, creds: store().credentials(botId, ref) }); } catch (e) { refused.push(e.message); }
    }
    if (refused.length) { for (const u of used) u.creds.password = null; return { ok: false, text: refused.join(' ') }; }
    let result;
    try { result = await vaultHttp.apiRequest(listed.several ? used : used[0].creds, body); } catch (e) { result = { ok: false, text: e.message }; }
    // A certificate a login does not accept: the bot asks for the switch on a card, the owner does not go to the Vault.
    const strict = used.filter((u) => !u.creds.insecureTls).map((u) => `"${u.creds.name}"`);
    if (!result.ok && result.text === vaultHttp.CERT_UNTRUSTED && strict.length) {
      result.text = `The server's certificate isn't trusted. If it is the owner's own server with a self-signed certificate, ask the owner to accept it for the ${strict.join(', ')} login${strict.length > 1 ? 's' : ''} with ask_vault_switch (switch "insecureTls"${strict.length > 1 ? ', once per login' : ''}), then try again once they allow it. Don't tell them to change it in the Vault themselves.`;
    }
    for (const u of used) u.creds.password = null;
    let where = '';
    try { const u = new URL(String(body.url)); where = `${u.hostname}${u.pathname}`; } catch { /* invalid */ }
    console.log(`[vault] ${who} ${String(body.method || 'GET').toUpperCase()} ${where} with ${used.map((u) => `"${u.creds.name}"`).join(', ')}: ${result.ok ? result.status : 'failed'}`);
    return result;
  }

  return async function routes(req, res, url, { parts, m, by, chiefChat, standing, replay }) {
    if (parts[0] === 'vault') {
      // A script job's botdot-request (ADR 085): by its run's key alone, only while that run goes, and only with the
      // logins its job lists, which the owner approved with the script. The gate (server.js) let in only that bot.
      if (parts[1] === 'script') {
        const session = B.scriptSession(req.headers['x-run-token']);
        if (!session) return send(res, 403, { ok: false, error: "This works only in a script job's run whose job lists the logins it uses." });
        if (parts[2] !== 'http' || parts[3] || m !== 'POST') return send(res, 404, { ok: false, error: 'Unknown endpoint' });
        const body = await readBody(req);
        const listed = vaultHttp.loginList(body);
        const own = (ref) => session.logins.some((n) => n.toLowerCase() === String(ref).trim().toLowerCase());
        const missing = (listed.refs || []).filter((ref) => !own(ref));
        if (missing.length) return send(res, 200, { ok: false, error: `This job may use only the logins it lists (${session.logins.map((n) => `"${n}"`).join(', ')}), not ${missing.map((n) => `"${n}"`).join(', ')}. Add a login to the job's "logins"; the owner approves it on a card.` });
        const r = await withLogins(session.botId, body, listed, `${session.botId} job ${session.jobId}`);
        return send(res, 200, r.ok ? { ok: true, status: r.status, body: r.body ?? '' } : { ok: false, error: r.text });
      }
      // git's credential helper in a bot's AI run (ADR 090, lib/script-bin/botdot-git-credential): by the run's git key
      // alone, while its Claude Code goes. For HTTPS to a GitHub the bot has a GitHub App login of, that app's token,
      // which ends within the hour; the app's key never leaves botdot. Nothing for any other host or login.
      if (parts[1] === 'git') {
        const session = B.gitSession(req.headers['x-run-token']);
        if (!session) return send(res, 403, { ok: false, error: "This works only in a bot's run." });
        if (parts[2] !== 'credential' || parts[3] || m !== 'POST') return send(res, 404, { ok: false, error: 'Unknown endpoint' });
        const { protocol, host } = await readBody(req);
        if (protocol !== 'https' || !host) return send(res, 200, { ok: true });
        if (!(await readyForSecrets(session.botId))) return send(res, 200, { ok: false, error: "the owner's Bitwarden is locked, so git can't sign in with a GitHub App yet. Ask them to unlock it in botdot." });
        const name = githubApp.forGitHost(store().forBot(session.botId), host);
        if (!name) return send(res, 200, { ok: true });
        let creds;
        try {
          creds = store().credentials(session.botId, name);
          const login = await githubApp.asLogin(creds);
          console.log(`[vault] ${session.botId} git signs in to ${String(host).slice(0, 100)} with "${creds.name}"`);
          return send(res, 200, { ok: true, username: login.username, password: login.password });
        } catch (e) {
          return send(res, 200, { ok: false, error: e.message });
        } finally { if (creds) creds.password = null; }
      }
      // Bot side: identified by the per-run token, never by the user's session.
      if (parts[1] === 'session') {
        const session = B.vaultSession(req.headers['x-vault-token']) || B.replaySession(req.headers['x-vault-token']);
        if (!session) return send(res, 403, { ok: false, error: 'This run may not use saved logins.' });
        // A replay of a bot's past task (ADR 102): the list of its logins, and api_request with GET. Any other call
        // with a login is not made and says what it would have sent; nothing else of the Vault is there.
        if (session.replay) {
          if (parts[2] === 'logins' && !parts[3] && m === 'GET') {
            if (!(await readyForSecrets(session.botId))) return send(res, 200, { ok: false, error: "The owner's Bitwarden is locked, so saved logins aren't available yet." });
            return send(res, 200, { logins: store().forBot(session.botId), notShared: [] });
          }
          if (parts[2] === 'http' && !parts[3] && m === 'POST') {
            const body = await readBody(req);
            const method = String(body.method || 'GET').toUpperCase();
            if (method !== 'GET') return send(res, 200, { ok: true, text: notDone({ method, url: String(body.url || ''), ...(body.body !== undefined ? { body: body.body } : {}) }) });
            const result = await withLogins(session.botId, body, vaultHttp.loginList(body), `${session.botId} replay`);
            return send(res, 200, result.ok ? { ok: true, text: result.text } : { ok: false, error: result.text });
          }
          return send(res, 200, { ok: false, error: 'A replay only reads with saved logins: list_logins, and api_request with GET.' });
        }
        // The bot's computer tools (lib/routes/computers.js).
        { const out = await computerRoutes.ofSession(req, res, url, { parts, m, session }); if (out !== NEXT) return out; }
        if (parts[2] === 'logins' && m === 'GET') {
          if (!(await readyForSecrets(session.botId))) return send(res, 200, { ok: false, error: "The owner's Bitwarden is locked, so saved logins aren't available yet. Ask them to unlock it in botdot." });
          return send(res, 200, { logins: store().forBot(session.botId), notShared: store().notSharedWith(session.botId) });
        }
        if (parts[2] === 'request' && !parts[3] && m === 'POST') {
          const { site, name, username, reason, type, again } = await readBody(req);
          const host = store().normalizeSite(site);
          if (!host) return send(res, 400, { ok: false, error: 'Say which website the login is for' });
          const app = connectedAppsLib.refused(host, type); // Google, Slack, GitHub…: a connected app, never a password
          if (app) return send(res, 200, { ok: false, error: connectedAppsLib.toBot(host, app) });
          // 127.0.0.1 is the bot's own computer: a secret a program there made (a local mail bridge, a token) is
          // only there, and the owner can't type it in (#611).
          if (loopbackHost(host)) return send(res, 200, { ok: false, error: SAY_LOOPBACK });
          const no = asks.loginDeclined(session.botId, host);
          if (no && !(again === true && no.ownerWrote)) return send(res, 200, { ok: false, error: SAY_DECLINED });
          if (!(await readyForSecrets(session.botId))) return send(res, 200, { ok: false, error: "The owner's Bitwarden is locked. Ask them to unlock it in botdot, then try again." });
          const r = loginRequests.create({ botId: session.botId, runId: session.runId, site: host, name, username, reason, type, from: 'bot' });
          if (bitwarden.unlocked()) bitwarden.sync({ background: true, ifOlderThan: 60_000 }).catch(() => {}); // pick up logins moved into bot-dot, unless synced in the last minute ("check Bitwarden again" always syncs)
          return send(res, 201, { ok: true, id: r.id });
        }
        if (parts[2] === 'request' && parts[3] && parts[4] === 'wait' && m === 'GET') {
          const r = loginRequests.get(parts[3]);
          if (!r || r.botId !== session.botId) return send(res, 404, { ok: false, error: 'Request not found' });
          return waitAnswer(res, r.id);
        }
        // ask_vault_switch: the bot asks the owner to turn on a switch of a login shared with it. It waits on a card in
        // its chat and in Needs you; only the owner's yes there (POST /api/asks/:id) turns it on.
        if (parts[2] === 'switch' && !parts[3] && m === 'POST') {
          const body = await readBody(req);
          const field = String(body.switch || '');
          if (!Object.hasOwn(asksLib.VAULT_SWITCHES, field)) return send(res, 200, { ok: false, error: 'Ask for one of the switches insecureTls or inComputer.' });
          if (!(await readyForSecrets(session.botId))) return send(res, 200, { ok: false, error: "The owner's Bitwarden is locked. Ask them to unlock it in botdot, then try again." });
          let login;
          try { login = store().sharedLogin(session.botId, body.login); } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
          const name = asksLib.VAULT_SWITCHES[field].name;
          if (login[field]) return send(res, 200, { ok: false, error: `“${name}” is already on for "${login.name}".` });
          if (asks.switchDeclined(session.botId, login.id, field)) return send(res, 200, { ok: false, error: "The owner said no to this recently. Don't ask again; do what you can without it." });
          asks.add({ kind: 'vault-switch', botId: session.botId, loginId: login.id, loginName: login.name, site: login.site, vaultSwitch: field, reason: body.reason }, { runId: session.runId });
          return send(res, 200, { ok: true, name, login: login.name });
        }
        // remove_login (#132): the bot asks the owner to remove an entry of its Vault list, shared with it or not. It
        // waits on a card in its chat and in Needs you; only the owner's yes there (POST /api/asks/:id) moves it to
        // Bitwarden's Trash. No secret of the entry is read for it.
        if (parts[2] === 'remove' && !parts[3] && m === 'POST') {
          const body = await readBody(req);
          if (!(await readyForSecrets(session.botId)) && bitwarden.configured()) return send(res, 200, { ok: false, error: "The owner's Bitwarden is locked. Ask them to unlock it in botdot, then try again." });
          const out = askRemove({ botId: session.botId, runId: session.runId, entry: body.entry, reason: body.reason }, BOT_REMOVE_SAY);
          return send(res, 200, out.error ? { ok: false, error: out.error } : { ok: true, name: out.name });
        }
        // api_request: one login, or several (`logins`, #228), each shared with this bot.
        if (parts[2] === 'http' && m === 'POST') {
          const body = await readBody(req);
          const result = await withLogins(session.botId, body, vaultHttp.loginList(body));
          return send(res, 200, result.ok ? { ok: true, text: result.text } : { ok: false, error: result.text });
        }
        if (parts[2] === 'type' && m === 'POST') {
          if (!session.container) return send(res, 200, { ok: false, error: "This bot has no computer with a browser. For an API, use api_request instead." });
          const { login, field, submit } = await readBody(req);
          const kind = ['username', 'totp'].includes(field) ? field : 'password';
          await readyForSecrets(session.botId);
          let secret;
          try { secret = await store().reveal(session.botId, login, kind); } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
          if (secret.type === githubApp.TYPE && kind !== 'username') {
            secret.value = null;
            return send(res, 200, { ok: false, error: `"${secret.name}" is a GitHub App: its private key is never typed anywhere. Call GitHub's API with api_request and {{token}} instead.` });
          }
          // The login's website, or the page's host where that is exactly one of its additional hosts.
          const site = await siteToType((payload) => typeInComputer(session, payload), secret);
          const result = await typeInComputer(session, { site, field: kind, value: secret.value, submit: !!submit });
          secret.value = null;
          console.log(`[vault] ${session.botId} typed ${kind} for "${secret.name}": ${result.ok ? 'ok' : 'refused'}`);
          return send(res, 200, result.ok ? { ok: true, name: secret.name } : { ok: false, error: result.error });
        }
        // A card detail, typed into a checkout page. Needs the owner's OK for this card on this site
        // (asked in a pop-up; one OK covers this run on that site for 15 minutes).
        if (parts[2] === 'card' && m === 'POST') {
          if (!session.container) return send(res, 200, { ok: false, error: 'This bot has no computer with a browser, so it cannot pay on a website.' });
          if (!bitwarden.configured()) return send(res, 200, { ok: false, error: 'Cards need Bitwarden, which is not connected.' });
          const { card, field, reason, amount, submit } = await readBody(req);
          if (!(await readyForSecrets(session.botId))) return send(res, 200, { ok: false, error: "The owner's Bitwarden is locked. Ask them to unlock it in botdot." });
          let info;
          try { info = bitwarden.card(session.botId, card); } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
          const where = await typeInComputer(session, { op: 'where' });
          const host = where.ok ? where.host : '';
          if (!host) return send(res, 200, { ok: false, error: 'Open the checkout page in Camoufox first.' });
          const key = `${session.runId}:${info.id}:${host}`;
          if (!(cardApprovals.get(key) > Date.now())) {
            const r = loginRequests.create({ botId: session.botId, runId: session.runId, site: host, name: info.name, reason, amount, from: 'bot', kind: 'card', card: { id: info.id, name: info.name, brand: info.brand, last4: info.last4 } });
            return send(res, 200, { ok: true, needsApproval: true, id: r.id, site: host });
          }
          let secret;
          try { secret = bitwarden.cardField(session.botId, card, field); } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
          const result = await typeInComputer(session, { site: host, field: 'card', value: secret.value, submit: !!submit });
          secret.value = null;
          console.log(`[vault] ${session.botId} typed card ${field} (••${secret.last4}) on ${host}: ${result.ok ? 'ok' : 'refused'}`);
          return send(res, 200, result.ok ? { ok: true, name: secret.name } : { ok: false, error: result.error });
        }
        // Name, address, email… from a Bitwarden identity, typed into a form.
        if (parts[2] === 'identity' && m === 'POST') {
          if (!session.container) return send(res, 200, { ok: false, error: 'This bot has no computer with a browser.' });
          if (!bitwarden.configured()) return send(res, 200, { ok: false, error: 'Identities need Bitwarden, which is not connected.' });
          const { identity, field, submit } = await readBody(req);
          if (!(await readyForSecrets(session.botId))) return send(res, 200, { ok: false, error: "The owner's Bitwarden is locked. Ask them to unlock it in botdot." });
          let secret;
          try { secret = bitwarden.identityField(session.botId, identity, field); } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
          const result = await typeInComputer(session, { field: 'text', value: secret.value, submit: !!submit });
          secret.value = null;
          return send(res, 200, result.ok ? { ok: true, name: secret.name } : { ok: false, error: result.error });
        }
        return send(res, 404, { error: 'Unknown endpoint' });
      }
      // Login requests: listed and answered by the owner; the Chief can also open one.
      if (parts[1] === 'requests') {
        const rid = parts[2];
        if (!rid && m === 'GET') return send(res, 200, loginRequests.pending().map(requestView));
        if (!rid && m === 'POST') {
          const { site, name, username, reason, forBot, type } = await readBody(req);
          const host = store().normalizeSite(site);
          if (!host) return send(res, 400, { ok: false, error: 'Say which website the login is for' });
          if (!B.bots.get(forBot)) return send(res, 400, { ok: false, error: 'Say which bot will use the login (forBot)' });
          const app = connectedAppsLib.refused(host, type);
          if (app) return send(res, 400, { ok: false, error: connectedAppsLib.toChief(host, app) });
          const r = loginRequests.create({ botId: forBot, site: host, name, username, reason, type, from: 'chief' });
          if (bitwarden.unlocked()) bitwarden.sync({ background: true, ifOlderThan: 60_000 }).catch(() => {});
          return send(res, 201, { ok: true, id: r.id });
        }
        const r = rid && loginRequests.get(rid);
        if (!r) return send(res, 404, { error: 'Request not found' });
        if (parts[3] === 'wait' && m === 'GET') return waitAnswer(res, rid);
        if (!parts[3] && m === 'POST') {
          if (r.status !== 'pending') return send(res, 409, { error: 'This request was already answered' });
          const body = await readBody(req);
          if (body.action === 'decline') {
            if (r.kind === 'login') asks.declineLogin(r.botId, r.site); // its runs don't ask again within the week (#611)
            return send(res, 200, loginRequests.settle(rid, 'declined'));
          }
          // A card use: the owner's OK covers this run, this card and this site for 15 minutes.
          if (r.kind === 'card') {
            if (body.action !== 'approve') return send(res, 400, { error: 'Unknown action' });
            cardApprovals.set(`${r.runId}:${r.card.id}:${r.site}`, Date.now() + 15 * 60_000);
            console.log(`[vault] owner approved card ••${r.card.last4} for ${r.botId} on ${r.site}`);
            return send(res, 200, loginRequests.settle(rid, 'allowed', r.card.name));
          }
          if (body.action === 'allow') {
            const { existing, others } = loginRequests.logins(store(), r);
            const ofSite = existing.find((x) => x.id === body.loginId);
            const e = ofSite || others.find((x) => x.id === body.loginId);
            if (!e) return send(res, 404, { error: 'Login not found' });
            const patch = { allowedBots: [...new Set([...e.allowedBots, r.botId])] };
            // A login of another website: the requested host joins its additional hosts (exact, and only so many).
            const hosts = e.allowedHosts || [];
            const host = hostname(r.site); // as exactHosts keeps it
            const adds = !ofSite && !hosts.includes(host);
            if (adds && hosts.length >= MAX_EXACT_HOSTS) return send(res, 400, { error: `"${e.name}" already has ${MAX_EXACT_HOSTS} additional hosts. Remove one in the Vault first.` });
            // exactHosts reads each host as an address again, where an IPv6 address stands in brackets.
            if (adds) patch.allowedHosts = [...hosts, host].map((h) => (h.includes(':') ? `[${h}]` : h));
            await store().update(e.id, patch);
            // Every pick of a login of another website is logged, also when an earlier pick already added the host.
            if (!ofSite) audit('login.host-allowed', by, { login: String(e.name).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 100) || e.id, host, bot: r.botId });
            return send(res, 200, loginRequests.settle(rid, 'allowed', e.name));
          }
          if (body.action === 'save') {
            // The site is fixed to what was requested and shown in the pop-up.
            if (!body.password) return send(res, 400, { error: 'Enter the password' });
            // The type the owner chose in the pop-up. A save that names none (an app from before the types) saves a
            // new item as what was asked for, and leaves the type of a login already saved. An unknown one is
            // refused here, before Bitwarden is unlocked or anything is saved.
            const type = vaultLib.givenType(body.type);
            // With Bitwarden locked, the pop-up also asks for the master password, so the login can go there.
            if (bitwarden.configured() && !bitwarden.unlocked()) {
              if (!body.unlockPassword) return send(res, 423, { error: 'Bitwarden is locked. Enter your master password so the login can be saved there.' });
              try { await bitwarden.unlock(body.unlockPassword); audit('bitwarden.unlocked', by); } finally { body.unlockPassword = null; }
              setUnlockWanted(null);
              if (vault.list().length) await moveOldVault();
            }
            const e = await store().upsert({ name: body.name || r.name, site: r.site, username: body.username, password: body.password, insecureTls: !!body.insecureTls, allowedBots: [r.botId], type, typeIfNew: r.type });
            body.password = null;
            return send(res, 200, loginRequests.settle(rid, 'saved', e.name));
          }
          return send(res, 400, { error: 'Unknown action' });
        }
        return send(res, 404, { error: 'Unknown endpoint' });
      }

      // Bitwarden: connect (API key), unlock (master password, kept only as an in-memory session), lock.
      if (parts[1] === 'bitwarden') {
        if (!parts[2] && m === 'GET') {
          const wanted = unlockWanted() && Date.now() - unlockWanted().at < 60_000 && !bitwarden.unlocked() ? B.bots.get(unlockWanted().botId) : null;
          return send(res, 200, { ...(await bitwarden.status()), oldLogins: vault.list().length, wantedBy: wanted ? { id: wanted.id, name: wanted.name, emoji: wanted.emoji, color: wanted.color } : null });
        }
        const body = await readBody(req);
        if (parts[2] === 'setup' && m === 'POST') return send(res, 200, await bitwarden.setup(body));
        if (parts[2] === 'unlock' && m === 'POST') {
          const st = await bitwarden.unlock(body.password);
          audit('bitwarden.unlocked', by);
          body.password = null;
          setUnlockWanted(null);
          const moved = vault.list().length ? await moveOldVault() : 0;
          return send(res, 200, { ...st, moved });
        }
        if (parts[2] === 'lock' && m === 'POST') { await bitwarden.lock(); return send(res, 200, await bitwarden.status()); }
        if (parts[2] === 'sync' && m === 'POST') { await bitwarden.sync(); return send(res, 200, await bitwarden.status()); }
        return send(res, 404, { error: 'Unknown endpoint' });
      }

      // An SSH key the owner adds (#160): pasted or picked, or generated here. Bitwarden only, as every SSH key. The
      // private key is write-only: the answer is the item as the list shows it, with its public key and fingerprint.
      // The Chief makes one too (#181): a new key alone, in a turn the owner started, shared with bots that exist. Its
      // answer is the same item, so the Chief reads back the public key and the fingerprint and never the private key.
      // In a chat that read the web it waits on a card (server.js holdAfterWeb), held here after the refusals, so a
      // refused call, one with a key of its own above all, never becomes a card.
      if (parts[1] === 'ssh-keys' && !parts[2] && m === 'POST' && by === 'chief') {
        const body = (await readBody(req)) || {};
        const pasted = body.privateKey !== undefined;
        body.privateKey = null; // never kept, not even in a card
        if (standing()?.startedBy !== 'owner') return send(res, 403, { error: VAULT_SAY.notNow });
        if (pasted) return send(res, 400, { error: VAULT_SAY.noPaste });
        const allowedBots = Array.isArray(body.allowedBots) ? body.allowedBots.map(String) : [];
        const unknown = allowedBots.find((botId) => !B.bots.get(botId));
        if (unknown) return send(res, 400, { error: VAULT_SAY.noBot(unknown) });
        if (!String(body.name ?? '').trim()) return send(res, 400, { error: 'Give the SSH key a name. Nothing was made.' });
        const ask = { name: body.name, allowedBots };
        if (!replay && standing().web) return holdAfterWeb(req, res, m, parts, chiefChat, standing(), ask);
        if (!bitwarden.configured()) return send(res, 400, { error: VAULT_SAY.noBitwarden });
        if (!bitwarden.unlocked()) return send(res, 423, { error: VAULT_SAY.locked });
        try { return send(res, 201, await bitwarden.addSshKey({ ...ask, generate: true })); } catch (e) {
          return send(res, 400, { error: `No SSH key was made: ${e.message}` });
        }
      }
      if (parts[1] === 'ssh-keys' && !parts[2] && m === 'POST') {
        const body = await readBody(req);
        try {
          if (!bitwarden.configured()) return send(res, 400, { error: 'SSH keys are kept in Bitwarden. Connect it on the Vault page first.' });
          if (!bitwarden.unlocked()) return send(res, 423, { error: 'Bitwarden is locked. Unlock it, then add the SSH key.' });
          const e = await bitwarden.addSshKey({ name: body.name, privateKey: body.privateKey, generate: body.generate === true, allowedBots: body.allowedBots });
          return send(res, 201, e);
        } finally { body.privateKey = null; }
      }

      // A file the owner adds (#157): its name and its bytes in base64, as the apps read it from the file picked. Bitwarden
      // only, as SSH keys. The content is write-only: the answer is the item as the list shows it, a name and a size.
      if (parts[1] === 'files' && !parts[2] && m === 'POST') {
        const body = await readBody(req);
        try {
          if (!bitwarden.configured()) return send(res, 400, { error: 'Files are kept in Bitwarden. Connect it on the Vault page first.' });
          if (!bitwarden.unlocked()) return send(res, 423, { error: 'Bitwarden is locked. Unlock it, then add the file.' });
          return send(res, 201, await bitwarden.addFile({ name: body.name, fileName: body.fileName, content: body.content, allowedBots: body.allowedBots }));
        } finally { body.content = null; }
      }

      // The Chief asks to remove an entry of the Vault (#183), as a bot does with remove_login (#132): the same card, kind
      // 'vault-remove', from the Chief (botId null) and for its chat, whose yes moves the entry to Bitwarden's Trash
      // (lib/routes/asks.js allowVaultRemove) and tells the Chief there. Only in a turn the owner started; any entry
      // the Vault lists, as for a bot. Nothing is removed here.
      if (parts[1] === 'remove' && !parts[2] && m === 'POST' && by === 'chief') {
        const body = (await readBody(req)) || {};
        if (standing()?.startedBy !== 'owner') return send(res, 403, { error: VAULT_SAY.notNowRemove });
        const out = askRemove({ botId: null, chatId: chiefChat, entry: body.entry, reason: body.reason }, VAULT_SAY.remove);
        return out.error ? send(res, out.status, { error: out.error }) : send(res, 201, { ok: true, id: out.id, name: out.name });
      }
      // The Chief changes an SSH key (#182): its bots and its name, nothing else of it, in a turn the owner started.
      // A password, a token, a card and the rest stay the owner's. Held after the refusals, as a new key is.
      if (parts[1] && !parts[2] && m === 'PUT' && by === 'chief') {
        const body = (await readBody(req)) || {};
        if (standing()?.startedBy !== 'owner') return send(res, 403, { error: VAULT_SAY.notNowChange });
        if (!bitwarden.configured()) return send(res, 400, { error: VAULT_SAY.noBitwardenChange });
        if (!bitwarden.unlocked()) return send(res, 423, { error: VAULT_SAY.lockedChange });
        const item = bitwarden.list().find((i) => i.id === parts[1]);
        if (!item) return send(res, 404, { error: VAULT_SAY.noKey(parts[1]) });
        if (item.kind !== 'ssh-key') return send(res, 400, { error: VAULT_SAY.onlyKeys(item.name) });
        const change = {};
        if (body.name !== undefined) {
          if (!String(body.name).trim()) return send(res, 400, { error: 'Give the SSH key a name. Nothing was changed.' });
          change.name = String(body.name);
        }
        // Bots to add and to take off, applied to the key's bots as they are when it is done: a change held on a card
        // keeps what the owner changed meanwhile.
        const ids = (k) => (body[k] === undefined ? [] : Array.isArray(body[k]) ? body[k].map(String) : null);
        const [add, remove] = [ids('add'), ids('remove')];
        if (!add || !remove) return send(res, 400, { error: 'add and remove are lists of bot ids. Nothing was changed.' });
        const unknown = [...add, ...remove].find((botId) => !B.bots.get(botId));
        if (unknown) return send(res, 400, { error: VAULT_SAY.noBot(unknown, 'changed') });
        if (add.length || remove.length) Object.assign(change, { add, remove });
        if (!Object.keys(change).length) return send(res, 400, { error: VAULT_SAY.nothing });
        if (!replay && standing().web) return holdAfterWeb(req, res, m, parts, chiefChat, standing(), change);
        const patch = change.name === undefined ? {} : { name: change.name };
        if (change.add) patch.allowedBots = [...item.allowedBots, ...change.add.filter((botId) => !item.allowedBots.includes(botId))].filter((botId) => !change.remove.includes(botId));
        try { return send(res, 200, await bitwarden.update(item.id, patch)); } catch (e) {
          return send(res, 400, { error: `The SSH key was not changed: ${e.message}` });
        }
      }

      // "Remove the file" on the Vault page (#253): a secret kept in a file goes from where botdot wrote it, and so does
      // the owner's yes for that place. Only the owner removes it. A file already gone is no error.
      if (parts[1] === 'secret-files' && parts[2] && !parts[3] && m === 'DELETE') {
        if (by === 'chief') return send(res, 403, { error: 'Only the owner removes a placed file.' });
        const r = secretFiles.get(parts[2]);
        if (!r) return send(res, 404, { error: 'That file is no longer listed.' });
        const where = whereOf(r);
        // A file botdot can no longer reach (its bot gone, or the SSH key no longer shared with it): the yes goes all
        // the same, so nothing writes it again, and the owner is told to delete the file by hand.
        const byHand = (why) => {
          secretFiles.remove(r.id);
          audit('secret-file.removed', 'you', { bot: r.botId, where });
          return send(res, 200, { ok: true, byHand: true, say: `${why}, so botdot can't reach ${where}. It won't write it again: delete the file there by hand.` });
        };
        if (!r.placedAt) { secretFiles.remove(r.id); audit('secret-file.removed', 'you', { bot: r.botId, where }); return send(res, 200, { ok: true }); }
        let ssh = null;
        if (r.sshKey) {
          if (!bitwarden.configured() || !bitwarden.unlocked()) return send(res, 409, { error: 'Your Bitwarden is locked: unlock it, so botdot can reach the server with its SSH key.' });
          if (!B.bots.get(r.botId)) return byHand('Its bot is gone');
          try { ssh = bitwarden.sshKey(r.botId, r.sshKey); } catch { return byHand(`The SSH key "${r.sshKey}" is no longer shared with its bot`); }
        }
        let out;
        try {
          await B.computers.ensure();
          out = await B.computers.removePlacedFile(r.botId, { path: r.path, ...(ssh ? { host: r.target, privateKey: ssh.privateKey } : {}) });
        } catch (e) { out = { code: null, error: e.message }; }
        if (ssh) ssh.privateKey = null;
        if (out.code !== 0) return send(res, 502, { error: `Couldn't remove ${where}: ${(out.stderr || out.error || 'no answer').trim().slice(0, 300)}` });
        secretFiles.remove(r.id);
        audit('secret-file.removed', 'you', { bot: r.botId, where });
        console.log(`[vault] the owner removed the placed file ${where}`);
        return send(res, 200, { ok: true });
      }

      // Owner side (the apps). Passwords are write-only. Each entry kept in a file says where (#253).
      const id = parts[1];
      if (!id && m === 'GET') { const places = secretFiles.byEntry(); return send(res, 200, store().list().map((e) => (places.has(e.id) ? { ...e, placedIn: places.get(e.id) } : e))); }
      // A login the owner saves for a site undoes every no to a login there (#611).
      const forgetNo = (e) => { if (e?.site) asks.forgetLoginDeclines([e.site, ...(e.allowedHosts || [])]); return e; };
      if (!id && m === 'POST') return send(res, 201, forgetNo(await store().add(await readBody(req))));
      if (id && m === 'PUT') { const e = forgetNo(await store().update(id, await readBody(req))); return e ? send(res, 200, e) : send(res, 404, { error: 'Login not found' }); }
      if (id && m === 'DELETE') return send(res, 200, { ok: await store().remove(id) });
    }
    return NEXT;
  };
}

module.exports = { create };
