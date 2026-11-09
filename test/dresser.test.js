// The dresser (lib/dresser.js): bots without an icon get one from the kit, picked by Claude in the
// background (ADR 169). Its rules on their own (which bots, what counts as an answer, how it
// waits after a failure), then on a real server with the stand-in Claude: bots from before the tile get an
// icon after the start, a new bot shortly after it is made, and nothing shows of it but the outfit.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, feed, waitFor, sleep, writeData } = require('./helpers');
const { create, question, parse, chosen, BATCH, TRIES } = require('../lib/dresser');

// A list of bots as the dresser sees it, and what it stored.
function store(list) {
  const all = list.map((b) => ({ description: '', prompt: 'Do the task.', outfit: null, ...b }));
  return {
    all,
    saves: 0,
    list: () => structuredClone(all),
    dress(outfits) {
      const done = all.filter((b) => !b.outfit?.icon && Object.hasOwn(outfits, b.id));
      for (const b of done) b.outfit = { hat: b.outfit?.hat ?? '', ...outfits[b.id] };
      if (done.length) this.saves++;
      return done.map((b) => b.id);
    },
  };
}
const idsIn = (prompt) => JSON.parse(prompt.split('\n\n').find((p) => p.startsWith('[{'))).map((b) => b.id);
const quiet = () => {};
const iconOf = (b) => b.outfit?.icon;

