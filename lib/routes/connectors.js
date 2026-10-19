// Connected apps (lib/connectors.js): the catalog, connecting one, and the bot side of their actions (ADR 010).
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');

function create(ctx) {
  const { connectorApprovals } = ctx;
  return async function routes(req, res, url, { parts, m }) {
    // Connectors (apps through Composio). The bot side is /api/connectors/session/*, with the run token.
    if (parts[0] === 'connectors') {
      const C = B.connectors;
      if (parts[1] === 'session' && m === 'POST') {
        const session = B.runSession(req.headers['x-run-token']);
        const bot = session && B.bots.get(session.botId);
        if (!bot) return send(res, 403, { ok: false, error: 'This run may not use connectors.' });
        const body = await readBody(req);
        // One slice of this run's wait for the owner's answer on an ask it made (ADR 010): its own token, its own ask.
        if (parts[2] === 'wait') {
          const answer = await connectorApprovals.wait(session, body.id);
          return answer ? send(res, 200, { ok: true, ...answer }) : send(res, 404, { ok: false, error: 'This run has no such request.' });
        }
        const app = String(body.app || '').toLowerCase();
        if (!(bot.connectors || []).includes(app)) return send(res, 200, { ok: false, error: `You don't have the ${app} connector. Yours: ${(bot.connectors || []).join(', ') || 'none'}.` });
        try {
          if (parts[2] === 'actions') return send(res, 200, { ok: true, actions: await C.tools(app, { search: body.search, tool: body.action }) });
          if (parts[2] === 'run') {
            const data = await C.execute(app, String(body.action || ''), body.arguments || {}, (p) => B.runFile(session.runId, bot.id, p), (tool) => connectorApprovals.authorize(session, app, tool, body.arguments || {}));
            B.noteLearned(session.runId, { kind: 'connector', text: `Used ${app}: ${String(body.action).toLowerCase().replace(/_/g, ' ')}` });
            let out = JSON.stringify(data);
            if (out.length > 40000) out = `${out.slice(0, 40000)}… [cut off; ask for less, e.g. fewer results]`;
            return send(res, 200, { ok: true, result: out });
          }
        } catch (e) {
          // A write without a grant: its card is made, and the run waits for the answer on it (the wait above).
          if (e.requestId) return send(res, 200, { ok: false, needsApproval: true, waits: true, requestId: e.requestId, error: e.message });
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
        const status = C.status();
        let list = [];
        let error = null;
        try { list = await C.connections(); } catch (e) { error = e.message; }
        const apps = await Promise.all([...new Set(list.map((c) => c.toolkit))].map((s) => C.toolkit(s).catch(() => ({ slug: s, name: s }))));
        return send(res, 200, { ...status, error, connections: list.map((c) => ({ ...c, app: apps.find((a) => a.slug === c.toolkit), usedBy: usedBy(c.toolkit) })) });
      }
      if (parts[1] === 'key' && m === 'PUT') return send(res, 200, await C.setKey((await readBody(req)).key));
      if (parts[1] === 'key' && m === 'DELETE') { C.removeKey(); return send(res, 200, C.status()); }
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
