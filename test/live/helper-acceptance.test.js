const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper-acceptance');
const { waitFor } = require('../helpers');

// Inspect the running application, not a docker-exec process with different credentials.
async function assertNonrootBoundary(s) {
  const state = JSON.parse(await s.inner('exec', s.server, 'node', '-e', `
    const fs=require('fs');
    const pids=fs.readdirSync('/proc').filter(p=>/^\\d+$/.test(p)).filter(p=>{
      try{return fs.readFileSync('/proc/'+p+'/cmdline','utf8').split('\\0').some(a=>a==='server.js'||a.endsWith('/server.js'));}catch{return false;}
    });
    if(pids.length!==1)throw Error('Expected exactly one server.js process, got '+pids.length);
    const fields=Object.fromEntries(fs.readFileSync('/proc/'+pids[0]+'/status','utf8').split('\\n').map(l=>l.split(/:\\s*/)));
    console.log(JSON.stringify({pid:pids[0],fields}));
  `));
  for (const key of ['Uid', 'Gid']) assert.deepEqual(state.fields[key].trim().split(/\s+/).map(Number), [60000, 60000, 60000, 60000], `${key}: actual server must be nonroot`);
  assert.deepEqual(state.fields.Groups.trim().split(/\s+/).filter(Boolean), [], 'server must discard supplementary groups');
  for (const key of ['CapEff', 'CapPrm', 'CapAmb']) assert.equal(BigInt('0x' + state.fields[key].trim()), 0n, `${key} must be cleared`);
  assert.equal(state.fields.NoNewPrivs.trim(), '1');
  const preserved = JSON.parse(await s.inner('exec', '--user', '60000:60000', s.server, 'node', '-e', `
    const fs=require('fs');console.log(JSON.stringify(Object.fromEntries(Object.keys(JSON.parse(process.argv[1])).map(p=>[p,{value:fs.readFileSync(p,'utf8'),uid:fs.statSync(p).uid}]))));
  `, JSON.stringify(s.markers)));
  for (const [p, value] of Object.entries(s.markers)) assert.deepEqual(preserved[p], { value, uid: 60000 }, `legacy marker ${p}`);
  assert.equal(await s.inner('exec', '--user', '60000:60000', s.server, 'node', '-e', 'console.log(require("fs").existsSync("/var/run/docker.sock"))'), 'false');
  // A successful connection is a failure; a timeout/ENOENT is not proof of authorization.
  for (const uid of [61000, 61001]) {
    const denied = JSON.parse(await s.inner('exec', '--user', `${uid}:${uid}`, s.server, 'node', '-e', `
      const fs=require('fs'),net=require('net');
      (async()=>{
        const files=Object.keys(JSON.parse(process.argv[1])).map(p=>{try{fs.readFileSync(p);return 'ALLOWED';}catch(e){return e.code;}});
        const sockets=await Promise.all(['/run/botdot/helper.sock','/run/botdot-privilege/broker.sock'].map(path=>new Promise(resolve=>{
          const socket=net.connect(path);socket.on('connect',()=>{socket.destroy();resolve('ALLOWED');});socket.on('error',e=>resolve(e.code));socket.setTimeout(2000,()=>{socket.destroy();resolve('TIMEOUT');});
        })));
        console.log(JSON.stringify({files,sockets}));
      })().catch(e=>{console.error(e);process.exit(1)});
    `, JSON.stringify(s.markers)));
    assert.deepEqual(denied.files, Object.keys(s.markers).map(() => 'EACCES'), `UID ${uid} server-secret isolation`);
    assert.deepEqual(denied.sockets, ['EACCES', 'EACCES'], `UID ${uid} privileged socket isolation`);
  }
  console.log(JSON.stringify({ serverPid: state.pid, uid: 60000, capabilities: 'cleared', migration: 'synthetic state preserved', botSocketAccess: 'denied' }));
}

