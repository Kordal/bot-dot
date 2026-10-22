// A job's schedule in words (lib/cron-words.js): the wording table every app is tested against, the rules
// around it, `when` on a job and in the preview of a real server, and the web page's side, cut out of app.js
// and run against stand-ins: the places that show the words, the answers of the preview that arrive out of
// order, and the "next" pill.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { startServer, makeBot } = require('./helpers');
const cron = require('../lib/cron');
const { describe } = require('../lib/cron-words');
const table = require('./fixtures/cron-words.json');
const { webSource } = require('./web-source');

for (const row of table.rows) {
  test(`table: ${row.cron} is "${row.words}"`, () => {
    assert.equal(describe(row.cron), row.words);
    assert.ok(!row.words.includes(row.cron), 'the words never hold the expression');
  });
}

test('the same set of values reads the same, however it is written', () => {
  assert.equal(describe('0,15,30,45 * * * *'), 'Every 15 min');
  assert.equal(describe('0-59/15 * * * *'), 'Every 15 min');
  assert.equal(describe('  0   9  *  *  1-5 '), 'Weekdays at 09:00');
  assert.equal(describe('00 02 * * *'), 'Nightly at 02:00');
  assert.equal(describe('0 9 * * 1,2,3,4,5'), 'Weekdays at 09:00');
  assert.equal(describe('0 9 * * 6,7'), 'Weekends at 09:00');
});

test('the rules beside the table', () => {
  const says = (expr, words) => assert.equal(describe(expr), words, expr);
  // A run of hours: 7 or more read as a range, fewer as the times themselves.
  says('0 9-15 * * *', 'Every hour, 09:00 to 15:00');
  says('0 9-14 * * *', 'Daily at 09:00, 10:00, 11:00, 12:00, 13:00 and 14:00');
  says('30 0-23/3 * * *', 'Every 3 hours, at minute 30');
  says('0 0,12 * * *', 'Every 12 hours');
  says('0 1-23/2 * * *', '12 times a day, from 01:00 to 23:00');
  // Every minute, and steps of minutes, within hours.
  says('* 8 * * *', 'Every minute, 08:00 to 08:59');
  says('* 8-17 * * 1-5', 'Every minute, 08:00 to 17:59, Monday to Friday');
  says('* 8,12 * * *', 'Custom schedule');
  says('*/20 * * * *', 'Every 20 min');
  says('10-59/20 * * * *', 'Custom schedule');
  says('*/7 * * * *', 'Custom schedule');
  // Days after a repeating form: singular names, in the week's order from Monday.
  says('*/30 * * * 0,6', 'Every 30 min, Saturday and Sunday');
  says('0 * * * 1,3,5', 'Hourly, Monday, Wednesday and Friday');
  says('0 */6 1 * *', 'Every 6 hours, on day 1');
  says('0 */6 1,15 * *', 'Every 6 hours, on days 1 and 15');
  says('0 * 13 * 5', 'Hourly, on day 13, only if it is a Friday');
  says('0 8-21 * 6-8 1-5', 'Every hour, 08:00 to 21:00, Monday to Friday, in June to August');
  // Days before fixed times: plural names.
  says('30 7 * * 5-7', 'Friday to Sunday at 07:30');
  says('30 7 * * 0,1,6', 'Mondays, Saturdays and Sundays at 07:30');
  says('30 7 * * 1,2', 'Mondays and Tuesdays at 07:30');
  says('30 7 1-5 * *', 'Monthly on days 1 to 5 at 07:30');
  says('30 7 1,2,3,15 * *', 'Monthly on days 1, 2, 3 and 15 at 07:30');
  says('0 9 10 * 0,6', 'Monthly on day 10, only if it is a weekend day, at 09:00');
  says('0 9 10 * 1,3,5', 'Monthly on day 10, only if it is a Monday, Wednesday or Friday, at 09:00');
  says('0 7 28 9,10 *', 'Monthly on day 28 at 07:00, in September and October');
  says('0 7 28 9 1', 'Monthly on day 28, only if it is a Monday, at 07:00, in September');
});

