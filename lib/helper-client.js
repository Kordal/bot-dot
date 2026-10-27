const http = require('node:http');
const { spawn } = require('node:child_process');
// A connection of its own per call (agent: false): a pooled one that the helper closes while a big upload's last bytes
// are still being written fails with EPIPE where nothing listens, after the answer came.
function call(operation, args = []) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: process.env.BOT_DOT_HELPER_SOCKET, path: '/call', method: 'POST', agent: false, timeout: 35 * 60_000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; if (data.length > 64 * 1024 * 1024) res.destroy(new Error('Helper response too large')); });
      res.on('error', reject);
      res.on('end', () => { try { const result = JSON.parse(data); if (res.statusCode !== 200) throw new Error(result.error); resolve(result.value); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Helper timed out')));
    req.end(JSON.stringify({ operation, args }));
  });
}
function computers(local) {
  const proxy = { IMAGE: local.IMAGE, timeZone: local.timeZone, containerName: local.containerName, watch() {} };
  for (const name of ['ensure', 'ensureImage', 'stop', 'reset', 'resetAll', 'updateAll', 'restartAll', 'usage', 'copyOld', 'details', 'health', 'logs', 'inspect', 'listAll', 'dockerStatus', 'setRestartPolicy', 'request', 'typeSecret', 'browserTool', 'startProgram', 'runWithLogin', 'runWithSshKey', 'runWithFile', 'placeFile', 'removePlacedFile', 'runShell', 'readFile', 'writeFile', 'packFolder', 'unpackFolder', 'bringOut', 'listUploads', 'moveFiles', 'replayCopy', 'replayShell', 'replayRead', 'replayWrite', 'replayEnd', 'replayRemove', 'screenState', 'freeScreen', 'restScreen']) proxy[name] = (...args) => call(name, args);
  // A file for the computer's uploads/ (#545): its bytes travel as base64, which the helper turns back into bytes.
  proxy.putUpload = (seat, { name, data }) => call('putUpload', [seat, { name, data: Buffer.from(data).toString('base64') }]);
  proxy.putFile = (seat, { script, data }) => call('putFile', [seat, { script, data: Buffer.from(data).toString('base64') }]);
  // A bot's screen (#105): its seat, { bot, screen }, goes in the address.
  proxy.screenPipe = (seat) => spawn(process.execPath, [__filename, seat.bot, String(seat.screen)], { stdio: ['pipe', 'pipe', 'ignore'] });
  return proxy;
}
function updates({ busy }) {
  let state = { available: false };
  const status = async () => (state = await call('update.status'));
  return { status, check: async () => (state = await call('update.check')), clean: () => call('update.clean'), lastStatus: () => state, start() {}, apply: async ({ force = false } = {}) => {
    const n = busy(); if (n && !force) throw new Error(`${n} tasks are still running. Update when they are done.`);
    return (state = await call('update.apply'));
  } };
}
module.exports = { call, computers, updates };
if (require.main === module) {
  const [id, screen] = process.argv.slice(2);
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id) || !/^[1-9][0-9]?$/.test(screen || '')) process.exit(1);
  const req = http.request({ socketPath: process.env.BOT_DOT_HELPER_SOCKET, path: `/screen/${id}/${screen}`, headers: { Connection: 'Upgrade', Upgrade: 'botdot-screen' } });
  req.on('upgrade', (_res, socket, head) => {
    if (head.length) process.stdout.write(head);
    socket.on('error', () => process.exit(1)); socket.on('close', () => process.exit());
    process.stdin.pipe(socket); socket.pipe(process.stdout);
  });
  req.on('error', () => process.exit(1)); req.on('response', () => process.exit(1)); req.end();
}
