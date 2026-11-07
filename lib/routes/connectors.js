// Connected apps (lib/connectors.js): the catalog, connecting one, and the side of their actions a bot's run and a
// Chief turn use (ADR 010, ADR 047).
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const chief = require('../chief');
const { APPS } = require('../connected-apps'); // the names of the apps people connect most
const { forBot, appError, explain, sentence } = require('../app-errors');
const { notDone } = require('../replay'); // what a replay's write answers (ADR 102)

// Composio refused a sign-in link: its words in one plain sentence for the owner who pressed Connect or Reconnect
// (#464), on the Connectors page or on a missing app's card (ADR 168). An Error with `code`.
async function connectRefusal(e, slug) {
  const name = B.connectors.SLUG_RE.test(slug) ? B.appName(slug) : 'The app';
  const err = appError(e.message, { app: slug, name, fallback: sentence(e.message) || `Couldn't connect ${name}.` });
  await explain(err, { doing: `connect ${name} to botdot`, ask: (p, o) => require('../dresser').askClaude(p, o), ms: 15_000 });
  return err;
}

function create(ctx) {
  const { connectorApprovals, fromFrontDoor, connectAsks } = ctx;
  return async function routes(req, res, url, { parts, m }) {
    // Connectors (apps through Composio). The bot side is /api/connectors/session/*, with the run token.
    if (parts[0] === 'connectors') {
      const C = B.connectors;
      if (parts[1] === 'session' && m === 'POST') {
        // A bot's run, by its token, or a Chief turn the owner started, by its own (ADR 047). The Chief's key alone
        // opens none of these.
        // A replay of a bot's past task has a key of its own (ADR 102): its reads go, the rest is a dry run.
        const token = req.headers['x-run-token'];
        const run = B.runSession(token) || B.replaySession(token);
        const replay = run?.replay ? run : null;
        const bot = run && B.bots.get(run.botId);
        const turn = run ? null : connectorApprovals.chiefSession(token);
        if (!bot && !turn) return send(res, 403, { ok: false, error: 'This run may not use connectors.' });
        const session = turn || run;
        const body = await readBody(req);
        // One slice of this run's wait for the owner's answer on an ask it made (ADR 010): its own token, its own ask.
        if (parts[2] === 'wait') {
          const answer = await connectorApprovals.wait(session, body.id);
          return answer ? send(res, 200, { ok: true, ...answer }) : send(res, 404, { ok: false, error: 'This run has no such request.' });
        }
        const app = String(body.app || '').toLowerCase();
        try {
          // The Chief has every app that is connected, asked of Composio when it runs an action: one disconnected since
          // the turn started is refused. Finding an action reads what is known. It cannot connect one: the owner signs
          // in, from the Connect card this makes.
          if (turn) {
            // A look reads only the apps its session names (ADR 070).
            if (turn.apps && !turn.apps.includes(app)) return send(res, 200, { ok: false, error: `This look may not read ${C.SLUG_RE.test(app) ? APPS[app]?.name || B.appName(app) : 'that app'}. It reads ${turn.apps.map((a) => B.appName(a)).join(', ')} only.` });
            if (!(parts[2] === 'run' ? await C.connectedApps() : C.knownApps() || []).includes(app)) {
              const name = C.SLUG_RE.test(app) ? APPS[app]?.name || B.appName(app) : 'That app';
              // The owner gets the Connect card in this chat, and the Chief a turn here once it is connected (ADR 168).
              // A look has no chat to put it in; an app Composio doesn't know gets none.
              let r = null;
              if (C.SLUG_RE.test(app) && turn.chatId && !turn.readOnly) try { r = await connectAsks.chiefNeed({ app, chatId: turn.chatId, reason: `Your chat needed ${name}.` }); } catch (err) { console.error(`[connectors] no card for ${app}: ${err.message}`); }
              if (r?.held) return send(res, 200, { ok: false, error: `The user said not now to ${name} today, so nothing was done. Say in one line what you couldn't do without it.`, code: 'needs-connect' });
              if (r?.ask) return send(res, 200, { ok: false, error: `${name} isn't connected, so nothing was done. The user now has a card in this chat to connect it, and you get a new turn here once it is connected: say so in one line and end your reply.`, code: 'needs-connect', card: r.ask.id });
              return send(res, 200, { ok: false, error: `${name} isn't connected, so nothing was done. Call offer_connect_app for it and say in one line that its card waits; you can't connect it yourself.` });
            }
          } else if (!(bot.connectors || []).includes(app)) return send(res, 200, { ok: false, error: `You don't have the ${app} connector. Yours: ${(bot.connectors || []).join(', ') || 'none'}.` });
          if (parts[2] === 'actions') return send(res, 200, { ok: true, actions: await C.tools(app, { search: body.search, tool: body.action }) });
          if (parts[2] === 'run') {
            // A file is one in the bot's workspace or of its run; for the Chief, only one the owner attached in that chat.
            // A look has no chat and hands an app no file.
            // A replay hands none either.
            const open = turn?.readOnly ? () => { throw new Error('A look hands an app no file.'); } : replay ? () => { throw new Error('A replay hands an app no file.'); }
              : turn ? (p) => chief.attachedFile(turn.chatId, p) : (p) => B.runFile(session.runId, bot.id, p);
            const data = await C.execute(app, String(body.action || ''), body.arguments || {}, open, (tool) => connectorApprovals.authorize(session, app, tool, body.arguments || {}));
            // What the call did shows as a row under the reply: a bot's in its run; the Chief's from its turn (chief.js).
            if (!turn && !replay) B.noteLearned(session.runId, { kind: 'connector', text: `Used ${app}: ${String(body.action).toLowerCase().replace(/_/g, ' ')}` });
            let out = JSON.stringify(data);
            if (out.length > 40000) out = `${out.slice(0, 40000)}… [cut off; ask for less, e.g. fewer results]`;
            return send(res, 200, { ok: true, result: out });
          }
        } catch (e) {
          // A replay's write: not done, and it says what it would have sent (ADR 102).
          if (e.dryRun) return send(res, 200, { ok: true, result: notDone({ app, action: String(body.action || ''), arguments: body.arguments || {} }) });
          // A write without a grant: its card is made, and the run waits for the answer on it (the wait above).
          if (e.requestId) return send(res, 200, { ok: false, needsApproval: true, waits: true, requestId: e.requestId, error: e.message });
          // A bot's run found the app not connected, signed out or without a permission it needs: the owner gets one
          // card to connect it, and the run carries on once it is (ADR 168). Not a replay's (ADR 102), nor a run a shared
          // room started, whose every step is on a card already (ADR 067). An older app draws only the Reconnect card
          // under a job's reply (#431), which a job's run still gets, once a day.
          if (e.notConnected && !turn && !replay && !B.readMeta(session.runId)?.room) {
            const old = B.noteReconnect(session.runId, e.notConnected);
            const mode = e.listed || C.reconnect().includes(e.notConnected) ? 'reconnect' : 'connect';
            let r = null;
            try { r = connectAsks.offer({ botId: bot.id, app: e.notConnected, runId: session.runId, mode, reason: `Its run needed ${B.appName(e.notConnected)}: ${String(body.action || '').toLowerCase().replace(/_/g, ' ')}.` }); } catch (err) { console.error(`[connectors] no card for ${e.notConnected}: ${err.message}`); }
            const name = r?.name || r?.ask?.name || B.appName(e.notConnected);
            if (r?.held) return send(res, 200, { ok: false, error: `The owner said not now to ${name} today. Say in one line what you couldn't do without it.`, code: 'needs-connect' });
            if (r?.ask) return send(res, 200, { ok: false, error: `${name} isn't connected, so nothing was done. The owner now has a card to ${r.ask.mode === 'reconnect' ? 'reconnect' : 'connect'} it; botdot starts you again on this work once it is connected. Say so in one line, stop the work that needs it and don't try it another way.`, code: 'needs-connect', card: r.ask.id });
            if (old) return send(res, 200, { ok: false, error: `${name} is signed out, so nothing was done. The owner now has a Reconnect card for it under your reply: say in one line that ${name} needs reconnecting, and don't try it again in this run.` });
          }
          // An app's own failure: in plain words, what helps, and the app's words (app-errors.js).
          if (e.appError) return send(res, 200, { ok: false, error: forBot(e), code: e.code, action: e.action });
          return send(res, 200, { ok: false, error: e.message });
        }
        return send(res, 404, { ok: false, error: 'Unknown endpoint' });
      }
      const usedBy = (slug) => B.bots.list().filter((b) => (b.connectors || []).includes(slug)).map((b) => b.id);
      if (!parts[1] && m === 'GET') {
        // No key yet: the apps draw the one field that takes the owner's own (botdot makes no Composio account).
        if (!C.status().configured) return send(res, 200, { ...C.status(), error: C.installKeyError() ? `The key botdot was given was refused: ${C.installKeyError()}` : null, connections: [], reconnect: [] });
        let list = [];
        let error = null;
        try { list = await C.connections(); } catch (e) { error = e.message; }
        if (C.status().keyRejected) return send(res, 200, { ...C.status(), error, connections: [] });
        const again = C.reconnect().filter((s) => !list.some((c) => c.toolkit === s));
        const apps = await Promise.all([...new Set([...list.map((c) => c.toolkit), ...again])].map((s) => C.toolkit(s).catch(() => ({ slug: s, name: s }))));
        const app = (slug) => apps.find((a) => a.slug === slug);
        return send(res, 200, {
          ...C.status(),
          error,
          connections: list.map((c) => ({ ...c, app: app(c.toolkit), usedBy: usedBy(c.toolkit) })),
          // Connected before a switch to another Composio account (#409): offered with "Connect again".
          reconnect: again.map((s) => ({ slug: s, name: app(s)?.name || s, logo: app(s)?.logo || null, usedBy: usedBy(s) })),
        });
      }
      // The Composio key the admin gave the installer (ADR 160), from the front door only, for the admin's own account:
      // taken while the account has none, never over a key the owner pasted. 502 when Composio gave no answer: the
      // front door tries again.
      if (parts[1] === 'install-key' && m === 'POST') {
        if (!fromFrontDoor(req) || req.headers['x-botdot-room'] !== '1') return send(res, 403, { error: "Only the front door hands the installer's Composio key." });
        if (C.configured()) return send(res, 200, { ...C.status(), kept: true });
        const key = String((await readBody(req, 4e3))?.key || '').trim();
        if (!key) return send(res, 400, { error: 'No Composio key.' });
        try {
          const status = await C.setKey(key);
          await C.connections().catch(() => {});
          return send(res, 200, status);
        } catch (e) {
          const down = ['TypeError', 'TimeoutError', 'AbortError'].includes(e.name) || (e.composio && e.status >= 500);
          if (!down) C.refuseInstallKey(e.message);
          return send(res, down ? 502 : 400, { error: e.message });
        }
      }
      if (parts[1] === 'key' && m === 'PUT') {
        const status = await C.setKey((await readBody(req)).key);
        await C.connections().catch(() => {}); // the apps a Chief turn is given, known from now (ADR 047)
        return send(res, 200, status);
      }
      if (parts[1] === 'key' && m === 'DELETE') { C.removeKey(); return send(res, 200, C.status()); }
      // Not connecting an app again after a switch: it leaves the list, and the bots lose it.
      if (parts[1] === 'reconnect' && parts[2] && m === 'DELETE') {
        const slug = String(parts[2]).toLowerCase();
        C.forgetReconnect(slug);
        for (const b of B.bots.list()) if ((b.connectors || []).includes(slug)) B.bots.update(b.id, { connectors: b.connectors.filter((x) => x !== slug) });
        return send(res, 200, { ok: true });
      }
      // botdot no longer makes or claims Composio accounts: an older app's "New Composio account" and Claim say so.
      if ((parts[1] === 'renew' || parts[1] === 'claim') && m === 'POST') return send(res, 400, { error: 'botdot no longer makes Composio accounts. Paste your own Composio API key on the Connectors page.' });
      // Without a working key nothing else of Connectors is offered: the apps draw only the key field.
      if (['catalog', 'categories', 'connect'].includes(parts[1])) {
        if (!C.status().configured) return send(res, 409, { error: 'Connectors need a Composio key. Add yours on this page.' });
        if (C.status().keyRejected) return send(res, 409, { error: C.rejectedError().message });
      }
      if (parts[1] === 'catalog' && m === 'GET') return send(res, 200, await C.catalog({ search: url.searchParams.get('search'), category: url.searchParams.get('category'), offset: url.searchParams.get('offset') }));
      if (parts[1] === 'categories' && m === 'GET') return send(res, 200, await C.categories());
      if (parts[1] === 'connect' && m === 'POST') {
        const slug = String((await readBody(req)).app || '').toLowerCase();
        const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
        try {
          return send(res, 200, await C.connect(slug, `${proto}://${req.headers.host}/connectors/done`));
        } catch (e) {
          if (!e.composio) throw e;
          const err = await connectRefusal(e, slug);
          return send(res, 502, { error: err.message, code: err.code });
        }
      }
      if (parts[1] === 'connections' && parts[2]) {
        if (m === 'GET') return send(res, 200, await C.connection(parts[2]));
        if (m === 'DELETE') {
          let r;
          try { r = await C.disconnect(parts[2]); } catch (e) { return send(res, 403, { error: e.message }); }
          // Bots lose the app unless another connection of it is still there.
          if (r.toolkit && !r.left) for (const b of B.bots.list()) if ((b.connectors || []).includes(r.toolkit)) B.bots.update(b.id, { connectors: b.connectors.filter((x) => x !== r.toolkit) });
          return send(res, 200, { ok: true, note: r.note });
        }
      }
      // Which bots may use an app.
      if (parts[1] === 'apps' && parts[2] && parts[3] === 'bots' && m === 'PUT') {
        const slug = String(parts[2]).toLowerCase();
        if (!C.SLUG_RE.test(slug)) return send(res, 400, { error: 'Unknown app' });
        const want = (await readBody(req)).bots || [];
        for (const b of B.bots.list()) {
          const has = (b.connectors || []).includes(slug);
          if (want.includes(b.id) && !has) { B.bots.update(b.id, { connectors: [...(b.connectors || []), slug] }); }
          if (!want.includes(b.id) && has) { B.bots.update(b.id, { connectors: b.connectors.filter((x) => x !== slug) }); }
        }
        return send(res, 200, { ok: true, usedBy: usedBy(slug) });
      }
      return send(res, 404, { error: 'Unknown endpoint' });
    }
    return NEXT;
  };
}

module.exports = { create, connectRefusal };
