// The front door's own pages: sign in, sign up, a link that no longer works, an account being made, and the admin
// page. Plain HTML with one script each: /front-door/passkey.js, which talks to the browser's WebAuthn and to the
// front door's routes, and /front-door/admin.js for the admin page (docs/api.md).
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STYLE = `
:root { color-scheme: light dark; --bg: #f7f6f3; --fg: #1f1e1c; --muted: #525252; --line: #dedcd6; --dot: #d85a30; --err: #ca3636; }
@media (prefers-color-scheme: dark) { :root { --bg: #141413; --fg: #ecebe8; --muted: #a3a29e; --line: #34332f; --err: #ef6b6b; } }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
main { width: min(360px, calc(100vw - 32px)); }
main.wide { width: min(560px, calc(100vw - 32px)); }
ul { list-style: none; padding: 0; margin: 16px 0 0; }
li { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 10px 0; border-top: 1px solid var(--line); }
li span { color: var(--muted); font-size: 14px; }
li .actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
li.confirm { display: block; border-top: 0; padding: 0 0 12px; }
li button { width: auto; padding: 6px 12px; background: transparent; color: var(--fg); border: 1px solid var(--line); font-weight: 500; }
h1 { font-size: 22px; margin: 0 0 8px; } h1 span { color: var(--dot); }
h2 { font-size: 17px; margin: 16px 0 4px; }
p { color: var(--muted); margin: 0 0 16px; }
label { display: block; font-size: 14px; margin: 0 0 4px; }
input { box-sizing: border-box; width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit; font: inherit; margin: 0 0 16px; }
button { width: 100%; padding: 10px 12px; border: 0; border-radius: 8px; background: var(--dot); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
button:disabled { opacity: .6; cursor: default; }
#said { color: var(--err); min-height: 1.5em; margin: 12px 0 0; }
form.share { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 0 12px; align-items: end; }
form.share p, form.share button { grid-column: 1 / -1; }
form.share input { margin: 4px 0 12px; }
li .full { color: var(--err); font-weight: 600; }
`;

function page(title, body, { script = 'passkey', head = '', wide = false } = {}) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${head}
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body><main${wide ? ' class="wide"' : ''}>${body}<p id="said" role="alert"></p></main>${script ? `<script src="/front-door/${script}.js"></script>` : ''}</body></html>`;
}

const signIn = () => page('Sign in · botdot', `<h1>bot<span>·</span>dot</h1>
<p>Sign in with your passkey.</p>
<button id="sign-in" type="button">Sign in</button>`);

// Before the first account exists: nothing to sign in to, and only the install's link makes the account.
const notYet = () => page('botdot', `<h1>bot<span>·</span>dot</h1>
<p>Open the link from your server's install.</p>`);

// name: the one account this link makes (the install's link makes the admin's), set and not to be changed.
const signUp = ({ name = null } = {}) => page('Sign up · botdot', `<h1>bot<span>·</span>dot</h1>
<p>The admin of this machine can technically reach everything in your account.</p>
<form id="sign-up"><label for="name">Your account's name</label>
<input id="name" name="name" ${name ? `value="${esc(name)}" readonly ` : ''}required pattern="[a-z][a-z0-9\\-]{1,23}" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="lowercase letters, digits and dashes">
<button type="submit">Create my passkey</button></form>`);

// The admin's sign-in link: a new passkey for the account `name`, which exists. The same form and script as a
// sign-up, with the name set.
const newPasskey = ({ name }) => page('Sign in · botdot', `<h1>bot<span>·</span>dot</h1>
<p>Make a new passkey for your account, ${esc(name)}. Your bots and data are as you left them.</p>
<form id="sign-up"><input id="name" name="name" type="hidden" value="${esc(name)}">
<button type="submit">Make my passkey</button></form>`);

// A new account whose botdot server the machine is still making: the page looks again by itself.
const making = () => page('botdot', `<h1>bot<span>·</span>dot</h1>
<p>Your account is being made. It takes a few minutes, and this page opens it when it is ready.</p>`, { head: '<meta http-equiv="refresh" content="15">' });

