// The Chief takes a message while it replies (BUSY-002, ADR 011): a message of the owner to a chat whose reply is
// going is not refused. It is kept on disk, listed in the chat's `queued`, and starts as its own turn when the
// reply ends, before the turns botdot starts, built from the chat as it is then. It can be taken back. A Chief
// turn that only waits for a bot's run stops waiting when the owner writes. Against the stand-in for Claude; the
// Chief's own tools (lib/mcp-server.js) are the real ones. A late result is in test/chief-late.test.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, restartServer, makeBot, waitFor, feed, readData } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

const TOO_MANY = 'The Chief already has 10 of your messages waiting here. Take one back, or wait.';
const WROTE = (bot) => `The user wrote to you while you waited. Stop waiting: say in one line that ${bot} is still working and that its answer will come to this chat, and end your reply.`;
const isChief = (x) => x.args.includes('🧭 Chief of Staff');
const isTold = (x) => isChief(x) && /^botdot writes this, not the user/m.test(x.stdin);
const chiefTurn = (on, what, fn = () => true) => on.nextRun((x) => isChief(x) && fn(x), what);
const newChat = async (on = srv) => (await on.api('/chief/chats', { method: 'POST' })).data.id;
const chatOf = async (id, on = srv) => (await on.api(`/chief/chats/${id}`)).data;
const say = (id, body, on = srv) => on.api(`/chief/chats/${id}/messages`, { method: 'POST', body: typeof body === 'string' ? { text: body } : body });
const takeBack = (id, queuedId, on = srv) => on.api(`/chief/chats/${id}/queued/${queuedId}`, { method: 'DELETE' });
const quiet = (id, on = srv) => waitFor(async () => { const c = await chatOf(id, on); return !c.busy && !c.queued.length && !c.messages.at(-1)?.pending ? c : null; }, { what: 'the Chief to finish' });
const onDisk = (on = srv) => (fs.existsSync(path.join(on.data, 'chief-waiting-turns.json')) ? readData(on.data, 'chief-waiting-turns.json') : {});
const words = (chat) => chat.messages.map((m) => [m.role, m.text]);
const upload = async (name, text) => (await srv.api('/uploads?to=chief', { method: 'POST', raw: Buffer.from(text), headers: { 'X-File-Name': name } })).data;

test('a message to a chat whose reply is going waits with its files and its key, and starts when the reply ends, once', async (t) => {
  const events = feed(srv);
  t.after(() => { events.close(); srv.unhold(); });
  await events.wait('hello');
  const id = await newChat();
  srv.hold();
  const first = await say(id, 'Plan my week');
  assert.deepEqual([first.status, first.data.busy, first.data.queued], [201, true, []], 'the first starts at once, and nothing waits');
  const turn = await chiefTurn(srv, 'the first turn');

  const file = await upload('notes.txt', 'Friday is free.');
  const second = await say(id, { text: 'And book the dentist', attachments: [file], key: 'dentist-key-0001' });
  assert.equal(second.status, 201, 'not refused');
  assert.equal(second.data.id, id, 'answered with the chat');
  assert.equal(second.data.busy, true);
  assert.deepEqual(second.data.queued.map((q) => [q.text, q.attachments.map((a) => a.name)]), [['And book the dentist', ['notes.txt']]]);
  const [waits] = second.data.queued;
  assert.deepEqual(Object.keys(waits).sort(), ['at', 'attachments', 'id', 'text']);
  assert.ok(!Number.isNaN(Date.parse(waits.at)));
  assert.deepEqual(words(second.data).map(([role]) => role), ['user', 'chief'], 'it is not in the messages until its turn starts');
  // The chat lists it, the feed says it, and it is on disk before the answer.
  assert.deepEqual((await chatOf(id)).queued, [waits]);
  const said = await events.wait('queued', (d) => d.chatId === id && d.queued.length === 1);
  assert.deepEqual([said.data.chat, said.data.chatId, said.data.queued], [`chief:${id}`, id, [waits]]);
  assert.deepEqual(onDisk()[id].map((w) => [w.owner, w.id, w.text, w.key]), [[true, waits.id, 'And book the dentist', 'dentist-key-0001']]);
  // Sent again with its key: it waits once.
  const again = await say(id, { text: 'And book the dentist', attachments: [file], key: 'dentist-key-0001' });
  assert.deepEqual([again.status, again.data.again, again.data.queued], [200, true, [waits]]);
  assert.equal(srv.runs().filter(isChief).filter((x) => x.botdot.env.CHIEF_CHAT_ID === id).length, 1, 'the reply that is going is not interrupted, and no turn starts beside it');

  // The reply ends: the message's turn starts, with its files, and leaves the list.
  srv.reply('Your week is planned.');
  srv.release(turn);
  const next = await chiefTurn(srv, "the waiting message's turn", (x) => /And book the dentist/.test(x.stdin));
  assert.match(next.stdin, /notes\.txt/, 'its file is handed to the turn');
  const gone = await events.wait('queued', (d) => d.chatId === id && d.queued.length === 0);
  assert.deepEqual([gone.data.chat, gone.data.chatId, gone.data.queued], [`chief:${id}`, id, []]);
  assert.deepEqual(onDisk(), {});
  const going = await chatOf(id);
  assert.deepEqual([going.busy, going.queued], [true, []]);
  assert.deepEqual(going.messages.map((m) => [m.role, m.text, !!m.pending]), [['user', 'Plan my week', false], ['chief', 'Your week is planned.', false], ['user', 'And book the dentist', false], ['chief', '', true]]);
  assert.deepEqual([going.messages[2].queuedId, going.messages[2].attachments.map((a) => a.name)], [waits.id, ['notes.txt']]);
  // Too late to take back: it has started. An id that never waited is not found.
  assert.deepEqual([(await takeBack(id, waits.id)).status, (await takeBack(id, waits.id)).data], [409, { error: 'It has already started.' }]);
  assert.equal((await takeBack(id, 'w0000000000000000')).status, 404);

  srv.reply('Booked.');
  srv.unhold();
  const done = await quiet(id);
  assert.deepEqual(words(done), [['user', 'Plan my week'], ['chief', 'Your week is planned.'], ['user', 'And book the dentist'], ['chief', 'Booked.']], "the owner's message and the Chief's reply, in that order, once");
  const late = await say(id, { text: 'And book the dentist', key: 'dentist-key-0001' });
  assert.deepEqual([late.status, late.data.again], [200, true], 'its key is still known after it started');
  assert.equal(srv.runs().filter(isChief).filter((x) => x.botdot.env.CHIEF_CHAT_ID === id).length, 2, 'one turn per message');
});

