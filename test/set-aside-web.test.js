// A dialog set aside while its save runs on (#478, public/app.js `setAside`): it goes away at once, the corner pill
// says how it went, and a refusal brings the same dialog back, nothing typed lost, with the server's sentence in it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, words } = require('./web-page');

function page() {
  const pills = [];
  const toasts = [];
  const say = { textContent: '', hidden: true };
  const typed = { value: 'what was typed' };
  const modal = {
    open: true, shown: 0, childNodes: [typed],
    close() { modal.open = false; },
    showModal() { modal.open = true; modal.shown++; },
    replaceChildren(frag) { modal.childNodes = frag.nodes; },
  };
  const ctx = vm.createContext({ ...words,
    document: { createDocumentFragment: () => ({ nodes: [], append(...n) { this.nodes.push(...n); } }) },
    $: (sel) => (sel === '.req-error' ? say : null),
    cornerPill: (kind, text, retry) => pills.push({ kind, text, retry }),
    toast: (t, bad) => toasts.push([t, !!bad]),
  });
  vm.runInContext(read('app.js').match(/async function setAside[\s\S]*?\n}\n/)[0], ctx);
  return { setAside: ctx.setAside, pills, toasts, say, typed, modal };
}

test('web: a dialog set aside is gone before the server answers, and the pill says it saved (#478)', async () => {
  const p = page();
  let answer;
  const saving = p.setAside(p.modal, 'Saving…', () => new Promise((r) => { answer = r; }), { ok: 'Saved' });
  assert.equal(p.modal.open, false, 'closed at once');
  assert.deepEqual(p.pills.map((x) => [x.kind, x.text]), [['busy', 'Saving…']]);
  answer();
  assert.equal(await saving, true);
  assert.deepEqual(p.pills.map((x) => [x.kind, x.text]), [['busy', 'Saving…'], ['ok', 'Saved']]);
  assert.equal(p.modal.shown, 0, 'not brought back');
});

test('web: refused, the same dialog comes back with what was typed and the server\'s sentence (#478)', async () => {
  const p = page();
  assert.equal(await p.setAside(p.modal, 'Saving…', async () => { throw new Error('That address is not allowed'); }), false);
  assert.equal(p.modal.open, true);
  assert.equal(p.modal.childNodes[0], p.typed, 'the same nodes, so nothing typed is lost');
  assert.deepEqual([p.say.textContent, p.say.hidden], ['That address is not allowed', false]);
});

test('web: refused while another dialog is open, the error pill\'s tap brings it back (#478)', async () => {
  const p = page();
  const saved = p.setAside(p.modal, 'Saving…', async () => { p.modal.open = true; p.modal.childNodes = ['another dialog']; throw new Error('No'); });
  assert.equal(await saved, false);
  const err = p.pills.at(-1);
  assert.deepEqual([err.kind, err.text], ['err', 'No']);
  assert.deepEqual(p.modal.childNodes, ['another dialog'], 'the other dialog stays');
  err.retry();
  assert.deepEqual(p.modal.childNodes, ['another dialog'], 'still open: nothing happens yet');
  p.modal.open = false;
  err.retry();
  assert.equal(p.modal.childNodes[0], p.typed);
});
