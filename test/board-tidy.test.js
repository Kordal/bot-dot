// Tidy up (board-tidy): the board's button asks the project's Chief, in its own chat, to arrange the whole board. The
// board as the owner saw it is kept first (a never-arranged one from what the app measured), the Chief lays out every
// tile at once, and back puts the board as it stood (twice: it again).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startServer, writeData, waitFor } = require('./helpers');

let srv;
before(async () => {
  srv = await startServer({ env: { BOT_DOT_COMPANY_EVERY_MS: '300', BOT_DOT_LEAD_DELAY_MS: 'off' } });
  writeData(path.join(srv.data, 'company.json'), { id: 'p1', name: 'Botdot', start: 'botdot.app', kind: 'site', phase: 'running', startedAt: '2026-10-01T00:00:00.000Z', objectives: [{ id: 'o1', name: 'Reach 100 users', target: 100, current: 7 }] });
});
after(async () => { await srv.stop(); });

const at = (p) => `${p}?project=p1`;
const company = async () => (await srv.api(at('/company'))).data.company;
const SEEN = { days: [0, 0, 1200, 140], 'goal:o1': [0, 156, 592, 260], todo: [608, 156, 392, 560] };

test('the server says it tidies the board', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('board-tidy'));
});

test('only the owner tidies up', async () => {
  assert.equal((await srv.asChief(at('/company/layout/tidy'), { method: 'POST', body: {} })).status, 403);
});

test('Tidy up keeps the board as measured and asks the project\'s Chief in its chat', async () => {
  const r = await srv.api(at('/company/layout/tidy'), { method: 'POST', body: { layout: SEEN } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.company.chiefChat, r.data.chatId);
  assert.deepEqual(r.data.company.layout, SEEN);
  assert.equal('layoutBack' in r.data.company, false);
  const chat = await waitFor(async () => {
    const c = (await srv.api(`/chief/chats/${r.data.chatId}`)).data;
    return c.messages?.some((m) => m.role === 'user' && m.text === 'Tidy up the board.') && c;
  });
  assert.ok(chat);
});

test('the Chief lays out the whole board; back puts it as it was, and back again redoes it', async () => {
  const tidy = { days: [0, 0, 1200, 140], 'goal:o1': [0, 156, 590, 260], todo: [606, 156, 590, 280] };
  let r = await srv.asChief(at('/company/layout'), { method: 'PUT', body: { layout: tidy } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual((await company()).layout, tidy);
  r = await srv.asChief(at('/company/layout'), { method: 'PUT', body: { back: true } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual((await company()).layout, SEEN);
  await srv.asChief(at('/company/layout'), { method: 'PUT', body: { back: true } });
  assert.deepEqual((await company()).layout, tidy);
});

test('a tidy of a board already arranged keeps that one, not the app\'s', async () => {
  const was = (await company()).layout;
  const r = await srv.api(at('/company/layout/tidy'), { method: 'POST', body: { layout: SEEN } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.company.layout, was);
});

test('a never-tidied project has nothing to put back', async () => {
  writeData(path.join(srv.data, 'company.json'), { id: 'p1', name: 'Botdot', start: 'botdot.app', kind: 'site', phase: 'running', startedAt: '2026-10-01T00:00:00.000Z' });
  assert.equal((await srv.asChief(at('/company/layout'), { method: 'PUT', body: { back: true } })).status, 400);
});