// Every (day, month, weekday) a year can hold, from the 28 years in which each date falls on each weekday.
const DAYS = new Set();
for (let d = new Date(2024, 0, 1); d.getFullYear() < 2052; d.setDate(d.getDate() + 1)) DAYS.add(`${d.getDate()} ${d.getMonth() + 1} ${d.getDay()}`);
// Whether a schedule ever runs, the long way: a minute, an hour and one of those days fit it.
function everRuns(expr) {
  const [min, hour, dom, mon, dow] = cron.parse(expr).map((set) => [...set].filter(Number.isInteger));
  return min.length > 0 && hour.length > 0 && dom.some((d) => mon.some((m) => dow.some((w) => DAYS.has(`${d} ${m} ${w}`))));
}

test('"Never runs" is a schedule no day or time fits, whatever today is', () => {
  for (const expr of ['0 0 31 4 *', '0 0 30 2 1', '0 0 31 2,4,6,9,11 *', '0 0 30-31 2 1-5', '59-0 * * * *', '0 21-8 * * 1-5', '1.5 * * * *', '0 9 * 12-1 *']) {
    assert.equal(describe(expr), 'Never runs', expr);
    assert.equal(everRuns(expr), false, expr);
  }
  assert.equal(describe('0 0 31 2,3 *'), 'Monthly on day 31 at 00:00, in February and March', 'March has a 31st');
  // A run more than a year away is still a run: these keep their words on the days the server finds no next run.
  const gap = new Date(2027, 8, 1); // no Friday the 13th from August 2027 to October 2028
  assert.equal(cron.next('0 8 13 * 5', gap), null);
  assert.equal(describe('0 8 13 * 5'), 'Monthly on day 13, only if it is a Friday, at 08:00');
  assert.equal(cron.next('0 7 29 2 *', new Date(2026, 9, 4)), null);
  assert.equal(describe('0 7 29 2 *'), '29 Feb at 07:00', 'a one-time job on 29 February keeps its date');
  assert.equal(describe('0 8,9 29 2 *'), 'Monthly on day 29 at 08:00 and 09:00, in February');
  assert.equal(describe('0 8 29 2 1'), 'Monthly on day 29, only if it is a Monday, at 08:00, in February');
});

test('whatever the text, the words are words: never the expression, never empty', () => {
  const odd = [undefined, null, '', ' ', 42, {}, '* * * *', '* * * * * *', '60 * * * *', '0 24 * * *', '0 0 0 * *', '0 0 * 13 *', '0 0 * * 8',
    'a b c d e', '*/0 * * * *', '1.5 * * * *', '0-59/1.5 * * * *', '0 9 * * mon', '@daily', '0 9 * * 1-5; rm -rf /'];
  for (const expr of odd) {
    const words = describe(expr);
    assert.ok(typeof words === 'string' && words.trim(), `words for ${JSON.stringify(expr)}`);
    if (typeof expr === 'string' && expr.trim()) assert.ok(!words.includes(expr.trim()), `"${words}" holds the expression`);
  }
  assert.equal(describe('60 * * * *'), 'Invalid schedule');
  assert.equal(describe('* * * *'), 'Invalid schedule');
  assert.equal(describe('0-59/1.5 * * * *'), 'Every 3 min', 'the minutes it really runs in');
  // Any mix of the field forms the server accepts gives words by the rules, or "Custom schedule".
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const field = (lo, hi) => {
    const n = () => lo + rnd(hi - lo + 1);
    return ['*', `${n()}`, `${n()},${n()}`, `${lo}-${n()}`, `*/${1 + rnd(hi)}`, `${n()}-${hi}/${1 + rnd(6)}`, `${n()},${n()},${n()}`][rnd(7)];
  };
  for (let i = 0; i < 3000; i++) {
    const expr = [field(0, 59), field(0, 23), field(1, 31), field(1, 12), field(0, 7)].join(' ');
    const words = describe(expr);
    assert.match(words, /^[A-Z0-9][A-Za-z0-9 ,:]+$/, `${expr}: "${words}"`);
    assert.ok(!words.includes(expr), expr);
    assert.notEqual(words, 'Invalid schedule', expr);
    // "Never runs" is exactly a schedule that never runs; one with a next run is never called that.
    assert.equal(words === 'Never runs', !everRuns(expr), `${expr}: "${words}"`);
    if (i % 10 === 0 && cron.next(expr)) assert.notEqual(words, 'Never runs', expr);
  }
});

// ---------- the server ----------

