// The owner's remote MCP servers (lib/custom-servers.js, ADR 265): adding, listing, changing the key of and removing
// one, and which bots have it (the owner's side, /api/connectors/servers), and what a bot's run, a Chief turn or a replay
// does with one (the session side, /api/connectors/session/custom-*, by the run's token, as the connected apps' is).
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const { notDone } = require('../replay'); // what a replay's write answers (ADR 102)
const { isCustomApp } = require('../custom-app');

const MAX_ANSWER = 40000;
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// The status a refusal is sent with: the owner's own mistake (the address, the key), or a server that did not do it.
const STATUS = { 'bad-address': 400, 'bad-key': 400, auth: 400, exists: 409, 'too-many': 409, unknown: 404 };

function create(ctx) {
  const { connectorApprovals, asks } = ctx;
  const S = B.customServers;
  const botIds = () => B.bots.list().map((b) => b.id);
  const shown = (s) => ({ ...s, usedBy: S.botsOf(s.id, botIds()) });

  return async function routes(req, res, url, { parts, m }) {
    if (parts[0] !== 'connectors') return NEXT;

    // ---------- the owner's side ----------
    if (parts[1] === 'servers') {
      if (!parts[2] && m === 'GET') return send(res, 200, { servers: S.list().map(shown) });
      if (!parts[2] && m === 'POST') {
        const body = await readBody(req, 16e3);
        try {
          const s = await S.add({ name: body.name, url: body.url, key: body.key, header: body.header });
          // The card the Chief made for it, with the name and address, is answered by the server being there.
          asks.drop((a) => a.kind === 'connect-app' && a.mode === 'server' && S.sameAddress(a.serverUrl || '', s.url));
          return send(res, 201, shown(s));
        } catch (e) { return send(res, STATUS[e.code] || 502, { error: e.message, code: e.code || 'unreachable' }); }
      }
      const id = String(parts[2] || '').toLowerCase();
      if (parts[2] && !parts[3] && m === 'PUT') {
        const body = await readBody(req, 16e3);
        try { return send(res, 200, shown(await S.setKey(id, { key: body.key, header: body.header }))); } catch (e) { return send(res, STATUS[e.code] || 502, { error: e.message, code: e.code || 'unreachable' }); }
      }
      if (parts[2] && !parts[3] && m === 'DELETE') {
        if (!S.remove(id)) return send(res, 404, { error: 'There is no such server.' });
        connectorApprovals.forgetApp(id); // its lasting grants go with it
        return send(res, 200, { ok: true });
      }
      // Which bots have it (ADR 231): the bots listed have it, any other is taken from.
      if (parts[2] && parts[3] === 'bots' && m === 'PUT') {
        const body = await readBody(req, 16e3);
        const has = S.setBots(id, Array.isArray(body.bots) ? body.bots.filter((x) => typeof x === 'string') : [], botIds());
        return has ? send(res, 200, { ok: true, usedBy: has }) : send(res, 404, { error: 'There is no such server.' });
      }
      return send(res, 404, { error: 'Unknown endpoint' });
    }

    // ---------- a run's side ----------
    if (parts[1] === 'session' && m === 'POST' && (parts[2] === 'custom-tools' || parts[2] === 'custom-run')) {
      // A bot's run, a replay of one (ADR 102) or a Chief turn the owner started (ADR 047), each by its own token. A look
      // (ADR 070) is a Chief session too and has no remote server.
      const token = req.headers['x-run-token'];
      const run = B.runSession(token) || B.replaySession(token);
      const replay = run?.replay ? run : null;
      const bot = run && B.bots.get(run.botId);
      const turn = run ? null : connectorApprovals.chiefSession(token);
      if (!bot && !turn) return send(res, 403, { ok: false, error: 'This run may not use remote servers.' });
      if (turn?.readOnly) return send(res, 200, { ok: false, error: 'A look has no remote servers.' });
      const session = turn || run;
      const body = await readBody(req, 4e6);
      const s = S.find(body.server);
      const mine = () => S.forBot(bot.id).map((x) => x.name).join(', ') || 'none';
      if (!s || (!turn && !S.mayUse(bot.id, s.id))) return send(res, 200, { ok: false, error: `You don't have ${s ? `the server ${s.name}` : 'that server'}. ${turn ? `Yours: ${S.list().map((x) => x.name).join(', ') || 'none'}.` : `Yours: ${mine()}.`}` });
      try {
        if (parts[2] === 'custom-tools') return send(res, 200, { ok: true, tools: await S.tools(s.id, { search: body.search, tool: body.tool ? String(body.tool) : undefined }) });
        const name = String(body.tool || '');
        const args = plain(body.arguments) ? body.arguments : {};
        if (body.arguments !== undefined && !plain(body.arguments)) return send(res, 200, { ok: false, error: '"arguments" is an object, named by the tool\'s input schema.' });
        // A tool that only reads goes at once; any other waits for the owner's card (authorize), and a replay's is not done.
        const tool = await S.toolFor(s.id, name);
        connectorApprovals.authorize(session, s.id, tool, args, {});
        const text = await S.run(s.id, tool.slug, args);
        if (!turn && !replay) B.noteLearned(session.runId, { kind: 'connector', text: `Used ${s.name}: ${tool.slug.replace(/[_-]+/g, ' ')}` });
        return send(res, 200, { ok: true, result: text.length > MAX_ANSWER ? `${text.slice(0, MAX_ANSWER)}… [cut off; ask for less]` : text });
      } catch (e) {
        if (e.dryRun) return send(res, 200, { ok: true, result: notDone({ app: s.name, action: String(body.tool || ''), arguments: plain(body.arguments) ? body.arguments : {} }) });
        if (e.requestId) return send(res, 200, { ok: false, needsApproval: true, waits: true, requestId: e.requestId, error: e.message });
        return send(res, 200, { ok: false, error: e.message });
      }
    }
    return NEXT;
  };
}

module.exports = { create, isCustomApp };