test("the turn is built when it starts: a plan's Approve that waited answers the plan then, and is told what came in meanwhile", async (t) => {
  t.after(() => srv.unhold());
  const id = await newChat();
  // A bot's plan waits in this chat (as send_to_chief leaves it).
  const file = path.join(srv.data, 'chief', `${id}.json`);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.messages.push({ role: 'suggestion', from: { id: 'designer', name: 'Bot Designer', emoji: '🎨', color: '#888' }, text: 'A bot that waters the plants.', at: new Date().toISOString(), status: 'pending' });
  fs.writeFileSync(file, JSON.stringify(saved));
  srv.hold();
  await say(id, 'What is the weather?');
  const turn = await chiefTurn(srv, 'the first turn', (x) => /What is the weather\?/.test(x.stdin));
  assert.match(turn.stdin, /Background only: a plan from 🎨 Bot Designer/);

  // While it replies: the owner taps Approve, then a quick answer; and a reminder goes off.
  const approve = await say(id, 'Approved. Go ahead.');
  const quick = await say(id, 'Yes');
  assert.deepEqual([approve.status, quick.status, quick.data.queued.map((q) => q.text)], [201, 201, ['Approved. Go ahead.', 'Yes']]);
  assert.equal((await srv.api('/chief/reminders', { method: 'POST', body: { text: 'Water the plants', at: new Date().toISOString(), chatId: id } })).status, 201);
  // It goes off into the turn, and stays listed until the turn's reply is saved (#307).
  assert.deepEqual((await srv.api('/chief/reminders')).data.map((r) => r.text), ['Water the plants']);
  assert.equal((await chatOf(id)).messages.find((m) => m.role === 'suggestion').status, 'pending', 'the plan is not answered while Approve waits');

  srv.release(turn);
  await waitFor(async () => !(await srv.api('/chief/reminders')).data.length, { what: 'the reminder to go off' });
  const approved = await chiefTurn(srv, "Approve's turn", (x) => /My answer: Approved\. Go ahead\./.test(x.stdin));
  assert.match(approved.stdin, /<suggestion>\nA bot that waters the plants\.\n<\/suggestion>/, 'the plan is answered when the turn starts');
  assert.match(approved.stdin, /The reminder you set for me went off in our chat: "Water the plants"\./, 'and it is told what the Chief has not seen, as a message sent now would be');
  let now = await chatOf(id);
  assert.equal(now.messages.find((m) => m.role === 'suggestion').status, 'answered');
  assert.deepEqual(now.queued.map((q) => q.text), ['Yes'], 'the next one still waits: each is its own turn');
  srv.release(approved);
  const yes = await chiefTurn(srv, "the quick answer's turn", (x) => /My message: Yes$/.test(x.stdin));
  assert.doesNotMatch(yes.stdin, /<suggestion>|waiting-plan|reminder/, 'told nothing twice');
  srv.unhold();
  now = await quiet(id);
  assert.deepEqual(now.messages.filter((m) => m.role === 'user').map((m) => m.text), ['What is the weather?', 'Approved. Go ahead.', 'Yes']);
});