let srv, bot;
before(async () => { srv = await startServer(); bot = await makeBot(srv, { name: 'Schedule Probe' }); });
after(() => srv.stop());

test('server: every job carries `when`, from each route that returns a job', async () => {
  const add = await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Hourly look', kind: 'ai', cron: '0 8-21 * * *', prompt: '' } });
  assert.equal(add.status, 201, JSON.stringify(add.data));
  assert.equal(add.data.when, 'Every hour, 08:00 to 21:00');
  const id = add.data.id;
  const listed = (await srv.api('/bots')).data.find((b) => b.id === bot.id).jobs.find((j) => j.id === id);
  assert.equal(listed.when, 'Every hour, 08:00 to 21:00');
  assert.equal(listed.cron, '0 8-21 * * *', 'the cron stays as it is');
  assert.equal((await srv.api(`/bots/${bot.id}/jobs`)).data[0].when, 'Every hour, 08:00 to 21:00');
  const changed = await srv.api(`/bots/${bot.id}/jobs/${id}`, { method: 'PUT', body: { cron: '*/30 9-17 * * 1-5' } });
  assert.equal(changed.data.when, 'Every 30 min, 09:00 to 17:30, Monday to Friday');
  const paused = await srv.api(`/bots/${bot.id}/jobs/${id}`, { method: 'PUT', body: { enabled: false } });
  assert.equal(paused.data.when, 'Every 30 min, 09:00 to 17:30, Monday to Friday', 'a paused job too');
  // Changing the bot answers with its jobs as every route hands them out: the web page keeps that answer.
  const bot2 = await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { description: 'Probes schedules' } });
  assert.equal(bot2.data.jobs[0].when, 'Every 30 min, 09:00 to 17:30, Monday to Friday');
  assert.equal((await srv.api(`/bots/${bot.id}`)).data.jobs[0].when, 'Every 30 min, 09:00 to 17:30, Monday to Friday');
  // What a client sends back as `when` is not kept: the words are the server's.
  const forged = await srv.api(`/bots/${bot.id}/jobs/${id}`, { method: 'PUT', body: { cron: '5-50/7 * * * *', when: 'Every day at noon' } });
  assert.equal(forged.data.when, 'Custom schedule');
  assert.equal(JSON.parse(fs.readFileSync(path.join(srv.data, 'bots.json'), 'utf8')).find((b) => b.id === bot.id).jobs[0].when, undefined, 'the words are not stored');
  // A job the Chief set up, and its approval.
  const asked = await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Morning check', kind: 'script', script: 'echo hi', cron: '0 10 * * 1', assessment: 'A script is enough' } });
  assert.equal(asked.data.when, 'Mondays at 10:00');
  assert.equal(asked.data.approved, false);
  const approved = await srv.api(`/bots/${bot.id}/jobs/${asked.data.id}/approve`, { method: 'POST', body: { approve: true } });
  assert.equal(approved.data.when, 'Mondays at 10:00');
  const never = await srv.api(`/bots/${bot.id}/jobs/${id}`, { method: 'PUT', body: { cron: '0 21-8 * * *' } });
  assert.equal(never.data.when, 'Never runs');
  assert.equal(never.data.nextRunAt, null);
  // A change of the bot the owner approves answers with the bot: its jobs carry their words there too.
  const proposed = await srv.asChief(`/bots/${bot.id}`, { method: 'PUT', body: { allowedTools: ['Read', 'Bash', 'WebFetch'] } });
  assert.ok(proposed.data.pendingChange, JSON.stringify(proposed.data));
  const granted = await srv.api(`/asks/${proposed.data.pendingChange}`, { method: 'POST', body: { yes: true } });
  assert.equal(granted.data.bot.jobs.find((j) => j.id === id).when, 'Never runs');
});

