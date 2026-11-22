// Settings → "Feedback to the developers" on a managed machine (#1571, ADR 259): a switch only where the front door's
// session says the owner answers for themselves (`feedbackAsk` a boolean), set by the owner's own route; the Feedback icon
// follows at once. The page's own code, cut out of public/settings.js and run against stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, esc, words, element } = require('./web-page');

function page({ features = ['accounts'], post = async () => ({ on: true }) } = {}) {
  const toasts = [];
  const calls = [];
  const icon = element({}, { classes: [] });
  const box = element({}, { checked: false, disabled: false });
  const slot = element({ '#feedback-answer': box }, { innerHTML: '', hidden: true });
  const ctx = vm.createContext({
    ...words, esc, state: { features }, feedbackDevelopers: false, feedbackShots: false, flashSaved() {}, CHEV: '',
    $: (sel, root) => (root ? root.querySelector(sel) : { '#feedback-btn': icon, '#view-settings': null }[sel] || null),
    toast: (t, err) => toasts.push([t, !!err]),
    frontDoorPost: async (path, body) => { calls.push([path, body]); return post(path, body); },
  });
  vm.runInContext(`${cut('// ---------- Feedback to the developers, on a managed machine ----------', '// ---------- deleting the account ----------')}
    Object.assign(this, { feedbackAnswerRowHTML, drawFeedbackAnswerRow, devs: () => feedbackDevelopers, shots: () => feedbackShots });`, ctx);
  const root = element({ '#feedback-answer-row': slot });
  return { ctx, slot, box, icon, calls, toasts, root };
}

test('web: Settings has a slot for it only behind a front door, drawn in the same pass as the subscription', () => {
  assert.match(page().ctx.feedbackAnswerRowHTML(), /id="feedback-answer-row"/);
  assert.equal(page({ features: [] }).ctx.feedbackAnswerRowHTML(), '');
  assert.match(cut('function renderSettings()', '// ---------- backups ----------'), /\$\{feedbackAnswerRowHTML\(\)\}/);
  assert.match(cut('async function loadDeleteCard(root)', '// The confirmation'), /drawFeedbackAnswerRow\(root, session\)/);
});

test('web: the switch is there only on a managed machine and shows the answer', () => {
  const on = page();
  on.ctx.drawFeedbackAnswerRow(on.root, { feedbackAsk: false, feedbackTo: 'developers' });
  assert.equal(on.slot.hidden, false);
  assert.match(on.slot.innerHTML, /<input type="checkbox" id="feedback-answer" aria-label="Feedback to the developers" checked>/);
  assert.match(on.slot.innerHTML, /Your reports go to botdot's developers\./);
  const off = page();
  off.ctx.drawFeedbackAnswerRow(off.root, { feedbackAsk: true, feedbackTo: null });
  assert.equal(off.slot.hidden, false, 'not answered yet: the switch is there, off');
  assert.doesNotMatch(off.slot.innerHTML, /checked/);
  for (const session of [null, {}, { feedback: true, feedbackTo: 'admin' }, { feedbackAsk: 'true' }]) {
    const none = page();
    none.ctx.drawFeedbackAnswerRow(none.root, session);
    assert.equal(none.slot.hidden, true, JSON.stringify(session));
    assert.equal(none.slot.innerHTML, '');
  }
});

test("web: turning it on or off tells the front door and the Feedback icon follows; a refusal puts the switch back and says why", async () => {
  const p = page({ post: async (_, body) => ({ ok: true, on: body.on }) });
  p.ctx.drawFeedbackAnswerRow(p.root, { feedbackAsk: true, feedbackTo: null });
  p.box.checked = true;
  await p.box.onchange();
  assert.equal(JSON.stringify(p.calls), JSON.stringify([['/front-door/feedback-to-developers', { on: true }]]));
  assert.equal(p.icon.classList.contains('hidden'), false, 'the icon shows at once');
  assert.equal(p.ctx.devs(), true, 'and the form says the developers read it');
  assert.equal(p.ctx.shots(), true, 'and offers Add screenshot, as the session would say');
  p.box.checked = false;
  await p.box.onchange();
  assert.equal(JSON.stringify(p.calls.at(-1)), JSON.stringify(['/front-door/feedback-to-developers', { on: false }]));
  assert.equal(p.icon.classList.contains('hidden'), true);
  assert.equal(p.ctx.devs(), false);
  assert.equal(p.ctx.shots(), false);
  const refused = page({ post: async () => { throw new Error("Can't reach botdot."); } });
  refused.ctx.drawFeedbackAnswerRow(refused.root, { feedbackAsk: false, feedbackTo: null });
  refused.box.checked = true;
  await refused.box.onchange();
  assert.equal(refused.box.checked, false, 'put back');
  assert.equal(refused.box.disabled, false);
  assert.deepEqual(refused.toasts, [["Can't reach botdot.", true]]);
});