test("the owner's messages start before the turns botdot starts, in the order sent; ten at most, and the eleventh keeps its key free", async (t) => {
  t.after(() => srv.unhold());
  const id = await newChat();
  srv.hold();
  await say(id, 'Give Alpha the web');
  const turn = await chiefTurn(srv, 'the first turn', (x) => /Give Alpha the web/.test(x.stdin));
  // botdot has something to tell the Chief here first: the owner's yes on what the Chief asked for.
  const bot = await makeBot(srv, { name: 'Alpha', allowedTools: ['Read'] });
  const change = await srv.asChief(`/bots/${bot.id}`, { method: 'PUT', body: { allowedTools: ['Read', 'WebSearch', 'WebFetch'] }, headers: { 'X-Chief-Chat': id } });
  assert.equal((await srv.api(`/asks/${change.data.pendingChange}`, { method: 'POST', body: { yes: true } })).status, 200);
  assert.deepEqual(onDisk()[id].map((w) => !!w.owner), [false]);

  for (let i = 1; i <= 10; i++) assert.equal((await say(id, { text: `Message ${i}`, key: `ordered-key-${String(i).padStart(4, '0')}` })).status, 201, `message ${i}`);
  const eleventh = await say(id, { text: 'Message 11', key: 'ordered-key-0011' });
  assert.deepEqual([eleventh.status, eleventh.data], [429, { error: TOO_MANY }]);
  let chat = await chatOf(id);
  assert.deepEqual(chat.queued.map((q) => q.text), Array.from({ length: 10 }, (_, i) => `Message ${i + 1}`), 'oldest first, and what botdot has to tell is not among them');

  // Take back all but the first two: each answers what was sent, and its key is free again.
  for (const q of chat.queued.slice(2)) assert.deepEqual((await takeBack(id, q.id)).data, { text: q.text, attachments: [] });
  assert.equal((await takeBack(id, chat.queued[9].id)).status, 404, 'taken back once');
  // The eleventh was refused, so its key was not used up: there is room now, and it is taken.
  const taken = await say(id, { text: 'Message 11', key: 'ordered-key-0011' });
  assert.deepEqual([taken.status, taken.data.queued.map((q) => q.text)], [201, ['Message 1', 'Message 2', 'Message 11']]);
  // A message that was taken back may be sent again with its key.
  const back = await say(id, { text: 'Message 3', key: 'ordered-key-0003' });
  assert.deepEqual([back.status, back.data.again], [201, undefined]);
  assert.equal((await takeBack(id, back.data.queued.at(-1).id)).status, 200);

  const from = srv.runs().length;
  srv.unhold();
  srv.release(turn);
  const turnsOf = () => srv.runs().slice(from).filter((x) => isChief(x) && x.botdot.env.CHIEF_CHAT_ID === id).map((x) => (isTold(x) ? 'botdot: Alpha' : x.stdin.match(/Message \d+$/)?.[0]));
  // The chat is quiet for a moment between the owner's last turn and the one botdot starts, so wait for that turn.
  await waitFor(() => (turnsOf().length >= 4 ? true : null), { what: "botdot's turn" });
  chat = await quiet(id);
  assert.deepEqual(turnsOf(), ['Message 1', 'Message 2', 'Message 11', 'botdot: Alpha'], "the owner's first, in the order sent, then botdot's turn");
  assert.deepEqual(chat.messages.filter((m) => m.role === 'user').map((m) => m.text), ['Give Alpha the web', 'Message 1', 'Message 2', 'Message 11']);
  assert.deepEqual(onDisk(), {});
});