test('the question names the icons, the bots and the icons already taken, and nothing else of a bot', () => {
  const q = question(
    [{ id: 'a1', name: 'Mail Keeper', description: 'Sorts my mail', prompt: 'Check the inbox. '.repeat(100), allowedTools: ['Bash'], systemPrompt: 'secret rules' }],
    [{ id: 'b2', outfit: { hat: 'cap', icon: 'mail' } }, { id: 'c3', outfit: { hat: '' } }, { id: 'd4', outfit: { hat: { shapes: [] } } }, { id: 'e5', outfit: { hat: 'chef', icon: 'food' } }, { id: 'a1', outfit: null }],
  );
  assert.match(q, /Icons: compass \(/);
  assert.match(q, /already have: mail, food\./);
  assert.match(q, /shown as a small tile in its colour with an icon on it/);
  assert.match(q, /"compass" is the Chief of Staff's, so no bot gets it/);
  assert.doesNotMatch(q, /\bhats?\b|\bhold|stick figure/i, 'only the icon is asked for');
  assert.match(q, /\{"<id>": \{"icon": "<an icon's name>"\}\}$/);
  assert.deepEqual(idsIn(q), ['a1']);
  const sent = JSON.parse(q.split('\n\n').find((p) => p.startsWith('[{')))[0];
  assert.deepEqual(Object.keys(sent), ['id', 'name', 'does']);
  assert.ok(sent.does.startsWith('Sorts my mail · Check the inbox.') && sent.does.length <= 401, 'the task is cut short');
  assert.doesNotMatch(q, /secret rules|Bash/);
});

test('an answer: JSON, also with words or a fence around it; an icon only by a name from the kit, and nothing else of the answer', () => {
  assert.deepEqual(parse('```json\n{"a":{"icon":"mail"}}\n```'), { a: { icon: 'mail' } });
  assert.deepEqual(parse('Here you go: {"a":1} Hope it fits.'), { a: 1 });
  for (const bad of ['Done.', '', '[1,2]', '{"a":', '}{', 'null']) assert.throws(() => parse(bad), /the answer was not/);
  const a = { ok: { icon: 'mail', extra: 1 }, hat: { icon: 'mail', hat: 'crown' }, onlyHat: { hat: 'cap' }, none: { icon: '' }, unknown: { icon: 'helmet' }, drawn: { icon: { shapes: [] } }, proto: { icon: 'constructor' }, list: ['mail'], text: 'mail' };
  assert.deepEqual(chosen(a, 'ok'), { icon: 'mail' });
  assert.deepEqual(chosen(a, 'hat'), { icon: 'mail' }, 'a hat in an answer is left out: the dresser never changes one');
  for (const id of ['onlyHat', 'none', 'unknown', 'drawn', 'proto', 'list', 'text', 'missing', 'constructor', '__proto__']) assert.equal(chosen(a, id), null, id);
});

test('bots without an icon get one in one question, keeping their hat; a chosen icon is left alone', async () => {
  const s = store([{ id: 'a', name: 'Mail' }, { id: 'b', name: 'Servers', outfit: { hat: 'hard-hat' } }, { id: 'c', name: 'Bare', outfit: { hat: '' } }, { id: 'd', name: 'Chosen', outfit: { hat: 'crown', icon: 'chart' } }]);
  const asked = [];
  const d = create({ bots: s, soon: 5, first: 50, longest: 200, log: quiet, ask: async (p) => { asked.push(idsIn(p)); return JSON.stringify({ a: { icon: 'mail' }, b: { icon: 'server' }, c: { icon: 'spark' }, d: { icon: 'food' } }); } });
  d.nudge();
  d.nudge(); // a second nudge starts nothing more
  await waitFor(() => iconOf(s.all[2]));
  await sleep(120);
  assert.deepEqual(asked, [['a', 'b', 'c']]);
  assert.deepEqual(s.all.map((b) => b.outfit), [{ hat: '', icon: 'mail' }, { hat: 'hard-hat', icon: 'server' }, { hat: '', icon: 'spark' }, { hat: 'crown', icon: 'chart' }]);
  assert.equal(d.waitMs(), 0);
  d.nudge(); // nothing left: no question
  await sleep(40);
  assert.equal(asked.length, 1);
});

test('an icon that is not in the kit is dropped for that bot only; it is asked about again later, and not for ever', async () => {
  const s = store([{ id: 'a', name: 'Mail' }, { id: 'b', name: 'Knight' }]);
  const asked = [];
  const logged = [];
  const d = create({ bots: s, soon: 5, first: 10, longest: 20, log: (m) => logged.push(m), ask: async (p) => { asked.push(idsIn(p)); return JSON.stringify({ a: { icon: 'mail' }, b: { icon: 'helmet' } }); } });
  d.nudge();
  await waitFor(() => iconOf(s.all[0]));
  assert.equal(s.all[1].outfit, null);
  await waitFor(() => asked.length === TRIES);
  await sleep(150);
  assert.deepEqual(asked, [['a', 'b'], ...Array(TRIES - 1).fill(['b'])], 'the other tries ask only about the bot still plain, and they end');
  assert.equal(s.all[1].outfit, null);
  assert.equal(logged.filter((m) => /no usable icon for Knight/.test(m)).length, 1);
  d.nudge(); // it is left plain now
  await sleep(40);
  assert.equal(asked.length, TRIES);
});

test('a bot dressed while Claude was thinking keeps what it was given', async () => {
  const s = store([{ id: 'a', name: 'Mail' }]);
  const d = create({ bots: s, soon: 5, first: 50, longest: 200, log: quiet, ask: async () => { s.all[0].outfit = { hat: '', icon: 'pen' }; return JSON.stringify({ a: { icon: 'mail' } }); } });
  d.nudge();
  await sleep(80);
  assert.deepEqual(s.all[0].outfit, { hat: '', icon: 'pen' });
  assert.equal(d.waitMs(), 0);
});

test('a failing Claude leaves bots plain; retries wait longer each time, keep their time, and dressing follows once it works', async () => {
  const s = store([{ id: 'a', name: 'Mail' }]);
  const at = [];
  let works = false;
  const d = create({ bots: s, soon: 5, first: 40, longest: 160, log: quiet, ask: async () => { at.push(Date.now()); if (!works) throw new Error('Not logged in'); return '{"a":{"icon":"mail"}}'; } });
  d.nudge();
  const nudging = setInterval(() => d.nudge(), 2); // the bots changing meanwhile must not hurry a retry
  await waitFor(() => at.length === 5, { timeout: 5000 });
  clearInterval(nudging);
  const gaps = at.slice(1).map((t, i) => t - at[i]);
  assert.ok(gaps[0] >= 35 && gaps[1] >= 75 && gaps[2] >= 155 && gaps[3] >= 155, `gaps grow to the longest wait: ${gaps}`);
  assert.ok(gaps[3] < 400, `and no further: ${gaps}`);
  assert.equal(s.all[0].outfit, null);
  assert.equal(d.waitMs(), 160);
  works = true;
  await waitFor(() => iconOf(s.all[0]));
  assert.deepEqual(s.all[0].outfit, { hat: '', icon: 'mail' });
  assert.equal(d.waitMs(), 0);
  await sleep(200);
  assert.equal(at.length, 6, 'nothing more is asked once all are dressed');
});

test('an answer that can\'t be read is Claude failing: nothing is held against the bots, and they are dressed once it answers properly', async () => {
  const s = store([{ id: 'a', name: 'Mail' }]);
  let asked = 0;
  const d = create({ bots: s, soon: 2, first: 4, longest: 8, log: quiet, ask: async () => (++asked <= TRIES + 3 ? 'Usage limit reached.' : '{"a":{"icon":"mail"}}') });
  d.nudge();
  await waitFor(() => iconOf(s.all[0]));
  assert.equal(asked, TRIES + 4);
});

test('a rejection that is no Error does not stop the dresser', async () => {
  const s = store([{ id: 'a', name: 'Mail' }]);
  let asked = 0;
  // eslint-disable-next-line no-throw-literal
  const d = create({ bots: s, soon: 2, first: 4, longest: 8, log: quiet, ask: async () => { if (++asked < 3) throw undefined; return '{"a":{"icon":"mail"}}'; } });
  d.nudge();
  await waitFor(() => iconOf(s.all[0]));
});

test('a new bot is not held up by the retry for a bot whose answer was dropped, and is while Claude can\'t be reached, until it is signed in again', async () => {
  const s = store([{ id: 'a', name: 'Knight' }]);
  let works = true;
  const asked = [];
  const d = create({ bots: s, soon: 5, first: 600, longest: 600, log: quiet, ask: async (p) => { asked.push(idsIn(p)); if (!works) throw new Error('Not logged in'); return JSON.stringify({ a: { icon: 'helmet' }, b: { icon: 'mail' }, c: { icon: 'food' } }); } });
  d.nudge();
  await waitFor(() => asked.length === 1);
  await sleep(20); // Knight's answer was dropped: its retry waits 600 ms
  d.signedIn(); // Claude was never away: this hurries nothing
  await sleep(30);
  assert.equal(asked.length, 1);
  s.all.push({ id: 'b', name: 'Mail', description: '', prompt: 'x', outfit: null });
  const t0 = Date.now();
  d.nudge();
  for (let i = 0; i < 5; i++) d.nudge(); // more nudges don't push it back
  await waitFor(() => iconOf(s.all[1]));
  assert.ok(Date.now() - t0 < 300, 'dressed shortly after, not after the retry');
  assert.deepEqual(asked[1], ['b', 'a']);

  works = false;
  s.all.push({ id: 'c', name: 'Cook', description: '', prompt: 'x', outfit: null });
  await waitFor(() => asked.length === 3, { timeout: 3000 }); // the retry for Knight, and Cook with it: Claude is away
  s.all.push({ id: 'e', name: 'Extra', description: '', prompt: 'x', outfit: null });
  d.nudge();
  await sleep(100);
  assert.equal(asked.length, 3, 'while Claude is away a new bot does not hurry the retry');
  works = true;
  d.signedIn();
  await waitFor(() => iconOf(s.all[2]), { timeout: 300, what: 'dressing right after Claude is signed in again' });
  d.stop();
});

test('a long list is asked about in batches, one after the other', async () => {
  const s = store(Array.from({ length: BATCH * 2 + 3 }, (_, i) => ({ id: `b${i}`, name: `Bot ${i}` })));
  const sizes = [];
  let open = 0;
  const d = create({ bots: s, soon: 2, first: 500, longest: 500, log: quiet, ask: async (p) => { assert.equal(++open, 1); const ids = idsIn(p); sizes.push(ids.length); await sleep(5); open--; return JSON.stringify(Object.fromEntries(ids.map((id) => [id, { icon: 'mail' }]))); } });
  d.nudge();
  await waitFor(() => s.all.every(iconOf));
  assert.deepEqual(sizes, [BATCH, BATCH, 3]);
  assert.equal(s.saves, 3, 'a batch is saved once');
});

// ---------- on a real server ----------

const WAITS = '150,400,1500'; // soon, the first retry, the longest wait (ms)
const outfitsOf = async (srv) => Object.fromEntries((await srv.api('/bots')).data.map((b) => [b.name, b.outfit]));
// Everything a person could see of the dressing, were it shown anywhere.
async function visible(srv) {
  return { runs: (await srv.api('/runs')).data.length, chats: (await srv.api('/chief')).data.chats.length };
}

test('server: bots from before the tile get an icon after the start, a new one after it is made, and nothing else shows', async () => {
  // Bots as an older botdot saved them: no outfit at all, a hat without an icon, or one with an icon already.
  let srv = await startServer();
  const mail = await makeBot(srv, { name: 'Mail Keeper', description: 'Sorts the mail' });
  const servers = await makeBot(srv, { name: 'Server Check', description: 'Checks the servers every morning' });
  const knight = await makeBot(srv, { name: 'Knight', description: 'Guards the gate' });
  const bare = await makeBot(srv, { name: 'Bare', outfit: { hat: '' } });
  const set = await makeBot(srv, { name: 'Set', outfit: { hat: 'crown', icon: 'chart' } });
  const { dir } = srv;
  await sleep(400);
  assert.equal(srv.runs().length, 0, 'switched off, the dresser asks nothing');
  await srv.stop();
  const file = path.join(srv.data, 'bots.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const b of saved) if (!['Bare', 'Set'].includes(b.name)) delete b.outfit;
  // One as the stick-figure build left it: a held object and no hat. Nothing of that is left, so it is dressed too.
  saved.find((b) => b.name === 'Server Check').outfit = { hat: '', holds: 'wrench' };
  writeData(file, saved);
  fs.writeFileSync(path.join(srv.out, 'result.txt'), `Here are the icons:\n${JSON.stringify({
    [mail.id]: { icon: 'mail' },
    [servers.id]: { icon: 'server' },
    [knight.id]: { icon: 'helmet' }, // no such icon in the kit
    [bare.id]: { icon: 'spark', hat: 'chef' }, // the hat is never changed
    [set.id]: { icon: 'food' }, // never asked for
  })}`);

  // Claude's answer is held until the feed below is open and the bots are read, so no machine's speed decides the order.
  srv.hold();
  srv = await startServer({ dir, env: { BOT_DOT_DRESS_WAITS: WAITS } });
  try {
    const live = await feed(srv);
    await live.wait('hello');
    assert.deepEqual(await outfitsOf(srv), { 'Mail Keeper': null, 'Server Check': null, Knight: null, Bare: { hat: '' }, Set: { hat: 'crown', icon: 'chart' } }, 'old bots read as never dressed');
    srv.unhold();
    await live.wait('bots'); // an open app hears of it, with no reload
    await waitFor(async () => (await outfitsOf(srv)).Bare?.icon);
    assert.deepEqual(await outfitsOf(srv), { 'Mail Keeper': { hat: '', icon: 'mail' }, 'Server Check': { hat: '', icon: 'server' }, Knight: null, Bare: { hat: '', icon: 'spark' }, Set: { hat: 'crown', icon: 'chart' } });
    const before = (await srv.api(`/bots/${mail.id}`)).data;
    assert.equal(before.updatedAt, saved.find((b) => b.id === mail.id).updatedAt, 'it is nobody\'s edit');

    // How Claude was asked: as the Chief's user in the Chief's folder, with no tools, nothing kept.
    const rec = await srv.nextRun();
    assert.equal(fs.realpathSync(rec.cwd), fs.realpathSync(path.join(srv.data, 'workspaces', '_chief')));
    assert.equal(rec.args[rec.args.indexOf('--tools') + 1], '');
    assert.ok(rec.args.includes('--strict-mcp-config') && rec.args.includes('--no-session-persistence') && !rec.args.includes('--allowedTools'));
    assert.deepEqual([rec.self, rec.botdot, rec.connectors], [null, null, null]);
    assert.deepEqual(JSON.parse(rec.stdin.split('\n\n').find((p) => p.startsWith('[{'))).map((b) => b.name), ['Mail Keeper', 'Server Check', 'Knight', 'Bare']);

    // A bot made without an icon gets one shortly after; one made with an icon is not asked about.
    const news = await makeBot(srv, { name: 'News Reader', description: 'Reads the news' });
    await makeBot(srv, { name: 'Chosen', outfit: { icon: 'pen' } });
    srv.reply(JSON.stringify({ [news.id]: { icon: 'news' }, [knight.id]: { icon: 'shield' } }));
    await waitFor(async () => (await outfitsOf(srv))['News Reader']);
    await waitFor(async () => (await outfitsOf(srv)).Knight, { what: 'the bot dropped before to get an icon on a later try' });
    assert.deepEqual(await outfitsOf(srv), { 'Mail Keeper': { hat: '', icon: 'mail' }, 'Server Check': { hat: '', icon: 'server' }, Knight: { hat: '', icon: 'shield' }, Bare: { hat: '', icon: 'spark' }, Set: { hat: 'crown', icon: 'chart' }, 'News Reader': { hat: '', icon: 'news' }, Chosen: { hat: '', icon: 'pen' } });

    // Nothing of it is a run, a chat, a notification or something that needs the owner.
    await sleep(300);
    assert.deepEqual(await visible(srv), { runs: 0, chats: 0 });
    assert.deepEqual([...new Set(live.events.map((e) => e.type))], ['hello', 'bots'], 'the feed says only that the bots changed');
    const hello = await (async () => { // where things stand, as an app opening now is told
      const r = (await fetch(`${srv.base}/api/events`)).body.getReader();
      for (let buf = ''; ;) {
        buf += Buffer.from((await r.read()).value).toString();
        const m = buf.match(/event: hello\ndata: (.*)\n\n/);
        if (m) { r.cancel(); return JSON.parse(m[1]); }
      }
    })();
    assert.deepEqual([hello.running, hello.chiefBusy, hello.asks, hello.loginRequests, hello.approvals.jobs, hello.plans], [[], false, [], [], [], []]);
    assert.ok(srv.runs().length && srv.runs().every((r) => r.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === '1'), 'Claude Code sends no non-essential traffic (#205)');
    const quietNow = srv.runs().length;
    await sleep(600);
    assert.equal(srv.runs().length, quietNow, 'with every bot dressed, Claude is asked nothing more');
    live.close();
  } finally {
    await srv.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('server: with Claude failing the bots stay plain and all else works; retries wait longer; dressing follows once Claude works', async () => {
  const srv = await startServer({ env: { BOT_DOT_DRESS_WAITS: WAITS } });
  try {
    fs.writeFileSync(path.join(srv.out, 'fail.txt'), 'Not logged in · Please run /login');
    const bot = await makeBot(srv, { name: 'Backup Bot', description: 'Backs up the photos' });
    await sleep(2600); // soon 150, then waits of 400, 800 and 1500: four tries fit, a tight loop would make hundreds
    const tries = srv.runs().length;
    assert.ok(tries >= 2 && tries <= 4, `tries so far: ${tries}`);
    assert.equal((await srv.api(`/bots/${bot.id}`)).data.outfit, null);
    assert.equal((await srv.api('/runs')).data.length, 0, 'a failed try is no failed run');
    // The rest of botdot is as usual: the bot can be changed, and dressed by hand.
    const other = await makeBot(srv, { name: 'Other', outfit: { icon: 'mail' } });
    assert.equal((await srv.api(`/bots/${other.id}`, { method: 'PUT', body: { description: 'Changed' } })).data.description, 'Changed');
    assert.match(srv.log.join(''), /\[dresser\] Claude couldn't be asked for icons: Not logged in/);

    fs.rmSync(path.join(srv.out, 'fail.txt'));
    srv.reply(JSON.stringify({ [bot.id]: { icon: 'shield' } }));
    const dressed = await waitFor(async () => (await srv.api(`/bots/${bot.id}`)).data.outfit, { timeout: 5000, what: 'the bot to get an icon once Claude works' });
    assert.deepEqual(dressed, { hat: '', icon: 'shield' });
    assert.equal((await srv.api('/runs')).data.length, 0);
  } finally {
    await srv.stop();
    fs.rmSync(srv.dir, { recursive: true, force: true });
  }
});
