// Mentions (lib/mentions.js): the shared rules table every app is tested against, and the note bot
// and Chief runs get about the owner's "@" references.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, waitFor } = require('./helpers');
const { shortName, findMentions, suggest, pick, command, commandMark, mentionsNote, MAX_ROWS } = require('../lib/mentions');
const table = require('./fixtures/mentions.json');

test('the table and the module agree on the row limit', () => {
  assert.equal(table.maxRows, MAX_ROWS);
});

test('short names', () => {
  for (const [name, short] of table.shortNames) assert.equal(shortName(name), short, name);
});

for (const c of table.cases) {
  test(`table: ${c.name}`, () => {
    const ctx = { chat: c.chat, ...table.worlds[c.world] };
    if (c.matches) {
      const got = findMentions(c.text, ctx).map(({ start, end, ...m }) => {
        assert.equal(c.text.slice(start, end), m.text);
        return m;
      });
      assert.deepEqual(got, c.matches);
    }
    if (c.suggestions) assert.deepEqual(suggest(c.typed, ctx).map((r) => r.text), c.suggestions);
  });
}

// A message with '|' where the cursor is → [text, cursor], and back.
const caret = (t) => [t.replace('|', ''), t.indexOf('|')];
const withCaret = (t, at) => `${t.slice(0, at)}|${t.slice(at)}`;

for (const c of table.picks) {
  test(`table pick: ${c.name}`, () => {
    const ctx = { chat: c.chat, ...table.worlds[c.world] };
    const [text, at] = caret(c.before);
    const row = suggest(text.slice(0, at), ctx).find((r) => r.text === c.pick);
    assert.ok(row, `${c.pick} is offered`);
    const done = pick(text, at, row);
    assert.equal(withCaret(done.text, done.cursor), c.after);
    assert.equal(done.jobsNext, c.jobsNext);
  });
}

for (const c of table.commands) {
  test(`table command: ${c.name}`, () => {
    assert.deepEqual(command(c.text, { chat: c.chat, ...table.worlds[c.world] }), c.command);
  });
}

for (const c of table.marks) {
  test(`table mark: ${c.name}`, () => {
    assert.deepEqual(commandMark(c.text, { chat: c.chat, ...table.worlds[c.world] }), c.mark);
  });
}

test('pick: nothing being typed, nothing picked', () => {
  assert.equal(pick('no mention here', 4, { kind: 'bot', text: '@FleetDoctor' }), null);
});

const world = {
  bots: [
    { id: 'chief', name: 'Chief of Staff', description: 'Runs the team.', jobs: [] },
    { id: 'fleet', name: 'Fleet Doctor', prompt: '\nCheck the homelab.\nThen more.', skills: ['weekly-report'], jobs: [
      { id: 'j1', name: 'Morning check', cron: '0 7 * * *', prompt: 'Check every server.' },
      { id: 'j2', name: 'Once', at: '2026-10-02T07:00:00.000Z', kind: 'ai', prompt: '' },
    ] },
  ],
  library: [{ name: 'weekly-report', description: 'How the weekly report looks.' }],
};

test('the note: one line per mention, each once (in the Chief chat, the Chief is "you")', () => {
  const n = mentionsNote('@FleetDoctor, @fleetdoctor, @FleetDoctor/MorningCheck @FleetDoctor/Once @weekly-report @ChiefOfStaff', { chat: 'chief', ...world });
  const lines = n.split('\n');
  assert.match(lines[0], /^Mentioned in this message/);
  assert.deepEqual(lines.slice(1), [
    '- @FleetDoctor is the bot Fleet Doctor (id fleet): Check the homelab.',
    '- @FleetDoctor/MorningCheck is Fleet Doctor\'s job "Morning check" (id j1, schedule 0 7 * * *): Check every server.',
    '- @FleetDoctor/Once is Fleet Doctor\'s job "Once" (id j2, once at 2026-10-02T07:00:00.000Z): Fleet Doctor\'s main assignment',
    '- @weekly-report is the skill weekly-report in the library: How the weekly report looks.',
    '- @ChiefOfStaff is you.',
  ]);
});

test('the note in a bot\'s chat: its skills to load, itself as "you"', () => {
  const n = mentionsNote('@weekly-report and @FleetDoctor', { chat: 'fleet', ...world });
  assert.match(n, /@weekly-report is your skill botdot:weekly-report: How the weekly report looks\. Load it with the Skill tool if it fits\./);
  assert.match(n, /@FleetDoctor is you\./);
});

test('no mentions, no note', () => {
  assert.equal(mentionsNote('mail me@FleetDoctor.com about @Nobody', { chat: 'chief', ...world }), '');
});

// ---------- the server ----------

let srv, doctor, keeper, quiet;
before(async () => {
  srv = await startServer();
  await srv.api('/skills', { method: 'POST', body: { name: 'weekly-report', description: 'How the weekly report looks.', instructions: 'Headings, then bullets.' } });
  await srv.api('/skills', { method: 'POST', body: { name: 'tone', description: "The owner's tone.", instructions: 'Plain.' } });
  doctor = await makeBot(srv, { name: 'Fleet Doctor', emoji: '🩺', description: 'Keeps the homelab healthy.', skills: ['weekly-report'], jobs: [{ name: 'Morning check', cron: '0 7 * * *', prompt: 'Check every server.' }] });
  keeper = await makeBot(srv, { name: 'Todo Keeper', emoji: '✅' });
  quiet = await makeBot(srv, { name: 'Quiet One', emoji: '🤫', mayMessage: [] });
});
after(() => srv.stop());

