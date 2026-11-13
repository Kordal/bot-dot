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
    '#delete-account-said': { textContent: '', classList: { remove() { this.shown = true; } } },
    '#delete-account-form': { onsubmit: null },
  };
  return { html: '', parts };
}

function page({ features = ['accounts'], post = async () => ({ ok: true, deleted: '/front-door/deleted' }) } = {}) {
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
  });
  vm.runInContext(`${cut('// ---------- deleting the account ----------', '// ---------- the way to the admin page ----------')}
    Object.assign(this, { deleteCardHTML, deleteCardInner, openDeleteAccount });`, ctx);
  return { ctx, posts, went, m };
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

test('web: a managed machine opens the page of botdot.app the front door names, in a new tab (#1312)', () => {
  const { ctx } = page();
  const html = ctx.deleteCardInner({ account: 'solo', admin: false, deleteAccount: false, deleteAccountPage: 'https://botdot.app/account-deletion/' });
  assert.match(html, /<a[^>]*id="delete-account-page"[^>]*href="https:\/\/botdot\.app\/account-deletion\/"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>Delete account…<\/a>/);
  assert.match(html, /Your account is deleted on botdot\.app: the page says how\./);
  assert.doesNotMatch(html, /id="delete-account"[ >]/, 'no Delete of its own');
  for (const bad of ['http://botdot.app/account-deletion/', 'javascript:alert(1)', 'not a url', 42]) {
    assert.equal(ctx.deleteCardInner({ account: 'solo', deleteAccount: false, deleteAccountPage: bad }), '', String(bad));
  }
  assert.equal(ctx.deleteCardInner({ account: 'solo', admin: false, deleteAccount: false, deleteAccountPage: null }), '', 'a self-hosted machine of one account shows nothing');
  assert.match(ctx.deleteCardInner({ account: 'bob', deleteAccount: true, deleteAccountPage: null }), /id="delete-account"/, '#1307 unchanged');
});

test('web: the confirmation lists what is lost and the 14 days, and Delete stays off until the name matches exactly', async () => {
  const { ctx, m, posts } = page();
  ctx.openDeleteAccount('bob');
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
  ctx.openDeleteAccount('bob');
  type(m, 'bob');
  await submit(m);
  assert.deepEqual(JSON.parse(JSON.stringify(posts)), [['/front-door/delete-account', { name: 'bob' }]]);
  assert.deepEqual(went, ['/front-door/deleted']);
});

test('web: a refusal is said in the form, and nothing is left', async () => {
  const { ctx, m, went } = page({ post: async () => { throw new Error('Type your account\'s name, bob, to delete it.'); } });
  ctx.openDeleteAccount('bob');
  type(m, 'bob');
  await submit(m);
  assert.deepEqual(went, []);
  assert.equal(m.parts['#delete-account-said'].textContent, "Type your account's name, bob, to delete it.");
  assert.equal(m.parts['#delete-account-go'].disabled, false, 'it can be tried again');
});

test('web: a second Delete is not sent while the first one waits, even when the name is typed again', async () => {
  let finish;
  const { ctx, m, posts } = page({ post: () => new Promise((r) => { finish = r; }) });
  ctx.openDeleteAccount('bob');
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
  ctx.openDeleteAccount('bob');
  type(m, 'bob');
  await submit(m);
  assert.deepEqual(went, [], 'it waits for the owner to read it');
  assert.match(m.parts['#delete-account-said'].textContent, /not all its machines on boat\.dev were \(boat\.dev: 1 machine not deleted \(timeout\)\)/);
  assert.equal(m.parts['#delete-account-go'].textContent, 'OK');
  await submit(m);
  assert.deepEqual(went, ['/front-door/deleted']);
  assert.equal(posts.length, 1, 'OK only leaves');
});
