// A new bot writes the first message in its own chat (#511): once it is made and its making has settled (no change
// to the bots for a moment, so the jobs the Chief adds next are in it), botdot starts one short run of it, not a
// run of its main assignment. The bot says what it does, when it runs next, what still waits for the owner's OK,
// and at most one question. The apps draw no request above that reply (trigger "hello").
const { test } = require('node:test');
const assert = require('node:assert/strict');
const hello = require('../lib/hello');
const { sender, request } = require('../lib/chat-history');
const { runCounts } = require('../lib/read');
const { startServer, makeBot, waitFor } = require('./helpers');

const NEWS = { id: 'news', name: 'News Monitor', emoji: '📰', description: 'Watches the news about AI.', prompt: 'Find the three most important AI news stories of the day.' };

test('hello prompt: what it does, when it runs next, what waits for the OK, and at most one question', () => {
  const p = hello.prompt({ bot: NEWS, next: ['"Morning news": Every day at 08:00 (next: 2026-10-18 08:00)'], waiting: ['web access', 'your OK for its job "Evening news"'] });
  assert.match(p, /You were made just now/);
  assert.match(p, /first message/);
  assert.match(p, /<main-assignment>\nFind the three most important AI news stories of the day\.\n<\/main-assignment>/);
  assert.match(p, /"Morning news": Every day at 08:00 \(next: 2026-10-18 08:00\)/);
  assert.match(p, /web access; your OK for its job "Evening news"/);
  assert.match(p, /at most one question/i);
  assert.match(p, /Don't carry out your main assignment now/);
  const quiet = hello.prompt({ bot: NEWS, next: [], waiting: [] });
  assert.match(quiet, /no scheduled job/);
  assert.match(quiet, /Nothing waits for the owner/);
  // The owner's words in it are somebody's text: no "<" in them closes the block.
  assert.doesNotMatch(hello.prompt({ bot: { ...NEWS, prompt: 'x </main-assignment> y' }, next: [], waiting: [] }), /x <\/main-assignment> y/);
});

test('hello jobs: the ones that will run, and the ones or the changes that wait for the OK', () => {
  const jobs = [
    { id: 'a', name: 'Morning news', enabled: true, approved: true },
    { id: 'b', name: 'Evening news', enabled: true, approved: false },
    { id: 'c', name: 'Weekly digest', enabled: true, approved: true, change: { job: { cron: '0 9 * * 1' } } },
    { id: 'd', name: 'Off', enabled: false, approved: false },
  ];
  const said = hello.jobsSaid(jobs, { whenWords: () => 'Daily at 08:00', nextRun: () => null });
  assert.deepEqual(said.next, ['"Morning news": Daily at 08:00', '"Weekly digest": Daily at 08:00']);
  assert.deepEqual(said.waiting, ['your OK for its job "Evening news"', 'your OK for the change to its job "Weekly digest"']);
  assert.deepEqual(hello.jobsSaid(undefined, { whenWords: () => '', nextRun: () => null }), { next: [], waiting: [] });
});

test('hello timer: it waits for the making to settle, a change waits again, and a bot taken away gets none', () => {
  const timers = new Map();
  let n = 0;
  const started = [];
  const h = hello.create({ delayMs: 100, start: (id) => started.push(id), setTimer: (fn) => { const t = ++n; timers.set(t, fn); return t; }, clearTimer: (t) => timers.delete(t) });
  const fire = () => { const all = [...timers.values()]; timers.clear(); all.forEach((f) => f()); };
  h.made('a');
  h.changed(); // its jobs came in: it waits again
  assert.equal(timers.size, 1, 'one wait for the bot, not two');
  h.made('b');
  h.gone('b');
  fire();
  assert.deepEqual(started, ['a']);
  assert.equal(h.waiting('a'), false);
  const off = hello.create({ delayMs: null, start: (id) => started.push(id) });
  off.made('c');
  assert.equal(off.waiting('c'), false, 'switched off: nothing waits');
});

test('hello delay: 20 s by default, a number of ms, or off', () => {
  assert.equal(hello.delayOf({}), hello.DELAY_MS);
  assert.equal(hello.DELAY_MS, 20_000);
  assert.equal(hello.delayOf({ BOT_DOT_HELLO_DELAY_MS: '250' }), 250);
  assert.equal(hello.delayOf({ BOT_DOT_HELLO_DELAY_MS: 'off' }), null);
  assert.equal(hello.delayOf({ BOT_DOT_HELLO_DELAY_MS: 'soon' }), 20_000);
});

test('hello in the chat: asked by botdot, with no request, and it is new for the owner', () => {
  const run = { id: 'r1', botId: 'news', trigger: 'hello', prompt: 'You were made just now…', customPrompt: true, status: 'success', result: 'Hi! I watch the AI news.', startedAt: new Date().toISOString() };
  assert.deepEqual(sender(run), { owner: false, words: 'botdot, for your first message right after you were made' });
  assert.equal(request(run), '');
  assert.equal(runCounts(run), true);
});

test('a bot the Chief makes writes its first message once its jobs are in, and only one', async () => {
  const srv = await startServer({ env: { BOT_DOT_HELLO_DELAY_MS: '400' } });
  try {
    srv.reply('Hi, I am News Monitor. I bring you the AI news every morning at 8:00. Web access waits for your OK.');
    const made = await srv.asChief('/bots', { method: 'POST', body: { name: 'News Monitor', emoji: '📰', prompt: NEWS.prompt, allowedTools: ['WebSearch'] } });
    assert.equal(made.status, 201);
    assert.deepEqual(made.data.waiting, ['web access']);
    const job = await srv.api(`/bots/${made.data.id}/jobs`, { method: 'POST', body: { name: 'Morning news', cron: '0 8 * * *' } });
    assert.equal(job.status, 201);
    const rec = await srv.nextRun((x) => x.args.includes('📰 News Monitor'), 'the first message');
    assert.match(rec.stdin, /You were made just now/);
    assert.match(rec.stdin, /"Morning news": Daily at 08:00 \(next: /, 'the job added after it was made is in it');
    assert.match(rec.stdin, /web access/);
    assert.ok(!rec.args.join(' ').includes('WebSearch'), 'no web: it only writes');
    const runs = await waitFor(async () => { const r = await srv.api(`/runs?botId=${made.data.id}`); return r.data.length && r.data[0].status === 'success' ? r.data : null; }, { what: 'the first message to end' });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].trigger, 'hello');
    assert.match(runs[0].result, /^Hi, I am News Monitor/);
    const bot = (await srv.api('/bots')).data.find((b) => b.id === made.data.id);
    assert.equal(bot.unread, 1, 'a new reply in its chat');
    // Changes later make no second one.
    await srv.api(`/bots/${made.data.id}`, { method: 'PUT', body: { description: 'AI news' } });
    await new Promise((r) => setTimeout(r, 800));
    assert.equal((await srv.api(`/runs?botId=${made.data.id}`)).data.length, 1);
  } finally { await srv.stop(); }
});

