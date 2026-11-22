// Feedback from the web page (#216, ADR 048): beside Settings, an icon shown when the front door says Feedback goes to
// an admin page, which opens a form (Bug or Feature request, and text). Send posts it to the front door; a send that
// fails keeps the form and its text, and says why. The page's own code, cut out of public/app.js and run against
// stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, read, element, answer, words } = require('./web-page');

function page({ fetch = answer(201, { ok: true }), session = answer(200, { admin: false, feedback: true }), kind = 'bug', text = 'Approve button does nothing on my phone' } = {}) {
  const calls = [];
  const toasts = [];
  const urls = { made: [], revoked: [] };
  const adminLink = element({}, { classes: ['hidden'] });
  const button = element({}, { classes: ['hidden'] });
  const said = element({}, { classes: ['hidden'] });
  const send = element();
  const form = element({}, { kind: { value: kind }, text: { value: text } });
  // The screenshots' box: what the page draws in it, and its remove buttons, one per data-unshot it drew.
  const shots = element({}, { classes: ['hidden'] });
  shots.querySelectorAll = () => (shots.drawn = [...shots.innerHTML.matchAll(/data-unshot="(\d+)"/g)].map(([, i]) => ({ dataset: { unshot: i } })));
  const add = element();
  const input = element({}, { files: [], clicked: 0, click() { input.clicked++; } });
  // My reports (#1568): the button in the form, and the list, with its "Send feedback" button, in the dialog that follows.
  const mineButton = element();
  const list = element({}, { innerHTML: '<li>Loading…</li>' });
  const newButton = element();
  const modal = element({ '#feedback-mine': mineButton, '#my-reports': list, '#my-reports-new': newButton, '#feedback-form': form, '#feedback-send': send, '#feedback-said': said, '#feedback-shots': shots, '#feedback-add': add, '#feedback-file': input }, {
    open: false, close() { modal.open = false; for (const fn of modal.listeners.close || []) fn(); modal.listeners.close = []; },
  });
  const ctx = vm.createContext({
    ...words,
    state: { features: ['accounts'] },
    I18n: { locale: 'en' },
    esc: (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    btoa: (b) => Buffer.from(b, 'latin1').toString('base64'),
    URL: { createObjectURL: (file) => { const u = `blob:${file.name}`; urls.made.push(u); return u; }, revokeObjectURL: (u) => urls.revoked.push(u) },
    $$: (sel, root) => root.querySelectorAll(sel),
    $: (sel, root) => (root ? root.querySelector(sel) : { '#admin-link': adminLink, '#feedback-btn': button }[sel] || null),
    openModal: (html) => { modal.html = html; modal.open = true; return modal; },
    toast: (t, err) => toasts.push([t, !!err]),
    fetch: async (url, opts) => { calls.push([url, opts]); return (url === '/front-door/session' ? session : fetch)(url, opts); },
  });
  vm.runInContext(`${cut('// ---------- the way to the admin page ----------', '// ---------- backups ----------')}
    Object.assign(this, { showAdminLink, openFeedback, sendFeedback, addFeedbackShots, openMyReports });`, ctx);
  return { ctx, calls, toasts, button, adminLink, modal, form, said, send, shots, add, input, urls, mineButton, list, newButton };
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
  const tools = html.slice(html.indexOf('<nav class="side-tools">'), html.indexOf('</nav>', html.indexOf('<nav class="side-tools">')));
  const b = tools.match(/<button [^>]*id="feedback-btn"[^>]*>/);
  assert.ok(b, 'the icon is in the top bar\'s tools (#635)');
  assert.match(b[0], /class="more-btn hidden"/);
  assert.match(b[0], /aria-label="Feedback"/);
  assert.ok(tools.indexOf('id="admin-link"') < tools.indexOf('id="feedback-btn"') && tools.indexOf('id="feedback-btn"') < tools.indexOf('id="more-btn"'), 'Settings last, at the right');
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

// A picked file as the browser hands it: a name, a type, a size, and its bytes.
const file = (name, type, size = 10) => ({ name, type, size, arrayBuffer: async () => new Uint8Array(Buffer.from(`${name}:${size}`)).buffer });
const withShots = async (opts) => { const p = page({ ...opts, session: answer(200, { admin: false, feedback: true, feedbackScreenshots: true }) }); await p.ctx.showAdminLink(); p.ctx.openFeedback(); return p; };

test('web: with a front door that takes screenshots the form has Add screenshot and says the admin sees them whole; without, neither', async () => {
  const p = await withShots();
  assert.match(p.modal.html, /id="feedback-add">Add screenshot</);
  assert.match(p.modal.html, /accept="image\/png,image\/jpeg,image\/webp" multiple hidden/);
  assert.match(p.modal.html, /sees each screenshot whole, as it is\. Only what you write and add here is sent\./);
  p.add.onclick();
  assert.equal(p.input.clicked, 1, 'the button opens the picker');
  const old = page();
  await old.ctx.showAdminLink();
  old.ctx.openFeedback();
  assert.doesNotMatch(old.modal.html, /Add screenshot/);
  assert.match(old.modal.html, /Only what you write here is sent\./);
});

test('web: a picked screenshot shows as a preview with a remove button; removed, it is not sent', async () => {
  const p = await withShots();
  p.input.files = [file('one.png', 'image/png'), file('two.jpg', 'image/jpeg')];
  p.input.onchange();
  assert.equal(p.shots.classList.contains('hidden'), false);
  assert.match(p.shots.innerHTML, /<img src="blob:one\.png" alt="Screenshot 1"><button type="button" data-unshot="0"/);
  assert.match(p.shots.innerHTML, /<img src="blob:two\.jpg"/);
  // Remove the first: its preview goes and its address is let go.
  p.shots.drawn[0].onclick();
  assert.deepEqual(p.urls.revoked, ['blob:one.png']);
  assert.doesNotMatch(p.shots.innerHTML, /one\.png/);
  assert.match(p.shots.innerHTML, /<img src="blob:two\.jpg" alt="Screenshot 1"><button type="button" data-unshot="0"/);
  await p.ctx.sendFeedback(p.modal);
  const body = JSON.parse(p.calls.at(-1)[1].body);
  assert.deepEqual(body.screenshots, [{ data: Buffer.from('two.jpg:10').toString('base64') }]);
  assert.equal(p.modal.open, false);
  assert.ok(p.urls.revoked.includes('blob:two.jpg'), 'closing lets the previews go');
});

test('web: a fourth screenshot, one over 5 MB and one that is no PNG, JPEG or WebP are refused in a sentence; the others stay', async () => {
  const p = await withShots();
  p.ctx.addFeedbackShots(p.modal, [file('a.png', 'image/png'), file('big.png', 'image/png', 6 * 1024 * 1024), file('logo.svg', 'image/svg+xml'), file('cat.gif', 'image/gif')]);
  assert.match(p.said.textContent, /big\.png is 6\.0 MB: each screenshot can be at most 5 MB\./);
  assert.match(p.said.textContent, /logo\.svg isn't a PNG, JPEG or WebP picture\./);
  assert.match(p.said.textContent, /cat\.gif isn't a PNG, JPEG or WebP picture\./);
  p.ctx.addFeedbackShots(p.modal, [file('b.webp', 'image/webp'), file('c.jpg', 'image/jpeg'), file('d.png', 'image/png')]);
  assert.equal(p.said.textContent, 'At most 3 screenshots go in one report.');
  assert.equal(p.modal._shots.length, 3);
  assert.equal(p.add.disabled, true, 'no more past three');
  assert.deepEqual(Array.from(p.modal._shots, (s) => s.file.name), ['a.png', 'b.webp', 'c.jpg']);
});

test('web: a failed send keeps the text and the screenshots, and says so', async () => {
  const p = await withShots({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
  p.ctx.addFeedbackShots(p.modal, [file('a.png', 'image/png')]);
  await p.ctx.sendFeedback(p.modal);
  assert.equal(p.modal.open, true);
  assert.match(p.said.textContent, /can't reach botdot\. Your text and screenshots are still here\./);
  assert.equal(p.modal._shots.length, 1);
  assert.deepEqual(p.urls.revoked, []);
});

test('web: when the front door sends Feedback to botdot\'s developers the form says they read it, that its text may be published without personal details and that screenshots never are', async () => {
  for (const shots of [true, false]) {
    const p = page({ session: answer(200, { admin: false, feedback: true, feedbackTo: 'developers', ...(shots ? { feedbackScreenshots: true } : {}) }) });
    await p.ctx.showAdminLink();
    assert.equal(p.button.classList.contains('hidden'), false);
    p.ctx.openFeedback();
    assert.match(p.modal.html, /<p class="muted" id="feedback-to">botdot's developers read it\. Its text may be published without personal details; screenshots never are\. Only what you write and add here is sent\.<\/p>/);
    assert.doesNotMatch(p.modal.html, /The admin of this machine/);
  }
  // An admin page, or an older front door that says nothing, keeps the form as it was.
  for (const session of [answer(200, { feedback: true, feedbackTo: 'admin' }), answer(200, { feedback: true })]) {
    const p = page({ session });
    await p.ctx.showAdminLink();
    p.ctx.openFeedback();
    assert.match(p.modal.html, /The admin of this machine reads it/);
    assert.doesNotMatch(p.modal.html, /developers read it/);
  }
});

// ---------- My reports (#1568) ----------

const REPORTS = [
  { id: 'a'.repeat(32), created: '2026-11-03T10:00:00.000Z', kind: 'bug', text: 'Approve does nothing\non my phone', status: 'fixed', fixedIn: '2026-11-25-the-fix', issue: 'https://github.com/Kordal/bot-dot/issues/1600', note: 'Thanks <b>so</b> much' },
  { id: 'b'.repeat(32), created: '2026-11-01T10:00:00.000Z', kind: 'feature', text: 'A dark theme', status: 'sent' },
];

test('web: My reports is offered in the form only when the front door lists them, and an older front door shows no button', async () => {
  const on = page({ session: answer(200, { feedback: true, feedbackTo: 'developers', feedbackReports: true }) });
  await on.ctx.showAdminLink();
  on.ctx.openFeedback();
  assert.match(on.modal.html, /<button type="button" class="btn ghost left" id="feedback-mine">My reports<\/button>/);
  for (const session of [answer(200, { feedback: true, feedbackTo: 'developers' }), answer(200, { feedback: true, feedbackReports: false }), answer(200, { feedback: true })]) {
    const off = page({ session });
    await off.ctx.showAdminLink();
    off.ctx.openFeedback();
    assert.doesNotMatch(off.modal.html, /My reports/);
  }
});

test('web: My reports lists each report with its status in plain words, the issue as a link opened in a tab of its own and the note as text', async () => {
  const p = page({ fetch: answer(200, { reports: REPORTS }) });
  await p.ctx.openMyReports();
  assert.equal(p.calls.at(-1)[0], '/front-door/feedback');
  assert.match(p.modal.html, /<h2>My reports<\/h2>/);
  const html = p.list.innerHTML;
  assert.match(html, /<b class="my-report-status">Fixed<\/b><span class="muted">Bug · (?:3 Nov|Nov 3)<\/span>/);
  assert.match(html, /<b class="my-report-status">Sent<\/b><span class="muted">Feature request · (?:1 Nov|Nov 1)<\/span>/);
  assert.match(html, /<a href="https:\/\/github\.com\/Kordal\/bot-dot\/issues\/1600" target="_blank" rel="noopener noreferrer">Public issue #1600<\/a>/);
  assert.match(html, /<p class="my-report-note muted">Thanks &lt;b&gt;so&lt;\/b&gt; much<\/p>/, 'the developers\' note is text, never markup');
  assert.doesNotMatch(html, /<b>so<\/b>/);
  assert.equal([...html.matchAll(/<a /g)].length, 1, 'a report with no issue has no link');
  for (const [status, word] of [['seen', 'Seen'], ['wontfix', "Won't fix"]]) {
    const q = page({ fetch: answer(200, { reports: [{ ...REPORTS[1], status }] }) });
    await q.ctx.openMyReports();
    assert.match(q.list.innerHTML, new RegExp(`<b class="my-report-status">${word.replace("'", '&#39;')}</b>`));
  }
});

test('web: My reports makes a link only for a public issue of botdot, and draws the report\'s own words as text', async () => {
  const evil = [{ ...REPORTS[0], text: '<img src=x onerror=alert(1)>', issue: 'javascript:alert(1)', note: '"><script>x</script>' }, { ...REPORTS[1], issue: 'https://github.com/other/repo/issues/1' }, { ...REPORTS[1], issue: 'https://github.com/Kordal/bot-dot/issues/1"onmouseover="x' }];
  const p = page({ fetch: answer(200, { reports: evil }) });
  await p.ctx.openMyReports();
  assert.doesNotMatch(p.list.innerHTML, /<a /);
  assert.doesNotMatch(p.list.innerHTML, /<img|<script/);
  assert.match(p.list.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('web: My reports says when there are none, and why a list could not be loaded', async () => {
  const none = page({ fetch: answer(200, { reports: [] }) });
  await none.ctx.openMyReports();
  assert.match(none.list.innerHTML, /You have not sent any report yet\./);
  const missing = page({ fetch: answer(404, { error: 'Not found' }) });
  await missing.ctx.openMyReports();
  assert.match(missing.list.innerHTML, /Not found/);
  const odd = page({ fetch: answer(502) });
  await odd.ctx.openMyReports();
  assert.match(odd.list.innerHTML, /Couldn&#39;t load your reports \(502\)\./);
  const down = page({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
  await down.ctx.openMyReports();
  assert.match(down.list.innerHTML, /Couldn&#39;t load your reports: can&#39;t reach botdot\./);
});

test('web: going to My reports and back keeps what was typed in the form', async () => {
  const p = page({ session: answer(200, { feedback: true, feedbackTo: 'developers', feedbackReports: true }), fetch: answer(200, { reports: REPORTS }), kind: 'feature', text: 'Half written' });
  await p.ctx.showAdminLink();
  p.ctx.openFeedback();
  p.mineButton.onclick();
  assert.doesNotMatch(p.modal.html, /id="feedback-form"/, 'the form gives way to the list');
  assert.match(p.modal.html, /My reports/);
  p.newButton.onclick();
  assert.match(p.modal.html, /id="feedback-form"/, 'Send feedback opens the form again');
  assert.equal(p.form.text.value, 'Half written');
});
