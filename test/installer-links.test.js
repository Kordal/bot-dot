// install.sh on a stand-in machine (test/installer-helpers.js): the sign-in and sign-up links root asks of root's step
// on a machine without an admin page (#985), SIGN-IN-<account> and SIGN-UP. Root's step asks the front door for each
// (`node front-door.js … --by console`) and keeps what it says in a status file only root and the front door read; the
// front door's side is in test/front-door-console-links.test.js, the round trip in `make install-real`.
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withBob, status, installer } = require('./installer-helpers');

const URL_SAID = 'https://botdot.example.com/sign-up/S3CRETt0ken';
// The stand-in front door: a link for ann or bob, or for any name, and no account nobody; a sign-up for bob is taken.
const frontDoor = [
  'case "$*" in *"front-door.js sign-"*"--by console"*)',
  '  k="${9%-link}"; n=""; [ "${10}" = --account ] && n="${11}"',
  '  case "$k:$n" in',
  `    sign-in:ann | sign-in:bob | sign-up: | sign-up:cleo) printf '{"state":"made","kind":"%s"%s,"url":"${URL_SAID}","expires":"2026-11-06T08:00:00.000Z"}\\n' "$k" "\${n:+,\\"account\\":\\"$n\\"}"; exit 0 ;;`,
  '    sign-up:bob) printf \'{"state":"refused","kind":"sign-up","account":"bob","error":"The account bob exists already."}\\n\'; exit 3 ;;',
  '    *) printf \'{"state":"refused","kind":"%s","account":"%s","error":"There is no account %s."}\\n\' "$k" "$n" "$n"; exit 3 ;;',
  '  esac ;;',
  'esac',
];
// Root's step for a request named `name` that holds `text`, with what it asked of Docker in this run alone.
function stepWith(t, m, name, text) {
  const requests = path.join(m.first.dir, 'front-door', 'requests');
  fs.writeFileSync(path.join(requests, name), text);
  const log = path.join(m.first.top, 'docker.log');
  const before = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0;
  const done = installer(t, { again: m.first, dotenv: '', script: path.join(m.first.dir, 'bin', 'install.sh'), args: ['--requested'], dockerFirst: frontDoor });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.deepEqual(fs.readdirSync(requests), [], 'the request is taken');
  return { ...done, docker: done.docker.slice(before) };
}
const asked = (done) => done.docker.map((c) => c.call).filter((c) => c.includes('front-door.js sign-'));

test('SIGN-IN-<account>: the front door\'s sign-in link, in a status file of root\'s that the front door reads, and in no log', (t) => {
  const m = withBob(t);
  const done = m.step('SIGN-IN-ann', { dockerFirst: frontDoor });
  assert.deepEqual(asked(done).map((c) => c.split(' exec -T ')[1]), ['front-door node front-door.js sign-in-link --account ann --by console']);
  const said = status(done, 'sign-in-ann.json');
  assert.equal(said.state, 'made');
  assert.equal(said.kind, 'sign-in');
  assert.equal(said.account, 'ann');
  assert.equal(said.url, URL_SAID);
  assert.equal(said.expires, '2026-11-06T08:00:00.000Z');
  assert.match(said.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  const file = path.join(m.first.dir, 'front-door', 'status', 'sign-in-ann.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o640, 'root\'s, read by the front door\'s group alone');
  assert.match(done.system, new RegExp(`chown 0:\\d+ ${file.replace(/[.]/g, '\\.')}\\.new`));
  assert.match(done.said, /A sign-in link for ann is in /);
  assert.ok(!`${done.said}${done.stderr}`.includes('S3CRETt0ken'), 'the link is in no log');
});

test('SIGN-UP: a sign-up link for any name, or for the name on its first line; one refused says why', (t) => {
  const m = withBob(t);
  const any = m.step('SIGN-UP', { dockerFirst: frontDoor });
  assert.equal(asked(any).length, 1);
  assert.match(asked(any)[0], /front-door\.js sign-up-link --by console$/);
  assert.equal(status(any, 'sign-up.json').state, 'made');
  assert.equal(status(any, 'sign-up.json').url, URL_SAID);

  const named = stepWith(t, m, 'SIGN-UP', 'cleo\n');
  assert.match(asked(named)[0], /front-door\.js sign-up-link --account cleo --by console$/);
  assert.equal(status(named, 'sign-up-cleo.json').account, 'cleo');

  const taken = stepWith(t, m, 'SIGN-UP', 'bob\n');
  assert.deepEqual(status(taken, 'sign-up-bob.json'), { at: status(taken, 'sign-up-bob.json').at, state: 'refused', kind: 'sign-up', account: 'bob', error: 'The account bob exists already.' });
  assert.match(taken.said, /The sign-up link for bob was refused: The account bob exists already/);

  const nobody = m.step('SIGN-IN-nobody', { dockerFirst: frontDoor });
  assert.equal(status(nobody, 'sign-in-nobody.json').state, 'refused');

  // A name that isn't one asks the front door for nothing.
  const bad = stepWith(t, m, 'SIGN-UP', '../x\n');
  assert.equal(asked(bad).length, 0);
  assert.match(bad.said, /Not an account's name, so no sign-up link was made/);
});

test('a front door that answers nothing leaves a failed status, and makes no account of the request', (t) => {
  const m = withBob(t);
  const done = m.step('SIGN-IN-ann', { dockerFirst: ['case "$*" in *"front-door.js sign-"*) echo "service \\"front-door\\" is not running" >&2; exit 1 ;; esac'] });
  const said = status(done, 'sign-in-ann.json');
  assert.equal(said.state, 'failed');
  assert.match(said.error, /^The front door made no link: service front-door is not running$/);
  assert.ok(!fs.existsSync(path.join(m.first.dir, 'accounts', 'SIGN-IN-ann')));
  assert.ok(!done.system.includes('useradd'), 'no account was made');
});

test('a link request root didn\'t make is refused', { skip: process.getuid?.() !== 0 && 'chowning needs root' }, (t) => {
  const m = withBob(t);
  const requests = path.join(m.first.dir, 'front-door', 'requests');
  for (const name of ['SIGN-IN-ann', 'SIGN-UP']) {
    fs.writeFileSync(path.join(requests, name), '');
    fs.chownSync(path.join(requests, name), 990, 990);
  }
  const done = m.step('bob', { dockerFirst: frontDoor });
  assert.equal(asked(done).length, 0, 'the front door was asked for nothing');
  assert.equal(status(done, 'sign-in-ann.json').state, 'refused');
  assert.equal(status(done, 'sign-in-ann.json').error, 'Only root asks for this.');
  assert.equal(status(done, 'sign-up.json').state, 'refused');
});
