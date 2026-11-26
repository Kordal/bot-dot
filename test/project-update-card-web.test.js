// A project update drawn as a card of the block kit on the web page (#1755, public/project-update.js): the head, the
// status pills, only the sections that have something, and the one faint line for the rest. Drawn in a browser by
// test/browser/project-updates.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, cut, esc, words } = require('./web-page');

const page = (extra = {}) => {
  const ctx = vm.createContext({
    ...words, esc,
    botById: (id) => (id === 'infra' ? { id, color: '#c98a2b', state: 'idle', outfit: null } : null),
    botFigure: (color, st, size, outfit, id) => `<div class="avatar head ${size}" data-bot="${id}"></div>`,
    chiefFigure: (size) => `<div class="avatar head ${size}" data-chief></div>`,
    msgTime: (iso) => `T(${iso})`,
    ProjectOverview: { head: (x) => (x.chatId ? '<div class="avatar head sm" data-chief></div>' : x.botId ? `<div class="avatar head sm" data-bot="${x.botId}"></div>` : '<span class="cf-you sm"></span>') },
    ...extra,
  });
  vm.runInContext(`${cut('function md(src, botId, tables = false)', '// Link bare web addresses after rendering')}\nthis.mdPreview = mdPreview;`, ctx);
  vm.runInContext(`${read('project-update.js')}\nthis.ProjectUpdate = ProjectUpdate;`, ctx);
  return ctx.ProjectUpdate;
};
const since = '2026-11-24T09:00:00.000Z';
const quiet = {
  project: { id: 'p1', name: 'Qwotz Development' }, since, summary: 'Nothing needs you, 2 in progress',
  pills: [{ level: 'ok', text: 'Nothing needs you' }, { level: 'ok', text: 'No blockers' }, { level: 'info', text: '2 in progress' }],
  needs: [], blockers: [], goals: [], done: [], decisions: [],
  work: [{ botId: 'infra', name: 'Infra Admin', text: 'Plan the **database** copy', state: 'working' }, { name: 'Mail', text: 'Decide on Brevo', state: 'planned' }],
  replies: [{ botId: 'infra', runId: 'r9', name: 'Infra Admin', text: 'Three new issues', at: '2026-11-25T08:41:00.000Z' }],
  quiet: 'Nothing marked done, no goal figures, no new decisions.',
};
const busy = {
  ...quiet, summary: '1 needs you, 1 blocker, 2 done, 2 in progress',
  pills: [{ level: 'warn', text: '1 needs you' }, { level: 'err', text: '1 blocker' }, { level: 'ok', text: '2 done' }, { level: 'info', text: '2 in progress' }],
  needs: [{ botId: 'infra', cardId: 'ask9', name: 'Infra Admin', text: 'May I sign in to staging?' }],
  blockers: [{ botId: 'infra', runId: 'r5', name: 'Infra Admin', text: 'No access to OVH' }],
  goals: [{ id: 'v1', name: 'Version 1.0', value: '4', of: 'of 6 steps', ratio: 4 / 6, level: 'ok' }, { id: 'i', name: 'Open issues', value: '19', of: '/ 10', ratio: 1, level: 'warn' }],
  done: [{ id: 'a', text: 'Groq removed (PR #708)' }, { id: 'b', text: 'QA tests written up' }],
  decisions: [{ id: 'd1', text: 'Mail goes through Brevo' }], quiet: undefined,
  work: [{ botId: 'infra', name: 'Infra Admin', text: 'Plan the copy', state: 'asks' }, { chatId: 'c1', name: 'Chief', text: 'Reading', state: 'working' }],
};

