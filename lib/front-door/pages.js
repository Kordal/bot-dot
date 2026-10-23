// @ts-check
// The front door's own pages: sign in, sign up, a link that no longer works, an account being made, and the admin
// page. Plain HTML with one script each: /front-door/passkey.js, which talks to the browser's WebAuthn and to the
// front door's routes, and /front-door/admin.js for the admin page (docs/api.md).
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STYLE = `
:root { color-scheme: dark; --bg: #141413; --fg: #ecebe8; --muted: #a3a29e; --line: #34332f; --dot: #d85a30; --err: #ef6b6b; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
main { width: min(360px, calc(100vw - 32px)); }
h1 { font-size: 22px; margin: 0 0 8px; } h1 span { color: var(--dot); }
p { color: var(--muted); margin: 0 0 16px; }
label { display: block; font-size: 14px; margin: 0 0 4px; }
input { box-sizing: border-box; width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit; font: inherit; margin: 0 0 16px; }
button { width: 100%; padding: 10px 12px; border: 0; border-radius: 8px; background: var(--dot); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
button:disabled { opacity: .6; cursor: default; }
#said { color: var(--err); min-height: 1.5em; margin: 12px 0 0; }
a.back { display: block; margin: 12px 0 0; padding: 10px 12px; border-radius: 8px; background: var(--dot); color: #fff; font-weight: 600; text-align: center; text-decoration: none; }
a.back[hidden] { display: none; }
`;

// The manifest and icons (issue #163): the sign-in page is where a signed-out browser lands, so Install is offered there too.
const INSTALL_HEAD = '<meta name="theme-color" content="#000000"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2"><link rel="icon" href="/icon.svg?v=2">';

// back: the page signs in, so a native app's browser may need the way back to the app (passkey.js shows it).
function page(title, body, { script = 'passkey', head = '', back = false } = {}) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${INSTALL_HEAD}${head}
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body><main>${body}${back ? '<a id="back" class="back" href="#" hidden>Back to the app</a>' : ''}<p id="said" role="alert"></p></main>${script ? `<script src="/front-door/${script}.js"></script>` : ''}</body></html>`;
}

const signIn = () => page('Sign in · botdot', `<h1>bot<span>·</span>dot</h1>
<p>Sign in with your passkey.</p>
<button id="sign-in" type="button">Sign in</button>`, { back: true });

// Before the first account exists: nothing to sign in to, and only the install's link makes the account.
const notYet = () => page('botdot', `<h1>bot<span>·</span>dot</h1>
<p>Open the link from your server's install.</p>`);

// name: the one account this link makes (the install's link makes the admin's), set and not to be changed.
const signUp = ({ name = null } = {}) => page('Sign up · botdot', `<h1>bot<span>·</span>dot</h1>
<p>The admin of this machine can technically reach everything in your account.</p>
<form id="sign-up">${name ? `<p>Your account's name: <b>${esc(name)}</b></p>
<input id="name" name="name" type="hidden" value="${esc(name)}">` : `<label for="name">Your account's name</label>
<input id="name" name="name" required pattern="[a-z][a-z0-9\\-]{1,23}" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="lowercase letters, digits and dashes">`}
<button type="submit">Create my passkey</button></form>`, { back: true });

// The admin's sign-in link: a new passkey for the account `name`, which exists. The same form and script as a
// sign-up, with the name set.
const newPasskey = ({ name }) => page('Sign in · botdot', `<h1>bot<span>·</span>dot</h1>
<p>Make a new passkey for your account, ${esc(name)}. Your bots and data are as you left them.</p>
<form id="sign-up"><input id="name" name="name" type="hidden" value="${esc(name)}">
<button type="submit">Make my passkey</button></form>`, { back: true });

// A new account whose botdot server the machine is still making: the page looks again by itself.
const making = () => page('botdot', `<h1>bot<span>·</span>dot</h1>
<p>Your account is being made. It takes a few minutes, and this page opens it when it is ready.</p>`, { head: '<meta http-equiv="refresh" content="15">' });

// An account the admin resumed, whose botdot server the machine is starting again.
const starting = () => page('botdot', `<h1>bot<span>·</span>dot</h1>
<p>Your account is starting. This page opens it when it is ready.</p>`, { head: '<meta http-equiv="refresh" content="10">' });

// A suspended account: this until the admin resumes it, and the one way out (#466): this browser's session ends and
// the sign-in page opens, for another account's passkey.
const paused = () => page('botdot', `<h1>bot<span>·</span>dot</h1>
<p>Your account is paused by the admin.</p>
<button id="other" type="button">Use another account</button>`, { head: '<meta http-equiv="refresh" content="60">' });

