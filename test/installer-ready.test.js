// install.sh's last line for a program, BOTDOT_READY (#981): what the fleet console reads of a fresh or updated
// machine, on every reach, without parsing prose.
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const path = require('node:path');
const { installer } = require('./installer-helpers');

const READY = 'BOTDOT_READY ';
// ready(said): the run's last line, which is the one BOTDOT_READY line it prints, as JSON.
function ready(said) {
  const lines = said.trim().split('\n');
  assert.equal(lines.filter((l) => l.startsWith(READY)).length, 1, `one BOTDOT_READY line:\n${said}`);
  const last = lines.at(-1);
  assert.ok(last.startsWith(READY), `the last line is BOTDOT_READY:\n${said}`);
  return JSON.parse(last.slice(READY.length));
}

test('a public install ends with BOTDOT_READY: origin, version, reach, accounts and the sign-up link', (t) => {
  const done = installer(t, { dotenv: '', input: '1\nbotdot.example.com\nann\n' });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const line = ready(done.said);
  assert.deepEqual(Object.keys(line), ['origin', 'version', 'reach', 'accounts', 'signUp']);
  assert.equal(line.origin, 'https://botdot.example.com');
  assert.match(line.version, /^[0-9a-f]*$/);
  assert.equal(line.reach, 'public');
  assert.deepEqual(line.accounts, ['ann']);
  assert.equal(line.signUp, 'https://botdot.example.com/sign-up/T0KEN', 'the admin\'s link, while the account does not exist');
  assert.equal(line.variant, undefined, 'no variant before managed mode');
});

test('a tailnet install ends with BOTDOT_READY, and once the admin exists it has no sign-up link', (t) => {
  const done = installer(t, { dotenv: '', input: '2\nann\n' });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const line = ready(done.said);
  assert.equal(line.origin, 'https://vm.example.ts.net');
  assert.equal(line.reach, 'tailnet');
  assert.equal(line.signUp, 'https://vm.example.ts.net/sign-up/T0KEN');

  const again = installer(t, { again: done, dotenv: '', exists: true });
  assert.equal(again.status, 0, `${again.said}\n${again.stderr}`);
  const after = ready(again.said);
  assert.equal(after.origin, 'https://vm.example.ts.net');
  assert.deepEqual(after.accounts, ['ann']);
  assert.ok(!('signUp' in after), 'no link once the account exists');
});

test('an update ends with BOTDOT_READY too, with the version it installed and no sign-up link', (t) => {
  const first = installer(t, { dotenv: '', input: '2\nann\n' });
  assert.equal(first.status, 0, `${first.said}\n${first.stderr}`);
  const done = installer(t, { again: first, dotenv: '', args: ['--update'] });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const line = ready(done.said);
  assert.equal(line.origin, 'https://vm.example.ts.net');
  assert.equal(line.reach, 'tailnet');
  assert.deepEqual(line.accounts, ['ann']);
  assert.equal(line.version, JSON.parse(done.read('front-door/status/version.json')).version, 'the version the update installed');
  assert.ok(!('signUp' in line), 'an update makes no link');
});

test('the requested and load steps of root print no BOTDOT_READY line', (t) => {
  const first = installer(t, { dotenv: '', input: '2\nann\n' });
  assert.equal(first.status, 0, `${first.said}\n${first.stderr}`);
  for (const step of ['--requested', '--load']) {
    const done = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: [step] });
    assert.doesNotMatch(done.said, /BOTDOT_READY/, step);
  }
});
