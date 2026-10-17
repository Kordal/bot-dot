// What this botdot server sends an app that does not know groups (GRP-006; Milestone 10, G19; ADR 018): no group
// and no turn of one. The test reads the bots, the runs of a member and the feed as the Android app of Milestone 9
// does (`git show main:android/app/src/main/java/dev/botdot/app/data/Api.kt`, `Store.kt`, `feed/Notifier.kt`,
// `ui/ChatModels.kt`): the same routes with the same questions, and of the feed the events that app acts on.
// Against a real botdot server and the stand-in for Claude (test/fixtures/fake-claude.js).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, waitFor } = require('./helpers');
const { shortName } = require('../public/mentions.js');

let srv;
before(async () => { srv = await startServer(); });
after(() => { letAllGo(srv); return srv.stop(); });

const fileOf = (on, kind, bot, ext = '') => path.join(on.out, `${kind}-${shortName(bot.name)}${ext}`);
const reply = (on, bot, text) => fs.writeFileSync(fileOf(on, 'result', bot, '.txt'), text);
const hold = (on, bot) => fs.writeFileSync(fileOf(on, 'hold', bot), '');
const letGo = (on, bot) => fs.rmSync(fileOf(on, 'hold', bot), { force: true });
const letAllGo = (on) => { for (const f of fs.readdirSync(on.out)) if (f === 'hold' || f.startsWith('hold-')) fs.rmSync(path.join(on.out, f), { force: true }); };
const chatOf = async (on, group) => (await on.api(`/group-chats/${group.id}/chat`)).data;
// The chat once a message's line has ended: nobody at work, no turn to come and none waiting.
const settled = (on, group, id) => waitFor(async () => {
  const c = await chatOf(on, group);
  const m = c.items.find((x) => x.type === 'message' && x.id === id);
  return m && !c.working.length && !m.next.length && !m.waitsFor.length ? c : null;
}, { timeout: 20_000, what: `the line of message ${id} to end` });

// The live feed as the app of Milestone 9 opens it (`Api.feed`: /api/events?guarded=1), every event kept.
function appFeed(on) {
  const events = [];
  const ac = new AbortController();
  (async () => {
    const res = await fetch(`${on.base}/api/events?guarded=1`, { headers: { Accept: 'text/event-stream' }, signal: ac.signal });
    const reader = res.body.getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += Buffer.from(value).toString();
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const type = chunk.match(/^event: (.*)$/m)?.[1];
        const data = chunk.match(/^data: (.*)$/m)?.[1];
        if (type) events.push({ type, data: JSON.parse(data || '{}') });
      }
    }
  })().catch(() => {});
  return { events, close: () => ac.abort(), hello: () => waitFor(() => events.find((e) => e.type === 'hello')?.data, { what: 'the feed\'s hello' }) };
}

// The events the app of Milestone 9 acts on: its store (`Store.handle`), its notifications (`Notifier.handleNow`),
// a bot's open chat (`BotChatModel`), the opening lines (`OpeningLines.handle`) and a Chief chat (`ChiefChatModel`).
// Any other event it does not know, and ignores.
const KNOWN = ['hello', 'reset', 'run_started', 'run_finished', 'waiting', 'bot_message', 'bots', 'approvals', 'chief_started', 'chief_reply', 'chief_suggestion',
  'plan_closed', 'login_request', 'login_request_closed', 'asks', 'bitwarden', 'update_available', 'queued', 'unread', 'dashboard', 'opening_line', 'run_waits',
  'chat_seen', 'claude', 'rating'];
// Of those, the ones that only say "read the bots again" or where things stand: they carry no run and no chat.
const LISTS = ['hello', 'bots'];

