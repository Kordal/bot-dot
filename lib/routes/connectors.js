// Connected apps (lib/connectors.js): the catalog, connecting one, and the side of their actions a bot's run and a
// Chief turn use (ADR 010, ADR 047).
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const chief = require('../chief');
const { APPS } = require('../connected-apps'); // the names of the apps people connect most

function create(ctx) {
  const { connectorApprovals } = ctx;
  return async function routes(req, res, url, { parts, m }) {
    // Connectors (apps through Composio). The bot side is /api/connectors/session/*, with the run token.
    if (parts[0] === 'connectors') {
      const C = B.connectors;
      if (parts[1] === 'session' && m === 'POST') {
        // A bot's run, by its token, or a Chief turn the owner started, by its own (ADR 047). The Chief's key alone
        // opens none of these.
        const token = req.headers['x-run-token'];
        const run = B.runSession(token);
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
          // in on the Connectors page.
          if (turn) {
            // A look reads only the apps its session names (ADR 070).
            if (turn.apps && !turn.apps.includes(app)) return send(res, 200, { ok: false, error: `This look may not read ${C.SLUG_RE.test(app) ? APPS[app]?.name || B.appName(app) : 'that app'}. It reads ${turn.apps.map((a) => B.appName(a)).join(', ')} only.` });
            if (!(parts[2] === 'run' ? await C.connectedApps() : C.knownApps() || []).includes(app)) {
              const name = C.SLUG_RE.test(app) ? APPS[app]?.name || B.appName(app) : 'That app';
              return send(res, 200, { ok: false, error: `${name} isn't connected, so nothing was done. Tell the user in one line to connect ${name} on the Connectors page; you can't connect it yourself.` });
            }
          } else if (!(bot.connectors || []).includes(app)) return send(res, 200, { ok: false, error: `You don't have the ${app} connector. Yours: ${(bot.connectors || []).join(', ') || 'none'}.` });
          if (parts[2] === 'actions') return send(res, 200, { ok: true, actions: await C.tools(app, { search: body.search, tool: body.action }) });
          if (parts[2] === 'run') {
            // A file is one in the bot's workspace or of its run; for the Chief, only one the owner attached in that chat.
            // A look has no chat and hands an app no file.
            const open = turn?.readOnly ? () => { throw new Error('A look hands an app no file.'); } : turn ? (p) => chief.attachedFile(turn.chatId, p) : (p) => B.runFile(session.runId, bot.id, p);
            const data = await C.execute(app, String(body.action || ''), body.arguments || {}, open, (tool) => connectorApprovals.authorize(session, app, tool, body.arguments || {}));
            // What the call did shows as a row under the reply: a bot's in its run; the Chief's from its turn (chief.js).
            if (!turn) B.noteLearned(session.runId, { kind: 'connector', text: `Used ${app}: ${String(body.action).toLowerCase().replace(/_/g, ' ')}` });
            let out = JSON.stringify(data);
            if (out.length > 40000) out = `${out.slice(0, 40000)}… [cut off; ask for less, e.g. fewer results]`;
            return send(res, 200, { ok: true, result: out });
          }
        } catch (e) {
          // A write without a grant: its card is made, and the run waits for the answer on it (the wait above).
          if (e.requestId) return send(res, 200, { ok: false, needsApproval: true, waits: true, requestId: e.requestId, error: e.message });
          // A job's run (scheduled or called) found the app signed out: the owner gets a Reconnect card in the bot's chat, once a day (#431).
          if (e.notConnected && !turn && B.noteReconnect(session.runId, e.notConnected)) {
            return send(res, 200, { ok: false, error: `${B.appName(e.notConnected)} is signed out, so nothing was done. The owner now has a Reconnect card for it under your reply: say in one line that ${B.appName(e.notConnected)} needs reconnecting, and don't try it again in this run.` });
          }
          return send(res, 200, { ok: false, error: e.message });
        }
        return send(res, 404, { ok: false, error: 'Unknown endpoint' });
      }
      const usedBy = (slug) => B.bots.list().filter((b) => (b.connectors || []).includes(slug)).map((b) => b.id);
      if (!parts[1] && m === 'GET') {
        // The first visit sets up botdot's own Composio account.
        if (!C.status().configured) {
          try { await C.ensureAccount(); } catch (e) { return send(res, 200, { ...C.status(), error: e.message, connections: [] }); }
        }
        let list = [];
        let error = null;
        await C.checkClaim();
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
      // A new botdot Composio account in place of one whose key Composio refuses (#409).
      if (parts[1] === 'renew' && m === 'POST') {
        const status = await C.renew();
        await C.connections().catch(() => {});
        return send(res, 200, status);
      }
      if (parts[1] === 'claim' && m === 'POST') return send(res, 200, await C.claim((await readBody(req)).email));
      if (parts[1] === 'catalog' && m === 'GET') return send(res, 200, await C.catalog({ search: url.searchParams.get('search'), category: url.searchParams.get('category'), offset: url.searchParams.get('offset') }));
      if (parts[1] === 'categories' && m === 'GET') return send(res, 200, await C.categories());
      if (parts[1] === 'connect' && m === 'POST') {
        const { app } = await readBody(req);
        const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
        return send(res, 200, await C.connect(String(app || '').toLowerCase(), `${proto}://${req.headers.host}/connectors/done`));
      }
      if (parts[1] === 'connections' && parts[2]) {
        if (m === 'GET') return send(res, 200, await C.connection(parts[2]));
        if (m === 'DELETE') {
          const c = await C.connection(parts[2]);
          await C.disconnect(parts[2]);
          // Bots lose the app unless another connection of it is still there.
          const left = (await C.connections()).some((x) => x.toolkit === c.toolkit && x.id !== c.id);
          if (!left) for (const b of B.bots.list()) if ((b.connectors || []).includes(c.toolkit)) B.bots.update(b.id, { connectors: b.connectors.filter((x) => x !== c.toolkit) });
          return send(res, 200, { ok: true });
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

module.exports = { create };