test('web: a quiet update is a head, three pills, what is in progress, the latest replies and one faint line', () => {
  const html = page().html(quiet);
  assert.match(html, /<span class="pu-title">Qwotz Development<\/span>/);
  assert.match(html, /<span class="pu-sub">Update since T\(2026-11-24T09:00:00.000Z\)<\/span>/);
  assert.match(html, /data-pu-project="p1"[^>]*>Board/);
  assert.deepEqual([...html.matchAll(/<span class="kit-pill (\w+)">([^<]*)<\/span>/g)].slice(0, 3).map((m) => [m[1], m[2]]), [['ok', 'Nothing needs you'], ['ok', 'No blockers'], ['info', '2 in progress']]);
  assert.match(html, /<h3>In progress <span class="n">2<\/span><\/h3>/);
  assert.match(html, /<h3>Latest replies <span class="n">1<\/span><\/h3>/);
  assert.doesNotMatch(html, /Needs you<|Blockers<|Goals<|>Done<|Decisions</, 'an empty section has no heading');
  assert.doesNotMatch(html, /kit-callout/);
  assert.match(html, /<p class="pu-quiet">Nothing marked done, no goal figures, no new decisions\.<\/p>/);
  assert.doesNotMatch(html, /This update uses recorded activity/);
  assert.match(html, /<span class="kit-pill info">Working<\/span>/);
  assert.match(html, /<span class="kit-pill plan">To-do<\/span>/);
  assert.match(html, /<strong>database<\/strong>/, "a row's text is Markdown drawn as a reply's preview");
});

test('web: a busy update has its callouts, goals with the kit bar, a tick per done item and its decisions', () => {
  const html = page().html(busy);
  const order = ['Needs you', 'Blockers', 'Goals', 'Done', 'In progress', 'Decisions', 'Latest replies'].map((h) => html.indexOf(`<h3>${h}`));
  assert.ok(order.every((n, i) => n >= 0 && (!i || n > order[i - 1])), `the sections stand in the order of the design: ${order}`);
  assert.match(html, /<div class="kit-callout warn"><b class="pu-name">Infra Admin asks<\/b><p class="pu-call">May I sign in to staging\?<\/p><button type="button" class="btn primary" data-pu-card="ask9" data-pu-bot="infra">Open card<\/button><\/div>/);
  assert.match(html, /<div class="kit-callout err"><b class="pu-name">Infra Admin failed<\/b>[\s\S]*data-pu-bot="infra">Open chat<\/button>/);
  assert.match(html, /<span class="pu-value">4<small>of 6 steps<\/small><\/span>/);
  assert.match(html, /<div class="kit-bar"><i style="width:67%;--c:var\(--ok\)"><\/i><\/div>/);
  assert.match(html, /<div class="kit-bar"><i style="width:100%;--c:var\(--warn\)"><\/i><\/div>/);
  assert.equal([...html.matchAll(/<li><span class="pu-tick">/g)].length, 2);
  assert.match(html, /Mail goes through Brevo/);
  assert.match(html, /<span class="kit-pill warn">Asks<\/span>/);
  assert.doesNotMatch(html, /pu-quiet/, 'nothing is empty: no faint line');
});

test('web: a row opens the chat of its bot, its group or the Chief, and the card opens the card', () => {
  const html = page().html(busy);
  assert.match(html, /data-pu-chief="c1"/);
  const grouped = page().html({ ...quiet, replies: [{ groupId: 'g1', botId: 'infra', name: 'Team', text: 'x', at: since }] });
  assert.match(grouped, /data-pu-group="g1"/);
  assert.doesNotMatch(page().html({ ...quiet, replies: [], work: [{ name: 'Mail', text: 'Decide', state: 'planned' }] }), /data-pu-bot|data-pu-chief|data-pu-group/, 'a to-do of nobody opens nothing');
});

test('web: the card starts folded to its head and pills, and a tap unfolds the rest', () => {
  const { html } = page();
  const folded = html(busy, 'key-one');
  assert.match(folded, /<button type="button" class="pu-toggle" data-pu-toggle aria-expanded="false">/);
  assert.match(folded, /<div class="pu-body" hidden>/);
  assert.match(folded, /<div class="pu-pills">[\s\S]*<div class="pu-body" hidden>/, 'the pills stand above the folded part');
  assert.ok(folded.indexOf('class="pu-pills"') < folded.indexOf('class="pu-body"'));
  assert.doesNotMatch(folded, /pu-card[^>]*\bopen\b/);
  const { html: again, unfold } = page();
  unfold('key-one', true);
  const open = again(busy, 'key-one');
  assert.match(open, /aria-expanded="true"/);
  assert.doesNotMatch(open, /<div class="pu-body" hidden>/);
  assert.match(again(busy, 'key-two'), /aria-expanded="false"/, 'another update stays folded');
  assert.doesNotMatch(html({ ...quiet, work: [], replies: [], quiet: undefined }), /pu-toggle/, 'nothing to unfold: no toggle');
});