test('server: a bot made with jobs answers with their words', async () => {
  const made = await srv.api('/bots', { method: 'POST', body: { name: 'With jobs', emoji: '🧪', prompt: 'x', jobs: [{ name: 'Daily', kind: 'ai', cron: '0 9 * * *' }] } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(made.data.jobs[0].when, 'Daily at 09:00');
});

test('server: a one-time job reads as before', async () => {
  const later = new Date(Date.now() + 3 * 864e5);
  later.setUTCHours(7, 0, 0, 0); // the test server runs on UTC
  const add = await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Once', kind: 'ai', at: later.toISOString().slice(0, 16), assessment: 'Needs AI' } });
  assert.equal(add.status, 201, JSON.stringify(add.data));
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][later.getUTCMonth()];
  assert.equal(add.data.when, `${later.getUTCDate()} ${month} at 07:00`);
});

test('server: the preview answers { when, next }, and for a refused expression { error, when }', async () => {
  const preview = async (expr) => (await srv.api('/cron/preview', { method: 'POST', body: { expr } })).data;
  const ok = await preview('0 8-21 * * *');
  assert.equal(ok.when, 'Every hour, 08:00 to 21:00');
  assert.equal(ok.next.length, 3);
  assert.equal(ok.error, undefined);
  const custom = await preview('5-50/7 * * * *');
  assert.equal(custom.when, 'Custom schedule');
  assert.equal(custom.next.length, 3);
  assert.deepEqual(await preview('0 0 31 2 *'), { when: 'Never runs', next: [] });
  for (const bad of ['foo', '0 9 * *', '0 25 * * *', '']) {
    const r = await preview(bad);
    assert.equal(r.when, 'Invalid schedule', bad);
    assert.ok(r.error, bad);
    assert.equal(r.next, undefined, bad);
  }
  assert.equal((await preview(undefined)).when, 'Invalid schedule');
});

// ---------- the web page ----------

const app = webSource();
// A part of app.js, from one line of it up to another.
const { whileBusy } = require('./web-page');
const cut = (from, to) => {
  const a = app.indexOf(from), b = app.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `app.js has "${from}" … "${to}"`);
  return app.slice(a, b);
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const JOB = { id: 'j1', name: 'Morning check', kind: 'ai', cron: '0 8-21 * * *', when: 'Every hour, 08:00 to 21:00', enabled: true, approved: true, prompt: '', createdBy: 'you' };

test('web: the page has no describer of its own, and never draws a job\'s cron as its words', () => {
  assert.doesNotMatch(app, /describeCron/);
  assert.doesNotMatch(app, /esc\((j|job)\.cron\)\}?<\/span>/);
});

// The jobs' part of the page, with stand-ins for what it calls.
function jobsPage(extra = {}) {
  const page = vm.createContext({ esc, ago: () => 'a while ago', toast: () => {}, refresh: () => {}, confirm: () => true, setTimeout, clearTimeout, whileBusy, ...extra });
  vm.runInContext(`${cut('const CRON_PRESETS = [', 'const MODE_INFO')}
    ${cut('// "18:32" today', '// When a message in a chat was sent')}
    ${cut('const AI_WHEN_TEXT = {', '// A script job\'s run in the chat')}
    ${cut('const jobReq = {', '// ---------- connectors')}
    ${cut('// Words of the server\'s that a card draws', '// Who carries on after a yes')}
    ${cut('// A job in one line', '// Approve or decline one card')}
    Object.assign(globalThis, { CRON_PRESETS, shortTime, jobCardHTML, wireJobCard, jobStatus, jobLine, openJobApproval });`, page);
  return page;
}

