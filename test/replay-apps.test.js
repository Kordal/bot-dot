// A replay has the bot's connected apps and saved logins in a dry run (ADR 102, #594): an app action that only reads
// runs for real, and one that sends, posts, changes or deletes reaches no app, makes no card and answers "dry run: not
// done" with what it would have sent, also with an "Always allow" grant. With a saved login only a GET goes through
// api_request, and nothing else of the Vault is there. Through the real server, the replay's own tools servers
// (lib/connectors-mcp.js, lib/vault-mcp.js), the stand-in for Claude and the stand-in connected app.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('node:http');
const path = require('path');
const { startServer, makeBot, waitFor, fakeConnectedApp } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

const MAIL = { recipient_email: 'anna@example.com', subject: 'Running late', body: 'Hi Anna, 20 minutes late.' };
const isReplay = (x) => /This run is a replay/.test(x.system || '');
const said = (result) => result.content.map((c) => c.text).join('\n');
const flagged = (args, flag) => { const i = args.indexOf(flag) + 1; let j = i; while (j < args.length && !args[j].startsWith('--')) j++; return args.slice(i, j); };

let app, srv, api, hits, mailer;
before(async () => {
  app = await fakeConnectedApp({ connected: ['gmail'] });
  hits = [];
  api = http.createServer((req, res) => { hits.push(req.method); res.end(req.headers.authorization === 'Bearer fixture-secret' ? 'accepted' : 'missing'); });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  srv = await startServer({ env: { ...app.env, BOT_DOT_REPLAYS_PER_HOUR: '60', BOT_DOT_REPLAY_GAP_MS: '0' } });
  await app.connect(srv);
  mailer = await makeBot(srv, { name: 'Mailer', description: 'Answers the mail', connectors: ['gmail'] });
  assert.equal((await srv.api('/vault', { method: 'POST', body: { site: 'bank.com', password: 'fixture-secret', allowedBots: [mailer.id], allowedHosts: ['127.0.0.1'] } })).status, 201);
});
after(async () => { srv.unhold(); await srv.stop(); app.close(); api.close(); });