test('a message with only a file waits as it was sent, and take back answers its text and files', async (t) => {
  const events = feed(srv);
  t.after(() => { events.close(); srv.unhold(); });
  await events.wait('hello');
  const id = await newChat();
  srv.hold();
  await say(id, 'Hello');
  const turn = await chiefTurn(srv, 'the first turn', (x) => x.botdot.env.CHIEF_CHAT_ID === id);
  const file = await upload('plan.txt', 'The plan.');
  const sent = await say(id, { text: '', attachments: [file], key: 'file-only-key-01' });
  const [waits] = sent.data.queued;
  assert.deepEqual([waits.text, waits.attachments.map((a) => a.name)], ['', ['plan.txt']], 'what the owner wrote: nothing');
  assert.equal((await say(id, { text: '   ' })).status, 400, 'an empty message is refused as ever');
  const back = await takeBack(id, waits.id);
  assert.deepEqual([back.status, back.data.text, back.data.attachments.map((a) => a.name)], [200, '', ['plan.txt']]);
  assert.deepEqual((await events.wait('queued', (d) => d.chatId === id && d.queued.length === 0)).data.queued, []);
  assert.deepEqual([(await chatOf(id)).queued, onDisk()], [[], {}]);
  assert.equal((await takeBack(id, waits.id)).status, 404, 'it never started');
  // Sent again with the same key: taken anew. A chat whose reply is going cannot be deleted, waiting message or not.
  assert.equal((await say(id, { text: '', attachments: [file], key: 'file-only-key-01' })).status, 201);
  const refused = await srv.api(`/chief/chats/${id}`, { method: 'DELETE' });
  assert.deepEqual([refused.status, refused.data.error], [400, 'Wait for the current reply to finish']);
  srv.unhold();
  srv.release(turn);
  const done = await quiet(id);
  assert.deepEqual(done.messages.filter((m) => m.role === 'user').map((m) => [m.text, (m.attachments || []).map((a) => a.name)]), [['Hello', []], ['Have a look at the attached files.', ['plan.txt']]]);
});

test("while Claude is signed out the owner's waiting messages stay waiting, with what botdot has to tell behind them, and start with the sign-in", async (t) => {
  const own = await startServer();
  const signedOut = path.join(own.out, 'signed-out');
  t.after(async () => { fs.rmSync(signedOut, { force: true }); own.unhold(); await own.stop(); });
  const id = await newChat(own);
  own.hold();
  await say(id, 'First', own);
  await chiefTurn(own, 'the first turn');
  assert.equal((await say(id, 'Second', own)).data.queued.length, 1);
  // botdot has something to tell the Chief there too: the owner's yes on what the Chief asked for.
  const bot = await makeBot(own, { name: 'Alpha', allowedTools: ['Read'] });
  const change = await own.asChief(`/bots/${bot.id}`, { method: 'PUT', body: { allowedTools: ['Read', 'WebSearch', 'WebFetch'] }, headers: { 'X-Chief-Chat': id } });
  assert.equal((await own.api(`/asks/${change.data.pendingChange}`, { method: 'POST', body: { yes: true } })).status, 200);

  // The owner signs out: the reply that was going ends, and the message that waited does not start to fail.
  fs.writeFileSync(signedOut, '');
  assert.equal((await own.api('/setup/claude', { method: 'DELETE' })).data.stopped, 1);
  await waitFor(async () => !(await chatOf(id, own)).busy, { what: 'the reply to end' });
  // A message sent meanwhile waits behind it, and so does what botdot has to tell the Chief there.
  assert.equal((await say(id, 'Third', own)).data.queued.length, 2);
  await new Promise((r) => setTimeout(r, 100)); // past the moment what waits would have started
  let chat = await chatOf(id, own);
  assert.deepEqual([chat.busy, chat.queued.map((x) => x.text), words(chat)], [false, ['Second', 'Third'], [['user', 'First'], ['chief', '']]]);
  assert.equal(chat.messages.at(-1).error, 'This reply was stopped because Claude was signed out.');
  assert.deepEqual(onDisk(own)[id].map((x) => (x.owner ? x.text : 'botdot: Alpha')), ['Second', 'botdot: Alpha', 'Third'], 'on disk, as before');
  assert.equal(own.runs().filter(isChief).length, 1, 'no turn started');
  // It can still be taken back.
  assert.deepEqual((await takeBack(id, chat.queued[1].id, own)).data, { text: 'Third', attachments: [] });

  // Signed in again, which the server learns as Setup is opened: the message starts, as its own turn.
  fs.rmSync(signedOut);
  own.unhold();
  assert.equal((await own.api('/setup?fresh')).data.claude.loggedIn, true);
  const turns = () => own.runs().filter(isChief).slice(1).map((x) => (isTold(x) ? 'botdot: Alpha' : x.stdin.match(/Second$/)?.[0]));
  // The chat is quiet for a moment between the owner's turn and the one botdot starts, so wait for that turn.
  await waitFor(() => (turns().length >= 2 ? true : null), { what: "botdot's turn" });
  chat = await quiet(id, own);
  assert.deepEqual(turns(), ['Second', 'botdot: Alpha'], "the owner's message, then what botdot had to tell");
  assert.deepEqual(chat.messages.filter((m) => m.role === 'user').map((m) => m.text), ['First', 'Second']);
  assert.deepEqual(onDisk(own), {});
});