// The admin page has the web page's own look (#22): its colours, Geist and Geist Mono (served by the front door from
// public/fonts), a rail of sections and one card per account. The other pages keep STYLE.
const ADMIN_STYLE = `
@font-face { font-family: Geist; src: url("/front-door/fonts/Geist.ttf") format("truetype"); font-weight: 100 900; font-display: swap; }
@font-face { font-family: "Geist Mono"; src: url("/front-door/fonts/GeistMono.ttf") format("truetype"); font-weight: 100 900; font-display: swap; }
:root { color-scheme: dark; --bg: #000000; --panel: #0d0d0d; --sunk: #1a1a1a; --line: #1f1f1f; --line-2: #2b2b2b; --text: #ffffff; --muted: #a3a3a3; --faint: #838383;
  --dot: #d85a30; --ok: #45c78e; --ok-soft: #16281f; --err: #ef6a6a; --err-soft: #2d1717; --warn: #e2a846; --warn-soft: #2c2413;
  --font: Geist, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 var(--font); }
[hidden] { display: none !important; }
.shell { display: grid; grid-template-columns: 248px minmax(0, 1fr); min-height: 100vh; }
.rail { position: sticky; top: 0; align-self: start; height: 100vh; box-sizing: border-box; border-right: 1px solid var(--line); padding: 22px 16px; display: flex; flex-direction: column; gap: 22px; }
.brand { font-size: 22px; font-weight: 600; letter-spacing: -.04em; display: flex; align-items: center; }
.brand i { display: inline-block; width: .44em; height: .44em; border-radius: 50%; background: var(--dot); margin: 0 2px; transform: translateY(2px); }
.tag { font: 500 10px/1 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--faint); border: 1px solid var(--line-2); border-radius: 99px; padding: 4px 7px; margin-left: 10px; }
.nav { display: flex; flex-direction: column; gap: 4px; }
.nav a, .back { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; color: var(--muted); text-decoration: none; border: 1px solid transparent; }
.nav a:hover, .back:hover { color: var(--text); background: var(--panel); border-color: var(--line); }
.nav .n { margin-left: auto; font: 12px var(--mono); color: var(--faint); }
.rail svg, .btn svg { width: 18px; height: 18px; flex: none; stroke: currentColor; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.back { margin-top: auto; color: var(--faint); }
main { padding: 28px 40px 60px; max-width: 1120px; width: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 36px; }
h1 { margin: 0; font-size: 28px; font-weight: 600; letter-spacing: -.03em; }
.sub { color: var(--muted); margin: 2px 0 0; }
section { display: flex; flex-direction: column; gap: 14px; scroll-margin-top: 20px; }
h2 { margin: 0; font: 500 11px/1 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--faint); padding-bottom: 10px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 34px; box-sizing: border-box; }
h2 .btn { text-transform: none; letter-spacing: 0; }
p { margin: 0; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 16px; padding: 16px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.tile { display: flex; flex-direction: column; gap: 10px; }
.tile .k { font: 11px var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }
.tile .v { font-size: 24px; font-weight: 600; letter-spacing: -.03em; }
.tile .v small { font-size: 13px; color: var(--muted); font-weight: 400; letter-spacing: 0; margin-left: 4px; }
.none { color: var(--faint); }
.bar { height: 6px; border-radius: 99px; background: var(--sunk); overflow: hidden; }
.bar span { display: block; height: 100%; border-radius: 99px; background: var(--text); }
.bar .warn { background: var(--warn); } .bar .err { background: var(--err); }
form.share { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
form.share > p { flex: 1 1 100%; color: var(--muted); }
form.share > p b { color: var(--text); font-weight: 500; }
form.share .grow { flex: 1; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--faint); }
input { box-sizing: border-box; height: 44px; border-radius: 12px; border: 1px solid var(--line-2); background: var(--bg); color: var(--text); font: 15px var(--mono); padding: 0 12px; }
input:focus { outline: none; border-color: var(--muted); }
form.share input { width: 110px; }
.btn, #update { height: 44px; padding: 0 18px; border-radius: 99px; border: 1px solid var(--line-2); background: transparent; color: var(--text); font: 500 14px var(--font); display: inline-flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; white-space: nowrap; }
.btn:hover { border-color: var(--faint); }
.btn.pri, #update { background: var(--text); color: var(--bg); border-color: var(--text); }
.btn.sm { height: 34px; padding: 0 12px; font-size: 13px; }
.btn.danger { color: var(--err); }
.btn:disabled, #update:disabled { opacity: .5; cursor: default; }
.cards { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.card { display: flex; flex-direction: column; gap: 14px; }
.card.full { border-color: #3a1f1f; }
.card.dim { opacity: .72; }
.who { display: flex; gap: 12px; align-items: center; }
.av { width: 40px; height: 40px; flex: none; border-radius: 12px; display: grid; place-items: center; font-weight: 600; font-size: 16px; background: var(--sunk); color: var(--text); text-transform: uppercase; }
.av.you { background: var(--dot); color: #000; }
.nm { font-weight: 600; font-size: 15px; overflow-wrap: anywhere; }
.nm small { color: var(--faint); font-weight: 400; font-size: 14px; }
.meta { color: var(--faint); font-size: 12px; }
.pill { margin-left: auto; flex: none; font: 500 11px/1 var(--mono); letter-spacing: .06em; text-transform: uppercase; padding: 6px 9px; border-radius: 99px; display: inline-flex; gap: 6px; align-items: center; white-space: nowrap; }
.pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.pill.ok { color: var(--ok); background: var(--ok-soft); } .pill.warn { color: var(--warn); background: var(--warn-soft); }
.pill.err { color: var(--err); background: var(--err-soft); } .pill.off { color: var(--muted); background: var(--sunk); }
.use { display: grid; grid-template-columns: 44px 1fr auto; gap: 6px 10px; align-items: center; }
.use .m { font: 11px var(--mono); color: var(--faint); text-transform: uppercase; }
.use .r { font: 11px var(--mono); color: var(--muted); text-align: right; }
.use .r.err { color: var(--err); }
.note { font-size: 12px; color: var(--muted); }
.full-mark { font-size: 12px; color: var(--err); font-weight: 600; }
.acts { display: flex; gap: 6px; flex-wrap: wrap; border-top: 1px solid var(--line); padding-top: 12px; }
.acts .sp { flex: 1; }
.confirm { display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--line); padding-top: 12px; }
.confirm form.share input { width: 88px; }
.confirm input.wide { width: 100%; }
.shown { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; border-color: var(--line-2); }
.shown label { flex: 1; min-width: 240px; }
.shown input { width: 100%; font-size: 13px; }
.links { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
.links:empty { display: none; }
.links li { display: flex; align-items: center; gap: 14px; padding: 12px 16px; border-top: 1px solid var(--line); background: var(--panel); flex-wrap: wrap; }
.links li:first-child { border-top: 0; }
.links .pill { margin: 0; }
.links .what { flex: 1; min-width: 200px; }
.links .what span { display: block; color: var(--faint); font-size: 12px; }
.links .what .said { color: var(--text); font-size: 14px; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0 0 4px; }
.links li.done .said { color: var(--muted); }
.shots { display: flex; gap: 8px; flex-wrap: wrap; margin: 4px 0 6px; }
.shots a { display: block; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; line-height: 0; }
.shots img { width: 96px; height: 72px; object-fit: cover; }
.update { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.update > div { flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: 4px; }
#self-built { color: var(--faint); font-size: 13px; }
#update-log { flex: 1 1 100%; min-width: 0; margin: 0; max-height: 240px; overflow: auto; white-space: pre; background: var(--sunk); border: 1px solid var(--line-2); border-radius: 12px; padding: 10px 12px; font: 12px/1.5 var(--mono); color: var(--muted); }
#said { color: var(--err); }
#said:empty { display: none; }
@media (max-width: 820px) {
  .shell { grid-template-columns: 1fr; }
  .rail { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); flex-direction: row; flex-wrap: wrap; align-items: center; padding: 14px 16px; gap: 10px; }
  .nav { flex-direction: row; flex-wrap: wrap; flex: 1 1 100%; }
  .nav a, .back { padding: 8px 10px; }
  .back { margin: 0 0 0 auto; }
  main { padding: 20px 16px 48px; }
  .cards { grid-template-columns: 1fr; }
}
`;

