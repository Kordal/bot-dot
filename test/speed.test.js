// What keeps botdot light: screenshots kept apart from run logs, waiting for a run without polling,
// compressed and cached answers, and a quick cron.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, feed, sleep } = require('./helpers');
const cron = require('../lib/cron');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(async () => { srv.unhold(); await srv.stop(); });

// A tiny PNG, as a computer tool's screenshot would come back.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
// Claude Code repeats the tool's answer in tool_use_result.
const shot = () => [{ type: 'text', text: 'Clicked.' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } }];
const shotEvent = (id) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: shot() }] }, tool_use_result: shot() });
const imagesOf = (events) => events.filter((e) => e.type === 'user').flatMap((e) => e.message.content.flatMap((c) => (Array.isArray(c.content) ? c.content : []).filter((x) => x.type === 'image')));

test("a run's screenshots are kept as files, not inside its log", async () => {
  const bot = await makeBot(srv, { name: 'Shooter' });
  fs.writeFileSync(path.join(srv.out, 'events.json'), JSON.stringify([shotEvent('t1'), shotEvent('t2')]));
  try {
    const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Look' } })).data;
    await srv.finished(run.id);
    const log = fs.readFileSync(path.join(srv.data, 'runs', `${run.id}.ndjson`), 'utf8');
    assert.ok(!log.includes(PNG.toString('base64')), 'no image data in the log');
    const imgs = imagesOf((await srv.api(`/runs/${run.id}`)).data.events);
    assert.equal(imgs.length, 2);
    assert.match(imgs[0].source.url, new RegExp(`^/api/runs/${run.id}/images/img-[0-9a-f]{16}\\.png$`));
    const res = await fetch(`${srv.base}${imgs[0].source.url}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.match(res.headers.get('cache-control'), /immutable/);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
    // Names that aren't a run's images get nowhere.
    assert.equal((await srv.api(`/runs/${run.id}/images/..%2F${run.id}.json`)).status, 404);
    assert.equal((await srv.api(`/runs/${run.id}/images/img-0000000000000000.png`)).status, 404);
    // The phone lists them: the run says it has some, and the list has each picture once (both were the same).
    assert.equal((await srv.api(`/runs/${run.id}?events=0`)).data.screenshots, 1);
    assert.deepEqual((await srv.api(`/runs/${run.id}/images`)).data.images, [imgs[0].source.url]);
  } finally { fs.rmSync(path.join(srv.out, 'events.json'), { force: true }); }
});

test('a log from before keeps working, and its images move out the first time it is read', async () => {
  const bot = await makeBot(srv, { name: 'Old Shooter' });
  const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Look' } })).data;
  await srv.finished(run.id);
  const file = path.join(srv.data, 'runs', `${run.id}.ndjson`);
  fs.appendFileSync(file, `${JSON.stringify(shotEvent('old'))}\n`); // as botdot wrote them before
  const imgs = imagesOf((await srv.api(`/runs/${run.id}`)).data.events);
  assert.equal(imgs.length, 1);
  assert.ok(imgs[0].source.url);
  assert.ok(!fs.readFileSync(file, 'utf8').includes('"type":"base64"'), 'the log was slimmed');
  assert.equal((await fetch(`${srv.base}${imgs[0].source.url}`)).status, 200);
});

test('a run can be read without its log, and waited for without polling', async () => {
  const bot = await makeBot(srv, { name: 'Waiter' });
  srv.hold();
  const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Slowly' } })).data;
  const rec = await srv.nextRun((r) => r.stdin.includes('Slowly'));
  const light = (await srv.asChief(`/runs/${run.id}?events=0`)).data;
  assert.equal(light.id, run.id);
  assert.equal(light.events, undefined);
  // Still running: it answers when the time is up. So does a call for a run that waits its turn behind it
  // (ADR 011), in that same second: with the run as it waits.
  const behind = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Afterwards' } })).data;
  assert.equal(behind.status, 'queued');
  const t0 = Date.now();
  const [early, notYet] = await Promise.all([srv.asChief(`/runs/${run.id}/wait?timeout=1`), srv.asChief(`/runs/${behind.id}/wait?timeout=1&seen=chief`)]);
  assert.equal(early.status, 200);
  assert.equal(early.data.status, 'running');
  assert.ok(Date.now() - t0 >= 900, 'it waited');
  assert.deepEqual([notYet.status, notYet.data.id, notYet.data.status, notYet.data.chiefSaw], [200, behind.id, 'queued', undefined], 'held as long, and answered as it waits');
  assert.equal((await srv.api(`/bots/${bot.id}/queued/${behind.id}`, { method: 'DELETE' })).status, 200); // taken back: nothing follows
  // It ends while the call waits: the answer comes then.
  const waiting = srv.asChief(`/runs/${run.id}/wait?timeout=30&seen=chief`);
  await sleep(300);
  srv.unhold();
  srv.release(rec);
  const done = await waiting;
  assert.equal(done.data.status, 'success');
  assert.equal(done.data.chiefSaw, true);
  // An ended run answers at once.
  assert.equal((await srv.api(`/runs/${run.id}/wait?timeout=30`)).data.status, 'success');
});

test('the page and long answers are compressed, and the page is cached until it changes', async () => {
  const page = await fetch(`${srv.base}/app.js`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('content-encoding'), 'gzip');
  assert.equal(page.headers.get('cache-control'), 'no-cache');
  const etag = page.headers.get('etag');
  assert.ok(etag);
  assert.equal((await page.text()).length, fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8').length);
  assert.equal((await fetch(`${srv.base}/app.js`, { headers: { 'If-None-Match': etag } })).status, 304);
  const html = await fetch(`${srv.base}/`);
  assert.match(html.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(`${srv.base}/nope.js`)).status, 404);
  assert.equal((await fetch(`${srv.base}/..%2Fserver.js`)).status, 404);
  for (let i = 0; i < 3; i++) await makeBot(srv, { name: `Filler ${i}`, description: 'x'.repeat(400) });
  const list = await fetch(`${srv.base}/api/bots`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(list.headers.get('content-encoding'), 'gzip');
  assert.ok(Array.isArray(await list.json()));
});

test('the feed tells about a new login request straight away', async () => {
  const f = feed(srv);
  try {
    const bot = await makeBot(srv, { name: 'Needy' });
    await sleep(300);
    const t0 = Date.now();
    await srv.asChief('/vault/requests', { method: 'POST', body: { site: 'example.com', forBot: bot.id, reason: 'test' } });
    await f.wait('login_request', (d) => d.botId === bot.id);
    assert.ok(Date.now() - t0 < 2000, 'not on a slow timer');
  } finally { f.close(); }
});

test('cron.next skips ahead but finds the same minute as trying every one', () => {
  const slow = (expr, from) => {
    const d = new Date(from);
    d.setSeconds(0, 0);
    for (let i = 0; i < 525600; i++) { d.setMinutes(d.getMinutes() + 1); if (cron.matches(expr, d)) return d; }
    return null;
  };
  const exprs = ['*/15 * * * *', '0 9 * * *', '30 7 * * 1-5', '0 9 1 * *', '0 0 31 * *', '5 4 * 3,9 2', '0 9 13 * 5', '59 23 31 12 *', '0 3 29 2 *'];
  const froms = [Date.UTC(2026, 0, 1, 0, 0, 30), Date.UTC(2026, 1, 28, 23, 59), Date.UTC(2026, 11, 31, 23, 59), Date.UTC(2027, 5, 15, 9, 0)];
  for (const e of exprs) for (const f of froms) assert.equal(cron.next(e, new Date(f))?.getTime() ?? null, slow(e, f)?.getTime() ?? null, `${e} from ${new Date(f).toISOString()}`);
});