test('a check of the sign-in asked before the sign-out and answered after it starts nothing that waits', async (t) => {
  const own = await startServer();
  const [late, held, signedOut] = ['auth-late', 'auth-late-held', 'signed-out'].map((f) => path.join(own.out, f));
  t.after(async () => { for (const f of [late, held, signedOut]) fs.rmSync(f, { force: true }); own.unhold(); await own.stop(); });
  const id = await newChat(own);
  own.hold();
  await say(id, 'First', own);
  await chiefTurn(own, 'the first turn');
  assert.equal((await say(id, 'Second', own)).data.queued.length, 1);

  // A check begins while Claude is signed in (the one each minute, or one an app asked for), and answers late.
  fs.writeFileSync(late, '');
  const check = own.api('/setup?fresh');
  await waitFor(() => fs.existsSync(held), { what: 'the check to begin' });
  // Meanwhile the owner signs out: the reply that was going ends, and the message waits for the sign-in.
  fs.writeFileSync(signedOut, '');
  assert.equal((await own.api('/setup/claude', { method: 'DELETE' })).data.stopped, 1);
  await waitFor(async () => !(await chatOf(id, own)).busy, { what: 'the reply to end' });
  // The check answers "signed in", from before the sign-out: botdot asks again, and nothing starts.
  fs.rmSync(held);
  assert.equal((await check).data.claude.loggedIn, false);
  const chat = await chatOf(id, own);
  assert.deepEqual([chat.busy, chat.queued.map((x) => x.text)], [false, ['Second']]);
  assert.equal(own.runs().filter(isChief).length, 1, 'no turn started');

  fs.rmSync(signedOut);
  own.unhold();
  assert.equal((await own.api('/setup?fresh')).data.claude.loggedIn, true);
  assert.deepEqual((await quiet(id, own)).messages.filter((m) => m.role === 'user').map((m) => m.text), ['First', 'Second'], 'it starts with the sign-in');
});

test('botdot stopped and started while a message waits: it still waits, and starts once, after the reply that was cut off', async (t) => {
  let own = await startServer();
  t.after(async () => { own.unhold(); await own.stop(); });
  const id = await newChat(own);
  own.hold();
  await say(id, 'First', own);
  await chiefTurn(own, 'the first turn');
  const sent = await say(id, { text: 'Second', key: 'restart-wait-key1' }, own);
  assert.equal(sent.data.queued.length, 1);

  own = await restartServer(own, (data) => fs.rmSync(path.join(data, '..', 'fake', 'hold'), { force: true }));
  const turn = await own.nextRun((x) => isChief(x) && /Second$/.test(x.stdin), "the waiting message's turn");
  assert.equal(turn.botdot.env.BOT_DOT_URL, `http://127.0.0.1:${own.botdotPort}`);
  const done = await quiet(id, own);
  assert.deepEqual(done.messages.map((m) => [m.role, m.text, m.error || null]), [['user', 'First', null], ['chief', '', 'This reply was cut off because botdot was restarted.'], ['user', 'Second', null], ['chief', 'Done.', null]]);
  assert.deepEqual(onDisk(own), {});
  const again = await say(id, { text: 'Second', key: 'restart-wait-key1' }, own);
  assert.deepEqual([again.status, again.data.again], [200, true], 'its key outlived the restart');

  own = await restartServer(own);
  assert.deepEqual((await chatOf(id, own)).messages.filter((m) => m.role === 'user').map((m) => m.text), ['First', 'Second']);
  assert.equal(own.runs().filter((x) => isChief(x) && /Second$/.test(x.stdin)).length, 1, 'started once');
});

