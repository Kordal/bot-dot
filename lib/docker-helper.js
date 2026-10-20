// Private Unix-socket API. Never accept Docker argv, mounts, images or Compose project names.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vaultFiles = require('./vault-files');
// Dedicated server group; bot principals start at 61000 and must never join this group.
// The compose files put the helper in it (group_add), so it can hand its socket over without CAP_CHOWN.
const SERVER_GID = 60000;
const ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const keys = (v, allowed) => object(v) && Object.keys(v).every((k) => allowed.includes(k));
// A bot's screen on the account's computer (#105): { bot, screen }, as lib/computer-screens.js hands it on.
const MAX_SCREEN = 89;
const isSeat = (v) => keys(v, ['bot', 'screen']) && typeof v.bot === 'string' && ID.test(v.bot)
  && Number.isInteger(v.screen) && v.screen >= 1 && v.screen <= MAX_SCREEN;
const filePath = (v) => typeof v === 'string' && v.length > 0 && v.length <= 4096 && !v.includes('\0');
function validate(operation, args) {
  if (!Array.isArray(args)) return false;
  const id = () => typeof args[0] === 'string' && ID.test(args[0]);
  const seat = () => isSeat(args[0]);
  switch (operation) {
    case 'inspect': case 'details': case 'stop': case 'reset': return args.length === 1 && id();
    // The account's computer's state, asked for no bot (#109), or for one as before.
    case 'health': return args.length === 0 || args.length === 1 && id();
    // The account's computer, for every bot (#107): an update or a reset takes nothing; a copy of a bot's old computer
    // takes that bot, and botdot alone decides from where and to where.
    // Its restart, and what each screen uses of it (#109), take nothing either.
    case 'resetAll': case 'updateAll': case 'restartAll': case 'usage': return args.length === 0;
    case 'copyOld': return args.length === 1 && id();
    case 'screenState': case 'freeScreen': case 'restScreen': return args.length === 1 && seat();
    case 'logs': return (args[0] === null || seat()) && (args.length === 1 || args.length === 2 && Number.isInteger(args[1]) && args[1] >= 1 && args[1] <= 500);
    // Without a bot, the account's computer alone (bots.keepAlwaysOn); with a bot's seat, its screen too.
    case 'ensure': return args.length === 0 || args.length === 1 && seat();
    case 'listAll': case 'ensureImage': case 'update.status': case 'update.check': case 'update.clean': return args.length === 0;
    case 'dockerStatus': return args.length === 0 || args.length === 1 && typeof args[0] === 'boolean';
    case 'setRestartPolicy': return args.length === 2 && id() && typeof args[1] === 'boolean';
    case 'request': return seat() && args.length >= 2 && args.length <= 4 && ['/cmd', '/status'].includes(args[1])
      && (args[2] === null || args[2] === undefined || object(args[2]))
      && (args[3] === undefined || keys(args[3], ['timeoutSeconds']) && Number.isFinite(args[3].timeoutSeconds) && args[3].timeoutSeconds >= 1 && args[3].timeoutSeconds <= 615);
    case 'typeSecret': return args.length === 2 && seat() && keys(args[1], ['op', 'site', 'field', 'value', 'submit']);
    // The browser tools (#170): what the bot asks of its browser's page, no secret in it.
    case 'browserTool': return args.length === 2 && seat() && keys(args[1], ['op', 'ref', 'text', 'key', 'url', 'seconds'])
      && ['snapshot', 'click', 'fill', 'press', 'goto', 'wait'].includes(args[1].op)
      && ['ref', 'text', 'key', 'url'].every((k) => args[1][k] === undefined || typeof args[1][k] === 'string' && args[1][k].length <= 10000)
      && (args[1].seconds === undefined || Number.isFinite(args[1].seconds) && args[1].seconds >= 1 && args[1].seconds <= 15);
    // The login travels in the body, as typeSecret's value does; the helper puts it in docker's environment only.
    case 'runWithLogin': return args.length === 2 && seat() && keys(args[1], ['command', 'username', 'password', 'timeoutSeconds'])
      && typeof args[1].command === 'string' && args[1].command.length > 0 && args[1].command.length <= 4000
      && ['username', 'password'].every((k) => args[1][k] === undefined || typeof args[1][k] === 'string' && args[1][k].length <= 65536)
      && (args[1].timeoutSeconds === undefined || Number.isFinite(args[1].timeoutSeconds) && args[1].timeoutSeconds >= 1 && args[1].timeoutSeconds <= 600);
    // The private key travels in the body too; the helper hands it to `docker exec` on stdin only.
    case 'runWithSshKey': return args.length === 2 && seat() && keys(args[1], ['command', 'privateKey', 'timeoutSeconds'])
      && typeof args[1].command === 'string' && args[1].command.length > 0 && args[1].command.length <= 4000
      && typeof args[1].privateKey === 'string' && args[1].privateKey.length > 0 && args[1].privateKey.length <= 65536
      && (args[1].timeoutSeconds === undefined || Number.isFinite(args[1].timeoutSeconds) && args[1].timeoutSeconds >= 1 && args[1].timeoutSeconds <= 600);
    // A file of the Vault (#157) travels in the body as base64; the helper hands it to `docker exec` on stdin only.
    case 'runWithFile': return args.length === 2 && seat() && keys(args[1], ['command', 'fileName', 'content', 'timeoutSeconds'])
      && typeof args[1].command === 'string' && args[1].command.length > 0 && args[1].command.length <= 4000
      && typeof args[1].fileName === 'string' && vaultFiles.FILE_NAME.test(args[1].fileName)
      && typeof args[1].content === 'string' && args[1].content.length > 0 && args[1].content.length <= 100000
      && (args[1].timeoutSeconds === undefined || Number.isFinite(args[1].timeoutSeconds) && args[1].timeoutSeconds >= 1 && args[1].timeoutSeconds <= 600);
    // run_shell, read_file and write_file (#134): as box in the bot's folder, without its screen.
    case 'runShell': return args.length === 2 && seat() && keys(args[1], ['command', 'timeoutSeconds'])
      && typeof args[1].command === 'string' && args[1].command.length > 0 && args[1].command.length <= 100000
      && (args[1].timeoutSeconds === undefined || Number.isFinite(args[1].timeoutSeconds) && args[1].timeoutSeconds >= 1 && args[1].timeoutSeconds <= 600);
    case 'readFile': return args.length === 2 && seat() && keys(args[1], ['path']) && filePath(args[1].path);
    case 'writeFile': return args.length === 2 && seat() && keys(args[1], ['path', 'content']) && filePath(args[1].path)
      && typeof args[1].content === 'string';
    case 'startProgram': return args.length === 2 && seat() && typeof args[1] === 'string' && args[1].length > 0 && args[1].length <= 4000;
    case 'update.apply': return args.length === 0; // server owns its busy/force decision
    default: return false;
  }
}
// The operations that make a computer again or erase one (#191).
const CHANGES_COMPUTER = new Set(['updateAll', 'resetAll', 'reset']);
function createServer({ computers, updates }) {
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.method !== 'POST' || req.url !== '/call') return send(404, { error: 'Unknown operation' });
    try {
      let bytes = 0; const chunks = [];
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 1024 * 1024) throw new Error('Request too large'); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks));
      if (!keys(body, ['operation', 'args']) || !validate(body.operation, body.args)) return send(400, { error: 'Invalid helper operation' });
      const target = body.operation.startsWith('update.') ? updates : computers;
      const method = body.operation.replace(/^update\./, '');
      const value = await target[method](...body.args) ?? null;
      send(200, { value });
      // A computer made again, or erased, leaves the desktop image it ran on unused: it goes now, by botdot's rule,
      // since an update no longer downloads a computer image no computer uses (#191). After the answer, and never
      // waited for: a cleanup that fails is tried again at the next one.
      if (CHANGES_COMPUTER.has(body.operation) && value !== 'none' && value !== 'failed') updates.clean?.().catch(() => {});
    } catch (e) { send(400, { error: e.message }); }
  });
  server.on('upgrade', (req, socket, head) => {
    // The bot's own screen (#105): /screen/<bot>/<screen number>.
    const m = req.url?.match(/^\/screen\/([a-z0-9][a-z0-9_-]{0,79})\/([1-9][0-9]?)$/);
    const seat = m && { bot: m[1], screen: Number(m[2]) };
    if (!seat || !isSeat(seat) || req.headers.upgrade !== 'botdot-screen') return socket.destroy();
    const pipe = computers.screenPipe(seat);
    const close = () => { pipe.kill(); socket.destroy(); };
    pipe.on('error', close); pipe.on('close', close); socket.on('error', close); socket.on('close', close); pipe.stdin.on('error', close);
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: botdot-screen\r\n\r\n');
    if (head.length) pipe.stdin.write(head);
    socket.pipe(pipe.stdin); pipe.stdout.pipe(socket);
  });
  return server;
}
function prepareSocketDirectory(socket) {
  const dir = path.dirname(socket);
  fs.mkdirSync(dir, { recursive: true, mode: 0o710 });
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0) throw new Error('Helper socket directory must be root-owned');
  fs.chownSync(dir, 0, SERVER_GID);
  fs.chmodSync(dir, 0o710);
  // The server can traverse this directory but cannot replace the helper socket.
  fs.rmSync(socket, { force: true });
}
async function main() {
  if (process.getuid?.() !== 0) throw new Error('Docker helper must run as root');
  const socket = process.env.BOT_DOT_HELPER_SOCKET || '/run/botdot/helper.sock';
  // Child processes and modules here use Docker directly; the main server uses this socket.
  delete process.env.BOT_DOT_HELPER_SOCKET;
  const { execFileSync } = require('node:child_process');
  const own = JSON.parse(execFileSync('docker', ['inspect', process.env.HOSTNAME], { encoding: 'utf8' }))[0];
  const project = own.Config.Labels['com.docker.compose.project'];
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) throw new Error('Helper must belong to a Compose project');
  // Its computers carry its project's name, so another botdot app on this Docker host keeps its own (#19).
  process.env.BOT_DOT_COMPUTER_SCOPE = project;
  const computers = require('./computers');
  await computers.adoptUnscoped();
  const existing = await computers.listAll();
  computers.watch(() => Object.keys(existing));
  const updates = require('./updates').create({ busy: () => 0, computerImage: computers.IMAGE,
    containerId: () => {
      const ids = execFileSync('docker', ['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`, '--filter', 'label=com.docker.compose.service=bot-dot'], { encoding: 'utf8' }).trim().split('\n');
      if (ids.length !== 1 || !/^[a-f0-9]{12,64}$/.test(ids[0])) throw new Error('Cannot identify the server in this project');
      return ids[0];
    } });
  prepareSocketDirectory(socket);
  const server = createServer({ computers, updates });
  process.umask(0o177);
  server.listen(socket, () => {
    fs.chownSync(socket, 0, SERVER_GID);
    fs.chmodSync(socket, 0o660);
    updates.start();
  });
}
module.exports = { createServer };
if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