const runOf = (bot) => srv.nextRun((x) => x.args.includes(`${bot.emoji} ${bot.name}`), `a run of ${bot.name}`);

test("a bot's chat message gets the note, with its own skills only", async () => {
  const r = await srv.api(`/bots/${keeper.id}/run`, { method: 'POST', body: { prompt: 'Ask @FleetDoctor about @FleetDoctor/MorningCheck, use @tone, not @weekly-report' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const rec = await runOf(keeper);
  assert.match(rec.system, /Mentioned in this message/);
  assert.match(rec.system, /@FleetDoctor is the bot Fleet Doctor \(id [^)]+\): Keeps the homelab healthy\./);
  assert.match(rec.system, /@FleetDoctor\/MorningCheck is Fleet Doctor's job "Morning check" \(id j\w+, schedule 0 7 \* \* \*\): Check every server\./);
  assert.doesNotMatch(rec.system, /@tone is|@weekly-report is/, "Todo Keeper picked no skills");
  assert.match(rec.stdin, /Ask @FleetDoctor/, 'the message itself is unchanged');
  await srv.finished(r.data.id);

  const d = await srv.api(`/bots/${doctor.id}/run`, { method: 'POST', body: { prompt: 'Lay it out like @weekly-report' } });
  const dr = await runOf(doctor);
  assert.match(dr.system, /@weekly-report is your skill botdot:weekly-report: How the weekly report looks\. Load it with the Skill tool if it fits\./);
  await srv.finished(d.data.id);
});

// "/" and a skill's name (#237): the run starts with that skill invoked as Claude Code invokes a library skill.
test('a message starting with "/" and one of the bot\'s skills runs that skill with the rest as its arguments', async () => {
  const r = await srv.api(`/bots/${doctor.id}/run`, { method: 'POST', body: { prompt: '/weekly-report for May, short' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const rec = await runOf(doctor);
  assert.match(rec.stdin, /^\/botdot:weekly-report for May, short(\n|$)/, 'the skill is invoked, the rest is its arguments');
  assert.equal(r.data.prompt, '/weekly-report for May, short', 'the chat keeps what the owner wrote');
  await srv.finished(r.data.id);

  const alone = await srv.api(`/bots/${doctor.id}/run`, { method: 'POST', body: { prompt: '/weekly-report' } });
  assert.match((await runOf(doctor)).stdin, /^\/botdot:weekly-report(\n|$)/);
  await srv.finished(alone.data.id);
});

test('"/" and a name the bot has no skill of is sent as plain text', async () => {
  for (const prompt of ['/weekly-report for May', '/nothing here']) {
    const r = await srv.api(`/bots/${keeper.id}/run`, { method: 'POST', body: { prompt } });
    const rec = await runOf(keeper);
    assert.ok(rec.stdin.startsWith(prompt), rec.stdin);
    assert.doesNotMatch(rec.stdin, /botdot:/);
    await srv.finished(r.data.id);
  }
});

test('no mention, no note', async () => {
  const r = await srv.api(`/bots/${keeper.id}/run`, { method: 'POST', body: { prompt: 'mail me@FleetDoctor.com about @Nobody' } });
  const rec = await runOf(keeper);
  assert.doesNotMatch(rec.system, /Mentioned in this message/);
  await srv.finished(r.data.id);
});

test('a Chief message gets the note, with the whole library', async () => {
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Give @tone to @TodoKeeper' } });
  await waitFor(async () => { const c = (await srv.api(`/chief/chats/${chat.id}`)).data; return !c.busy && !c.messages.at(-1).pending; }, { what: 'the Chief to reply' });
  const turn = srv.runs().filter((x) => x.args.includes('🧭 Chief of Staff')).at(-1);
  assert.match(turn.system, /@tone is the skill tone in the library: The owner's tone\./);
  assert.match(turn.system, /@TodoKeeper is the bot Todo Keeper \(id [^)]+\): Do the test task\./);
  assert.equal(turn.stdin.trim(), 'Give @tone to @TodoKeeper');
});

test("mentioning a bot it may not message only gives the note: nothing is sent, run or granted", async () => {
  const doctorRuns = (await srv.api(`/runs?botId=${doctor.id}`)).data.length;
  const r = await srv.api(`/bots/${quiet.id}/run`, { method: 'POST', body: { prompt: 'Tell @FleetDoctor the disks are full' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const rec = await runOf(quiet);
  assert.match(rec.system, /@FleetDoctor is the bot Fleet Doctor/);
  assert.equal(rec.self.env.SELF_TEAM, '0', 'still no tools to message other bots');
  await srv.finished(r.data.id);

  assert.equal((await srv.api(`/runs?botId=${doctor.id}`)).data.length, doctorRuns, 'Fleet Doctor was not started');
  assert.deepEqual((await srv.api(`/bots/${doctor.id}/inbox`)).data, [], 'nor left a note');
  const after = (await srv.api(`/bots/${quiet.id}`)).data;
  assert.deepEqual(after.mayMessage, []);
  assert.equal(after.mayMessageAll, false);
});
