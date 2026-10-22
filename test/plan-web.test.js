// A bot's or the Chief's plan on the web page (docs/api.md, "The plan"): public/plan.js loaded the way the browser
// loads it (a plain script, before app.js): the card above the message box while it works, open and folded, a long
// plan, the plan of work that was stopped, and the plan folded under a reply; then the page's own code, read for
// where it draws them and follows the stream.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webSource } = require('./web-source');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const stored = new Map();
const page = vm.createContext({
  localStorage: { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)) },
  matchMedia: () => ({ matches: false }),
});
vm.runInContext(read('plan.js'), page);
const { Plan } = page;
const app = webSource();
const css = read('style.css');

const plan = (...statuses) => ({ steps: statuses.map((status, i) => ({ text: `Step ${i + 1}`, status, ...(status === 'doing' ? { doing: `Doing step ${i + 1}` } : {}) })) });
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('web: the page gets it as window.Plan, before app.js', () => {
  const html = read('index.html');
  const at = (src) => html.indexOf(`<script src="${src}">`);
  assert.ok(at('/plan.js') > 0 && at('/plan.js') < at('/app.js'));
});

test('web: how far a plan is, and the step it is on', () => {
  assert.deepEqual({ ...Plan.progress(plan('done', 'done', 'doing', 'todo', 'todo')) }, { done: 2, total: 5, step: 3 });
  assert.deepEqual({ ...Plan.progress(plan('done', 'todo')) }, { done: 1, total: 2, step: 2 }, 'no step at work: the first not done');
  assert.equal(Plan.finished(plan('done', 'done')), true);
  assert.equal(Plan.has({ steps: [{ text: '' }, 5] }), false, 'what is not a step is not drawn');
});

test('web: the open card says how far it is, strikes what is done and marks the step at work, with its words', () => {
  const html = Plan.liveHTML(plan('done', 'done', 'doing', 'todo', 'todo'), { who: 'News Monitor' });
  assert.match(html, /<section class="plan-card" aria-label="News Monitor&#39;s plan">/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(text(html), /^Plan 2 of 5 done/);
  assert.match(html, /width:40%/);
  assert.equal((html.match(/plan-step done/g) || []).length, 2);
  assert.match(html, /plan-step doing"><span class="plan-mark"><i aria-hidden="true"><\/i><\/span><span>Step 3<em>Doing step 3<\/em>/);
  assert.equal((html.match(/plan-step todo/g) || []).length, 2);
});

test('web: folded, it is one line with the step at work: "Plan · step 3 of 5"', () => {
  const html = Plan.liveHTML(plan('done', 'done', 'doing', 'todo', 'todo'), { fold: true });
  assert.match(html, /aria-expanded="false"/);
  assert.match(text(html), /Plan step 3 of 5 Doing step 3/);
  assert.doesNotMatch(html, /<ol/);
});

test('web: a long plan folds the steps that are done until they are shown, and fades at its end', () => {
  const long = plan('done', 'done', 'done', 'doing', 'todo', 'todo', 'todo', 'todo');
  const html = Plan.liveHTML(long);
  assert.match(html, /class="plan-steps long"/);
  assert.match(text(html), /3 steps done · show/);
  assert.equal((html.match(/plan-step done/g) || []).length, 1, 'one row for the steps that are done');
  assert.equal((Plan.liveHTML(long, { showDone: true }).match(/plan-step done/g) || []).length, 3);
  assert.match(css, /\.plan-steps\.long \{[^}]*mask-image/);
  assert.match(css, /\.plan-steps \{[^}]*max-height/);
});

test('web: a stopped plan says where it stopped, the step in amber, and has Dismiss and no Carry on', () => {
  const stopped = { steps: [...plan('done', 'done', 'done', 'done', 'done').steps, { text: 'Flag the invoices', status: 'doing' }, ...plan('todo', 'todo', 'todo', 'todo', 'todo', 'todo').steps] };
  const html = Plan.stoppedHTML(stopped, { who: 'Inbox Sweeper' });
  assert.match(html, /aria-label="Inbox Sweeper&#39;s plan, stopped"/);
  assert.match(text(html), /Stopped at step 6 of 12 5 steps done Flag the invoices 6 steps not started Dismiss/);
  assert.match(html, /plan-step cut/);
  assert.doesNotMatch(html, /Carry on/);
  assert.match(css, /\.plan-step\.cut \{[^}]*--warn-text/);
});

test('web: a reply that is done carries its plan folded, "Plan · 5 of 5 done"', () => {
  const html = Plan.replyHTML(plan('done', 'done', 'done', 'done', 'done'));
  assert.match(html, /^<details class="plan-fold"><summary><svg/);
  assert.match(text(html), /^Plan · 5 of 5 done Step 1 Step 2/);
});

test('web: the steps are text, never markup', () => {
  const evil = { steps: [{ text: '<img src=x onerror=alert(1)>', status: 'doing', doing: '<b>x</b>' }] };
  for (const html of [Plan.liveHTML(evil), Plan.liveHTML(evil, { fold: true }), Plan.stoppedHTML(evil), Plan.replyHTML(evil), Plan.liveHTML(evil, { who: '"><script>' })]) {
    assert.doesNotMatch(html, /<img|<b>x|<script/);
  }
});

test('web: the fold is kept for each chat, and a dismissed plan stays dismissed', () => {
  assert.equal(Plan.folded('bot:a'), false, 'open on a wide screen');
  Plan.setFolded('bot:a', true);
  assert.equal(Plan.folded('bot:a'), true);
  assert.equal(Plan.folded('bot:b'), false);
  assert.equal(Plan.dismissed('run-1'), false);
  Plan.dismiss('run-1');
  assert.equal(Plan.dismissed('run-1'), true);
});

test('web: its touch targets are 44px, and the page draws it above the box and follows it on the streams', () => {
  assert.match(css, /\.plan-head \{[^}]*min-height: 44px/);
  assert.match(css, /\.plan-actions \.btn \{[^}]*min-height: 44px/);
  assert.match(app, /<div class="plan-slot"><\/div>/);
  assert.match(app, /if \(ev\.type === 'plan'\) onPlan\?\.\(ev\.plan \|\| null\)/, 'a bot\'s run stream');
  assert.match(app, /ev\.type === 'plan'\) \{\n\s*const pending/, 'the Chief\'s stream');
  assert.match(app, /drawBotPlan\?\.\(bot, runs\)/);
  assert.match(app, /drawChiefPlan\?\.\(id, thread\._last\)/);
});
