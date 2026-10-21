// The Chief of Staff: suggestions from bots wait for the owner; answer buttons; no session tools.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, heldRun, self, waitFor, feed } = require('./helpers');

let srv, designer;
before(async () => {
  srv = await startServer();
  designer = await makeBot(srv, { name: 'Bot Designer', emoji: '🧩' });
});
after(() => srv.stop());

const chiefRuns = () => srv.runs().filter((x) => x.args.includes('🧭 Chief of Staff'));
const lastMessage = async (chatId) => (await srv.api(`/chief/chats/${chatId}`)).data.messages.at(-1);
const replyDone = (chatId) => waitFor(async () => { const c = (await srv.api(`/chief/chats/${chatId}`)).data; return !c.busy && !c.messages.at(-1).pending ? c : null; }, { what: 'the Chief to reply' });

test('a bot hands the Chief a suggestion; nothing runs until the owner answers', async () => {
  const { rec, run, token } = await heldRun(srv, designer);
  assert.equal(rec.self.env.SELF_CHIEF, '1');
  const r = await self(srv, token, 'chief', { title: 'Build Mail Steward', text: '**Build 📬 Mail Steward.**\n- One job: watch the inbox' });
  assert.equal(r.data.ok, true);
  srv.release(rec);
  await srv.finished(run.id);
  const chat = (await srv.api(`/chief/chats/${r.data.chatId}`)).data;
  assert.equal(chat.title, 'Build Mail Steward');
  assert.deepEqual([chat.messages[0].role, chat.messages[0].status, chat.messages[0].from.name], ['suggestion', 'pending', 'Bot Designer']);
  assert.equal(chiefRuns().length, 0, 'the Chief did not start by itself');

  // Approve: the Chief gets the bot's text, marked as a bot's, with the owner's answer.
  srv.unhold();
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Approved. Go ahead.' } });
  const c = await replyDone(chat.id);
  const turn = chiefRuns().at(-1);
  assert.match(turn.stdin, /Mail Steward/);
  assert.match(turn.stdin, /not my words/);
  assert.match(turn.stdin, /My answer: Approved\. Go ahead\./);
  assert.equal(c.messages[0].status, 'answered');

  // Later messages in that chat are just the text (after what botdot adds to a resumed turn, chief-instructions.test.js).
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Thanks' } });
  await replyDone(chat.id);
  assert.match(chiefRuns().at(-1).stdin, /<\/from-botdot>\n\nMy message: Thanks$/);
  assert.doesNotMatch(chiefRuns().at(-1).stdin, /Mail Steward/);

  // Parts of the chat, for the phone: its last messages, older ones, and where each part sits.
  const whole = (await srv.api(`/chief/chats/${chat.id}`)).data;
  assert.deepEqual([whole.offset, whole.total], [0, whole.messages.length]);
  const n = whole.total;
  assert.ok(n >= 5);
  const tail = (await srv.api(`/chief/chats/${chat.id}?limit=2`)).data;
  assert.deepEqual([tail.offset, tail.total, tail.messages], [n - 2, n, whole.messages.slice(-2)]);
  const older = (await srv.api(`/chief/chats/${chat.id}?offset=1&limit=2`)).data;
  assert.deepEqual([older.offset, older.messages], [1, whole.messages.slice(1, 3)]);
  const rest = (await srv.api(`/chief/chats/${chat.id}?offset=3`)).data;
  assert.deepEqual([rest.offset, rest.messages], [3, whole.messages.slice(3)]);
});

test("an older app's \"Build it.\" still approves a plan", async () => {
  const { rec, run, token } = await heldRun(srv, designer);
  const r = await self(srv, token, 'chief', { title: 'Old app', text: 'Plan from before the rename' });
  srv.release(rec);
  await srv.finished(run.id);
  srv.unhold();
  await srv.api(`/chief/chats/${r.data.chatId}/messages`, { method: 'POST', body: { text: 'Build it.' } });
  const c = await replyDone(r.data.chatId);
  assert.match(chiefRuns().at(-1).stdin, /My answer: Build it\./);
  assert.equal(c.messages[0].status, 'answered');
});

test('a message about something else leaves the plan waiting; the Chief sees it only as background', async () => {
  const planner = await makeBot(srv, { name: 'Planner' });
  const { rec, run, token } = await heldRun(srv, planner);
  const r = await self(srv, token, 'chief', { title: 'Build Idea Forge', text: 'Please build Idea Forge.' });
  srv.release(rec);
  await srv.finished(run.id);
  srv.unhold();
  await srv.api(`/chief/chats/${r.data.chatId}/messages`, { method: 'POST', body: { text: 'Why is the find-skills skill missing?' } });
  const c = await replyDone(r.data.chatId);
  const turn = chiefRuns().at(-1);
  assert.match(turn.stdin, /Background only/);
  assert.match(turn.stdin, /My message: Why is the find-skills skill missing\?/);
  assert.doesNotMatch(turn.stdin, /My answer:/);
  assert.equal(c.messages[0].status, 'pending', 'the plan still waits for Approve');
  assert.ok((await srv.api('/chief')).data.chats.find((x) => x.id === r.data.chatId).waiting, 'and shows in Needs you');
});

