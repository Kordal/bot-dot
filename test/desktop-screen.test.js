// The desktop app's own screen (desktop/ui/screen.js) against stand-in elements and Tauri calls: what it shows while
// botdot is set up on this computer (ADR 136, ADR 170). The look is the app's (desktop/ui/style.css).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCREEN = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'ui', 'screen.js'), 'utf8');
const IDS = ['connect', 'address', 'go', 'here', 'said', 'line', 'last'];

// The screen on a computer that can run botdot: `start` says so, `run_here` waits, events come from the test.
async function screen(userAgent) {
  const els = Object.fromEntries(IDS.map((id) => [id, {
    id, hidden: ['connect', 'here', 'line', 'last'].includes(id), textContent: '', disabled: false, listeners: {},
    classList: { toggle() {} }, setAttribute() {}, focus() {}, addEventListener(type, f) { this.listeners[type] = f; },
  }]));
  const listeners = {};
  const tauri = {
    core: { invoke: (command) => (command === 'start' ? Promise.resolve({ here: true }) : new Promise(() => {})) },
    event: { listen: (name, f) => { listeners[name] = f; return Promise.resolve(() => {}); } },
  };
  const ctx = vm.createContext({ window: { __TAURI__: tauri }, document: { getElementById: (id) => els[id] }, navigator: { language: 'en-GB', userAgent }, location: { search: '' }, URLSearchParams, Promise });
  vm.runInContext(SCREEN, ctx);
  await new Promise((r) => setImmediate(r));
  // What a person sees: an element shown inside a form that is shown.
  const shown = () => IDS.filter((id) => !els[id].hidden && (id === 'connect' || ['line', 'last'].includes(id) || !els.connect.hidden) && (id !== 'said' || els.said.textContent));
  return { els, shown, emit: (name, payload) => listeners[name]({ payload }) };
}

for (const [system, userAgent, here] of [
  ['Linux', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15', 'Run botdot on this computer'],
  ['the Mac', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 'Run botdot on this Mac'],
  ['Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/130.0', 'Run botdot on this PC'],
]) {
  test(`on ${system}, while the passkey is made in the browser the window shows that line alone`, async () => {
    const { els, shown, emit } = await screen(userAgent);
    assert.equal(els.here.textContent, here);
    assert.deepEqual(shown(), ['connect', 'address', 'go', 'here']);
    els.here.listeners.click();
    assert.deepEqual(shown(), ['line']);
    emit('local-passkey');
    assert.deepEqual(shown(), ['line'], 'no button to run botdot again, no address');
    assert.equal(els.line.textContent, 'Make your passkey in the browser.');
    // A sign-in that didn't finish gives the address and the button back.
    emit('sign-in-failed');
    assert.deepEqual(shown(), ['connect', 'address', 'go', 'here', 'said']);
  });
}
