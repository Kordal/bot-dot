// Objectives that update themselves (#699, ADR 121): an objective's `source` names a connected app and what to read
// there; while the project runs, a read-only run of the Chief's own reads it each day (or week) and its number becomes
// `current`. The card shows when it last updated; a failed read is said once, not every day. The store's clock is set
// here; the server's tests use the stand-in for Claude and the stand-in connected app.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, fakeConnectedApp, writeData, waitFor } = require('./helpers');
const companyLib = require('../lib/company');

test('the number in a read: digits with a dot, thousands commas and a unit around it; FAILED or words are a failure', () => {
  assert.deepEqual(companyLib.numberOf('42'), { value: 42 });
  assert.deepEqual(companyLib.numberOf('Found 3 plans.\n1,234'), { value: 1234 });
  assert.deepEqual(companyLib.numberOf('$1 234.50'), { value: 1234.5 });
  assert.deepEqual(companyLib.numberOf('-3'), { value: -3 });
  assert.deepEqual(companyLib.numberOf('FAILED: no access to subscriptions'), { error: 'no access to subscriptions' });
  assert.deepEqual(companyLib.numberOf('FAILED'), { error: 'no number' });
  assert.deepEqual(companyLib.numberOf('about forty'), { error: 'the answer was not a number' });
  assert.deepEqual(companyLib.numberOf(''), { error: 'the answer was not a number' });
});

test('a source is kept on its objective, checked, read when due, and its failure is told once until it works again', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'objective-sources-'));
  let at = new Date('2026-10-01T09:00:00Z');
  const store = companyLib.create({ file: path.join(dir, 'company.json'), now: () => at });
  store.start({ start: 'fernhill.app' });
  store.patch({ objectives: [{ name: 'Paying users', target: 100, current: 0 }, { name: 'Launch page live' }] });
  const [paying] = store.read().objectives;
  assert.throws(() => store.setObjective(paying.id, { source: { app: 'Stripe!', what: 'x' } }), /slug of a connected app/);
  assert.throws(() => store.setObjective(paying.id, { source: { app: 'stripe', what: '  ' } }), /what to read/);
  assert.throws(() => store.setObjective(paying.id, { source: { app: 'stripe', what: 'x', every: 'hourly' } }), /daily or weekly/);
  let o = store.setObjective(paying.id, { source: { app: 'stripe', what: ' Active   subscriptions ' } }).objectives[0];
  assert.deepEqual(o.source, { app: 'stripe', what: 'Active subscriptions', every: 'daily' });
  assert.deepEqual(store.sourcesDue(at), [], 'not while it is set up');
  store.begin({});
  assert.deepEqual(store.sourcesDue(at).map((x) => x.id), [paying.id], 'a new source at once');

  let r = store.sourceRead(paying.id, { value: 17 }, at);
  o = r.company.objectives[0];
  assert.equal(r.told, false);
  assert.equal(o.current, 17);
  assert.deepEqual(o.history, [{ day: 1, value: 17 }]);
  assert.equal(o.source.readAt, at.toISOString());
  assert.deepEqual(store.sourcesDue(new Date('2026-10-02T08:59:00Z')), [], 'not before a day passed');
  at = new Date('2026-10-02T09:00:00Z');
  assert.equal(store.sourcesDue(at).length, 1);

  // Failures: the first is told, the next is not; a read that works clears it, and the next failure is told again.
  r = store.sourceRead(paying.id, { error: 'Stripe is not connected' }, at);
  assert.equal(r.told, true);
  assert.equal(r.company.objectives[0].source.failed, 'Stripe is not connected');
  assert.equal(r.company.objectives[0].current, 17, 'the number stays');
  assert.equal(r.company.objectives[0].source.readAt, '2026-10-01T09:00:00.000Z');
  at = new Date('2026-10-03T09:00:00Z');
  assert.equal(store.sourceRead(paying.id, { error: 'still not' }, at).told, false);
  at = new Date('2026-10-04T09:00:00Z');
  o = store.sourceRead(paying.id, { value: 20 }, at).company.objectives[0];
  assert.equal(o.source.failed, undefined);
  assert.equal(store.sourceRead(paying.id, { error: 'again' }, new Date('2026-10-05T09:00:00Z')).told, true);
  assert.match(store.promptNote(), /botdot reads it daily from stripe: Active subscriptions \(the last read failed: again\)/);

  // Weekly waits a week; the same source keeps its record, a changed one is read anew; null stops it.
  o = store.setObjective(paying.id, { source: { app: 'stripe', what: 'Active subscriptions', every: 'weekly' } }).objectives[0];
  assert.equal(o.source.failed, 'again');
  assert.deepEqual(store.sourcesDue(new Date('2026-10-11T09:00:00Z')), []);
  assert.equal(store.sourcesDue(new Date('2026-10-12T09:00:00Z')).length, 1);
  o = store.setObjective(paying.id, { source: { app: 'stripe', what: 'Paid invoices' } }).objectives[0];
  assert.deepEqual(o.source, { app: 'stripe', what: 'Paid invoices', every: 'weekly' });
  o = store.setObjective(paying.id, { source: null }).objectives[0];
  assert.equal(o.source, undefined);
  assert.throws(() => store.sourceRead(paying.id, { value: 1 }), { status: 404 });
  fs.rmSync(dir, { recursive: true, force: true });
});

