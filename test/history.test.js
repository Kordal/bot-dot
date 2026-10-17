// Run history and JSON files (lib/jsonfile.js, bots.js run index): lists come from an index in memory and read
// only the runs they return, files are written whole, and a damaged file is kept aside instead of emptied.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, makeBot, waitFor } = require('./helpers');
const { readJson, writeJson } = require('../lib/jsonfile');

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-test-'));
const stamp = (d) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14);

test('jsonfile: written whole, a missing file is the fallback, a damaged one is kept aside', () => {
  const dir = scratch();
  const file = path.join(dir, 'sub', 'x.json');
  assert.deepEqual(readJson(file, []), []);
  writeJson(file, { a: 1 });
  assert.deepEqual(readJson(file, null), { a: 1 });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['x.json'], 'no temp file left');
  fs.writeFileSync(file, '{"a": ');
  assert.deepEqual(readJson(file, {}), {});
  const kept = fs.readdirSync(path.dirname(file)).find((f) => f.startsWith('x.json.broken-'));
  assert.ok(kept, 'kept aside');
  assert.equal(fs.readFileSync(path.join(path.dirname(file), kept), 'utf8'), '{"a": ');
  assert.ok(!fs.existsSync(file));
});

test('the run list is the same as reading every file, and reads only the runs it returns', async () => {
  const dir = scratch();
  const runs = path.join(dir, 'data', 'runs');
  fs.mkdirSync(runs, { recursive: true });
  const bots = ['a1', 'b2', 'c3'];
  const t0 = Date.UTC(2026, 0, 1);
  const metas = [];
  for (let i = 0; i < 300; i++) {
    const at = new Date(t0 + Math.floor(i / 3) * 60_000); // three runs share each start time
    const id = `${stamp(at)}-${i.toString(16).padStart(6, '0')}`;
    const m = { id, botId: bots[i % 3], botName: bots[i % 3], trigger: 'manual', prompt: `run ${i}`, status: i % 50 === 7 ? 'running' : 'success', startedAt: at.toISOString(), endedAt: at.toISOString(), result: 'ok' };
    metas.push(m);
    fs.writeFileSync(path.join(runs, `${id}.json`), JSON.stringify(m));
  }
  // The oldest run is damaged: a list of the newest never reads it, so it stays as it is.
  const oldest = path.join(runs, `${metas[0].id}.json`);
  const srv = await startServer({ dir });
  try {
    fs.writeFileSync(oldest, '{"broken');
    // What reading every file gives: newest first (ties by id), runs left "running" now interrupted.
    const all = fs.readdirSync(runs).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(runs, f), 'utf8')); } catch { return null; } }).filter(Boolean)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
    assert.ok(all.every((m) => m.status !== 'running'), 'interrupted at start');
    const ids = (list) => list.map((m) => `${m.id} ${m.status}`);
    assert.deepEqual(ids((await srv.api('/runs?limit=20')).data), ids(all.slice(0, 20)));
    assert.deepEqual(ids((await srv.api('/runs')).data), ids(all.slice(0, 100)));
    assert.deepEqual(ids((await srv.api('/runs?botId=b2&limit=15')).data), ids(all.filter((m) => m.botId === 'b2').slice(0, 15)));
    // ?before=: the page after that run (a chat scrolled up), and nothing for a run that isn't in the list.
    const b2 = all.filter((m) => m.botId === 'b2');
    assert.deepEqual(ids((await srv.api(`/runs?botId=b2&limit=15&before=${b2[14].id}`)).data), ids(b2.slice(15, 30)));
    assert.deepEqual((await srv.api(`/runs?botId=b2&before=${all.find((m) => m.botId === 'a1').id}`)).data, []);
    assert.equal(fs.readFileSync(oldest, 'utf8'), '{"broken', 'not read for these lists');
    // A new run shows at the top, and its status follows it.
    const bot = await makeBot(srv);
    const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Hi' } });
    await srv.finished(r.data.id);
    const top = (await srv.api('/runs?limit=1')).data[0];
    assert.equal(top.id, r.data.id);
    assert.equal(top.status, 'success');
    assert.equal((await srv.api('/bots')).data.find((b) => b.id === bot.id).state, 'idle');
  } finally { await srv.stop(); }
});

test('damaged inbox, wait and reminder files are kept aside, and botdot carries on', async () => {
  const dir = scratch();
  const data = path.join(dir, 'data');
  fs.mkdirSync(path.join(data, 'inbox'), { recursive: true });
  fs.writeFileSync(path.join(data, 'awaits.json'), '[{"runId": ');
  fs.writeFileSync(path.join(data, 'reminders.json'), 'not json');
  const srv = await startServer({ dir });
  try {
    const bot = await makeBot(srv);
    fs.writeFileSync(path.join(data, 'inbox', `${bot.id}.json`), '[{"text": "half');
    assert.deepEqual((await srv.api(`/bots/${bot.id}/inbox`)).data, []);
    assert.deepEqual((await srv.api('/chief/reminders')).data, []);
    await waitFor(() => ['awaits.json', 'reminders.json'].every((f) => fs.readdirSync(data).some((x) => x.startsWith(`${f}.broken-`))), { what: 'the damaged files to be kept aside' });
    assert.ok(fs.readdirSync(path.join(data, 'inbox')).some((f) => f.startsWith(`${bot.id}.json.broken-`)));
    assert.match(srv.log.join(''), /awaits\.json couldn't be read/);
  } finally { await srv.stop(); }
});
