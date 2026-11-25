// What the version switch installer tests (installer-switch-N.test.js) share.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PIN, installer, rerun, withBob } = require('./installer-helpers');

// --- Each account's owner chooses when it switches to a new version (#259, ADR 053) ---------------------------

// A machine of one account, as withBob (test/installer-helpers.js) makes one of two: the install's own, the admin's.
function oneAccount(t) {
  const first = rerun(t);
  const data = path.join(first.dir, 'front-door', 'data', 'front-door.json');
  const door = (d) => fs.writeFileSync(data, typeof d === 'string' ? d : JSON.stringify({ accounts: {}, passkeys: {}, sessions: {}, signUpLinks: {}, deleted: {}, ...d }));
  const upIn = (done, account) => done.docker.some((c) => c.host === `unix://${first.run}/${account}/docker.sock` && /^compose .* up -d/.test(c.call));
  return { first, door, upIn };
}

// An install of ann and bob on the version before (PIN), the front door pinning it too, whose front door's data says
// `accounts`. update(): the admin page's update through root's step, which finds the newest (SIGNED); request(name):
// root's step for one request. Each returns what it did since the last one.
function onOlderVersion(t, accounts, { pins = {}, one = false } = {}) {
  const { first, door, upIn } = one ? oneAccount(t) : withBob(t);
  door({ accounts });
  const pin = (f, image) => fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^BOT_DOT_IMAGE=.*$/m, `BOT_DOT_IMAGE=${image}`));
  pin(path.join(first.dir, 'front-door', '.env'), pins.door || `ghcr.io/ladrok/bot-dot${PIN}`);
  for (const name of one ? ['ann'] : ['ann', 'bob']) pin(path.join(first.dir, 'accounts', name, '.env'), pins[name] || `ghcr.io/ladrok/bot-dot${PIN}`);
  let seen = fs.readFileSync(path.join(first.top, 'docker.log'), 'utf8').split('\n').filter(Boolean).length;
  const request = (name, options = {}) => {
    fs.writeFileSync(path.join(first.dir, 'front-door', 'requests', name), '');
    const done = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ['--requested'], ...options });
    assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
    assert.deepEqual(fs.readdirSync(path.join(first.dir, 'front-door', 'requests')), [], 'the request is taken');
    const docker = done.docker.slice(seen);
    seen = done.docker.length;
    const calls = (name) => docker.filter((c) => c.host === `unix://${first.run}/${name}/docker.sock`).map((c) => c.call);
    const log = path.join(first.dir, 'update.log');
    return { ...done, docker, calls, up: (name) => upIn({ docker }, name), log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' };
  };
  return { first, door, request, update: (options) => request('UPDATE', options), started: path.join(first.top, 'started') };
}

module.exports = { oneAccount, onOlderVersion };