let app, srv;
before(async () => {
  app = await fakeConnectedApp({ connected: ['stripe'] });
  srv = await startServer({ env: { ...app.env, BOT_DOT_SOURCES_EVERY_MS: '200' } });
  await app.connect(srv);
  await srv.api('/company', { method: 'POST', body: { start: 'fernhill.app' } });
  const co = (await srv.api('/company')).data.company;
  writeData(path.join(srv.data, 'company.json'), { ...co, phase: 'running', startedAt: new Date().toISOString(), objectives: [{ id: 'o1', name: 'Paying users', current: 0, target: 100 }, { id: 'o2', name: 'Weekly users', current: 5, target: 500 }] });
});
after(async () => { srv.unhold(); await srv.stop(); fs.rmSync(srv.dir, { recursive: true, force: true }); app.close(); });

const isRead = (x) => x.args.includes('🧭 Chief of Staff · objective');
const objective = async (id) => (await srv.api('/company')).data.company.objectives.find((o) => o.id === id);
const notices = async () => {
  const out = [];
  for (const c of (await srv.api('/chief')).data.chats || []) out.push(...(await srv.api(`/chief/chats/${c.id}`)).data.messages.filter((m) => m.notice));
  return out;
};

test('features name objective-sources', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('objective-sources'));
});

test("the owner sets a source; a read-only run of the Chief's with that one app reads it, and its number is current", async () => {
  assert.equal((await srv.api('/company/objectives/o1', { method: 'PUT', body: { source: { app: 'stripe', what: 'x', every: 'monthly' } } })).status, 400);
  srv.reply('Found the subscriptions.\n1,234');
  srv.hold();
  const r = await srv.api('/company/objectives/o1', { method: 'PUT', body: { source: { app: 'stripe', what: 'Active subscriptions' } } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const run = await srv.nextRun(isRead, 'the read');
  const arg = (flag) => run.args[run.args.indexOf(flag) + 1];
  assert.equal(arg('--tools'), '', 'no web, no built-in tool');
  assert.ok(run.args.includes('--no-session-persistence'));
  const mcp = JSON.parse(fs.readFileSync(arg('--mcp-config'), 'utf8'));
  assert.equal(mcp.mcpServers.botdot.env.BOT_DOT_LOOK, '1', "botdot's reading tools only");
  assert.equal(mcp.mcpServers.connectors.env.CONNECTOR_APPS, 'stripe', 'that one app');
  assert.match(run.stdin, /<what>\nActive subscriptions\n<\/what>/);
  assert.match(run.system, /answer with the number alone on the last line/);
  srv.unhold();
  srv.release(run);
  const o = await waitFor(async () => { const x = await objective('o1'); return x.source.readAt ? x : null; }, { what: 'the number read' });
  assert.equal(o.current, 1234);
  assert.equal(o.history.at(-1).value, 1234);
  assert.equal(o.source.failed, undefined);
  // Read today: not again on the next rounds.
  await new Promise((res) => setTimeout(res, 600));
  assert.equal((await objective('o1')).source.triedAt, o.source.triedAt);
});

test('a failed read is said once in the Chief chat and shown on the card; the next failure is not said again', async () => {
  srv.reply('FAILED: no access to analytics');
  const before = (await notices()).length;
  await srv.asChief('/company/objectives/o2', { method: 'PUT', body: { source: { app: 'stripe', what: 'Weekly users' } } });
  const o = await waitFor(async () => { const x = await objective('o2'); return x.source.failed ? x : null; }, { what: 'the failed read' });
  assert.equal(o.source.failed, 'no access to analytics');
  assert.equal(o.current, 5);
  const said = await waitFor(async () => { const n = await notices(); return n.length > before ? n : null; }, { what: 'the notice' });
  assert.match(said.at(-1).text, /"Weekly users" in Fernhill could not update from .+: no access to analytics\. botdot tries again tomorrow\./);
  // Its next read is due once a day passed: move its last try back and let it fail again.
  const file = path.join(srv.data, 'company.json');
  const co = JSON.parse(fs.readFileSync(file, 'utf8'));
  co.objectives.find((x) => x.id === 'o2').source.triedAt = '2020-01-01T00:00:00.000Z';
  writeData(file, co);
  await waitFor(async () => (await objective('o2')).source.triedAt !== '2020-01-01T00:00:00.000Z' || null, { what: 'the second read' });
  await new Promise((res) => setTimeout(res, 300));
  assert.equal((await notices()).length, before + 1, 'said once');
});

test('a disconnected app fails without a run; the owner stops a source with null', async () => {
  const r = await srv.api('/company/objectives/o2', { method: 'PUT', body: { source: { app: 'hubspot', what: 'Deals won' } } });
  assert.equal(r.status, 200);
  const o = await waitFor(async () => { const x = await objective('o2'); return x.source.app === 'hubspot' && x.source.failed ? x : null; }, { what: 'the failed read' });
  assert.match(o.source.failed, /is not connected/);
  const stopped = await srv.api('/company/objectives/o2', { method: 'PUT', body: { source: null } });
  assert.equal(stopped.data.objectives.find((x) => x.id === 'o2').source, undefined);
});