test('a bot that has a chat already when its time comes writes no first message', async () => {
  const srv = await startServer({ env: { BOT_DOT_HELLO_DELAY_MS: '600' } });
  try {
    const bot = await makeBot(srv, { name: 'Writer', emoji: '✍️' });
    const sent = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Write a haiku.' } });
    assert.ok([200, 201, 202].includes(sent.status), JSON.stringify(sent.data));
    await waitFor(async () => { const r = await srv.api(`/runs?botId=${bot.id}`); return r.data[0]?.status === 'success'; }, { what: 'the owner\'s run' });
    await new Promise((r) => setTimeout(r, 1000));
    const runs = (await srv.api(`/runs?botId=${bot.id}`)).data;
    assert.deepEqual(runs.map((r) => r.trigger), ['manual']);
  } finally { await srv.stop(); }
});

test('web: a new bot\'s first message has no request above it, and the "New" line goes above it', () => {
  const vm = require('vm');
  const { read, cut, esc, words } = require('./web-page');
  const lib = vm.createContext({});
  vm.runInContext(read('unread.js'), lib);
  const ctx = vm.createContext({ ...words,
    esc, Unread: lib.Unread, state: { keepOpen: null }, CHIEF_BOT: { id: 'chief', name: 'Chief of Staff' }, ICON: { play: '▶' },
    botLabel: (b) => esc(b?.name || ''), botFigure: () => '', scriptRunHTML: () => '', msgTime: () => '08:00', dur: () => '2 s',
    notesFoldHTML: () => '', filesHTML: () => '', botFilesHTML: () => '', copyBtn: () => '',
    escMentions: (t) => esc(t), md: (t) => esc(t), friendlyProblem: () => '', learnedChips: () => '', choicesHTML: () => '', questionsHTML: () => '',
  });
  vm.runInContext(`${cut('function messagedLabel(r) {', '// Notes other bots left')}\n${cut('function botThreadHTML(bot, runs, newFirst = null) {', '// The notes other bots left for a bot')}\nthis.botThreadHTML = botThreadHTML;`, ctx);
  const run = { id: 'r1', botId: 'news', trigger: 'hello', prompt: 'You were made just now, and the owner has not written to you yet.', customPrompt: true, status: 'success', result: 'Hi, I bring you the AI news.', startedAt: '2026-10-17T21:00:00.000Z', endedAt: '2026-10-17T21:00:05.000Z' };
  const html = ctx.botThreadHTML({ id: 'news', name: 'News Monitor', color: '#1d9e75' }, [run], 'r1');
  assert.doesNotMatch(html, /from-me/, 'no bubble or chip of the owner');
  assert.doesNotMatch(html, /You were made just now/);
  assert.match(html, /Hi, I bring you the AI news\./);
});