test('web: nothing a bot wrote becomes markup', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const html = page().html({ ...busy, project: { id: 'p"1', name: evil }, needs: [{ botId: 'in"fra', cardId: 'a"b', name: evil, text: evil }], blockers: [{ name: evil, text: `**${evil}**` }], work: [{ botId: 'infra', name: evil, text: `[x](javascript:alert(1)) ${evil}`, state: 'working' }], done: [{ id: 'a', text: evil }], decisions: [{ id: 'd', text: evil }], goals: [{ id: 'g', name: evil, value: evil, of: evil, ratio: 9, level: 'x" onclick="1' }], pills: [{ level: 'ok" onclick="1', text: evil }] });
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /onclick|onerror="/);
  assert.doesNotMatch(html, /href="javascript/);
  assert.match(html, /style="width:100%;--c:var\(--ok\)"/, 'a ratio is held to 0..100 and a level to the kit levels');
});

test('web: an update that is missing lists still draws, and a record without one is not a card', () => {
  const { html, of } = page();
  assert.match(html({ project: { id: 'p', name: 'X' }, summary: 'Nothing needs you', pills: [] }), /pu-title/);
  assert.equal(of({ update: null, result: 'Project update: X' }), null);
  assert.equal(of({ update: 'x' }), null);
  assert.equal(of({ update: { project: { name: 'X' } } })?.project.name, 'X');
});

test('web: the list says the outcome, not "Project update: <name>"', () => {
  const { preview } = page();
  assert.equal(preview({ kind: 'project-update', result: 'Project update: Qwotz\n\nMarked done…', update: quiet }), 'Nothing needs you, 2 in progress');
  assert.equal(preview({ kind: 'project-update', result: 'Project update: Qwotz' }), null, 'an older record keeps its text');
  assert.equal(preview({ result: 'Hello', update: quiet }), null, 'a reply is no update');
});

test('web: the card is drawn in the Project Manager\'s chat and the Chief chat, and the list reads its outcome', () => {
  const bot = read('bot-chat.js'), chief = read('chief.js'), list = read('list.js'), index = read('index.html');
  assert.match(bot, /ProjectUpdate\.of\(r\)/);
  assert.match(read('app.js'), /\.pu-name/, 'the callout title is no bot link');
  assert.match(chief, /ProjectUpdate\.of\(m\)/);
  assert.match(list, /ProjectUpdate\.preview\(r\)/, 'the list says the outcome');
  assert.ok(index.indexOf('<script src="/blocks.js"></script>') < index.indexOf('<script src="/project-update.js"></script>'));
});

test('web: a blocker with nowhere to go has no button, and the notes stand at the foot', () => {
  const html = page().html({ ...busy, blockers: [{ name: 'Members', text: 'HubSpot is not connected' }], notes: ['No new recorded team report: Ops.', 'Saved report unavailable for this update: <b>Sales</b>.'] });
  assert.match(html, /<div class="kit-callout err"><b class="pu-name">Members failed<\/b><p class="pu-call">HubSpot is not connected<\/p><\/div>/);
  assert.match(html, /<p class="pu-quiet pu-note">No new recorded team report: Ops\.<\/p>/);
  assert.match(html, /unavailable for this update: &lt;b&gt;Sales&lt;\/b&gt;\./, 'a note is text, never markup');
  assert.match(page().html({ ...quiet, work: [], replies: [], quiet: undefined, notes: ['No new recorded team report: Ops.'] }), /pu-toggle/, 'a card with only notes can unfold');
});