test('the Chief stops waiting for a bot when the owner writes: the wait is answered at once with a note, the run goes on, and its result is a later turn', async (t) => {
  t.after(() => srv.unhold());
  const bot = await makeBot(srv, { name: 'Web Surfer', emoji: '🏄' });
  const id = await newChat();
  srv.hold();
  await say(id, 'Ask Web Surfer for the news');
  const turn = await chiefTurn(srv, 'the first turn', (x) => /Ask Web Surfer for the news/.test(x.stdin));
  // The Chief's own tools, as that turn has them.
  const tools = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey, CHIEF_CHAT_ID: id });
  const started = await tools.json('run_bot', { id: bot.id, prompt: 'Find the news' });
  const rec = await srv.nextRun((x) => x.args.includes('🏄 Web Surfer'), 'Web Surfer to start');
  const events = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'run1', name: 'mcp__botdot__run_bot', input: { id: bot.id } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'run1', content: JSON.stringify(started) }] } },
  ];
  fs.writeFileSync(path.join(srv.out, `events-${turn.n}.json`), JSON.stringify(events));
  await waitFor(async () => (await chatOf(id)).messages.at(-1).actions.some((a) => a.runId === started.id), { what: 'the reply to record the run it started' });
  const metaOf = () => readData(srv.data, path.join('runs', `${started.id}.json`));

  const asked = Date.now();
  const waiting = tools.json('wait_for_run', { runId: started.id });
  await chatOf(id); // the wait is open by now (and were it not, botdot would answer it at once all the same)
  await chatOf(id);
  const sent = await say(id, 'Never mind. What time is it?');
  assert.deepEqual([sent.status, sent.data.queued.map((q) => q.text)], [201, ['Never mind. What time is it?']]);
  const told = await waiting;
  assert.ok(Date.now() - asked < 10_000, 'the open wait was answered when the message came, not when its time was up');
  assert.deepEqual([told.id, told.status, told.note], [started.id, 'running', WROTE('Web Surfer')]);
  assert.deepEqual([metaOf().status, metaOf().chiefSaw], ['running', undefined], 'the run is not stopped, and not marked as seen by the Chief');
  // A later wait in the same turn, while the message still waits: the same note, at once.
  const once = Date.now();
  const more = await tools.json('wait_for_run', { runId: started.id });
  assert.deepEqual([more.status, more.note], ['running', WROTE('Web Surfer')]);
  assert.ok(Date.now() - once < 10_000);
  assert.equal((await srv.api(`/runs/${started.id}/wait?timeout=1&seen=chief`)).data.ownerWrote, true, 'the route says it, for the chat whose reply started the run');
  assert.equal((await srv.api(`/runs/${started.id}?events=0`)).data.ownerWrote, undefined);

  // The Chief ends its reply; the owner's message is the next turn; the bot works on.
  srv.reply('Web Surfer is still on it. Its answer will come here.');
  srv.release(turn);
  const next = await chiefTurn(srv, "the owner's turn", (x) => /Never mind\. What time is it\?$/.test(x.stdin));
  assert.equal(metaOf().status, 'running');

  // The bot ends while that turn is going: its result waits behind it, and is the Chief's next turn.
  srv.reply('The news: all quiet.');
  srv.release(rec);
  await srv.finished(started.id);
  assert.deepEqual(onDisk()[id].map((w) => [!!w.owner, w.unlessSeen]), [[false, started.id]]);
  srv.release(next);
  const late = await srv.nextRun((x) => isTold(x) && /Web Surfer/.test(x.stdin), "the Chief's turn for the late result");
  assert.match(late.stdin, /🏄 Web Surfer \(bot id [^)]+\), which you started in this chat, has ended its run/);
  assert.match(late.stdin, /<bot-reply>\nThe news: all quiet\.\n<\/bot-reply>/);
  srv.unhold();
  const done = await quiet(id);
  assert.deepEqual(done.messages.map((m) => m.role), ['user', 'chief', 'user', 'chief', 'chief']);
  assert.deepEqual(done.messages.at(-1).actions, [{ kind: 'from', text: 'From Web Surfer', botId: bot.id, runId: started.id }]);
});

test('the features and the tools say it', async (t) => {
  assert.ok((await srv.api('/version')).data.features.includes('message-waits'));
  const tools = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey });
  const wait = (await tools.request('tools/list')).tools.find((x) => x.name === 'wait_for_run');
  assert.match(wait.description, /When the user writes to you meanwhile, it returns at once with a note: follow the note\./);
  // The Chief's tools cannot take the owner's message back, nor write as the owner.
  const id = await newChat();
  assert.equal((await srv.asChief(`/chief/chats/${id}/queued/w0000000000000000`, { method: 'DELETE' })).status, 403);
});