// An account the admin resumed, whose botdot server the machine is starting again.
const starting = () => page('botdot', `<h1>bot<span>·</span>dot</h1>
<p>Your account is starting. This page opens it when it is ready.</p>`, { head: '<meta http-equiv="refresh" content="10">' });

// A suspended account: this, and nothing else, until the admin resumes it.
const paused = () => page('botdot', `<h1>bot<span>·</span>dot</h1>
<p>Your account is paused by the admin.</p>`, { script: null, head: '<meta http-equiv="refresh" content="60">' });

// The machine: its load, and the share every account has unless it has its own (ADR 028). Only the admin page shows a
// share or a load; nothing in an account does.
const SHARES = `<h2>The machine</h2>
<p id="machine-load">No load measured yet.</p>
<form id="default-share" class="share"><p>Each account's share, unless it has its own:</p>
<label>CPUs <input name="cpu" type="number" min="1" max="256" required></label>
<label>RAM, GB <input name="ram" type="number" min="2" max="4096" required></label>
<label>Computers at once <input name="computers" type="number" min="1" max="50" required></label>
<label>Disk, GB <input name="disk" type="number" min="12" max="100000" required></label>
<button type="submit">Save the default share</button></form>`;

// The admin page: the machine's load and the default share, the accounts (each one's share and use, suspended,
// resumed, deleted, a new sign-in link), sign-up links (made, listed and revoked) and the update of every account at
// once. It never shows what is inside an account.
const admin = () => page('Admin · botdot', `<h1>bot<span>·</span>dot</h1>
${SHARES}
<h2>Accounts</h2>
<ul id="accounts"></ul>
<div id="sign-in-made" hidden><label for="sign-in-link"></label><input id="sign-in-link" readonly></div>
<h2>Sign-up links</h2>
<p>A link makes one account. Hand it to one person: it works once, for 7 days.</p>
<button id="new-link" type="button">New sign-up link</button>
<div id="made" hidden><label for="link">The new link (shown once)</label><input id="link" readonly></div>
<ul id="links"></ul>
<h2>Update</h2>
<p id="version">Checking…</p>
<p id="self-built" hidden>botdot here is built from the source on this machine. Run git pull and make images in the source first: Update then moves every account to what you built.</p>
<button id="update" type="button">Update every account</button>`, { script: 'admin', wide: true });

const ended = () => page('botdot', `<h1>bot<span>·</span>dot</h1>
<p>This link was used or has ended. Ask the admin of this machine for a new one.</p>`);

// The browser's half: WebAuthn wants bytes where the front door sends base64url, and the other way round.
const SCRIPT = `'use strict';
(() => {
  const toBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const toText = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  const said = (t) => { document.getElementById('said').textContent = t; };
  async function post(path, body) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'The front door could not do that.');
    return data;
  }
  const out = (c) => ({
    id: c.id, rawId: toText(c.rawId), type: c.type,
    response: Object.fromEntries(['clientDataJSON', 'attestationObject', 'authenticatorData', 'signature', 'userHandle']
      .filter((k) => c.response[k]).map((k) => [k, toText(c.response[k])])),
  });
  const quiet = (e) => e && (e.name === 'NotAllowedError' || e.name === 'AbortError');
  // In the Mac app's sheet (?app=mac&handoff=…): the sign-in goes back to the app as a code, not as this page's cookie.
  const asked = new URLSearchParams(location.search);
  const sheet = asked.get('app') === 'mac' && asked.get('handoff') ? { app: 'mac', handoff: asked.get('handoff') } : { app: 'web' };
  const done = (answer) => {
    if (sheet.handoff) location.replace('botdot://signed-in?code=' + encodeURIComponent(answer.code));
    else location.replace('/');
  };

  const signIn = document.getElementById('sign-in');
  if (signIn) signIn.addEventListener('click', async () => {
    signIn.disabled = true; said('');
    try {
      const { publicKey } = await post('/sign-in/options', {});
      publicKey.challenge = toBytes(publicKey.challenge);
      const c = await navigator.credentials.get({ publicKey });
      done(await post('/sign-in', { credential: out(c), ...sheet }));
    } catch (e) { if (!quiet(e)) said(e.message); } finally { signIn.disabled = false; }
  });

  const signUp = document.getElementById('sign-up');
  if (signUp) signUp.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const button = signUp.querySelector('button');
    const name = signUp.elements.name.value.trim();
    button.disabled = true; said('');
    try {
      const { publicKey } = await post(location.pathname + '/options', { name });
      publicKey.challenge = toBytes(publicKey.challenge);
      publicKey.user.id = toBytes(publicKey.user.id);
      const c = await navigator.credentials.create({ publicKey });
      done(await post(location.pathname, { name, credential: out(c), ...sheet }));
    } catch (e) { if (!quiet(e)) said(e.message); } finally { button.disabled = false; }
  });
})();
`;

