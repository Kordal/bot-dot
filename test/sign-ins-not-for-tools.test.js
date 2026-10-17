// Sign-ins belong to the front door alone (ADR 028, #468): no tool of the Chief of Staff or of a bot reads or
// changes the owner's passkeys or sessions. They run inside the account's botdot server, which holds none of them:
// only front-door.js and lib/front-door/ know the front door's data, and no tool is about sign-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FRONT_DOOR = ['front-door.js', path.join('lib', 'front-door')];

// Every JavaScript file of the botdot server, its tools included: server.js and lib/, without the front door's own.
function serverFiles() {
  const out = ['server.js'];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (FRONT_DOOR.includes(rel)) continue;
      if (e.isDirectory()) walk(rel); else if (e.name.endsWith('.js')) out.push(rel);
    }
  };
  walk('lib');
  return out;
}

test("no part of the botdot server, and so none of the Chief's or a bot's tools, reaches the front door's sign-ins", () => {
  const files = serverFiles();
  assert.ok(files.includes(path.join('lib', 'mcp-server.js')), "the Chief's tools are among them");
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(text, /require\([^)]*front-door/, `${f} loads the front door's code`);
    assert.doesNotMatch(text, /FRONT_DOOR_DATA|front-door\.json|botdot_session|\/sign-out-everywhere/, `${f} names the front door's sessions`);
  }
});

test("no tool of the Chief's is about the owner's sign-ins, sessions or passkeys", () => {
  const { TOOLS } = require('../lib/mcp-server');
  const about = /passkey|session|sign[ -]?(in|out)|front door/i;
  for (const t of TOOLS) assert.doesNotMatch(`${t.name} ${t.description}`.replace(/Claude('s)? sign[ -]?(in|out)/gi, ''), about, t.name);
});
