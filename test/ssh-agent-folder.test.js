// A bot's ssh-agent folder where botdot runs as root itself (identity.agentDir without the broker, ADR 249): the
// server's, the bot's group (the Chief's for the Chief), 0710, so only that user reaches the socket in it. Needs Linux
// and root, so it runs in CI's container (tests.yml) and is skipped elsewhere; the broker's own is in
// privilege-broker.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CAN = process.platform === 'linux' && process.getuid?.() === 0 && !process.env.BOT_DOT_PRIVILEGE_SOCKET;

// Asks the agent at socket for its keys, as uid: "ok" on an answer, or the error's code.
const knock = (uid, socket) => spawnSync(process.execPath, ['-e', `const c=require('net').connect(process.argv[1]);c.on('connect',()=>c.write(Buffer.from([0,0,0,1,11])));c.on('data',()=>{process.stdout.write('ok');c.destroy();});c.on('error',(e)=>process.stdout.write(e.code));`, socket], { uid, gid: uid, cwd: '/', encoding: 'utf8', timeout: 10000 }).stdout;

test("a root botdot makes each bot's agent folder itself, and only that bot reaches its socket (security review M1)", { skip: !CAN && 'needs Linux and root' }, async (t) => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-folders-'));
  fs.chmodSync(data, 0o711);
  const old = process.env.BOT_DOT_SEPARATE_USERS;
  process.env.BOT_DOT_SEPARATE_USERS = '1';
  t.after(() => { if (old === undefined) delete process.env.BOT_DOT_SEPARATE_USERS; else process.env.BOT_DOT_SEPARATE_USERS = old; fs.rmSync(data, { recursive: true, force: true }); });
  const identity = require('../lib/identity').create(data, { claudeBin: '/bin/false' });
  assert.equal(identity.enabled, true);
  const one = identity.uidForBot('bot1'), two = identity.uidForBot('bot2');
  const dir = identity.agentDir('bot1');
  assert.equal(dir, path.join(data, 'agents', String(one)));
  const area = fs.statSync(path.join(data, 'agents'));
  assert.equal(area.mode & 0o7777, 0o711);
  const st = fs.statSync(dir);
  assert.deepEqual([st.uid, st.gid, st.mode & 0o7777], [0, one, 0o710], "the server's, with the bot's group, mode 0710");
  const chief = fs.statSync(identity.agentDir('chief'));
  assert.deepEqual([chief.gid, chief.mode & 0o7777], [identity.CHIEF_UID, 0o710]);
  assert.equal(identity.agentDir('bot1'), dir, 'asked again, the same folder');
  const agent = await require('../lib/ssh-agent').start(async () => [], { dir });
  t.after(() => agent.close());
  assert.equal(knock(one, agent.socket), 'ok', 'its own bot reaches it');
  assert.equal(knock(two, agent.socket), 'EACCES', 'another bot does not');
});
