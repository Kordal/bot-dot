// The Chief of Staff's name (#41): asked once in the first-run setup, kept by the server, shown by the apps from
// `GET /api/chief`, announced with the feed's `chief_name`, told to the Chief itself, and changed later by asking
// the Chief (AGENTS.md rule 5: no control in Settings). A real botdot server with the stand-in Claude.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, feed, waitFor } = require('./helpers');

let srv, f;
before(async () => {
  srv = await startServer();
  await makeBot(srv, { name: 'News Watcher' });
  f = feed(srv);
  await f.wait('hello');
});
after(async () => { f.close(); await srv.stop(); });

const chiefName = async () => (await srv.api('/chief')).data.chief.name;
const chiefRuns = () => srv.runs().filter((x) => x.args.includes('🧭 Chief of Staff'));
const replyDone = (id) => waitFor(async () => { const c = (await srv.api(`/chief/chats/${id}`)).data; return !c.busy && !c.messages.at(-1).pending ? c : null; }, { what: 'the Chief to reply' });

test('a new server is called Chief of Staff and has not asked for a name yet', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('chief-name'));
  assert.equal(await chiefName(), 'Chief of Staff');
  const s = (await srv.api('/setup')).data;
  assert.equal(s.chiefName, 'Chief of Staff');
  assert.equal(s.chiefNameAsked, false);
});

test('skipping the question in setup keeps Chief of Staff, and the question counts as asked', async () => {
  const r = await srv.api('/setup', { method: 'PUT', body: { chiefName: '' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.chiefName, 'Chief of Staff');
  assert.equal(r.data.chiefNameAsked, true);
  assert.equal(await chiefName(), 'Chief of Staff');
});

test('the name given in setup is the name every app shows, announced on the feed', async () => {
  const r = await srv.api('/setup', { method: 'PUT', body: { chiefName: '  Ada \n Lovelace  ', done: true } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.chiefName, r.data.chiefNameAsked, r.data.done], ['Ada Lovelace', true, true], 'spaces made plain');
  assert.equal(await chiefName(), 'Ada Lovelace');
  assert.equal((await srv.api('/setup')).data.chiefName, 'Ada Lovelace');
  assert.equal((await f.wait('chief_name', (d) => d.name === 'Ada Lovelace')).data.name, 'Ada Lovelace');
  const again = feed(srv);
  try { assert.equal((await again.wait('hello')).data.chiefName, 'Ada Lovelace', "the feed's hello says where it stands"); } finally { again.close(); }
});

test("a name that is a bot's, or too long, is refused and the name stays", async () => {
  for (const name of ['news watcher', 'x'.repeat(41)]) {
    const r = await srv.api('/setup', { method: 'PUT', body: { chiefName: name } });
    assert.equal(r.status, 400, name);
    assert.ok(r.data.error);
  }
  assert.match((await srv.api('/setup', { method: 'PUT', body: { chiefName: 'News Watcher' } })).data.error, /News Watcher/);
  assert.equal(await chiefName(), 'Ada Lovelace');
});

test('the Chief is told its name, and a resumed chat is told when it changes', async () => {
  const c = (await srv.api('/chief/chats', { method: 'POST' })).data;
  srv.reply('Hi.');
  await srv.api(`/chief/chats/${c.id}/messages`, { method: 'POST', body: { text: 'hello' } });
  await replyDone(c.id);
  assert.match(chiefRuns().at(-1).system, /Your name: the user named you "Ada Lovelace"\. Go by that name/);
  await srv.api('/settings', { method: 'PUT', body: { chiefName: 'Max' } });
  srv.reply('Hi again.');
  await srv.api(`/chief/chats/${c.id}/messages`, { method: 'POST', body: { text: 'and now?' } });
  await replyDone(c.id);
  const run = chiefRuns().at(-1);
  assert.ok(run.args.includes('--resume'));
  assert.match(run.stdin, /Your instructions have changed[\s\S]*the user named you "Max"/);
});

test('the Chief renames itself only in a turn the owner started', async () => {
  const c = (await srv.api('/chief/chats', { method: 'POST' })).data;
  const refused = await srv.asChief('/settings/chief-name', { method: 'PUT', headers: { 'X-Chief-Chat': c.id }, body: { name: 'Sneaky' } });
  assert.equal(refused.status, 403);
  assert.equal(await chiefName(), 'Max');
  srv.hold();
  await srv.api(`/chief/chats/${c.id}/messages`, { method: 'POST', body: { text: 'Call yourself Jarvis from now on' } });
  const run = await srv.nextRun((x) => x.stdin.includes('Jarvis from now on'), "the Chief's turn");
  try {
    const r = await srv.asChief('/settings/chief-name', { method: 'PUT', headers: { 'X-Chief-Chat': c.id }, body: { name: 'Jarvis' } });
    assert.equal(r.status, 200);
    assert.equal(r.data.name, 'Jarvis');
  } finally { srv.unhold(); srv.release(run); await replyDone(c.id); }
  assert.equal(await chiefName(), 'Jarvis');
  await f.wait('chief_name', (d) => d.name === 'Jarvis');
  // An empty name is the old one again.
  srv.hold();
  await srv.api(`/chief/chats/${c.id}/messages`, { method: 'POST', body: { text: 'Go back to your old name' } });
  const back = await srv.nextRun((x) => x.stdin.includes('old name'), "the Chief's turn");
  try {
    assert.equal((await srv.asChief('/settings/chief-name', { method: 'PUT', headers: { 'X-Chief-Chat': c.id }, body: { name: '' } })).data.name, 'Chief of Staff');
  } finally { srv.unhold(); srv.release(back); await replyDone(c.id); }
  assert.equal(await chiefName(), 'Chief of Staff');
});

test('a look and a checkup, where the Chief writes unasked, know its name too', () => {
  for (const lib of ['../lib/look', '../lib/checkup']) {
    const { systemPrompt } = require(lib);
    assert.match(systemPrompt({ name: 'Ada' }), /Your name: the owner named you "Ada"\./, lib);
    assert.doesNotMatch(systemPrompt({ name: '' }), /Your name:/, lib);
  }
  assert.match(require('../lib/checkup').systemPrompt({ name: 'Ada' }), /A proposal for yourself still names "Chief of Staff" as its bot\./);
});

