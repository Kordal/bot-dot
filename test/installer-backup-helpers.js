// What the backup's installer tests (installer-backup-N.test.js) share: a machine with ann and bob, their data and bob's computer's volumes.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { withBob } = require('./installer-helpers');

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const volume = (home, name) => path.join(home, '.local', 'share', 'docker', 'volumes', name, '_data');

// A machine with ann and bob, their data and bob's computer's volumes, as root's step finds them.
function machine(t) {
  const m = withBob(t);
  const { dir } = m.first;
  const ann = path.join(dir, 'accounts', 'ann');
  fs.mkdirSync(path.join(ann, 'data', 'backups'), { recursive: true });
  fs.writeFileSync(path.join(ann, 'data', 'bots.json'), '[{"id":"b1"}]');
  fs.writeFileSync(path.join(ann, 'data', 'backups', 'bot-dot-20261101-0300.bdb'), 'an account backup');
  fs.mkdirSync(path.join(m.home, 'data'), { recursive: true });
  fs.writeFileSync(path.join(m.home, 'data', 'vault.json'), '[]');
  fs.mkdirSync(volume(m.home, 'bob_bot-dot-config'), { recursive: true });
  fs.writeFileSync(path.join(volume(m.home, 'bob_bot-dot-config'), 'vault.key'), 'ab'.repeat(32));
  fs.mkdirSync(path.join(volume(m.home, 'botdot-bob.account.computer-workspace'), 'b1'), { recursive: true });
  fs.writeFileSync(path.join(volume(m.home, 'botdot-bob.account.computer-workspace'), 'b1', 'notes.md'), 'a bot file');
  const profile = path.join(volume(m.home, 'botdot-bob.account.computer-browser'), 'profiles', 'b1');
  fs.mkdirSync(profile, { recursive: true });
  for (const f of ['cookies.sqlite', 'lock', '.parentlock', 'SingletonLock']) fs.writeFileSync(path.join(profile, f), f);
  fs.mkdirSync(volume(m.home, 'botdot-bob.account.computer-tailscale'), { recursive: true });
  fs.writeFileSync(path.join(volume(m.home, 'botdot-bob.account.computer-tailscale'), 'tailscaled.state'), '{"_machinekey":"x"}');
  fs.writeFileSync(path.join(dir, 'front-door', 'data', 'audit.jsonl'), '{"what":"sign-in"}\n');
  m.door({ accounts: { ann: {}, bob: {} }, passkeys: { k1: { account: 'ann' } } });
  // The version the install wrote, as of an image with a source revision.
  fs.writeFileSync(path.join(dir, 'front-door', 'status', 'version.json'), '{"version":"abc1234","selfBuilt":false}\n');
  return { ...m, dir, set: path.join(dir, 'backup') };
}

module.exports = { sha256, volume, machine };