test('in a replay a read of an app answers, and a write reaches no app and makes no card', async (t) => {
  srv.reply('Told Anna.');
  const asked = await srv.api(`/bots/${mailer.id}/run`, { method: 'POST', body: { prompt: 'Tell Anna I am late' } });
  await srv.finished(asked.data.id);
  await waitFor(async () => ((await srv.api(`/bots/${mailer.id}/outcomes`)).data.outcomes.length ? true : null), { what: 'the run\'s outcome' });
  const runsBefore = (await srv.api(`/runs?botId=${mailer.id}`)).data.length;
  const note = (await srv.api('/memory/notes', { method: 'POST', body: { owner: '_shared', text: 'To tell someone you are late: email them.' } })).data.note.id;

  // Every run but the replays goes on by itself: the review's and the judge's.
  srv.hold();
  const going = setInterval(() => { for (const x of srv.runs()) if (!isReplay(x)) srv.release(x); }, 50);
  t.after(() => clearInterval(going));
  srv.reply(JSON.stringify({ proposals: [{ kind: 'skill', name: 'late-notice', description: 'When the owner is late', instructions: 'Email them.', bots: ['Mailer'], replaces: [note], reason: 'A how-to.' }] }));
  const reviewing = srv.asChief('/memory/review/chief', { method: 'POST' });
  const rec = await srv.nextRun(isReplay, 'the replay');

  // Its tools: its apps and its logins, each in a dry run, by a key of its own.
  assert.deepEqual([rec.connectors.env.CONNECTOR_APPS, rec.connectors.env.CONNECTOR_CALLER], ['gmail', 'replay']);
  assert.equal(rec.vault.env.VAULT_REPLAY, '1');
  assert.equal(rec.connectors.env.RUN_TOKEN, rec.vault.env.VAULT_TOKEN);
  assert.equal(rec.self, null, 'no tools of its own');
  assert.deepEqual(flagged(rec.args, '--allowedTools'), ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'Skill', 'mcp__vault', 'mcp__connectors']);
  assert.match(rec.system, /read in your connected apps \(Gmail\)/);
  assert.ok(!JSON.stringify([rec.args, rec.system, rec.connectors, rec.vault]).includes('fixture-key'), 'no Composio key');

  const apps = rpcClient(t, 'connectors-mcp.js', rec.connectors.env);
  const before = app.executed.length;
  const read = await apps.call('connector_run', { app: 'gmail', action: 'GMAIL_READ', arguments: { max: 5 } });
  assert.ok(!read.isError, said(read));
  assert.match(said(read), /"done":true/, 'a read answers');
  // A write, and one botdot has no description of: not done, with what it would have sent, also with "Always allow".
  fs.writeFileSync(path.join(srv.data, 'connector-actions.json'), JSON.stringify({ [mailer.id]: ['gmail:GMAIL_SEND_EMAIL'] }));
  const write = await apps.call('connector_run', { app: 'gmail', action: 'GMAIL_SEND_EMAIL', arguments: MAIL });
  assert.ok(!write.isError);
  assert.match(said(write), /^dry run: not done\. This is a replay, so nothing was sent and no card was made\. It would have sent: /);
  assert.match(said(write), /"action":"GMAIL_SEND_EMAIL".*"recipient_email":"anna@example\.com"/);
  assert.match(said(await apps.call('connector_run', { app: 'gmail', action: 'GMAIL_MYSTERY', arguments: {} })), /^dry run: not done/);
  assert.match(said(await apps.call('connector_run', { app: 'gmail', action: 'GMAIL_SEND_EMAIL', arguments: { ...MAIL, attachment: { $file: 'notes.txt' } } })), /^dry run: not done/, 'no file is read for a write');
  assert.deepEqual(app.executed.slice(before), [{ action: 'GMAIL_READ', args: { max: 5 } }], 'only the read reached the app');
  assert.deepEqual((await srv.api('/asks')).data.filter((a) => a.kind === 'connector-action'), [], 'no card');

  // Saved logins: the list and a GET; any other method is not sent; nothing else of the Vault.
  const vault = rpcClient(t, 'vault-mcp.js', rec.vault.env);
  assert.deepEqual((await vault.request('tools/list')).tools.map((x) => x.name), ['list_logins', 'api_request']);
  assert.match(await vault.text('list_logins'), /bank\.com/);
  const url = `http://127.0.0.1:${api.address().port}/`;
  assert.match(await vault.text('api_request', { login: 'bank.com', url, headers: { Authorization: 'Bearer {{password}}' } }), /accepted/);
  const post = await vault.text('api_request', { login: 'bank.com', method: 'POST', url, headers: { Authorization: 'Bearer {{password}}' }, body: { amount: 10 } });
  assert.match(post, /^dry run: not done\..*"method":"POST".*"amount":10/);
  assert.ok(!post.includes('fixture-secret'));
  assert.deepEqual(hits, ['GET'], 'only the GET reached the API');
  const ask = await srv.api('/vault/session/request', { method: 'POST', headers: { 'X-Vault-Token': rec.vault.env.VAULT_TOKEN }, body: { site: 'shop.com', reason: 'To buy.' } });
  assert.match(ask.data.error, /^A replay only reads with saved logins/);
  assert.deepEqual((await srv.api('/vault/requests')).data, [], 'no login asked for');

  // Its key opens nothing of a bot's own run.
  assert.equal((await srv.api('/self/session/memory', { method: 'POST', headers: { 'X-Run-Token': rec.connectors.env.RUN_TOKEN }, body: {} })).status, 403);

  srv.unhold();
  for (const x of srv.runs()) srv.release(x);
  assert.equal((await reviewing).status, 200);
  await waitFor(async () => ((await srv.api('/asks')).data.some((a) => a.kind === 'skill') ? true : null), { what: 'the card', timeout: 20_000 });
  const gone = await srv.api('/connectors/session/run', { method: 'POST', headers: { 'X-Run-Token': rec.connectors.env.RUN_TOKEN }, body: { app: 'gmail', action: 'GMAIL_READ', arguments: {} } });
  assert.equal(gone.status, 403, 'the key goes with the replay');
  assert.equal((await srv.api(`/runs?botId=${mailer.id}`)).data.length, runsBefore, 'a replay is no run of the bot');
});
