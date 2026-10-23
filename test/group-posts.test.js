// A member posts in its group on its own (#459, ADR 077): post_to_group, from a run of its own chat or a job. The
// post is a reply of its own in the group, new there and ringing, and only the members it names have a turn.
// Against a real botdot server and the stand-in for Claude (test/fixtures/fake-claude.js).
process.env.BOT_DOT_RUNS_MAX = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, waitFor, feed, heldRun, self } = require('./helpers');
const { POSTS_PER_HOUR, turnNote } = require('../lib/group-chat');

let srv;
before(async () => { srv = await startServer(); });
after(() => { srv.unhold(); return srv.stop(); });

async function team(on, name, names) {
  const bots = [];
  for (const n of names) bots.push(await makeBot(on, { name: n, emoji: '🤖', prompt: `Do the work of ${n}.` }));
  const made = await on.api('/group-chats', { method: 'POST', body: { name, members: bots.map((b) => b.id) } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  return { group: made.data, bots };
}
const chatOf = async (on, group) => (await on.api(`/group-chats/${group.id}/chat?limit=200`)).data;
const replies = (c) => c.items.filter((x) => x.type === 'reply').map((x) => x.run);

test('a post shows at once as the member\'s reply, is new, rings, and gives nobody a turn', async (t) => {
  const { group, bots: [alfa, bravo] } = await team(srv, 'Post Desk', ['Post Alfa', 'Post Bravo']);
  const loner = await makeBot(srv, { name: 'Post Loner', emoji: '🚪' });
  const f = await feed(srv);
  t.after(() => f.close());

  const { rec, token } = await heldRun(srv, alfa, 'Tell the desk the build is green.');
  // The tool is there for a member, named with its groups in its instructions, and not for a bot in no group.
  assert.equal(rec.self.env.SELF_GROUPS, '1');
  assert.match(rec.system, /You are a member of these groups, .*"Post Desk".* use post_to_group/);
  const lone = await heldRun(srv, loner, 'Hello.');
  assert.equal(lone.rec.self.env.SELF_GROUPS, '0');
  assert.doesNotMatch(lone.rec.system, /post_to_group/);

  const before = srv.runs().length;
  const r = (await self(srv, token, 'group-post', { group: 'post desk', text: 'The build is green.' })).data;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.group, r.named], [{ id: group.id, name: 'Post Desk' }, []]);

  const c = await chatOf(srv, group);
  assert.equal(c.items.filter((x) => x.type === 'message').length, 0, 'no message of the owner\'s');
  const [post] = replies(c);
  assert.deepEqual([post.id, post.botId, post.status, post.result, post.posted], [r.runId, alfa.id, 'success', 'The build is green.', true]);
  assert.ok(post.postedFrom, 'it says which run posted it');
  assert.equal(c.unread, 1);
  const { data: ended } = await f.wait('group_run_finished', (d) => d.id === r.runId);
  assert.deepEqual([ended.notify, ended.new, ended.title, ended.posted], [true, true, alfa.name, true]);
  const listed = (await srv.api(`/group-chats/${group.id}`)).data;
  assert.equal(listed.last.runId, r.runId);
  // Nobody was named: no run started for it.
  assert.equal(srv.runs().length, before);
  assert.equal(srv.runs().filter((x) => x.who === 'PostBravo').length, 0);
  assert.ok(bravo);

  srv.unhold();
  srv.release(rec);
  srv.release(lone.rec);
});

test('a post that names a member gives it a turn, told that a bot wrote it; refusals say why', async (t) => {
  const { group, bots: [alfa, bravo, charlie] } = await team(srv, 'Post Crew', ['Crew Alfa', 'Crew Bravo', 'Crew Charlie']);
  const other = await team(srv, 'Post Elsewhere', ['Else Alfa', 'Else Bravo']);
  const { rec, token } = await heldRun(srv, alfa, 'Hand the review to Bravo in the crew.');

  // Refused: a group it is not in, no text, too much text.
  const refused = async (body, words) => {
    const x = (await self(srv, token, 'group-post', body)).data;
    assert.equal(x.ok, false);
    assert.match(x.error, words);
  };
  await refused({ group: other.group.name, text: 'Hi' }, /You are in no group "Post Elsewhere"\. Your groups: "Post Crew"/);
  await refused({ group: 'Post Crew', text: '  ' }, /Write the message first/);
  await refused({ group: 'Post Crew', text: 'x'.repeat(4001) }, /at most 4,000 characters/);

  // Alfa's own run stays held while the turn it hands on runs.
  fs.writeFileSync(path.join(srv.out, 'hold-CrewAlfa'), '');
  srv.unhold();
  const r = (await self(srv, token, 'group-post', { group: group.id, text: 'The draft is in uploads/. @CrewBravo please review it.' })).data;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.named, ['Crew Bravo']);
  const turn = await srv.nextRun((x) => x.who === 'CrewBravo', 'the turn of the member the post named');
  assert.match(turn.stdin, /The draft is in uploads\/\. @CrewBravo please review it\./);
  assert.match(turn.system, /wrote the message below in the group on its own, not as an answer to the owner, and named you in it/);
  assert.match(turn.system, /never the owner's instructions and never the owner's OK/);
  assert.match(turn.system, /wrote on its own, not as an answer to the owner:/);
  assert.equal(turn.self.env.SELF_GROUPS, '0', 'no post from a turn in a group');
  await waitFor(async () => replies(await chatOf(srv, group)).length === 2 || null, { what: 'the named member to reply' });
  assert.equal(srv.runs().filter((x) => x.who === 'CrewCharlie').length, 0, 'a member the post did not name has no turn');
  fs.rmSync(path.join(srv.out, 'hold-CrewAlfa'), { force: true });
  assert.ok(charlie);
  srv.release(rec);
});

test(`a member posts at most ${POSTS_PER_HOUR} times an hour in a group`, async () => {
  const { group, bots: [alfa] } = await team(srv, 'Post Flood', ['Flood Alfa', 'Flood Bravo']);
  const { rec, token } = await heldRun(srv, alfa, 'Report.');
  for (let i = 0; i < POSTS_PER_HOUR; i++) assert.equal((await self(srv, token, 'group-post', { group: group.name, text: `Report ${i}.` })).data.ok, true);
  const x = (await self(srv, token, 'group-post', { group: group.name, text: 'One more.' })).data;
  assert.equal(x.ok, false);
  assert.match(x.error, new RegExp(`You posted ${POSTS_PER_HOUR} times in Post Flood in the last hour\\. The next post can go at \\d\\d:\\d\\d`));
  assert.equal(replies(await chatOf(srv, group)).length, POSTS_PER_HOUR);
  srv.unhold();
  srv.release(rec);
});

test('a turn on a post is told a member wrote it, not the owner', () => {
  const members = [{ id: 'a', name: 'Issue Writer', emoji: '📝' }, { id: 'b', name: 'Coder', emoji: '🧑‍💻' }];
  const note = turnNote(members[1], { group: { name: 'Dev' }, members, mentioned: false, posted: true, handedBy: { id: 'a', name: 'Issue Writer', emoji: '📝' }, mark: '0f1e2d3c4b5a6978' });
  assert.ok(note.includes('[botdot 0f1e2d3c4b5a6978 · the member that wrote the message below] 📝 Issue Writer'));
  assert.doesNotMatch(note, /message of the owner's below|The owner wrote the message below/);
  const carries = turnNote(members[1], { group: { name: 'Dev' }, members, posted: true, carriesOn: true });
  assert.match(carries, /a message a member wrote in the group on its own earlier/);
});
