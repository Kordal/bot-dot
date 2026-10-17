// Where the bots' computer image comes from (lib/computers.js): a name on a registry is botdot's signed
// desktop and is pulled; a name without one, set or not, is a local image, built from deploy/desktop when
// it is missing. A self-built botdot server (CONTEXT.md) names its own, so this rule is the one it gets.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { fakeDocker } = require('./helpers');

// ensureImage() in a botdot server whose environment has `image` as BOT_DOT_COMPUTER_IMAGE: docker's calls.
function ensureImage(t, image) {
  const docker = fakeDocker();
  t.after(() => docker.remove());
  const env = { ...process.env, PATH: `${docker.bin}${path.delimiter}${process.env.PATH}` };
  delete env.BOT_DOT_COMPUTER_IMAGE;
  if (image !== undefined) env.BOT_DOT_COMPUTER_IMAGE = image;
  execFileSync(process.execPath, ['-e', "require('./lib/computers').ensureImage().then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); })"], { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' });
  return docker.calls().map((call) => call.args);
}

for (const [what, image, built] of [
  ['a self-built computer image', 'bot-dot/desktop:latest', 'bot-dot/desktop:latest'],
  ['another name without a registry', 'my/desktop:dev', 'my/desktop:dev'],
  ['no computer image at all (compose.yaml names none)', '', 'bot-dot/desktop:latest'],
  ['no BOT_DOT_COMPUTER_IMAGE', undefined, 'bot-dot/desktop:latest'],
]) {
  test(`${what} is built here when it is missing, and nothing is pulled`, (t) => {
    const calls = ensureImage(t, image);
    assert.ok(!calls.some((args) => ['pull', 'login'].includes(args[0])), `no pull or sign-in: ${JSON.stringify(calls)}`);
    const build = calls.find((args) => args[0] === 'build');
    assert.ok(build, 'the image is built');
    assert.deepEqual(build.slice(0, 3), ['build', '-t', built]);
    assert.equal(build.at(-1), path.join(__dirname, '..', 'deploy', 'desktop'));
  });
}

test('compose.yaml names a computer image only when the install sets one, for the server and the helper', () => {
  const compose = require('node:fs').readFileSync(path.join(__dirname, '..', 'compose.yaml'), 'utf8');
  const lines = compose.split('\n').filter((line) => /^\s+BOT_DOT_COMPUTER_IMAGE:/.test(line));
  assert.equal(lines.length, 2);
  for (const line of lines) assert.equal(line.trim(), 'BOT_DOT_COMPUTER_IMAGE: ${BOT_DOT_COMPUTER_IMAGE:-}');
});
