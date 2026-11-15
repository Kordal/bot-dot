// A bot sets a watch in its run (watch, lib/self-mcp.js); botdot reads it without a model, and its end starts the bot
// with what it planned (trigger "watch", ADR 248). The owner sees it in the bot's chat and stops it there. The
// Chief's ends as a check that starts a look (ADR 175, P3). GitHub here is a stand-in on this machine.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { startServer, makeBot, heldRun, self, feed, waitFor } = require('./helpers');

function fakeGithub() {
  const state = { merged: false };
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (/^\/repos\/acme\/shop\/pulls\/7$/.test(req.url)) return res.end(JSON.stringify({ title: 'New checkout', state: state.merged ? 'closed' : 'open', merged: state.merged, head: { sha: 'abc1234' } }));
    res.statusCode = 404;
    res.end('{"message":"Not Found"}');
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ state, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

test("a bot's watch wakes it once, with what it planned; the owner lists and stops it in its chat", { timeout: 90_000 }, async () => {
  const gh = await fakeGithub();
  const srv = await startServer({ env: { BOT_DOT_WATCH_LOCAL: '1', BOT_DOT_WATCH_TICK_MS: '200', BOT_DOT_WATCH_MINUTE_MS: '300', BOT_DOT_GITHUB_API_URL: gh.url } });
  const events = await feed(srv);
  try {
    const bot = await makeBot(srv, { name: 'Coder', emoji: '🧑‍💻' });
    const { rec, run } = await heldRun(srv, bot, 'Deploy the checkout once it is merged');

    const set = await self(srv, rec.self.env.RUN_TOKEN, 'watches', { action: 'add', name: 'Checkout merged', repo: 'acme/shop', number: 7, then: 'Deploy the shop to staging', every: 1 });
    assert.equal(set.status, 201, JSON.stringify(set.data));
    assert.match(set.data.watch.state, /acme\/shop#7 "New checkout": open/);
    await events.wait('watches', (d) => d.botId === bot.id);

    const missing = await self(srv, rec.self.env.RUN_TOKEN, 'watches', { action: 'add', repo: 'acme/shop', number: 8, then: 'x' });
    assert.equal(missing.data.ok, false);
    assert.match(missing.data.error, /can't be read/);

    // The owner's view: no login, no baseline; a second one, stopped from the chat, wakes nobody.
    const listed = (await srv.api(`/bots/${bot.id}/watches`)).data;
    assert.deepEqual(listed.map((w) => w.name), ['Checkout merged']);
    assert.equal(listed[0].seen, undefined);
    const other = (await self(srv, rec.self.env.RUN_TOKEN, 'watches', { action: 'add', name: 'Shop page', url: `${gh.url}/repos/acme/shop/pulls/7`, path: 'title', is: 'Never', then: 'x' })).data;
    assert.ok(other.watch, JSON.stringify(other));
    assert.equal((await srv.api(`/bots/${bot.id}/watches/${other.watch.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await srv.api(`/bots/${bot.id}/watches/${other.watch.id}`, { method: 'DELETE' })).status, 404);
    srv.release(rec);
    await srv.finished(run.id);

    srv.hold();
    gh.state.merged = true;
    const woken = await srv.nextRun((x) => x.stdin.includes('your watch "Checkout merged"'), "Coder's run for its watch");
    assert.match(woken.stdin, /<then>\nDeploy the shop to staging\n<\/then>/);
    assert.match(woken.system, /a watch you set has ended/);
    srv.release(woken);
    const runs = await waitFor(async () => { const r = (await srv.api(`/runs?botId=${bot.id}`)).data; return r.find((x) => x.trigger === 'watch' && x.status !== 'running') && r; }, { timeout: 20_000, what: 'the watch run' });
    assert.equal(runs.find((x) => x.trigger === 'watch').watchName, 'Checkout merged');
    assert.deepEqual((await srv.api(`/bots/${bot.id}/watches`)).data, [], 'gone once it ended');
  } finally {
    await srv.stop();
    gh.close();
  }
});

test("the Chief's watch ends as a check that starts a look", { timeout: 60_000 }, async () => {
  const gh = await fakeGithub();
  const srv = await startServer({ env: { BOT_DOT_WATCH_LOCAL: '1', BOT_DOT_WATCH_TICK_MS: '200', BOT_DOT_WATCH_MINUTE_MS: '300', BOT_DOT_GITHUB_API_URL: gh.url } });
  try {
    const set = await srv.api('/chief/watches', { method: 'POST', body: { name: 'Checkout merged', repo: 'acme/shop#7', then: 'Tell the user', every: 1 } });
    assert.equal(set.status, 201, JSON.stringify(set.data));
    assert.equal((await srv.api('/chief/watches', { method: 'POST', body: { repo: 'acme/shop#7', login: 'GitHub', then: 'x' } })).status, 400);
    assert.equal((await srv.api('/chief/watches')).data.length, 1);
    gh.state.merged = true;
    // Its time is now: the check waits for a look in reminders.json (ADR 175, P3).
    await waitFor(async () => (await srv.api('/chief/watches')).data.length === 0, { timeout: 20_000, what: 'the watch to end' });
    const checks = (await srv.api('/chief/reminders')).data;
    assert.ok(checks.some((r) => /Your watch "Checkout merged"/.test(r.text) && /You planned: Tell the user/.test(r.text)), JSON.stringify(checks));
  } finally {
    await srv.stop();
    gh.close();
  }
});