test('web: the job card\'s header, the always-approved list and the "When" list show the server\'s words', () => {
  const page = jobsPage();
  const html = page.jobCardHTML(JOB);
  assert.match(html, /<span class="faint job-when">Every hour, 08:00 to 21:00<\/span>/);
  assert.equal(page.jobLine(JOB), 'Every hour, 08:00 to 21:00 · uses AI');
  assert.equal(page.jobLine({ ...JOB, kind: 'script', when: 'Mondays at 10:00' }), 'Mondays at 10:00 · a script, no AI');
  assert.match(page.jobCardHTML({ ...JOB, when: '<b>x</b>' }), /job-when">&lt;b&gt;x&lt;\/b&gt;</, 'escaped');
  // Every preset's label is what the server says for its cron.
  for (const p of page.CRON_PRESETS) assert.equal(describe(p.cron), p.label, p.cron);
});

test('web: the approval dialog and its toast show the words, and the toast keeps their capitals', async () => {
  const toasts = [];
  const els = {};
  let html;
  const modal = { close() {}, querySelector: (sel) => (els[sel] ||= { dataset: {} }) };
  const page = jobsPage({ openModal: (h) => { html = h; return modal; }, api: async () => ({}), toast: (t) => toasts.push(t), $: (sel, root) => root.querySelector(sel) });
  page.openJobApproval({ id: 'b1', name: 'Probe' }, { ...JOB, cron: '0 10 * * 1', when: 'Mondays at 10:00', changedBy: 'chief' });
  assert.match(html, /<b>🧠 Morning check<\/b> · Mondays at 10:00<\/div>/);
  assert.ok(!html.includes('0 10 * * 1'), 'no cron in the dialog');
  await els['#job-approve'].onclick();
  assert.deepEqual(toasts, ['Approved. Morning check: Mondays at 10:00.']);
});

test('web: the Needs-you card and the always-approved list show the words', () => {
  const box = vm.createContext({ esc, botLabel: (b) => esc(b.name), needsOpen: new Set() });
  vm.runInContext(`${cut('// A change that waits beside an approved job or tile', 'function pendingJobs() {')}
    ${cut('function needCardHTML(x, here = null) {', 'function renderNeeds() {')}; this.needCardHTML = needCardHTML;`, box);
  const job = { ...JOB, kind: 'script', script: 'echo hi', cron: '0 10 * * 1', when: 'Mondays at 10:00', approved: false, changedBy: 'chief' };
  const html = box.needCardHTML({ kind: 'job', key: 'job:j1', bot: { id: 'b1', name: 'Probe' }, job });
  assert.match(html, /<div class="need-meta">Mondays at 10:00 · a script, no AI · added by the Chief<\/div>/);
  assert.ok(!html.includes('0 10 * * 1'), 'no cron on the card');
  assert.match(app, /desc: jobLine\(j\) \}\)\), trustedOn/, 'the always-approved list of the bot\'s settings');
});

