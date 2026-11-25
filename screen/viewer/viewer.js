// botdot's own viewer of a bot's computer screen (ADR 279), at /computer/<bot id>/vnc.html. It draws the picture
// through a transport (transport-rfb.js), says its state in words, reconnects by itself, and tells the page that holds
// it (the web page's dialog, the picture-in-picture, the run's live screen) what state it is in.
import { createTransport } from './transport-rfb.js';
import { setupDrop } from './drop.js';

const query = new URLSearchParams(location.search);
// Watching until the owner takes control: only view_only=0 lets the mouse and keys through (ADR 107).
const viewOnly = query.get('view_only') !== '0';
const here = location.pathname.replace(/[^/]*$/, '');
const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${here}websockify`;

// The words of each state, in the account's language: botdot writes them into the page it serves (lib/screen-page.js).
let WORDS = {};
try { WORDS = JSON.parse(document.body.dataset.words || '{}'); } catch { /* a state is then shown by its name */ }
const RETRY_MS = 2000;

const screen = document.getElementById('screen');
const status = document.getElementById('status');
let state = null;
let everShown = false;
let transport = null;
let retry = null;

// What the viewer is in: drawn in words, and told to the frame's parent (the web page), which reads the state and
// not this page's text.
function setState(next) {
  if (next === state) return;
  state = next;
  status.dataset.state = next;
  status.textContent = WORDS[next] || next;
  document.title = status.textContent;
  if (window.parent !== window) window.parent.postMessage({ type: 'botdot-screen', state: next }, location.origin);
}

// Whether the computer is on: the page itself answers 503 while it is off (server.js serveScreen).
async function computerIsOff() {
  try {
    const r = await fetch(location.pathname, { method: 'HEAD', cache: 'no-store' });
    return r.status === 503;
  } catch {
    return false;
  }
}

function later() {
  clearTimeout(retry);
  retry = setTimeout(connect, RETRY_MS);
}

function connect() {
  screen.replaceChildren();
  try {
    transport = createTransport({ target: screen, url, viewOnly });
  } catch {
    setState(everShown ? 'reconnecting' : 'starting');
    return later();
  }
  const mine = transport;
  mine.addEventListener('connect', () => {
    if (mine !== transport) return;
    everShown = true;
    setState(viewOnly ? 'watching' : 'control');
    if (!viewOnly) mine.focus();
  });
  mine.addEventListener('disconnect', async () => {
    if (mine !== transport) return;
    transport = null;
    // Ask first and say it once: a computer that stays off stays on "Turned off" across the retries, with no
    // "Reconnecting…" between. Not yet shown means it is still starting; shown once means it went away and comes back.
    const off = await computerIsOff();
    setState(off ? 'off' : everShown ? 'reconnecting' : 'starting');
    later();
  });
}

setState('starting');
connect();
setupDrop({ allowed: () => !viewOnly });
// The page that holds the viewer may remove it: close the connection with it.
addEventListener('pagehide', () => { clearTimeout(retry); transport?.disconnect(); });