const ICON = {
  machine: '<path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 20h8M12 16v4"/>',
  accounts: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.8.7 3 2.4 3.5 5.2"/>',
  links: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  update: '<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/>',
  feedback: '<path d="M4 5h16v11H9l-5 4zM12 8v3M12 13.5v.01"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

// The machine: its load, and the share every account has unless it has its own (ADR 028). Only the admin page shows a
// share or a load; nothing in an account does.
const SHARES = `<section id="machine"><h2>The machine</h2>
<div class="tiles" id="machine-load"><p class="panel none">No load measured yet.</p></div>
<form id="default-share" class="share panel"><p><b>Default share</b> · each account's share, unless it has its own</p>
<label>CPUs <input name="cpu" type="number" min="1" max="256" required></label>
<label>RAM, GB <input name="ram" type="number" min="2" max="4096" required></label>
<label>Disk, GB <input name="disk" type="number" min="12" max="100000" required></label>
<span class="grow"></span>
<button class="btn pri" type="submit">Save the default share</button></form></section>`;

// The admin page: the machine's load and the default share, the accounts (each one's share and use, suspended,
// resumed, deleted, a new sign-in link), sign-up links (made, listed and revoked), the update of every account at
// once, and the feedback owners sent (#216). It never shows what is inside an account, but for that feedback: what an
// owner wrote to the admin on purpose (ADR 048).
const admin = () => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#000000">
<title>Admin · botdot</title><style>${ADMIN_STYLE}</style></head>
<body><div class="shell">
<aside class="rail">
<div class="brand">bot<i></i>dot<span class="tag">Admin</span></div>
<nav class="nav" aria-label="Admin sections">
<a href="#machine">${icon('machine')}Machine</a>
<a href="#accounts">${icon('accounts')}Accounts<span class="n" id="accounts-count"></span></a>
<a href="#sign-up-links">${icon('links')}Sign-up links<span class="n" id="links-count"></span></a>
<a href="#update-section">${icon('update')}Update</a>
<a href="#rooms">${icon('accounts')}Shared rooms</a>
<a href="#feedback">${icon('feedback')}Feedback<span class="n" id="feedback-count"></span></a>
</nav>
<a class="back" href="/">${icon('back')}Back to my bots</a>
</aside>
<main>
<div><h1>This machine</h1><p class="sub">It runs every account's bots. You are its admin.</p></div>
<p id="said" role="alert"></p>
${SHARES}
<section id="accounts"><h2>Accounts</h2>
<div id="sign-in-made" class="panel shown" hidden><label for="sign-in-link"></label><input id="sign-in-link" readonly></div>
<ul id="account-list" class="cards"></ul></section>
<section id="sign-up-links"><h2>Sign-up links <button id="new-link" class="btn sm pri" type="button">New sign-up link</button></h2>
<p class="note">A link makes one account. Hand it to one person: it works once, for 7 days.</p>
<div id="made" class="panel shown" hidden><label for="link">The new link (shown once)</label><input id="link" readonly></div>
<ul id="links" class="links"></ul></section>
<section id="update-section"><h2>Update</h2>
<div class="panel update"><div><p id="version">Checking…</p>
<p id="self-built" hidden>botdot here is built from the source on this machine. Run git pull and make images in the source first: Update then moves every account to what you built.</p></div>
<button id="update" type="button">Update every account</button>
<pre id="update-log" hidden></pre></div>
<form id="update-days" class="panel share"><p>An account whose owner turned “Update automatically” off waits on the version it ran, at most:</p>
<label>Days <input name="days" type="number" min="1" max="60" required></label>
<span class="grow"></span>
<button class="btn pri" type="submit">Save the deadline</button></form></section>
<section id="rooms"><h2>Shared rooms</h2>
<div class="panel update"><div><p id="rooms-state">Checking…</p>
<p class="note">A shared room is one chat for people of several accounts and their bots (ADR 060). A bot there only talks: no tools, no notes, no files. It answers only when mentioned, and by default only its owner may mention it.</p></div>
<button id="rooms-switch" type="button" disabled>Turn on</button></div></section>
<section id="feedback"><h2>Feedback</h2>
<p class="note">Bugs and feature requests the owners of this machine's accounts sent you, newest first.</p>
<ul id="feedback-list" class="links"></ul></section>
</main></div>
<script src="/front-door/admin.js"></script></body></html>`;

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
  // In a native app's browser (?app=mac|android&handoff=…: the Mac app's sheet, the Android app's Custom Tab): the
  // sign-in goes back to the app as a code, not as this page's cookie. A browser may open no app without a fresh tap
  // (Chrome on Android, once the passkey took a while), so the way back is also a link to tap.
  const asked = new URLSearchParams(location.search);
  const native = ['mac', 'android'].includes(asked.get('app')) && asked.get('handoff');
  const sheet = native ? { app: asked.get('app'), handoff: asked.get('handoff') } : { app: 'web' };
  const done = (answer) => {
    // A room's invite link (ADR 068) came here to sign in first: back to it, so that the page opens "Join".
    if (!sheet.handoff) return location.replace('/' + (/^#rooms[/]join=[A-Za-z0-9_-]{1,100}$/.test(location.hash) ? location.hash : ''));
    const back = 'botdot://signed-in?code=' + encodeURIComponent(answer.code);
    const link = document.getElementById('back');
    if (link) { link.href = back; link.hidden = false; }
    location.replace(back);
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

  // The paused page's way out: this browser signs out, and the sign-in page takes another account's passkey.
  const other = document.getElementById('other');
  if (other) other.addEventListener('click', async () => {
    other.disabled = true; said('');
    try { await post('/sign-out', {}); location.replace('/sign-in'); } catch (e) { said(e.message); other.disabled = false; }
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
  const date = (iso) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
  const el = (tag, text) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; return e; };
  const div = (cls, ...kids) => { const e = el('div'); e.className = cls; e.append(...kids); return e; };
  const span = (cls, text) => { const e = el('span', text); if (cls) e.className = cls; return e; };
  const button = (text, act, cls = 'sm') => {
    const b = el('button', text);
    b.type = 'button';
    b.className = 'btn ' + cls;
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
  const one = (n) => Math.round(n * 10) / 10;
  const cpus = (n) => n + ' CPU' + (n === 1 ? '' : 's');
  const shareText = (s) => [cpus(s.cpu), s.ram + ' GB RAM', s.disk + ' GB disk'].join(' · ');
  // A bar of used against all: amber from 80%, red when full.
  function bar(used, all, full) {
    const part = all > 0 ? Math.min(1, Math.max(0, used / all)) : 0;
    const fill = el('span');
    fill.style.width = Math.round(part * 100) + '%';
    if (full || part >= 0.98) fill.className = 'err';
    else if (part >= 0.8) fill.className = 'warn';
    return div('bar', fill);
  }
  function tile(name, value, of, used, all) {
    const v = span('v', value);
    v.append(el('small', of));
    return div('tile panel', span('k', name), v, bar(used, all));
  }
  function fill(form, share) { for (const k of ['cpu', 'ram', 'disk']) form.elements[k].value = share[k]; }
  const read = (form) => Object.fromEntries(['cpu', 'ram', 'disk'].map((k) => [k, Number(form.elements[k].value)]));
  async function showMachine() {
    const { share, machine: m } = await call('GET', '/admin/share');
    document.getElementById('machine-load').replaceChildren(...(m
      ? [tile('CPU load', String(one(m.load)), 'on ' + cpus(m.cpus), m.load, m.cpus),
        tile('RAM', gb(m.ramUsed), 'of ' + gb(m.ramTotal), m.ramUsed, m.ramTotal),
        tile('Disk', gb(m.diskUsed), 'of ' + gb(m.diskTotal), m.diskUsed, m.diskTotal)]
      : [span('panel none', 'No load measured yet.')]));
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
  // What root's step measured of an account, against its share, as bars: nothing when it measured nothing yet.
  function useRows(u, s) {
    if (!u) return [span('note', 'Use not measured yet')];
    const rows = [];
    const row = (name, used, all, text, full) => {
      const r = span('r' + (full ? ' err' : ''), text);
      rows.push(span('m', name), bar(used, all, full), r);
    };
    if (u.cpu !== undefined) row('CPU', u.cpu, s.cpu, one(u.cpu) + ' / ' + s.cpu);
    if (u.ram !== undefined) row('RAM', u.ram, s.ram * GB, gb(u.ram) + ' / ' + s.ram + ' GB');
    if (u.diskUsed !== undefined) {
      const size = u.diskSize || s.disk * GB;
      row('Disk', u.diskUsed, size, gb(u.diskUsed) + ' / ' + gb(size), u.full);
    }
    const out = rows.length ? [div('use', ...rows)] : [span('note', 'Use not measured yet')];
    // The account's one computer, which all its bots work on (ADR 035): on or off.
    if (u.computers !== undefined) out.push(span('note', u.computers > 0 ? 'Its computer is on' : 'Its computer is off'));
    return out;
  }
  // One box at a time opens inside a card: an account's own share, or its deletion.
  function opened(card, box) {
    const was = card.querySelector('.confirm');
    if (was) was.remove();
    box.className = 'confirm';
    card.append(box);
  }
  function shareForm(card, a) {
    const box = el('div');
    const form = el('form');
    form.className = 'share';
    form.append(el('p', 'The share of ' + a.name + ':'));
    for (const [k, label, min, max] of [['cpu', 'CPUs', 1, 256], ['ram', 'RAM, GB', 2, 4096], ['disk', 'Disk, GB', 12, 100000]]) {
      const l = el('label', label + ' ');
      const i = el('input');
      i.name = k; i.type = 'number'; i.min = min; i.max = max; i.required = true;
      l.append(i);
      form.append(l);
    }
    fill(form, a.share);
    const save = el('button', 'Save the share of ' + a.name);
    save.type = 'submit';
    save.className = 'btn sm pri';
    form.append(save);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      save.disabled = true; said('');
      try { await call('POST', '/admin/accounts/' + a.name + '/share', read(form)); await showAccounts(); } catch (e) { said(e.message); } finally { save.disabled = false; }
    });
    const acts = div('acts');
    acts.style.borderTop = '0'; acts.style.paddingTop = '0';
    if (a.ownShare) acts.append(button('Back to the default share', async () => { await call('POST', '/admin/accounts/' + a.name + '/share', { default: true }); await showAccounts(); }));
    acts.append(span('sp'), button('Close', async () => box.remove()));
    box.append(form, acts);
    opened(card, box);
    form.elements.cpu.focus();
  }
  function deleteBox(card, a) {
    // Asked here: the account's name, typed.
    const box = el('div');
    const label = el('label', 'Type ' + a.name + ' to delete it for good: its bots, chats, data and computers');
    const field = el('input');
    field.id = 'delete-' + a.name;
    field.className = 'wide';
    label.htmlFor = field.id;
    field.autocomplete = 'off';
    field.spellcheck = false;
    box.append(label, field, div('acts', button('Delete ' + a.name, async () => {
      await call('POST', '/admin/accounts/' + a.name + '/delete', { name: field.value.trim() });
      await showAccounts();
    }, 'sm danger'), span('sp'), button('Close', async () => box.remove())));
    opened(card, box);
    field.focus();
  }

  // An account's own update (ADR 053), in words: waiting for a version until its deadline, being switched, or how its
  // last switch went.
  function updateText(u) {
    if (u.asked || (u.last && u.last.state === 'switching')) return 'Moving to the new version…';
    if (u.ready) return 'Waits for its owner on the version it ran' + (u.ready.version ? ': version ' + u.ready.version + ' is ready' : '') + '. It moves by itself on ' + day(u.ready.deadline) + '.';
    const auto = u.autoUpdate ? 'Updates with every account.' : 'Its owner chooses when it moves to a new version, up to the deadline.';
    if (u.last && (u.last.state === 'kept' || u.last.state === 'failed')) return auto + ' Its last move to a new version didn’t happen: ' + (u.last.error || 'see root’s step’s log') + '.';
    return auto;
  }
  const STATES = { running: 'Running', suspended: 'Suspended', making: 'Being made', starting: 'Starting', stopped: 'Not running' };
  const TONES = { running: 'ok', suspended: 'warn', stopped: 'err' };
  async function showAccounts() {
    const { accounts } = await call('GET', '/admin/accounts');
    document.getElementById('accounts-count').textContent = accounts.length;
    document.getElementById('account-list').replaceChildren(...accounts.map((a) => {
      const card = el('li');
      const full = !!(a.use && a.use.full);
      card.className = 'card panel' + (full ? ' full' : '') + (a.state === 'suspended' ? ' dim' : '');
      const av = span('av' + (a.admin ? ' you' : ''), a.name.slice(0, 1));
      av.setAttribute('aria-hidden', 'true');
      const nm = div('nm', a.name);
      if (a.admin) nm.append(' ', el('small', '(you)'));
      const meta = div('meta', ['made ' + date(a.created), a.lastSeen ? 'last seen ' + day(a.lastSeen) : 'not seen yet'].join(' · '));
      const who = div('who', av, div('', nm, meta), span('pill ' + (TONES[a.state] || 'off'), STATES[a.state] || a.state));
      card.append(who, ...useRows(a.use, a.share));
      // A full disk is marked: its runs fail with "No space left on the server".
      if (full) card.append(span('full-mark', 'Disk full'));
      // Near its RAM it slows down, then its site stalls on disk reads (#126): marked from 90%, before that happens.
      if (a.use && a.use.ram >= a.share.ram * GB * 0.9) card.append(span('full-mark', 'Near its RAM: its site may stall. Give it more RAM.'));
      card.append(span('note', (a.ownShare ? 'Its own share: ' : 'Default share: ') + shareText(a.share)));
      // When it switches to a new version (ADR 053): its owner's choice, and a version that waits for it.
      const up = a.update;
      if (up) card.append(span('note', updateText(up)));
      const actions = div('acts');
      actions.append(button('Change share', async () => shareForm(card, a)));
      if (up && up.canUpdate) actions.append(button('Update now', async () => { await call('POST', '/admin/accounts/' + a.name + '/update'); await showAccounts(); }));
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
      if (!a.admin) actions.append(span('sp'), button('Delete', async () => deleteBox(card, a), 'sm danger'));
      card.append(actions);
      return card;
    }));
  }

  const what = (l) => l.state === 'open' ? 'Open until ' + day(l.expires)
    : l.state === 'used' ? 'Used by ' + l.account + ' on ' + day(l.usedAt)
    : l.revokedAt ? 'Revoked on ' + day(l.revokedAt) : 'Ended on ' + day(l.expires);
  const linkState = (l) => l.state === 'open' ? ['ok', 'Open'] : l.state === 'used' ? ['off', 'Used'] : l.revokedAt ? ['err', 'Revoked'] : ['off', 'Ended'];
  async function showLinks() {
    const { links } = await call('GET', '/admin/links');
    document.getElementById('links-count').textContent = links.filter((l) => l.state === 'open').length || '';
    document.getElementById('links').replaceChildren(...links.map((l) => {
      const row = el('li');
      const [tone, word] = linkState(l);
      const text = div('what', (l.signIn ? 'Sign-in link: ' : '') + what(l));
      text.append(el('span', 'Made ' + day(l.created) + (l.for ? ', for ' + l.for : '')));
      row.append(span('pill ' + tone, word), text);
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
  // The phase root's step is in (#195), in words: what it does now, and, lower-case, where a failed one stopped.
  function phaseText(phase, account) {
    const of = account ? ' of ' + account : '';
    switch (phase) {
      case 'check': return 'Checking the new version';
      case 'clean': return 'Removing unused images' + of;
      case 'preflight': return 'Checking ' + (account || 'the machine') + ' before anything changes';
      case 'download': return account ? 'Downloading for ' + account : 'Downloading the new version';
      case 'switch': return 'Moving ' + (account || 'every account') + ' to the new version';
      case 'front-door': return 'Restarting the front door';
      case 'done': return 'Finishing the update';
      default: return '';
    }
  }
  const lower = (t) => t.charAt(0).toLowerCase() + t.slice(1);
  function showUpdate(u) {
    const busy = u.asked || (u.update && u.update.state === 'updating');
    const last = u.update;
    const phase = last && phaseText(last.phase, last.account);
    // Root's last lines of update.log, so that a failed update needs no look at the machine.
    const lines = !busy && last && last.state === 'failed' && Array.isArray(last.log) ? last.log : [];
    let text = busy ? (last && last.state === 'updating' && phase ? phase + '…' : 'Updating the front door and every account. It takes a few minutes.')
      : u.version ? 'Every account runs version ' + u.version + '.' : 'Every account runs the same version.';
    // The accounts it kept back (#194): each runs the version it ran, or none when that didn't start either.
    const kept = !busy && last && Array.isArray(last.accounts) ? last.accounts.filter((a) => a.result !== 'updated') : [];
    if (kept.length && u.version) text = 'The front door and every other account run version ' + u.version + '.';
    const days = document.getElementById('update-days');
    if (u.days && !days.contains(document.activeElement)) days.elements.days.value = u.days;
    if (!busy && last && last.state === 'failed') text += ' The last update stopped' + (phase ? ' while ' + lower(phase) : '') + ': ' + (last.error || (lines.length ? 'see its log below' : 'see update.log on the machine')) + '.';
    else if (!busy && last && last.state === 'updated' && last.at) text += last.from && last.from === last.to ? ' It was the newest already on ' + day(last.at) + '.' : ' Updated on ' + day(last.at) + '.';
    const waiting = !busy && last && Array.isArray(last.accounts) ? last.accounts.filter((a) => a.result === 'waiting') : [];
    for (const a of waiting) text += ' ' + a.name + ' waits for its owner on ' + (a.version ? 'version ' + a.version : 'the version it ran') + '.';
    for (const a of kept.filter((k) => k.result !== 'waiting')) {
      const why = a.error || 'see update.log on the machine';
      text += a.result === 'kept' ? ' ' + a.name + ' was kept on ' + (a.version ? 'version ' + a.version : 'the version it ran') + ': ' + why + '.'
        : ' ' + a.name + " doesn't run: " + why + '.';
    }
    // Whether a newer signed version exists, as root's step last found (#193).
    if (!busy && u.newest && u.version) text += u.newest.version !== u.version ? ' Version ' + u.newest.version + ' is available.' : ' This is the newest version.';
    document.getElementById('version').textContent = text;
    const log = document.getElementById('update-log');
    log.textContent = lines.join('\\n');
    log.hidden = !lines.length;
    document.getElementById('self-built').hidden = !u.selfBuilt;
    updateButton.disabled = busy;
    if (busy && !watching) watching = setInterval(watchUpdate, 5000);
    if (!busy && watching) { clearInterval(watching); watching = null; showAccounts().catch(() => {}); }
  }
  async function watchUpdate() {
    try { showUpdate(await call('GET', '/admin/update')); } catch { /* the front door is restarting */ }
  }
  const updateDays = document.getElementById('update-days');
  updateDays.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const b = updateDays.querySelector('button');
    b.disabled = true; said('');
    try { showUpdate(await call('POST', '/admin/update/days', { days: Number(updateDays.elements.days.value) })); await showAccounts(); } catch (e) { said(e.message); } finally { b.disabled = false; }
  });
  updateButton.addEventListener('click', async () => {
    if (!confirm('Update botdot now? The front door and every account restart on the newest version, which takes a few minutes. Work still running stops. An account whose owner turned “Update automatically” off waits for them.')) return;
    updateButton.disabled = true; said('');
    try { showUpdate(await call('POST', '/admin/update')); } catch (e) { said(e.message); updateButton.disabled = false; }
  });
  // The owners' feedback (#216): each report's text, as text, with whose it is, when, the kind, the app and the version,
  // and its screenshots (#223) as thumbnails, each an img made here, which opens the picture at full size.
  const KINDS = { bug: 'Bug', feature: 'Feature request' };
  const APPS = { web: 'web page', android: 'Android app', mac: 'Mac app' };
  async function showFeedback() {
    const { reports } = await call('GET', '/admin/feedback');
    document.getElementById('feedback-count').textContent = reports.filter((f) => !f.doneAt).length || '';
    const list = document.getElementById('feedback-list');
    if (!reports.length) { const none = el('li', 'No feedback yet.'); none.className = 'none'; return list.replaceChildren(none); }
    list.replaceChildren(...reports.map((f) => {
      const row = el('li');
      if (f.doneAt) row.className = 'done';
      const text = div('what', el('p', f.text));
      text.firstChild.className = 'said';
      if (f.screenshots?.length) {
        const shots = div('shots');
        for (const s of f.screenshots) {
          const href = '/admin/feedback/' + f.id + '/screenshot/' + s.id;
          const a = el('a');
          a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.title = 'Screenshot ' + (s.id + 1) + ', full size';
          const img = el('img');
          img.src = href; img.alt = 'Screenshot ' + (s.id + 1); img.loading = 'lazy';
          a.append(img);
          shots.append(a);
        }
        text.append(shots);
      }
      if (f.screenshotsDeleted) text.append(el('span', "Its screenshots were deleted to keep the machine's disk free."));
      text.append(el('span', [f.account, day(f.created), 'from the ' + (APPS[f.app] || f.app), f.version ? 'version ' + f.version : null, f.doneAt ? 'done on ' + day(f.doneAt) : null].filter(Boolean).join(' · ')));
      row.append(span('pill ' + (f.doneAt ? 'off' : f.kind === 'bug' ? 'err' : 'ok'), KINDS[f.kind] || f.kind), text);
      if (!f.doneAt) row.append(button('Mark done', async () => { await call('POST', '/admin/feedback/' + f.id + '/done'); await showFeedback(); }));
      row.append(button('Delete', async () => {
        if (!confirm('Delete this report for good?')) return;
        await call('POST', '/admin/feedback/' + f.id + '/delete');
        await showFeedback();
      }, 'sm danger'));
      return row;
    }));
  }
  // Shared rooms (ADR 060): the machine's switch, off until the admin turns it on.
  const roomsSwitch = document.getElementById('rooms-switch');
  function showRooms(r) {
    document.getElementById('rooms-state').textContent = r.on ? "Shared rooms are on: the owners of this machine's accounts can make rooms and invite each other." : 'Shared rooms are off.';
    roomsSwitch.textContent = r.on ? 'Turn off' : 'Turn on';
    roomsSwitch.dataset.on = r.on ? '1' : '';
    roomsSwitch.disabled = false;
  }
  roomsSwitch.addEventListener('click', async () => {
    const on = !roomsSwitch.dataset.on;
    if (!on && !confirm('Turn shared rooms off? Nobody reaches a room and no bot answers in one until they are on again. What the rooms hold is kept.')) return;
    roomsSwitch.disabled = true; said('');
    try { showRooms(await call('POST', '/admin/rooms', { on })); } catch (e) { said(e.message); roomsSwitch.disabled = false; }
  });
  call('GET', '/admin/rooms').then(showRooms, (e) => said(e.message));
  showMachine().catch((e) => said(e.message));
  showFeedback().catch((e) => said(e.message));
  showAccounts().catch((e) => said(e.message));
  showLinks().catch((e) => said(e.message));
  call('GET', '/admin/update').then(showUpdate, (e) => said(e.message));
  // Load is measured every minute: the page shows the newest.
  setInterval(() => { showMachine().catch(() => {}); if (!document.querySelector('.confirm')) showAccounts().catch(() => {}); }, 60_000);
})();
`;

module.exports = { signIn, signUp, newPasskey, notYet, ended, making, starting, paused, admin, SCRIPT, ADMIN_SCRIPT };
