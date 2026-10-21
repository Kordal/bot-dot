// Feedback from the web page (#216, ADR 048): beside Settings, an icon shown when the front door says Feedback goes to
// an admin page, which opens a form (Bug or Feature request, and text). Send posts it to the front door; a send that
// fails keeps the form and its text, and says why. The page's own code, cut out of public/app.js and run against
// stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, read, element, answer } = require('./web-page');

function page({ fetch = answer(201, { ok: true }), session = answer(200, { admin: false, feedback: true }), kind = 'bug', text = 'Approve button does nothing on my phone' } = {}) {
  const calls = [];
  const toasts = [];
  const adminLink = element({}, { classes: ['hidden'] });
  const button = element({}, { classes: ['hidden'] });
  const said = element({}, { classes: ['hidden'] });
  const send = element();
  const form = element({}, { kind: { value: kind }, text: { value: text } });
  const modal = element({ '#feedback-form': form, '#feedback-send': send, '#feedback-said': said }, { open: false, close() { modal.open = false; } });
  const ctx = vm.createContext({
    state: { features: ['accounts'] },
    $: (sel, root) => (root ? root.querySelector(sel) : { '#admin-link': adminLink, '#feedback-btn': button }[sel] || null),
    openModal: (html) => { modal.html = html; modal.open = true; return modal; },
    toast: (t, err) => toasts.push([t, !!err]),
    fetch: async (url, opts) => { calls.push([url, opts]); return (url === '/front-door/session' ? session : fetch)(url, opts); },
  });
  vm.runInContext(`${cut('// ---------- the way to the admin page ----------', '// ---------- backups ----------')}
    Object.assign(this, { showAdminLink, openFeedback, sendFeedback });`, ctx);
  return { ctx, calls, toasts, button, adminLink, modal, form, said, send };
}

test('web: the Feedback icon shows when the front door says Feedback goes to an admin page, and only then', async () => {
  const on = page();
  await on.ctx.showAdminLink();
  assert.equal(on.button.classList.contains('hidden'), false);
  assert.equal(on.adminLink.classList.contains('hidden'), true, 'the Admin icon stays the admin\'s');
  for (const session of [answer(200, { admin: false, feedback: false }), answer(200, { admin: true }), answer(401, { error: 'Sign in first.' }), answer(404), async () => { throw new TypeError('Failed to fetch'); }]) {
    const off = page({ session });
    await off.ctx.showAdminLink();
    assert.equal(off.button.classList.contains('hidden'), true);
  }
});

test('web: the form sends the kind and the text to the front door, says Sent and closes', async () => {
  for (const [kind, text] of [['bug', 'Approve button does nothing on my phone'], ['feature', 'Add a dark theme']]) {
    const p = page({ kind, text });
    p.ctx.openFeedback();
    assert.match(p.modal.html, /The admin of this machine reads it/);
    assert.match(p.modal.html, /value="bug" checked> Bug/);
    assert.match(p.modal.html, /value="feature"> Feature request/);
    await p.ctx.sendFeedback(p.modal);
    const [url, opts] = p.calls.at(-1);
    assert.equal(url, '/front-door/feedback', "the front door's own route, not botdot's /api");
    assert.equal(opts.method, 'POST');
    assert.equal(opts.headers['X-Bot-Dot'], '1');
    assert.deepEqual(JSON.parse(opts.body), { kind, text });
    assert.equal(p.modal.open, false);
    assert.deepEqual(p.toasts, [['Sent', false]]);
  }
});

test("web: a refused or failed send keeps the form and its text, and says why", async () => {
  const refused = page({ fetch: answer(400, { error: 'That is 2001 characters: at most 2000 go in one report. Make it shorter.' }) });
  refused.ctx.openFeedback();
  await refused.ctx.sendFeedback(refused.modal);
  assert.equal(refused.modal.open, true);
  assert.equal(refused.form.text.value, 'Approve button does nothing on my phone');
  assert.equal(refused.said.classList.contains('hidden'), false);
  assert.match(refused.said.textContent, /at most 2000/);
  assert.equal(refused.send.disabled, false);

  const down = page({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
  down.ctx.openFeedback();
  await down.ctx.sendFeedback(down.modal);
  assert.equal(down.modal.open, true);
  assert.match(down.said.textContent, /can't reach botdot\. Your text is still here/);
  assert.deepEqual(down.toasts, []);

  const odd = page({ fetch: answer(502) });
  odd.ctx.openFeedback();
  await odd.ctx.sendFeedback(odd.modal);
  assert.match(odd.said.textContent, /Couldn't send \(502\)/);
});

test('web: the Feedback icon sits beside Settings, after the Admin icon, hidden until the front door says so', () => {
  const html = read('index.html');
  const foot = html.slice(html.indexOf('<nav class="side-foot">'), html.indexOf('</nav>', html.indexOf('<nav class="side-foot">')));
  const b = foot.match(/<button [^>]*id="feedback-btn"[^>]*>/);
  assert.ok(b, 'the icon is in the sidebar foot');
  assert.match(b[0], /class="more-btn hidden"/);
  assert.match(b[0], /aria-label="Feedback"/);
  assert.ok(foot.indexOf('id="more-btn"') < foot.indexOf('id="admin-link"') && foot.indexOf('id="admin-link"') < foot.indexOf('id="feedback-btn"'));
  assert.match(read('boot.js'), /\$\('#feedback-btn'\)\.onclick = \(\) => openFeedback\(\)/);
});

test('web: a form closed while it sent leaves the dialog opened since alone, and says the answer as a toast', async () => {
  const p = page({ fetch: answer(400, { error: 'Pick Bug or Feature request.' }) });
  p.ctx.openFeedback();
  const sending = p.ctx.sendFeedback(p.modal);
  p.modal.querySelector = () => null; // another dialog took the modal's place
  p.modal.open = true;
  await sending;
  assert.equal(p.modal.open, true);
  assert.deepEqual(p.toasts, [['Pick Bug or Feature request.', true]]);
});