test('an app from before groups is sent no group and no turn of one: the bots, the runs of a member and the feed, as the app of Milestone 9 reads them', async (t) => {
  // A server of this milestone says so, where that app looks for what it may use.
  const version = (await srv.api('/version')).data;
  assert.ok(version.features.includes('groups'));
  assert.equal(version.apiVersion, 1, 'the same API version: an older app is not turned away');

  const [writer, coder, reviewer] = [await makeBot(srv, { name: 'Old Writer', emoji: '🤖', group: 'Work' }), await makeBot(srv, { name: 'Old Coder', emoji: '🤖', group: 'Work' }), await makeBot(srv, { name: 'Old Reviewer', emoji: '🤖', group: 'Work' })];
  // Coder's own chat with the owner, read: what the app shows of Coder before the group is made.
  reply(srv, coder, 'On the branch feature/own-chat.');
  const own = (await srv.api(`/bots/${coder.id}/run`, { method: 'POST', body: { prompt: 'Which branch?' } })).data;
  await srv.finished(own.id);
  await srv.api('/read', { method: 'POST', body: { app: 'android-m9', chat: `bot:${coder.id}` } });
  await srv.api('/read', { method: 'POST', body: { app: 'android-m9', chat: null } });

  const live = appFeed(srv);
  t.after(() => live.close());
  await live.hello();
  const made = await srv.api('/group-chats', { method: 'POST', body: { name: 'Old and new', members: [writer.id, coder.id, reviewer.id] } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const group = made.data;

  // One message in the group: a reply, a reply that asks the owner something, and a pass.
  reply(srv, writer, 'I will write the issue for the quokka switch.');
  reply(srv, coder, 'Two ways to build the quokka switch.\nWhich one?\n\n[[choices: The quick one | The clean one]]');
  reply(srv, reviewer, 'PASS');
  const sent = await srv.api(`/group-chats/${group.id}/messages`, { method: 'POST', body: { text: 'The settings page needs a quokka switch.' } });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  const chat = await settled(srv, group, sent.data.id);
  const turns = chat.items.filter((x) => x.type === 'reply').map((x) => x.run);
  assert.deepEqual(turns.map((r) => r.botId), [writer.id, coder.id], 'the group has its two replies');
  assert.equal(chat.asks?.botId, coder.id, 'and its open question');
  const turnIds = new Set((await srv.api(`/runs?group=${group.id}`)).data.map((r) => r.id));

  // ---- GET /api/bots, and GET /api/bots/:id when a chat comes on screen ----
  const bots = (await srv.api('/bots')).data;
  const members = [writer, coder, reviewer].map((b) => bots.find((x) => x.id === b.id));
  for (const b of members) {
    assert.deepEqual([b.unread, b.firstUnread ?? null, b.asks ?? null, b.queued, b.running, b.group], [0, null, null, [], false, 'Work'], `${b.name}: no new reply, no question and nothing waiting from the group`);
    assert.equal(b.state, 'idle', `${b.name}: its face shows nothing of the group's question`);
    const one = (await srv.api(`/bots/${b.id}`)).data;
    assert.deepEqual([one.unread, one.firstUnread ?? null, one.asks ?? null], [0, null, null]);
  }
  const holdsGroup = (x) => { const s = JSON.stringify(x); return s.includes(group.id) || s.includes('groupId') || s.includes('groupMessageId') || [...turnIds].some((id) => s.includes(id)); };
  assert.equal(holdsGroup(bots), false, 'no bot names the group or a turn');

  // ---- GET /api/runs: a member's chat (its pages of 40 and its newest 8), and every bot's latest runs for the list ----
  for (const limit of [40, 8]) {
    const runs = (await srv.api(`/runs?botId=${coder.id}&limit=${limit}`)).data;
    assert.deepEqual(runs.map((r) => [r.id, r.prompt, r.result]), [[own.id, 'Which branch?', 'On the branch feature/own-chat.']], "Coder's chat is its own run alone");
    assert.deepEqual((await srv.api(`/runs?botId=${writer.id}&limit=${limit}`)).data, [], 'a member that only answered in the group has an empty chat');
  }
  assert.deepEqual((await srv.api(`/runs?botId=${coder.id}&limit=40&before=${own.id}`)).data, [], 'and no older page');
  const recent = (await srv.api('/runs?limit=100')).data;
  assert.deepEqual(recent.map((r) => r.id), [own.id], "the list's previews are drawn from the bots' own runs");
  assert.equal(holdsGroup(recent), false);
  assert.deepEqual((await srv.api(`/bots/${coder.id}/inbox`)).data, []);

  // ---- GET /api/search, GET /api/chief, what waits ----
  assert.deepEqual((await srv.api('/search?q=quokka')).data, [], 'a turn is no search hit for an app that does not ask for groups');
  const chief = (await srv.api('/chief')).data;
  assert.equal(chief.unread ?? 0, 0);
  assert.equal(holdsGroup(chief), false);
  assert.deepEqual([(await srv.api('/asks')).data, (await srv.api('/vault/requests')).data, (await srv.api('/memory/pending?guarded=1')).data], [[], [], []]);

  // ---- the feed ----
  const heard = () => live.events.filter((e) => KNOWN.includes(e.type));
  assert.deepEqual(heard().filter((e) => !LISTS.includes(e.type)).map((e) => [e.type, e.data]), [], 'no run, no new reply, no question, no line and no waiting message of a bot');
  assert.equal(holdsGroup(heard()), false, 'what it knows of the feed names no group and no turn');
  assert.ok(live.events.some((e) => e.type === 'bots'), 'it is told to read the bots again');
  // The group's own events are of names that app does not know: it ignores them, and rings for none.
  const groups = live.events.filter((e) => !KNOWN.includes(e.type));
  assert.ok(groups.length > 0 && groups.every((e) => e.type === 'groups' || e.type.startsWith('group_')), JSON.stringify([...new Set(groups.map((e) => e.type))]));
  assert.deepEqual(groups.filter((e) => e.type === 'group_run_finished').map((e) => [e.data.botId, e.data.notify]), [[writer.id, false], [coder.id, true], [reviewer.id, false]], 'the question that this milestone\'s app rings for was asked');

  // ---- while a turn is at work: an app that connects then ----
  hold(srv, writer);
  reply(srv, writer, 'Written.');
  const again = await srv.api(`/group-chats/${group.id}/messages`, { method: 'POST', body: { text: '@OldWriter and now?' } });
  assert.equal(again.status, 201, JSON.stringify(again.data));
  const working = await waitFor(async () => (await chatOf(srv, group)).working.find((w) => w.botId === writer.id), { what: 'Old Writer to be at work in the group' });
  const late = appFeed(srv);
  t.after(() => late.close());
  const hello = await late.hello();
  const atWork = (await srv.api('/bots')).data.find((b) => b.id === writer.id);
  assert.deepEqual([atWork.running, atWork.state, atWork.unread, atWork.queued], [true, 'working', 0, []], 'the member works: a bot does one thing at a time, and its own row says so');
  assert.deepEqual((await srv.api(`/runs?botId=${writer.id}&limit=40`)).data, [], 'its own chat shows no run at work');
  assert.deepEqual((await srv.api('/runs?limit=100')).data.map((r) => r.id), [own.id]);
  assert.deepEqual((Array.isArray(hello.running) ? hello.running : []).filter((r) => r.id === working.runId || r.botId === writer.id), [], 'hello lists no turn among the runs going on');
  assert.equal(holdsGroup(hello), false, 'where things stand names no group and no turn');
  letGo(srv, writer);
  await settled(srv, group, again.data.id);
  assert.deepEqual(late.events.filter((e) => KNOWN.includes(e.type) && !LISTS.includes(e.type)).map((e) => e.type), []);
  assert.deepEqual(heard().filter((e) => !LISTS.includes(e.type)).map((e) => e.type), []);
});

// A card asked in a group (GRP-010; Milestone 10, G19, "Evidence limits"). A card is a bot's, in `GET /api/asks`
// and in the feed's `asks`, which the app of Milestone 9 reads and acts on; that it belongs to a group it is told
// by two fields that app does not know. So it is sent the card whole, and draws it as that bot's own: in Needs
// you under the bot's name and at the end of the bot's chat, where no run of that chat asked for it. The owner
// can answer it there, and what the yes starts is a turn of the group, of which that app is sent nothing.
test('a card asked in a group is sent to an app from before groups as the card of its bot, with the group in two fields it does not read; its yes carries on in the group', async (t) => {
  const { kit, BASH } = require('./carry-on-helpers');
  const { refuse } = kit(srv);
  const [coder, other] = [await makeBot(srv, { name: 'Card Old Coder', emoji: '🤖' }), await makeBot(srv, { name: 'Card Old Other', emoji: '🤖' })];
  const group = (await srv.api('/group-chats', { method: 'POST', body: { name: 'Old cards', members: [coder.id, other.id] } })).data;
  const live = appFeed(srv);
  t.after(() => live.close());
  await live.hello();
  reply(srv, coder, 'I cannot list the pull requests without running commands.');
  refuse([BASH]);
  const sent = await srv.api(`/group-chats/${group.id}/messages`, { method: 'POST', body: { text: '@CardOldCoder list the open pull requests' } });
  const chat = await settled(srv, group, sent.data.id);
  refuse([]);
  const stopped = chat.items.find((x) => x.type === 'reply').run;

  // GET /api/asks, as that app reads Needs you: the card with its bot, and the group in `groupId` and `groupName`.
  const [card] = await waitFor(async () => { const a = (await srv.api('/asks')).data.filter((x) => x.botId === coder.id); return a.length ? a : null; }, { what: 'the card' });
  assert.deepEqual([card.kind, card.botId, card.bot.name, card.permission, card.groupId, card.groupName], ['permission', coder.id, 'Card Old Coder', 'commands', group.id, 'Old cards']);
  assert.match(card.then.text, /^It carries on with “@CardOldCoder list the open pull requests” when you allow it\.$/);
  // The feed's `asks`, which it rings for and draws from: the same card in short, under the bot's name.
  const told = await waitFor(() => live.events.flatMap((e) => (e.type === 'asks' && e.data.list) || []).find((x) => x.id === card.id), { what: 'the feed to say the card' });
  assert.deepEqual([told.kind, told.botId, told.botName, told.what, told.groupId, told.groupName], ['permission', coder.id, 'Card Old Coder', card.what.label, group.id, 'Old cards']);
  // Nothing else names the group: the bot's own chat has no run that asked, and the bot asks nothing of its own.
  assert.deepEqual((await srv.api(`/runs?botId=${coder.id}&limit=40`)).data, [], 'its chat holds the card and no run');
  const row = (await srv.api('/bots')).data.find((b) => b.id === coder.id);
  assert.deepEqual([row.unread, row.asks ?? null], [0, null]);
  const known = live.events.filter((e) => KNOWN.includes(e.type) && !LISTS.includes(e.type));
  assert.deepEqual([...new Set(known.map((e) => e.type))], ['asks'], 'of what it acts on, the card alone');

  // Its yes, as that app sends it: the member carries on in the group, and that app is sent no run of it.
  reply(srv, coder, 'Three pull requests are open.');
  const yes = await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } });
  assert.deepEqual([yes.status, yes.data.carriesOn], [200, { who: 'bot', text: 'it carries on' }]);
  const carried = await waitFor(async () => (await srv.api(`/runs?group=${group.id}`)).data.find((r) => r.continues === stopped.id && r.status !== 'running'), { what: 'the run that carries on' });
  assert.deepEqual([carried.groupId, carried.result], [group.id, 'Three pull requests are open.']);
  assert.deepEqual((await srv.api(`/runs?botId=${coder.id}&limit=40`)).data, [], "nothing in the bot's own chat");
  assert.deepEqual(live.events.filter((e) => ['run_started', 'run_finished', 'unread', 'opening_line'].includes(e.type)), []);
});