test('isolated server and helper preserve legacy files and restore an isolated computer', { skip: process.env.BOT_DOT_HELPER_TEST !== '1', timeout: 1800000 }, async t => {
  const s = await setup();
  t.after(s.cleanup);
  try {
  await assertNonrootBoundary(s);
  await s.composeRun('restart', 'bot-dot', 'docker-helper');
  await waitFor(() => s.api('/version').then(r => r.status === 200).catch(() => false), { timeout: 30000, what: 'nonroot server restart' });
  await waitFor(() => s.helper('listAll', []).then(() => true).catch(() => false), { timeout: 30000, what: 'helper after restart' });
  await assertNonrootBoundary(s);
  const created = await s.api('/bots', 'POST', { name: 'Helper acceptance', emoji: '🧪', prompt: 'Synthetic acceptance only', computer: 'linux' });
  assert.equal(created.status, 201, JSON.stringify(created));
  const id = created.data.id;
  const computer = `botdot-${id}`;
  await s.inner('run', '-d', '--name', computer, '--label', `botdot.bot=${id}`, '--restart', 'always', '--entrypoint', 'sh', 'bot-dot/desktop:latest', '-c', 'echo legacy-file-survived > /tmp/acceptance.txt; exec sleep infinity');
  await s.composeRun('restart', 'docker-helper');
  await waitFor(() => s.helper('listAll', []).then(() => true).catch(() => false), { timeout: 30000, what: 'helper migration restart' });
  await waitFor(() => s.inner('inspect', computer, '--format', '{{.State.Running}}|{{.HostConfig.RestartPolicy.Name}}').then(v => v === 'false|no'), { timeout: 30000, what: 'legacy stop and restart-policy migration' });
  await s.inner('cp', `${computer}:/tmp/acceptance.txt`, '/tmp/acceptance-export.txt');
  assert.equal(await s.docker('exec', s.name, 'cat', '/tmp/acceptance-export.txt'), 'legacy-file-survived');
  assert.equal((await s.api(`/bots/${id}/computer`)).data.state, 'stopped');
  assert.ok((await s.api(`/bots/${id}/computer`, 'POST', { action: 'start' })).status >= 400);
  assert.equal((await s.api(`/bots/${id}/computer`)).data.state, 'stopped');
  assert.equal((await s.api(`/bots/${id}/computer`, 'POST', { action: 'reset' })).data.state, 'none');
  assert.equal((await s.api(`/bots/${id}/computer`, 'POST', { action: 'start' })).data.state, 'running');
  await s.inner('cp', '/tmp/acceptance-export.txt', `${computer}:/tmp/acceptance.txt`);
  const cmd = command => s.helper('request', [id, '/cmd', { command: 'run_command', params: { command, timeout: 10 } }]);
  const restored = await cmd('cat /tmp/acceptance.txt');
  assert.equal(restored.ok, true); assert.match(restored.text, /legacy-file-survived/);
  assert.equal((await s.helper('request', [id, '/status'])).ok, true);
  assert.equal(await s.inner('exec', s.server, 'node', '-e', 'console.log(require("fs").existsSync("/var/run/docker.sock"))'), 'false');
  const restricted = await s.inner('inspect', computer, '--format', '{{json .HostConfig.CapDrop}}|{{json .HostConfig.SecurityOpt}}|{{.HostConfig.NetworkMode}}');
  assert.match(restricted, /ALL/); assert.match(restricted, /no-new-privileges/); assert.match(restricted, /container:/);
  // A live private service makes rejection distinguishable from a missing destination.
  await s.inner('run', '-d', '--name', 'private-fixture', '--network', 'host', '--entrypoint', 'python3', 'bot-dot/desktop:latest', '-m', 'http.server', '18080');
  const address = await s.inner('network', 'inspect', `botdot-${id}-network`, '--format', '{{(index .IPAM.Config 0).Gateway}}');
  const probe = () => cmd(`python3 -c 'import socket; s=socket.socket(); s.settimeout(2); print("connected" if s.connect_ex(("${address}",18080)) == 0 else "blocked")'`);
  assert.match((await probe()).text, /blocked/);
  assert.equal((await s.api(`/bots/${id}`, 'PUT', { computerEgress: 'lan' })).status, 200);
  assert.match((await probe()).text, /connected/);
  assert.equal((await s.api(`/bots/${id}`, 'PUT', { computerEgress: 'internet' })).status, 200);
  assert.match((await probe()).text, /blocked/);
  const html = await fetch(`${s.base}/computer/${id}/vnc.html`);
  assert.equal(html.status, 200); assert.match(await html.text(), /noVNC/);
  await require('./helper-secret-acceptance').secretAcceptance(s.helper, id);
  console.log(JSON.stringify({ base: s.base, id, daemon: s.name, evidence: 'legacy preserved/exported/reset/restored; helper command control; server lacks Docker socket' }));
  if (process.env.BOT_DOT_HELPER_HOLD === '1') {
    console.log('Holding fixture for browser acceptance. End by creating /tmp/botdot-helper-acceptance-done inside the daemon.');
    await waitFor(() => s.docker('exec', s.name, 'test', '-f', '/tmp/botdot-helper-acceptance-done').then(() => true).catch(() => false), { timeout: 600000, every: 1000, what: 'browser acceptance' });
  }
  } catch (e) {
    console.error(e);
    if (process.env.BOT_DOT_HELPER_HOLD === '1') {
      console.log(`Failed fixture retained for inspection: ${s.name} ${s.base}`);
      await waitFor(() => s.docker('exec', s.name, 'test', '-f', '/tmp/botdot-helper-acceptance-done').then(() => true).catch(() => false), { timeout: 600000, every: 1000, what: 'failure inspection' });
    }
    throw e;
  }
});
