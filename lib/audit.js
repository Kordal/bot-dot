// Fixed event names and actor identifiers only. Never accept arbitrary event payloads.
const fs = require('node:fs');
const path = require('node:path');
const { BOT, TOOL_NAME, VERSION, LINK_VERSION, SHA256 } = require('./tools-worker');
const ACTIONS = new Set(['job.approved', 'job.declined', 'tile.approved', 'tile.declined', 'connector.granted', 'connector.removed', 'bitwarden.unlocked', 'backup.created', 'backup.downloaded', 'backup.restored', 'update.applied', 'update.cleaned',
  'tool.installed', 'tool.removed', 'tool.declined', 'tool.failed', 'login.host-allowed', 'memory.forgotten', 'memory.approved', 'memory.declined',
  'secret-file.allowed', 'secret-file.placed', 'secret-file.removed',
  'override.allowed', 'override.revoked', 'memory.always-allowed', 'memory.always-revoked', 'chief.after-web-allowed']);
// A memory event (ADR 016): a forget, and the owner's yes or no to a memory change that waited. Which notes by
// their ids, how many runs were left out, which bot asked and which kind of change: never a note's text.
const MEMORY_DETAIL = { id: /^[A-Za-z0-9_-]{1,80}$/, change: /^(add|edit|remove|erase)$/ };
// An installed tool's line also says which bot, which tool and which version (ADR 007), and a failed install
// one of four causes. A tool from a link is named by the sha256 the owner approved, and has a version only
// when the Chief gave one. Each is checked against its own shape; nothing else is ever written.
const TOOL_DETAIL = { bot: BOT, tool: TOOL_NAME, version: VERSION, sha256: SHA256, cause: /^(checksum|network|disk|other)$/ };
// A saved login the owner let a bot use on another host (every login request answered with a login of another
// website): the login's name as the owner wrote it, the host and the bot. The host is any name exactHosts keeps
// (lib/network-address.js), so that no host a login can gain goes unlogged.
const LOGIN_DETAIL = { login: /^[^\u0000-\u001f\u007f]{1,100}$/, host: /^[!-~]{1,253}$/, bot: BOT };
// A secret of the Vault kept in a file (#253): the bot it is for, and where the file is (secret-files.js whereOf: a
// plain path, on the account's computer or user@host). Never which secret, nor its value.
const SECRET_FILE_DETAIL = { bot: BOT, where: /^[ -~]{1,600}$/ };
// What an update's image cleanup did (lib/image-cleanup.js): images removed, skipped and failed, and the
// bytes that came back. Exactly these four, each a whole number.
const CLEANED_DETAIL = ['removed', 'skipped', 'failed', 'bytes'];
function create(dir) {
  const file = path.join(dir, 'audit.log');
  return (action, by = 'you', detail = null) => {
    if (!ACTIONS.has(action)) throw new Error('Unknown audit event');
    const actor = by === 'you' ? 'owner' : by;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(actor)) throw new Error('Invalid audit actor');
    const line = { time: new Date().toISOString(), actor, action };
    if (action.startsWith('tool.')) {
      const fromLink = detail?.sha256 !== undefined;
      for (const key of ['bot', 'tool', 'version', ...(fromLink ? ['sha256'] : [])]) {
        if (key === 'version' && fromLink && detail.version === '') continue;
        const shape = key === 'version' && fromLink ? LINK_VERSION : TOOL_DETAIL[key]; // a release's own version, as the Chief gave it
        if (typeof detail?.[key] !== 'string' || !shape.test(detail[key])) throw new Error('Invalid audit detail');
        line[key] = detail[key];
      }
      if (action === 'tool.failed') line.cause = TOOL_DETAIL.cause.test(detail.cause) ? detail.cause : 'other';
    } else if (action === 'login.host-allowed') {
      for (const [key, shape] of Object.entries(LOGIN_DETAIL)) {
        if (typeof detail?.[key] !== 'string' || !shape.test(detail[key])) throw new Error('Invalid audit detail');
        line[key] = detail[key];
      }
    } else if (action.startsWith('memory.')) {
      if (detail?.change !== undefined) { if (!MEMORY_DETAIL.change.test(String(detail.change))) throw new Error('Invalid audit detail'); line.change = detail.change; }
      if (detail?.bot !== undefined) { if (typeof detail.bot !== 'string' || !BOT.test(detail.bot)) throw new Error('Invalid audit detail'); line.bot = detail.bot; }
      // Ids only: what does not look like an id is not written.
      line.notes = (Array.isArray(detail?.notes) ? detail.notes : []).filter((id) => typeof id === 'string' && MEMORY_DETAIL.id.test(id)).slice(0, 200);
      if (detail?.runs !== undefined) line.runs = Math.max(0, Math.floor(Number(detail.runs)) || 0);
    } else if (action.startsWith('secret-file.')) {
      for (const [key, shape] of Object.entries(SECRET_FILE_DETAIL)) {
        if (typeof detail?.[key] !== 'string' || !shape.test(detail[key])) throw new Error('Invalid audit detail');
        line[key] = detail[key];
      }
    } else if (action.startsWith('override.')) {
      // A rule the owner lifted for a bot for good, or took back (#253): the bot and the grant's id, never its words.
      for (const [key, shape] of Object.entries({ bot: BOT, override: /^[A-Za-z0-9_-]{1,40}$/ })) {
        if (typeof detail?.[key] !== 'string' || !shape.test(detail[key])) throw new Error('Invalid audit detail');
        line[key] = detail[key];
      }
    } else if (action === 'chief.after-web-allowed') {
      // A type of the Chief's changes the owner let through after the web for good (#280): its name alone.
      if (typeof detail?.type !== 'string' || !/^[a-z-]{1,40}$/.test(detail.type)) throw new Error('Invalid audit detail');
      line.type = detail.type;
    } else if (action === 'update.cleaned') {
      if (!detail || typeof detail !== 'object' || Object.keys(detail).length !== CLEANED_DETAIL.length) throw new Error('Invalid audit detail');
      for (const key of CLEANED_DETAIL) {
        if (!Number.isSafeInteger(detail[key]) || detail[key] < 0) throw new Error('Invalid audit detail');
        line[key] = detail[key];
      }
    } else if (detail) throw new Error('Invalid audit detail');
    const fd = fs.openSync(file, 'a', 0o600);
    try { fs.fchmodSync(fd, 0o600); fs.writeSync(fd, JSON.stringify(line) + '\n'); } finally { fs.closeSync(fd); }
  };
}
module.exports = { create };
