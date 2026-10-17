// A scheduled run's opening line shows while the bot works, like any run's, and never reaches the owner
// as a notification or a report: only the `opening_line` event carries it. In a file of its own, because
// it waits for a real schedule (up to a minute).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, feed, waitFor } = require('./helpers');

test('a scheduled run\'s line is not sent as a notification or a report', { timeout: 60_000 }, async () => {
  const srv = await startServer();
  const f = feed(srv);
  try {
    srv.hold();
    srv.reply('Nothing new.');
    const LINE = 'Checking the parcel tracker';
    const bots = { reports: await makeBot(srv, { name: 'Reports' }), quiet: await makeBot(srv, { name: 'Quiet' }) };
    const jobs = {};
    for (const [k, bot] of Object.entries(bots)) jobs[k] = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: `Parcels ${k}`, cron: '* * * * *', prompt: `Check parcels ${k}` } })).data;
    await srv.tick();
    await waitFor(() => srv.runs().length >= 2, { timeout: 30_000, every: 100, what: 'the scheduled jobs' });
    const done = {};
    for (const [k, bot] of Object.entries(bots)) {
      const rec = srv.runs().find((r) => r.stdin.includes(`Check parcels ${k}`));
      await srv.api(`/bots/${bot.id}/jobs/${jobs[k].id}`, { method: 'PUT', body: { enabled: false } });
      const run = (await srv.api(`/runs?botId=${bot.id}`)).data[0];
      assert.equal(run.trigger, 'schedule');
      fs.writeFileSync(path.join(srv.out, `events-${rec.n}.json`), JSON.stringify([
        { type: 'assistant', message: { content: [{ type: 'text', text: `${LINE}.` }] } },
        { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'WebFetch', input: { url: 'https://example.com' } }] } },
      ]));
      const said = await f.wait('opening_line', (d) => d.runId === run.id);
      assert.equal(said.data.text, LINE, 'it shows while the bot works');
      if (k === 'reports') assert.equal((await srv.api('/self/session/notify', { method: 'POST', headers: { 'X-Run-Token': rec.self.env.RUN_TOKEN }, body: { message: 'Your parcel arrived.', urgent: true } })).status, 200);
      srv.release(rec);
      await srv.finished(run.id);
      done[k] = (await srv.api(`/runs/${run.id}?events=0`)).data;
      await f.wait('run_finished', (d) => d.id === run.id);
    }
    assert.equal(done.reports.result, 'Your parcel arrived.', 'the report is what the bot reported');
    assert.equal(done.quiet.reporting, 'quiet', 'a line does not make a quiet run speak');
    assert.equal(done.quiet.quiet, true);
    for (const run of Object.values(done)) assert.doesNotMatch(JSON.stringify(run), new RegExp(LINE));
    // Everything an app could notify from: no event but `opening_line`, and `working_line`, which starts with it
    // (docs/api.md, "The working line"), has the line.
    for (const e of f.events.filter((x) => !['opening_line', 'working_line'].includes(x.type))) assert.doesNotMatch(JSON.stringify(e.data), new RegExp(LINE), e.type);
    assert.equal(f.events.filter((e) => e.type === 'working_line').every((e) => e.data.new === undefined), true, 'nor is the working line a new reply');
    assert.equal(f.events.filter((e) => e.type === 'opening_line').every((e) => e.data.new === undefined), true, 'and that event is not a new reply');
    // The quiet bot has nothing new; the other has its one report.
    assert.equal((await srv.api(`/bots/${bots.quiet.id}`)).data.unread, 0);
    assert.equal((await srv.api(`/bots/${bots.reports.id}`)).data.unread, 1);
  } finally { f.close(); await srv.stop(); }
});