// A stand-in for a job card: every element asked for exists, and keeps what is written to it.
function fakeCard(values = {}) {
  const els = new Map();
  const el = (sel) => {
    if (!els.has(sel)) {
      const classes = new Set(sel === '.job-cron' && values.preset ? ['hidden'] : []);
      els.set(sel, {
        value: values[sel.match(/^\[name=(\w+)\]$/)?.[1]] ?? '', textContent: '', checked: true, title: '',
        classList: { contains: (c) => classes.has(c), toggle: (c, on = !classes.has(c)) => { if (on) classes.add(c); else classes.delete(c); return on; }, add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
        focus() {}, remove() {}, insertAdjacentHTML() {},
      });
    }
    return els.get(sel);
  };
  return { dataset: { job: 'j1' }, querySelector: (sel) => (sel === '[data-approve]' || sel === 'summary .pill' ? null : el(sel)), addEventListener() {}, remove() {}, el };
}

test('web: the header and the line under the field follow the preview\'s answer, the newest one', async () => {
  const asked = [];
  const api = (url, opts) => new Promise((resolve, reject) => asked.push({ url, expr: opts?.body?.expr, resolve, reject }));
  const page = jobsPage({ api, $: (sel, root) => root.querySelector(sel), fmtTime: (iso) => `<${iso}>` });
  const card = fakeCard({ jobCron: '0 9 * * *', jobWhen: '0 9 * * *', preset: true });
  card.el('.job-when').textContent = 'Daily at 09:00'; // as jobCardHTML drew it
  page.wireJobCard(card, { id: 'b1' });
  assert.equal(asked.length, 0, 'a card on a listed time asks nothing when the page opens: the job has its words');

  // The owner picks "Another time…" and types; the first answer comes after the second.
  card.el('[name=jobWhen]').value = '';
  card.el('[name=jobWhen]').onchange();
  assert.equal(card.el('.job-cron').classList.contains('hidden'), false);
  card.el('[name=jobCron]').value = '0 8-21 * * *';
  card.el('[name=jobCron]').oninput();
  card.el('[name=jobCron]').value = '0 8-21 * * 1-5';
  card.el('[name=jobCron]').oninput();
  assert.deepEqual(asked.map((a) => [a.url, a.expr]), [['/cron/preview', '0 9 * * *'], ['/cron/preview', '0 8-21 * * *'], ['/cron/preview', '0 8-21 * * 1-5']]);
  assert.equal(card.el('.job-when').textContent, 'Daily at 09:00', 'the header waits for the answer');
  asked[2].resolve({ when: 'Every hour, 08:00 to 21:00, Monday to Friday', next: ['a', 'b'] });
  await sleep(0);
  asked[1].resolve({ when: 'Every hour, 08:00 to 21:00', next: ['c'] });
  asked[0].resolve({ when: 'Daily at 09:00', next: ['d'] });
  await sleep(0);
  assert.equal(card.el('.job-when').textContent, 'Every hour, 08:00 to 21:00, Monday to Friday');
  assert.equal(card.el('.cron-preview').textContent, 'Every hour, 08:00 to 21:00, Monday to Friday. Next: <a> · <b>');
  assert.equal(card.el('.cron-preview').classList.contains('err'), false);

  const type = async (expr, answer) => {
    card.el('[name=jobCron]').value = expr;
    card.el('[name=jobCron]').oninput();
    const a = asked.at(-1);
    if (answer instanceof Error) a.reject(answer); else a.resolve(answer);
    await sleep(0);
  };
  // A schedule the rules cannot say, one that never runs, one that is not valid.
  await type('5-50/7 * * * *', { when: 'Custom schedule', next: ['e'] });
  assert.equal(card.el('.job-when').textContent, 'Custom schedule');
  assert.equal(card.el('.cron-preview').textContent, 'Custom schedule. Next: <e>');
  await type('0 0 31 2 *', { when: 'Never runs', next: [] });
  assert.equal(card.el('.job-when').textContent, 'Never runs');
  assert.equal(card.el('.cron-preview').textContent, 'Never runs');
  await type('0 9 * *', { error: 'Cron needs 5 fields: min hour day month weekday', when: 'Invalid schedule' });
  assert.equal(card.el('.job-when').textContent, 'Invalid schedule');
  assert.equal(card.el('.cron-preview').textContent, 'Cron needs 5 fields: min hour day month weekday');
  assert.equal(card.el('.cron-preview').classList.contains('err'), true);
  // The server cannot be reached: the error under the field, the header as it was.
  await type('0 9 * * *', new Error('Failed to fetch'));
  assert.equal(card.el('.job-when').textContent, 'Invalid schedule');
  assert.equal(card.el('.cron-preview').textContent, 'Failed to fetch');

  // Picking a listed time asks the server too, and hides the field.
  card.el('[name=jobWhen]').value = '0 10 * * 1';
  card.el('[name=jobWhen]').onchange();
  assert.equal(asked.at(-1).expr, '0 10 * * 1');
  asked.at(-1).resolve({ when: 'Mondays at 10:00', next: ['f'] });
  await sleep(0);
  assert.equal(card.el('.job-when').textContent, 'Mondays at 10:00');
  assert.equal(card.el('.job-cron').classList.contains('hidden'), true);
});

test('web: a card on a time that is not listed asks for its next runs when the page opens', async () => {
  const asked = [];
  const page = jobsPage({ api: (url, opts) => new Promise((resolve) => asked.push({ expr: opts.body.expr, resolve })), $: (sel, root) => root.querySelector(sel), fmtTime: (iso) => iso });
  const card = fakeCard({ jobCron: '0 8-21 * * *', jobWhen: '' });
  page.wireJobCard(card, { id: 'b1' });
  assert.deepEqual(asked.map((a) => a.expr), ['0 8-21 * * *']);
});

test('web: the "next" pill shows the date of a run more than six days away, the weekday of a nearer one', () => {
  const page = jobsPage();
  const at = (days) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(12, 0, 0, 0); return d; };
  const date = (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const weekday = (d) => d.toLocaleDateString([], { weekday: 'short' });
  for (const days of [7, 28, 200]) assert.equal(page.shortTime(at(days).toISOString()), date(at(days)), `in ${days} days`);
  for (const days of [2, 5]) assert.equal(page.shortTime(at(days).toISOString()), weekday(at(days)), `in ${days} days`);
  // What has passed reads as it did.
  for (const days of [-2, -5]) assert.equal(page.shortTime(at(days).toISOString()), weekday(at(days)), `${-days} days ago`);
  for (const days of [-7, -40]) assert.equal(page.shortTime(at(days).toISOString()), date(at(days)), `${-days} days ago`);
  assert.equal(page.shortTime(''), '');
  const far = at(28);
  assert.equal(page.jobStatus({ ...JOB, nextRunAt: far.toISOString() }), `<span class="pill">next ${date(far)}</span>`);
});
