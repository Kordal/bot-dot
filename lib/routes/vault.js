// The vault: saved logins (the built-in one or Bitwarden), the bot side of using them, and login requests.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const loginRequests = require('../login-requests');
const connectedAppsLib = require('../connected-apps');
const asksLib = require('../asks');
const vaultHttp = require('../vault-http');
const { siteToType } = require('../vault-type');
const { hostname, MAX_EXACT_HOSTS } = require('../network-address');
const vaultLib = require('../vault');

function create(ctx) {
  const { vault, bitwarden, store, computerRoutes, readyForSecrets, asks, audit, setUnlockWanted, unlockWanted,
    groupOfCard } = ctx;
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
  return async function routes(req, res, url, { parts, m, by }) {
    if (parts[0] === 'vault') {
      // Bot side: identified by the per-run token, never by the user's session.
      if (parts[1] === 'session') {
        const session = B.vaultSession(req.headers['x-vault-token']);
        if (!session) return send(res, 403, { ok: false, error: 'This run may not use saved logins.' });
        // The bot's computer tools (lib/routes/computers.js).
        { const out = await computerRoutes.ofSession(req, res, url, { parts, m, session }); if (out !== NEXT) return out; }
        if (parts[2] === 'logins' && m === 'GET') {
          if (!(await readyForSecrets(session.botId))) return send(res, 200, { ok: false, error: "The owner's Bitwarden is locked, so saved logins aren't available yet. Ask them to unlock it in botdot." });
          return send(res, 200, { logins: store().forBot(session.botId), notShared: store().notSharedWith(session.botId) });
        }
        if (parts[2] === 'request' && !parts[3] && m === 'POST') {
          const { site, name, username, reason, type } = await readBody(req);
          const host = store().normalizeSite(site);
          if (!host) return send(res, 400, { ok: false, error: 'Say which website the login is for' });
          const app = connectedAppsLib.refused(host, type); // Google, Slack, GitHub…: a connected app, never a password
          if (app) return send(res, 200, { ok: false, error: connectedAppsLib.toBot(host, app) });
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
          if (!String(body.entry || '').trim()) return send(res, 200, { ok: false, error: 'Say which entry to remove, by the name list_logins shows.' });
          if (!bitwarden.configured()) return send(res, 200, { ok: false, error: "The owner's Vault is not in Bitwarden, and only Bitwarden keeps a removed entry in its Trash, so it can't be removed from here. Tell the owner which entry is no longer needed." });
          if (!(await readyForSecrets(session.botId))) return send(res, 200, { ok: false, error: "The owner's Bitwarden is locked. Ask them to unlock it in botdot, then try again." });
          let entry;
          try { entry = bitwarden.listedItem(body.entry); } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
          if (asks.removeDeclined(session.botId, entry.id)) return send(res, 200, { ok: false, error: "The owner said no to this recently. Don't ask again; leave the entry as it is." });
          asks.add({ kind: 'vault-remove', botId: session.botId, itemId: entry.id, loginName: entry.name, site: entry.site, reason: body.reason }, { runId: session.runId });
          return send(res, 200, { ok: true, name: entry.name });
        }
        if (parts[2] === 'http' && m === 'POST') {
          const body = await readBody(req);
          let creds;
          await readyForSecrets(session.botId);
          try { creds = store().credentials(session.botId, body.login); } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
          let result;
          try { result = await vaultHttp.apiRequest(creds, body); } catch (e) { result = { ok: false, text: e.message }; }
          // A certificate the login does not accept: the bot asks for the switch on a card, the owner does not go to the Vault.
          if (!result.ok && result.text === vaultHttp.CERT_UNTRUSTED && !creds.insecureTls) {
            result.text = `The server's certificate isn't trusted. If it is the owner's own server with a self-signed certificate, ask the owner to accept it for the "${creds.name}" login with ask_vault_switch (switch "insecureTls"), then try again once they allow it. Don't tell them to change it in the Vault themselves.`;
          }
          creds.password = null;
          let where = '';
          try { const u = new URL(String(body.url)); where = `${u.hostname}${u.pathname}`; } catch { /* invalid */ }
          console.log(`[vault] ${session.botId} ${String(body.method || 'GET').toUpperCase()} ${where} with "${creds.name}": ${result.ok ? result.status : 'failed'}`);
          return send(res, 200, result.ok ? { ok: true, text: result.text } : { ok: false, error: result.text });
        }
        if (parts[2] === 'type' && m === 'POST') {
          if (!session.container) return send(res, 200, { ok: false, error: "This bot has no computer with a browser. For an API, use api_request instead." });
          const { login, field, submit } = await readBody(req);
          const kind = ['username', 'totp'].includes(field) ? field : 'password';
          await readyForSecrets(session.botId);
          let secret;
          try { secret = await store().reveal(session.botId, login, kind); } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
          if (secret.type === 'github-app' && kind !== 'username') {
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
          if (body.action === 'decline') return send(res, 200, loginRequests.settle(rid, 'declined'));
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
      if (parts[1] === 'ssh-keys' && !parts[2] && m === 'POST') {
        const body = await readBody(req);
        try {
          if (!bitwarden.configured()) return send(res, 400, { error: 'SSH keys are kept in Bitwarden. Connect it on the Vault page first.' });
          if (!bitwarden.unlocked()) return send(res, 423, { error: 'Bitwarden is locked. Unlock it, then add the SSH key.' });
          const e = await bitwarden.addSshKey({ name: body.name, privateKey: body.privateKey, generate: body.generate === true, allowedBots: body.allowedBots });
          return send(res, 201, e);
        } finally { body.privateKey = null; }
      }

      // Owner side (the apps). Passwords are write-only.
      const id = parts[1];
      if (!id && m === 'GET') return send(res, 200, store().list());
      if (!id && m === 'POST') return send(res, 201, await store().add(await readBody(req)));
      if (id && m === 'PUT') { const e = await store().update(id, await readBody(req)); return e ? send(res, 200, e) : send(res, 404, { error: 'Login not found' }); }
      if (id && m === 'DELETE') return send(res, 200, { ok: await store().remove(id) });
    }
    return NEXT;
  };
}

module.exports = { create };
