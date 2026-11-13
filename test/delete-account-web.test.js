// "Delete account" in Settings on the web page (#1307): shown only where the front door's session says so, never for
// the admin's own account, and its Delete works only once the account's name is typed exactly. The page's own code,
// cut out of public/app.js and run against stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, esc, words } = require('./web-page');

// A stand-in form: the name field, the Delete button and the line that says a refusal.
function modal() {
  const parts = {
    'input[name="name"]': { value: '', oninput: null },
    '#delete-account-go': { disabled: true },
    '#delete-account-said': { textContent: '', classList: { remove() { this.shown = true; }, add() { this.shown = false; } } },
    '#delete-account-form': { onsubmit: null },
  };
  return { html: '', parts };
}

function page({ features = ['accounts'], post = async () => ({ ok: true, deleted: '/front-door/deleted' }), sessions = [] } = {}) {
  const timers = [];
  const posts = [];
  const went = [];
  const m = modal();
  const ctx = vm.createContext({
    ...words,
    esc,
    URL,
    state: { features },
    CHEV: '',
    openModal: (html) => { m.html = html; return m; },
    $: (sel, root) => root.parts[sel],
    frontDoorPost: async (p, body) => { posts.push([p, body]); return post(p, body); },
    location: { assign: (to) => went.push(to) },
    // The session asked while the console ends the subscription: each answer in turn, [status, body].
    fetch: async () => { const [status, body] = sessions.shift() || [200, { deletion: 'pending' }]; return { status, ok: status === 200, json: async () => body }; },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
    document: { parts: {} },
  });
  vm.runInContext(`${cut('// ---------- deleting the account ----------', '// ---------- the way to the admin page ----------')}
    Object.assign(this, { deleteCardHTML, deleteCardInner, openDeleteAccount });`, ctx);
  // Runs the timers set so far, as the clock would.
  const tick = async () => { for (const fn of timers.splice(0)) await fn(); };
  return { ctx, posts, went, m, tick };
}

const type = (m, value) => { m.parts['input[name="name"]'].value = value; m.parts['input[name="name"]'].oninput(); };
const submit = async (m) => { m.parts['#delete-account-form'].onsubmit({ preventDefault() {} }); await new Promise((r) => setImmediate(r)); };

test('web: Settings shows "Delete account" only where the front door offers it', () => {
  const { ctx } = page();
  assert.match(ctx.deleteCardHTML(), /id="delete-account-card"/);
  assert.equal(page({ features: [] }).ctx.deleteCardHTML(), '', 'a botdot server without accounts has none');
  assert.match(ctx.deleteCardInner({ account: 'bob', admin: false, deleteAccount: true }), /<button[^>]*id="delete-account"[^>]*>Delete account…<\/button>/);
  assert.equal(ctx.deleteCardInner({ account: 'bob', admin: false }), '', 'an older front door, which leaves it out, shows nothing');
  assert.equal(ctx.deleteCardInner(null), '');
  assert.match(cut('function renderSettings()', '// ---------- backups ----------'), /\$\{deleteCardHTML\(\)\}[\s\S]*loadDeleteCard\(root\)/);
});

test("web: the admin's own account is not offered it, and Settings says the machine is removed by its admin", () => {
  const html = page().ctx.deleteCardInner({ account: 'ann', admin: true, deleteAccount: false });
  assert.doesNotMatch(html, /id="delete-account"/);
  assert.match(html, /The machine is removed by its admin instead\./);
});

