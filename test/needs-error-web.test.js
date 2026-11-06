// A failed Approve or Decline on the web page (#1071): the reason stands in the card's own line, read out, wherever
// the card stands, until the next answer on it; a card that is not on the page has the toast. The page's own code,
// cut out of it and run against stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, element } = require('./web-page');

const needs = read('needs.js');
const part = (from, to) => { const a = needs.indexOf(from), b = needs.indexOf(to, a + 1); assert.ok(a >= 0 && b > a, from); return needs.slice(a, b); };

function page(cards) {
  const toasts = [];
  const ctx = vm.createContext({
    toast: (...a) => toasts.push(a),
    $: (sel, root) => root.querySelector(sel),
    $$: (sel) => cards[sel] || [],
  });
  vm.runInContext(`${part('// Why an answer did not go (#1071)', '\n}\n')}\n} this.sayOnCard = sayOnCard;`, ctx);
  return { say: ctx.sayOnCard, toasts };
}
const line = () => element({}, { hidden: true });

test('web: a refused answer says why in every place its card stands, and the next answer clears it', () => {
  const here = line(), inChat = line();
  const sel = '.need-card[data-need="ask:a1"]';
  const p = page({ [sel]: [element({ ':scope > .req-error': here }), element({ ':scope > .req-error': inChat })] });
  p.say(sel, 'This bot is paused.');
  assert.deepEqual([here.textContent, here.hidden, inChat.textContent, inChat.hidden], ['This bot is paused.', false, 'This bot is paused.', false]);
  assert.deepEqual(p.toasts, [], 'no toast that is gone in 3 seconds');
  p.say(sel, '');
  assert.deepEqual([here.textContent, here.hidden], ['', true]);
});

test('web: a card that is not on the page has the toast', () => {
  const p = page({});
  p.say('.need-card[data-need="ask:gone"]', "Can't reach botdot.");
  assert.deepEqual(p.toasts, [["Can't reach botdot.", true]]);
  p.say('.need-card[data-need="ask:gone"]', '');
  assert.equal(p.toasts.length, 1, 'clearing says nothing');
});

test("web: every card and a run's card have their own line, read out, above the buttons, and both answers use it", () => {
  const slot = '<div class="req-error" role="alert" hidden></div>';
  const card = part('function needCardHTML(x', '// A job: one that waits');
  assert.ok(card.includes(`${slot}\n      <div class="need-actions">`));
  const batch = part('function batchCardHTML(x', '\n}\n');
  assert.ok(batch.includes(`${slot}\n      <div class="need-actions"><button class="btn sm" data-batch-no>`));
  const decide = part('async function decide(x', '// "Allow all" or "Decline all"');
  assert.match(decide, /sayOnCard\(`\.need-card\[data-need="\$\{CSS\.escape\(x\.key\)\}"\]`, ''\);/);
  assert.match(decide, /catch \(e\) \{ sayOnCard\(`\.need-card\[data-need="\$\{CSS\.escape\(x\.key\)\}"\]`, e\.message\); return; \}/);
  assert.doesNotMatch(decide, /toast\(e\.message/);
  const all = part('async function decideBatch(b', '// A card answered:');
  assert.ok(all.includes("catch (e) { sayOnCard(card, e.message); return; }"));
  assert.ok(all.includes("if (failed.length) sayOnCard(card, failed.join(' '));"));
});
