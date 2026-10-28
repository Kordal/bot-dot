// The owner's Board (/api/dashboard, lib/dashboard.js): its tiles, their values and what waits of them.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const asksLib = require('../asks');
const chief = require('../chief');
const { changeAsk } = require('../tile-change');

function create(ctx) {
  const { audit, thenOfWaiting, thenField, proposalOf, tellChiefOfAnswer, answerWordsOf, proposalAnswered, nameWord } = ctx;
  const dashboard = ctx.board; // the owner's Board (lib/dashboard.js)
  // The tiles whose script waits for the owner, in full, each with what its yes starts when the Chief asked for it.
  // What a yes starts is read from the tile as it is kept: the chat a change was asked for in stays on the server.
  const pendingTiles = () => dashboard.pending().map((t) => ({ ...t, ...thenOfWaiting(dashboard.get(t.id) || t) }));
  // The Board as the apps get it: with what waits, and on a tile a bot suggested in a run what Add starts (`then`).
  function board(d) {
    const then = (s) => { const x = dashboard.suggestion(s.id); return x?.runId ? thenField(proposalOf(x.botId, x.runId, x.at)) : {}; };
    return { ...d, suggestions: d.suggestions.map((s) => ({ ...s, ...then(s) })), pending: pendingTiles() };
  }
  return async function routes(req, res, url, { parts, m, by, chiefChat }) {
    // The Board. The Chief arranges it; only the owner taps tiles and approves scripts.
    if (parts[0] === 'dashboard') {
      const id = parts[2];
      if (!parts[1] && m === 'GET') {
        return send(res, 200, board(dashboard.list({ detail: by === 'chief' }))); // pending in full: the approval shows the scripts
      }
      if (parts[1] === 'refresh' && m === 'POST') {
        await dashboard.refresh(null, { all: (await readBody(req))?.all === true }); // all: the refresh button (#452)
        return send(res, 200, board(dashboard.list()));
      }
      if (parts[1] === 'test' && m === 'POST') { try { return send(res, 200, await dashboard.test(await readBody(req))); } catch (e) { return send(res, 200, { error: e.message }); } }
      if (parts[1] === 'layout' && m === 'PUT') return send(res, 200, dashboard.arrange(await readBody(req)));
      if (parts[1] === 'tiles' && !id && m === 'POST') return send(res, 201, dashboard.add(await readBody(req), { by, chatId: chiefChat }));
      if (parts[1] === 'tiles' && id) {
        if (!parts[3] && m === 'PUT') return send(res, 200, dashboard.update(id, await readBody(req), { by, chatId: chiefChat }));
        if (!parts[3] && m === 'DELETE') return send(res, 200, { ok: dashboard.remove(id, { withTiles: url.searchParams.has('all') }) });
        if (parts[3] === 'value' && m === 'PUT') return send(res, 200, dashboard.setValue(id, (await readBody(req)).value, { by }));
        if (parts[3] === 'tap' && m === 'POST') return send(res, 200, await dashboard.tap(id, await readBody(req)));
        if (parts[3] === 'act' && m === 'POST') return send(res, 200, await dashboard.act(id, await readBody(req))); // a slider, colour, switch… on it
        if (parts[3] === 'image' && parts[4] && m === 'GET') {
          const pic = dashboard.image(id, decodeURIComponent(parts[4]));
          if (!pic) return send(res, 404, { error: 'No cached picture. Refresh the Board first.' });
          res.writeHead(200, { 'Content-Type': pic.type, 'Content-Length': pic.data.length, 'Cache-Control': `private, max-age=${pic.maxAge}`, 'X-Content-Type-Options': 'nosniff' });
          return res.end(pic.data);
        }
        if (parts[3] === 'image' && parts[4] && m === 'POST') {
          await dashboard.refreshImage(id, decodeURIComponent(parts[4]));
          return send(res, 200, { ok: true });
        }
        // The owner asks the Chief to change this tile: a new Chief chat, its message naming the tile (#430).
        if (parts[3] === 'change' && !parts[4] && m === 'POST') {
          if (by !== 'you') return send(res, 403, { error: 'Only the owner asks for a change.' });
          const tile = dashboard.get(id);
          if (!tile) return send(res, 404, { error: 'No such tile' });
          const text = String((await readBody(req)).text || '').trim();
          if (!text) return send(res, 400, { error: 'Say what should change' });
          const chat = chief.createChat();
          try { chief.send(chat.id, changeAsk(tile, text, tile.bot ? B.bots.get(tile.bot)?.name : null)); } catch (e) { chief.deleteChat(chat.id); throw e; } // no empty chat left
          return send(res, 201, { chatId: chat.id });
        }
        if (parts[3] === 'move' && m === 'POST') return send(res, 200, dashboard.move(id, await readBody(req))); // dragged by the owner
        if (parts[3] === 'approve' && m === 'POST') {
          const yes = (await readBody(req)).approve === true;
          const tile = dashboard.get(id);
          const tileBot = tile?.bot ? B.bots.get(tile.bot) : null;
          if (tile && tile.approved !== false) {
            // An approved tile: only the change beside it is answered (ADR 013). The no keeps the tile, also the no
            // of a card that is out of date, and the Chief that asked for the change in a chat is told there.
            const change = dashboard.answerChange(id, yes);
            if (change) audit(yes ? 'tile.approved' : 'tile.declined', by);
            const carriesOn = change?.chatId ? tellChiefOfAnswer({ chatId: change.chatId, at: change.at }, yes, answerWordsOf({ tile: { ...change.tile }, change: true }, tileBot)) : null;
            return send(res, 200, { ok: true, ...(yes ? (change ? { text: asksLib.changedWords(change.tile.title, req.lang) } : {}) : { kept: true, text: asksLib.keptWords(tile.title, req.lang) }), ...(carriesOn ? { carriesOn } : {}) });
          }
          // The Chief asked for it in a chat: it is told there of the answer.
          const asked = tile && !tile.approved && tile.chatId ? [{ chatId: tile.chatId, at: tile.askedAt }, yes, answerWordsOf({ tile: { ...tile } }, tileBot)] : null;
          const ok = dashboard.approve(id, yes);
          if (ok) audit(yes ? 'tile.approved' : 'tile.declined', by);
          const carriesOn = ok && asked ? tellChiefOfAnswer(...asked) : null;
          return send(res, 200, { ok, ...(ok && !yes ? { text: asksLib.declinedNew(req.lang) } : {}), ...(carriesOn ? { carriesOn } : {}) });
        }
      }
      // A bot's suggestion: Add or ✕ (only the owner; the Chief's key never gets here).
      if (parts[1] === 'suggestions' && id && m === 'POST') {
        if (by !== 'you') return send(res, 403, { error: 'Only the owner answers these.' });
        const add = (await readBody(req)).add === true;
        const x = dashboard.suggestion(id);
        const tile = dashboard.answer(id, add);
        // A bot suggested it in a run: after Add it carries on with that run's request (ADR 009).
        return send(res, 200, { ok: true, tile, ...(x ? proposalAnswered(x.botId, { runId: x.runId, at: x.at }, [`put the tile “${nameWord(x.tile.title)}” on their Board`], add) : {}) });
      }
      return send(res, 404, { error: 'Unknown endpoint' });
    }
    return NEXT;
  };
}

module.exports = { create };