test('web: on a managed machine the card shows a deletion waiting for the console, or the one that failed (#1313)', () => {
  const { ctx } = page();
  const pending = ctx.deleteCardInner({ account: 'solo', deleteAccount: true, deletion: 'pending' });
  assert.match(pending, /<button[^>]*disabled>Deleting…<\/button>/);
  assert.doesNotMatch(pending, /id="delete-account"[ >]/, 'no second Delete while it waits');
  const failed = ctx.deleteCardInner({ account: 'solo', deleteAccount: true, deletion: 'failed' });
  assert.match(failed, /Your subscription couldn't be cancelled, so nothing was deleted\. Try again later\./);
  assert.match(failed, /id="delete-account"/, 'it can be tried again');
  assert.doesNotMatch(ctx.deleteCardInner({ account: 'solo', deleteAccount: false, deleteAccountPage: 'https://botdot.app/account-deletion/' }), /botdot\.app/, 'no page of botdot.app any more (#1312)');
});

test('web: the confirmation of the account that pays says the subscription is cancelled first, and names the others', () => {
  const { ctx, m } = page();
  ctx.openDeleteAccount({ account: 'owner', deleteEndsSubscription: true, deletesAlso: ['ann', '<b>'] });
  assert.match(m.html, /Your subscription is cancelled first\./);
  assert.match(m.html, /The other accounts on this machine are deleted too: ann, &lt;b&gt;\./);
  ctx.openDeleteAccount({ account: 'bob' });
  assert.doesNotMatch(m.html, /subscription|other accounts/, 'a self-hosted account says neither');
});

test('web: a deletion the console must allow waits in the form, then opens the deleted page once the account is gone', async () => {
  const { ctx, m, went, tick } = page({ post: async () => ({ ok: true, pending: true }), sessions: [[200, { deletion: 'pending' }], [401, {}]] });
  ctx.openDeleteAccount({ account: 'owner', deleteEndsSubscription: true });
  type(m, 'owner');
  await submit(m);
  assert.equal(m.parts['#delete-account-go'].textContent, 'Deleting…');
  assert.equal(m.parts['#delete-account-go'].disabled, true);
  assert.deepEqual(went, []);
  await tick();
  assert.deepEqual(went, [], 'still pending');
  await tick();
  assert.deepEqual(went, ['/front-door/deleted']);
});

test('web: when the console could not cancel the subscription, the form says nothing was deleted and Delete works again', async () => {
  const { ctx, m, went, tick } = page({ post: async () => ({ ok: true, pending: true }), sessions: [[200, { deletion: 'failed' }]] });
  ctx.openDeleteAccount({ account: 'owner', deleteEndsSubscription: true });
  type(m, 'owner');
  await submit(m);
  await tick();
  assert.deepEqual(went, []);
  assert.match(m.parts['#delete-account-said'].textContent, /nothing was deleted/);
  assert.equal(m.parts['#delete-account-go'].disabled, false);
  assert.equal(m.parts['#delete-account-go'].textContent, 'Delete account');
});

test('web: the confirmation lists what is lost and the 14 days, and Delete stays off until the name matches exactly', async () => {
  const { ctx, m, posts } = page();
  ctx.openDeleteAccount({ account: 'bob' });
  assert.match(m.html, /the account, its bots, chats, files, notes, Board, containers, passkeys, sessions and feedback/);
  assert.match(m.html, /14 days/);
  assert.match(m.html, /Type your account name, bob, to confirm/);
  const go = m.parts['#delete-account-go'];
  assert.equal(go.disabled, true);
  for (const wrong of ['bo', 'Bob', 'bob ', ' bob']) { type(m, wrong); assert.equal(go.disabled, true, wrong); }
  await submit(m);
  assert.deepEqual(posts, [], 'nothing is deleted without the name');
  type(m, 'bob');
  assert.equal(go.disabled, false);
});

test("web: Delete asks the front door's own route, then opens the deleted page", async () => {
  const { ctx, m, posts, went } = page();
  ctx.openDeleteAccount({ account: 'bob' });
  type(m, 'bob');
  await submit(m);
  assert.deepEqual(JSON.parse(JSON.stringify(posts)), [['/front-door/delete-account', { name: 'bob' }]]);
  assert.deepEqual(went, ['/front-door/deleted']);
});

test('web: a refusal is said in the form, and nothing is left', async () => {
  const { ctx, m, went } = page({ post: async () => { throw new Error('Type your account\'s name, bob, to delete it.'); } });
  ctx.openDeleteAccount({ account: 'bob' });
  type(m, 'bob');
  await submit(m);
  assert.deepEqual(went, []);
  assert.equal(m.parts['#delete-account-said'].textContent, "Type your account's name, bob, to delete it.");
  assert.equal(m.parts['#delete-account-go'].disabled, false, 'it can be tried again');
});

test('web: a second Delete is not sent while the first one waits, even when the name is typed again', async () => {
  let finish;
  const { ctx, m, posts } = page({ post: () => new Promise((r) => { finish = r; }) });
  ctx.openDeleteAccount({ account: 'bob' });
  type(m, 'bob');
  await submit(m);
  type(m, 'bo'); type(m, 'bob');
  assert.equal(m.parts['#delete-account-go'].disabled, true, 'still off while it waits');
  await submit(m);
  assert.equal(posts.length, 1);
  finish({ ok: true, deleted: '/front-door/deleted' });
});

test("web: when boat.dev's machines were not all deleted, the form says so before it leaves, with no second delete", async () => {
  const { ctx, m, posts, went } = page({ post: async () => ({ ok: true, deleted: '/front-door/deleted', boat: 'boat.dev: 1 machine not deleted (timeout)' }) });
  m.parts['#delete-account-go'].classList = { remove() {} };
  ctx.openDeleteAccount({ account: 'bob' });
  type(m, 'bob');
  await submit(m);
  assert.deepEqual(went, [], 'it waits for the owner to read it');
  assert.match(m.parts['#delete-account-said'].textContent, /not all its machines on boat\.dev were \(boat\.dev: 1 machine not deleted \(timeout\)\)/);
  assert.equal(m.parts['#delete-account-go'].textContent, 'OK');
  await submit(m);
  assert.deepEqual(went, ['/front-door/deleted']);
  assert.equal(posts.length, 1, 'OK only leaves');
});
