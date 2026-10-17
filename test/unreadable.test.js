// A Claude Code whose output botdot can't read (no "result" line, e.g. after an update changed its format):
// a bot's run and a Chief reply fail plainly, naming the version, instead of passing as an empty reply.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, waitFor } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());
const noResult = (on) => (on ? fs.writeFileSync(path.join(srv.out, 'no-result'), '') : fs.rmSync(path.join(srv.out, 'no-result'), { force: true }));
const MESSAGE = /^Claude Code \(2\.1\.280\) finished without a reply botdot could read\. A Claude Code update may have changed how it answers/;

test("a bot's run without a result line is an error that says why, not an empty reply", async () => {
  const bot = await makeBot(srv);
  noResult(true);
  try {
    const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Hi' } });
    const done = await srv.finished(r.data.id);
    assert.equal(done.status, 'error');
    assert.match(done.error, MESSAGE);
    assert.match((await srv.api(`/runs/${r.data.id}`)).data.problem, MESSAGE, 'the apps show it as it is');
    assert.ok(!done.quiet);
  } finally { noResult(false); }
  // Once Claude Code answers normally again, so does the bot.
  const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Hi again' } });
  assert.equal((await srv.finished(r.data.id)).status, 'success');
});

test('a Chief reply without a result line says why', async () => {
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  noResult(true);
  try {
    await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Hello' } });
    const reply = await waitFor(async () => {
      const c = (await srv.api(`/chief/chats/${chat.id}`)).data;
      const last = c.messages.at(-1);
      return !c.busy && last.role === 'chief' ? last : null;
    }, { what: "the Chief's reply" });
    assert.match(reply.error, MESSAGE);
  } finally { noResult(false); }
});