// The admin page's half: lists the accounts and the links; suspends, resumes and deletes an account, makes a sign-in
// link for one, and makes and revokes sign-up links. Everything it shows is text, never markup.
const ADMIN_SCRIPT = `'use strict';
(() => {
  const said = (t) => { document.getElementById('said').textContent = t; };
  async function call(method, path, body = {}) {
    const res = await fetch(path, { method, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Bot-Dot': '1' }, body: method === 'GET' ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'The front door could not do that.');
    return data;
  }
  const day = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const el = (tag, text) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; return e; };
  const button = (text, act) => {
    const b = el('button', text);
    b.type = 'button';
    b.addEventListener('click', async () => {
      b.disabled = true; said('');
      try { await act(); } catch (e) { said(e.message); } finally { b.disabled = false; }
    });
    return b;
  };
  // A link that is shown once, when it is made.
  function shown(id, label, url) {
    const box = document.getElementById(id);
    box.hidden = false;
    box.querySelector('label').textContent = label;
    const field = box.querySelector('input');
    field.value = url;
    field.focus(); field.select();
  }

  // ---------- shares and load ----------
  const GB = 1e9;
  const gb = (bytes) => (bytes >= 10 * GB ? Math.round(bytes / GB) : Math.round(bytes / GB * 10) / 10) + ' GB';
  const cpus = (n) => n + ' CPU' + (n === 1 ? '' : 's');
  const computers = (n) => n + ' computer' + (n === 1 ? '' : 's');
  const shareText = (s) => [cpus(s.cpu), s.ram + ' GB RAM', computers(s.computers) + ' at once', s.disk + ' GB disk'].join(' · ');
  // What root's step measured of an account, against its share: nothing when it measured nothing yet.
  function useText(u, s) {
    if (!u) return 'Use not measured yet';
    const parts = [];
    if (u.cpu !== undefined) parts.push('CPU ' + (Math.round(u.cpu * 10) / 10) + ' of ' + s.cpu);
    if (u.ram !== undefined) parts.push('RAM ' + gb(u.ram) + ' of ' + s.ram + ' GB');
    if (u.computers !== undefined) parts.push(u.computers + ' of ' + computers(s.computers));
    if (u.diskUsed !== undefined) parts.push('disk ' + gb(u.diskUsed) + ' of ' + (u.diskSize ? gb(u.diskSize) : s.disk + ' GB'));
    return parts.length ? 'Uses ' + parts.join(' · ') : 'Use not measured yet';
  }
  function fill(form, share) { for (const k of ['cpu', 'ram', 'computers', 'disk']) form.elements[k].value = share[k]; }
  const read = (form) => Object.fromEntries(['cpu', 'ram', 'computers', 'disk'].map((k) => [k, Number(form.elements[k].value)]));
  async function showMachine() {
    const { share, machine } = await call('GET', '/admin/share');
    const m = machine;
    document.getElementById('machine-load').textContent = m
      ? ['Load ' + (Math.round(m.load * 10) / 10) + ' on ' + cpus(m.cpus), 'RAM ' + gb(m.ramUsed) + ' of ' + gb(m.ramTotal), 'disk ' + gb(m.diskUsed) + ' of ' + gb(m.diskTotal)].join(' · ')
      : 'No load measured yet.';
    const form = document.getElementById('default-share');
    if (!form.contains(document.activeElement)) fill(form, share);
  }
  const defaultShare = document.getElementById('default-share');
  defaultShare.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const b = defaultShare.querySelector('button');
    b.disabled = true; said('');
    try { await call('POST', '/admin/share', read(defaultShare)); await showMachine(); await showAccounts(); } catch (e) { said(e.message); } finally { b.disabled = false; }
  });
  // An account's own share, asked below its row.
  function shareForm(row, a) {
    if (row.nextElementSibling && row.nextElementSibling.classList.contains('confirm')) return;
    const box = el('li');
    box.className = 'confirm';
    const form = el('form');
    form.className = 'share';
    form.append(el('p', 'The share of ' + a.name + ':'));
    for (const [k, label, min, max] of [['cpu', 'CPUs', 1, 256], ['ram', 'RAM, GB', 2, 4096], ['computers', 'Computers at once', 1, 50], ['disk', 'Disk, GB', 12, 100000]]) {
      const l = el('label', label + ' ');
      const i = el('input');
      i.name = k; i.type = 'number'; i.min = min; i.max = max; i.required = true;
      l.append(i);
      form.append(l);
    }
    fill(form, a.share);
    const save = el('button', 'Save the share of ' + a.name);
    save.type = 'submit';
    form.append(save);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      save.disabled = true; said('');
      try { await call('POST', '/admin/accounts/' + a.name + '/share', read(form)); await showAccounts(); } catch (e) { said(e.message); } finally { save.disabled = false; }
    });
    box.append(form);
    if (a.ownShare) box.append(button('Back to the default share', async () => { await call('POST', '/admin/accounts/' + a.name + '/share', { default: true }); await showAccounts(); }));
    row.after(box);
    form.elements.cpu.focus();
  }

  const STATES = { running: 'Running', suspended: 'Suspended', making: 'Being made', starting: 'Starting', stopped: 'Not running' };
  async function showAccounts() {
    const { accounts } = await call('GET', '/admin/accounts');
    document.getElementById('accounts').replaceChildren(...accounts.map((a) => {
      const row = el('li');
      const text = el('div', a.name + (a.admin ? ' (you)' : ''));
      text.append(el('br'), el('span', [STATES[a.state] || a.state, 'made ' + day(a.created), a.lastSeen ? 'last seen ' + day(a.lastSeen) : 'not seen yet'].join(' · ')));
      // Its share and its use of it; a full disk is marked: its runs fail with "No space left on the server".
      if (a.use && a.use.full) { const full = el('span', ' Disk full'); full.className = 'full'; text.append(full); }
      text.append(el('br'), el('span', 'Share ' + shareText(a.share) + (a.ownShare ? ' (its own)' : '')), el('br'), el('span', useText(a.use, a.share)));
      const actions = el('div');
      actions.className = 'actions';
      actions.append(button('Change share', async () => shareForm(row, a)));
      if (!a.admin) {
        actions.append(a.state === 'suspended'
          ? button('Resume', async () => { await call('POST', '/admin/accounts/' + a.name + '/resume'); await showAccounts(); })
          : button('Suspend', async () => { await call('POST', '/admin/accounts/' + a.name + '/suspend'); await showAccounts(); }));
      }
      actions.append(button('New sign-in link', async () => {
        const { url } = await call('POST', '/admin/accounts/' + a.name + '/sign-in-link');
        shown('sign-in-made', 'The sign-in link for ' + a.name + ' (shown once): it makes a new passkey for this account, works once, for 1 day', url);
        await showLinks();
      }));
      if (!a.admin) {
        actions.append(button('Delete', async () => {
          // Asked here: the account's name, typed.
          if (row.nextElementSibling && row.nextElementSibling.classList.contains('confirm')) return;
          const confirm = el('li');
          confirm.className = 'confirm';
          const label = el('label', 'Type ' + a.name + ' to delete it for good: its bots, chats, data and computers');
          const field = el('input');
          field.id = 'delete-' + a.name;
          label.htmlFor = field.id;
          field.autocomplete = 'off';
          field.spellcheck = false;
          confirm.append(label, field, button('Delete ' + a.name, async () => {
            await call('POST', '/admin/accounts/' + a.name + '/delete', { name: field.value.trim() });
            await showAccounts();
          }));
          row.after(confirm);
          field.focus();
        }));
      }
      row.append(text, actions);
      return row;
    }));
  }

  const what = (l) => l.state === 'open' ? 'Open until ' + day(l.expires)
    : l.state === 'used' ? 'Used by ' + l.account + ' on ' + day(l.usedAt)
    : l.revokedAt ? 'Revoked on ' + day(l.revokedAt) : 'Ended on ' + day(l.expires);
  async function showLinks() {
    const { links } = await call('GET', '/admin/links');
    document.getElementById('links').replaceChildren(...links.map((l) => {
      const row = el('li');
      const text = el('div', (l.signIn ? 'Sign-in link: ' : '') + what(l));
      text.append(el('br'), el('span', 'Made ' + day(l.created) + (l.for ? ', for ' + l.for : '')));
      row.append(text);
      if (l.state === 'open') row.append(button('Revoke', async () => { await call('POST', '/admin/links/' + l.id + '/revoke'); await showLinks(); }));
      return row;
    }));
  }
  const newLink = document.getElementById('new-link');
  newLink.addEventListener('click', async () => {
    newLink.disabled = true; said('');
    try {
      const { url } = await call('POST', '/admin/links');
      shown('made', 'The new link (shown once)', url);
      await showLinks();
    } catch (e) { said(e.message); } finally { newLink.disabled = false; }
  });

  // The update (#473): the front door and every account move to the newest version together, by root's step. The
  // front door itself restarts meanwhile, so a question that gets no answer is waited out.
  const updateButton = document.getElementById('update');
  let watching = null;
  function showUpdate(u) {
    const busy = u.asked || (u.update && u.update.state === 'updating');
    const last = u.update;
    let text = busy ? 'Updating the front door and every account. It takes a few minutes.'
      : u.version ? 'Every account runs version ' + u.version + '.' : 'Every account runs the same version.';
    if (!busy && last && last.state === 'failed') text += ' The last update stopped: ' + (last.error || 'see update.log on the machine') + '.';
    else if (!busy && last && last.state === 'updated' && last.at) text += last.from && last.from === last.to ? ' It was the newest already on ' + day(last.at) + '.' : ' Updated on ' + day(last.at) + '.';
    document.getElementById('version').textContent = text;
    document.getElementById('self-built').hidden = !u.selfBuilt;
    updateButton.disabled = busy;
    if (busy && !watching) watching = setInterval(watchUpdate, 5000);
    if (!busy && watching) { clearInterval(watching); watching = null; showAccounts().catch(() => {}); }
  }
  async function watchUpdate() {
    try { showUpdate(await call('GET', '/admin/update')); } catch { /* the front door is restarting */ }
  }
  updateButton.addEventListener('click', async () => {
    if (!confirm('Update botdot now? The front door and every account restart on the newest version, which takes a few minutes. Work still running stops.')) return;
    updateButton.disabled = true; said('');
    try { showUpdate(await call('POST', '/admin/update')); } catch (e) { said(e.message); updateButton.disabled = false; }
  });
  showMachine().catch((e) => said(e.message));
  showAccounts().catch((e) => said(e.message));
  showLinks().catch((e) => said(e.message));
  call('GET', '/admin/update').then(showUpdate, (e) => said(e.message));
  // Load is measured every minute: the page shows the newest.
  setInterval(() => { showMachine().catch(() => {}); if (!document.querySelector('li.confirm')) showAccounts().catch(() => {}); }, 60_000);
})();
`;

module.exports = { signIn, signUp, newPasskey, notYet, ended, making, starting, paused, admin, SCRIPT, ADMIN_SCRIPT };
