// get.sh, the one-line install (`curl … get.sh | sudo sh`): it gets botdot's source into ./bot-dot-source with git,
// or updates it when it is there, and runs the install.sh in it with the person's arguments, never letting that
// installer read the rest of the piped-in script. Stand-ins for id and git; the README and the install guide show the line.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const GET = fs.readFileSync(path.join(ROOT, 'get.sh'), 'utf8');
const LINE = 'curl -fsSL https://raw.githubusercontent.com/Kordal/bot-dot/main/get.sh | sudo sh';

// A folder to run in, with stand-ins: id says root (or not), git logs what it is asked and makes a source whose
// install.sh says its arguments and what it reads on its standard input.
function place(t, { uid = 0 } = {}) {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-get-'));
  t.after(() => fs.rmSync(top, { recursive: true, force: true }));
  const bin = path.join(top, 'bin');
  const work = path.join(top, 'work');
  fs.mkdirSync(bin);
  fs.mkdirSync(work);
  fs.writeFileSync(path.join(bin, 'id'), `#!/bin/sh\necho ${uid}\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'git'), [
    '#!/bin/sh',
    `echo "git $*" >> "${top}/git.log"`,
    'if [ "$1" = clone ]; then',
    '  mkdir -p "$4/.git"',
    '  printf \'%s\\n\' \'echo "install.sh $*"\' \'cat | sed "s/^/stdin: /"\' > "$4/install.sh"',
    'fi',
  ].join('\n'), { mode: 0o755 });
  return { top, work, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SUDO_USER: '' } };
}
// The script piped in on standard input, as curl hands it to sh.
const piped = (p, args = []) => spawnSync('sh', ['-s', '--', ...args], { cwd: p.work, env: p.env, input: GET, encoding: 'utf8' });

test('a first run clones the source here and runs its installer with the arguments, not on the piped script', (t) => {
  const p = place(t);
  const r = piped(p, ['--update']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(p.top, 'git.log'), 'utf8'), /^git clone --quiet https:\/\/github\.com\/Kordal\/bot-dot\.git bot-dot-source$/m);
  assert.match(r.stdout, /^install\.sh --update$/m);
  assert.doesNotMatch(r.stdout, /stdin: .*botdot_get/, 'the installer never reads the rest of get.sh');
});

test('a second run updates the source it finds instead of cloning again', (t) => {
  const p = place(t);
  fs.mkdirSync(path.join(p.work, 'bot-dot-source', '.git'), { recursive: true });
  fs.writeFileSync(path.join(p.work, 'bot-dot-source', 'install.sh'), 'echo "install.sh $*"\n');
  const r = piped(p);
  assert.equal(r.status, 0, r.stderr);
  const log = fs.readFileSync(path.join(p.top, 'git.log'), 'utf8');
  assert.match(log, /^git -C bot-dot-source pull --ff-only$/m);
  assert.doesNotMatch(log, /clone/);
  assert.match(r.stdout, /^install\.sh $/m);
});

test('without sudo it says how to run it and changes nothing', (t) => {
  const p = place(t, { uid: 1000 });
  const r = piped(p);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Run it with sudo/);
  assert.ok(!fs.existsSync(path.join(p.top, 'git.log')));
});

test('the README and the install guide give the one line', () => {
  for (const f of ['README.md', 'docs/install-linux.md']) {
    assert.ok(fs.readFileSync(path.join(ROOT, f), 'utf8').includes(`\n${LINE}\n`), `${f} has: ${LINE}`);
  }
  assert.ok(GET.includes(LINE), 'get.sh says the same line');
});