test('the phone hears when a plan is answered, so its notification can go away', async () => {
  const { rec, run, token } = await heldRun(srv, designer);
  const planned = (await self(srv, token, 'chief', { title: 'Tidy', text: 'Plan: tidy up' })).data.chatId;
  const declined = (await self(srv, token, 'chief', { title: 'Nope', text: 'Plan: no' })).data.chatId;
  srv.release(rec);
  await srv.finished(run.id);
  const f = await feed(srv);
  const hello = await f.wait('hello');
  assert.ok(hello.data.plans.includes(planned) && hello.data.plans.includes(declined), 'hello lists the plans still waiting');
  await srv.api(`/chief/chats/${declined}/dismiss`, { method: 'POST' });
  await f.wait('plan_closed', (d) => d.chatId === declined);
  srv.unhold();
  await srv.api(`/chief/chats/${planned}/messages`, { method: 'POST', body: { text: 'Approved. Go ahead.' } });
  await f.wait('plan_closed', (d) => d.chatId === planned);
  await replyDone(planned);
  f.close();
});

test('Decline turns a suggestion down', async () => {
  const { rec, run, token } = await heldRun(srv, designer);
  const r = await self(srv, token, 'chief', { title: 'Two', text: 'Plan two' });
  srv.release(rec);
  await srv.finished(run.id);
  assert.equal((await srv.api(`/chief/chats/${r.data.chatId}/dismiss`, { method: 'POST' })).data.ok, true);
  assert.equal((await srv.api(`/chief/chats/${r.data.chatId}`)).data.messages[0].status, 'dismissed');
});

test('no limit on suggestions: several in one run, many in a day', async () => {
  const { rec, run, token } = await heldRun(srv, designer);
  for (let i = 0; i < 7; i++) assert.equal((await self(srv, token, 'chief', { title: `n${i}`, text: 'x' })).data.ok, true, `suggestion ${i}`);
  srv.release(rec);
  await srv.finished(run.id);
});

test("the Chief's reply: answer buttons split off, no Claude session tools, no costs", async () => {
  srv.unhold();
  srv.reply('Should I build it now?\n\n[[choices: Yes | No]]');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'hi' } });
  const c = await replyDone(chat.id);
  assert.equal(c.messages.at(-1).text, 'Should I build it now?');
  assert.deepEqual(c.messages.at(-1).choices, ['Yes', 'No']);
  const { args, system } = chiefRuns().at(-1); // system: what it was told, read from its private file (ADR 014)
  const disallowed = args.slice(args.indexOf('--disallowedTools') + 1);
  assert.ok(disallowed.includes('ListAgents') && disallowed.includes('SendMessage'));
  assert.match(system, /\[\[choices: Yes \| No\]\]/);
  assert.match(system, /Never tell the user what a run or a reply costs\./);
  assert.doesNotMatch(system, /unless they ask/, 'not on request either (QW-004)');
  srv.reply('Two things.\n\n[[ask: What should it watch?]]\n[[ask: How often?]]');
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'make a bot' } });
  const asked = (await replyDone(chat.id)).messages.at(-1);
  assert.equal(asked.text, 'Two things.');
  assert.deepEqual(asked.questions, ['What should it watch?', 'How often?']);
  assert.match(system, /\[\[ask: /);
  srv.reply('Done.');
  assert.equal((await lastMessage(chat.id)).role, 'chief');
});

test("your rules for the Chief reach it, capped, and can be cleared", async () => {
  srv.unhold();
  let r = await srv.api('/settings', { method: 'PUT', body: { chiefRules: 'Always ask me before creating a bot.' } });
  assert.equal(r.data.settings.chiefRules, 'Always ask me before creating a bot.');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'hello' } });
  await replyDone(chat.id);
  assert.match(chiefRuns().at(-1).system, /<user-rules>\nAlways ask me before creating a bot\.\n<\/user-rules>/);
  r = await srv.api('/settings', { method: 'PUT', body: { chiefRules: 'x'.repeat(5000) } });
  assert.equal(r.data.settings.chiefRules.length, 4000);
  r = await srv.api('/settings', { method: 'PUT', body: { chiefRules: '' } });
  assert.equal(r.data.settings.chiefRules, '');
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'again' } });
  await replyDone(chat.id);
  assert.doesNotMatch(chiefRuns().at(-1).system, /<user-rules>/);
});

test('a bot asks for a permission it lacks; only the owner says yes, and then it has it', async () => {
  const { run, token } = await heldRun(srv, designer);
  assert.equal((await self(srv, token, 'ask', { kind: 'permission', permission: 'web', reason: 'To open the skills.sh page' })).data.ok, true);
  const asked = (await srv.api('/asks')).data;
  assert.deepEqual(asked.map((a) => [a.kind, a.permission, a.bot?.name]), [['permission', 'web', 'Bot Designer']]);
  assert.equal((await srv.api('/bots')).data.find((b) => b.id === designer.id).state, 'needs_you');
  assert.equal((await srv.asChief(`/asks/${asked[0].id}`, { method: 'POST', body: { yes: true } })).status, 403, 'the Chief can’t answer it');
  assert.equal((await srv.asChief('/asks', { method: 'POST', body: { kind: 'permission', permission: 'web' } })).status, 400, 'nor ask for a permission');
  await srv.api(`/asks/${asked[0].id}`, { method: 'POST', body: { yes: true } });
  const bot = (await srv.api(`/bots/${designer.id}`)).data;
  assert.ok(['WebSearch', 'WebFetch'].every((t) => bot.allowedTools.includes(t)));
  assert.equal((await srv.api('/asks')).data.length, 0);
  assert.match((await self(srv, token, 'ask', { kind: 'permission', permission: 'web', reason: 'again' })).data.error, /already have/);
  srv.unhold();
  await srv.finished(run.id);
});
