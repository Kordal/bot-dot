// A secret of the Vault kept in a file (#253): a config or env file a program needs (Traefik's DNS challenge, Proton
// Bridge, a systemd unit), written by botdot (place_secret_file) on the account's computer, or on a server over SSH
// with a saved SSH key. The bot names the entries and the path and never sees the values. Each place (the bot, its
// entries, the target, the path, its mode and owner) needs the owner's yes on a card first (kind 'vault-file'); after
// it, the same place is written again without a card, e.g. after the secret changed in the Vault. Kept in the data
// folder: [{ id, botId, place, entries: [{ id, name }], target, sshKey, path, mode, owner, template, allowedAt, placedAt }].
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// What a path, a mode, an owner and a host may be: plain enough to quote safely for any shell, here and over SSH.
const PATH = /^(?:\/[A-Za-z0-9._@+=,-]+)+$/;
const MODE = /^0?[0-7]{3}$/;
const OWNER = /^(?:[a-z_][a-z0-9_-]{0,31}|[0-9]{1,10})(?::(?:[a-z_][a-z0-9_-]{0,31}|[0-9]{1,10}))?$/;
const HOST = /^(?:[a-z_][a-z0-9_.-]{0,31}@)?[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/;
const COMPUTER = 'computer';
const MAX_BYTES = 64 * 1024; // as a file of the Vault (lib/vault-files.js)
const MAX_ENTRIES = 8;
const validPath = (p) => typeof p === 'string' && p.length <= 300 && PATH.test(p) && !p.split('/').some((seg) => seg === '.' || seg === '..');

// What the bot asked for, checked: { entries, template, path, mode, owner, target, sshKey }, or { error }.
function request(body) {
  const entries = Array.isArray(body.entries) ? body.entries : typeof body.entry === 'string' ? [body.entry] : null;
  if (!entries?.length || entries.some((e) => typeof e !== 'string' || !e.trim())) return { error: 'Say which Vault entries go in the file (entries: names from list_logins).' };
  if (entries.length > MAX_ENTRIES) return { error: `At most ${MAX_ENTRIES} entries in one file.` };
  if (!validPath(body.path)) return { error: 'Say where the file goes: an absolute path of letters, digits and . _ - @ + = , only, e.g. /etc/traefik/ovh.env.' };
  const mode = body.mode === undefined || body.mode === '' ? '600' : String(body.mode);
  if (!MODE.test(mode)) return { error: 'mode is an octal mode such as "600" or "640".' };
  const remote = body.host !== undefined && body.host !== null && body.host !== '';
  if (remote && (typeof body.host !== 'string' || !HOST.test(body.host))) return { error: 'host is user@server for SSH, e.g. admin@server.example.ts.net.' };
  if (remote && (typeof body.sshKey !== 'string' || !body.sshKey.trim())) return { error: 'A file on another server goes there over SSH: name the saved SSH key (sshKey) to reach it with.' };
  const owner = body.owner === undefined || body.owner === '' ? (remote ? '' : 'box') : String(body.owner);
  if (owner && !OWNER.test(owner)) return { error: 'owner is user or user:group, e.g. "root" or "box:box".' };
  if (body.template !== undefined && (typeof body.template !== 'string' || body.template.length > MAX_BYTES)) return { error: 'template is the text of the file, at most 64 KB.' };
  if (new Set(entries.map((e) => e.trim().toLowerCase())).size !== entries.length) return { error: 'An entry is named twice.' };
  return { entries, template: body.template, path: body.path, mode: mode.slice(-3), owner, target: remote ? body.host : COMPUTER, sshKey: remote ? body.sshKey : null };
}
// Where it is, in the owner's words: "the account's computer:/etc/x.env" or "admin@nas:/etc/x.env".
const whereOf = (r) => `${r.target === COMPUTER ? "the account's computer" : r.target}:${r.path}`;
// One place: what a yes allows, and what writing it again needs no new card for. The template is part of it, so a yes
// never covers other text in that file; so is the SSH key that reaches another server.
const placeOf = ({ botId, entries, target, sshKey, path: p, mode, owner, template }) => JSON.stringify([botId, entries.map((e) => e.id).sort(), target, sshKey || null, p, mode, owner, template || '']);

// The file's content: the template with {{NAME.username}}, {{NAME.password}} and {{NAME.file}} filled in, NAME an
// entry's name as list_logins shows it. Without a template, one entry alone: a file's bytes, or a login's password.
// used: [{ name, username, password } | { name, content (base64) }]. Returns a Buffer, or throws with a sentence.
function render(template, used) {
  if (template === undefined || template === '') {
    if (used.length !== 1) throw new Error('With several entries, give the file\'s text as template, with {{NAME.password}} where each value goes.');
    const [u] = used;
    return u.content !== undefined ? Buffer.from(u.content, 'base64') : Buffer.from(String(u.password || ''));
  }
  const byName = new Map(used.map((u) => [u.name.toLowerCase(), u]));
  if (byName.size !== used.length) throw new Error('Two entries have the same name: put them in the file one by one.');
  const missing = [];
  const out = template.replace(/\{\{\s*([^{}]+)\.(username|password|file)\s*\}\}/gi, (whole, name, field) => {
    const u = byName.get(name.trim().toLowerCase());
    if (!u) { missing.push(name.trim()); return whole; }
    const f = field.toLowerCase();
    if (f === 'file') return u.content !== undefined ? Buffer.from(u.content, 'base64').toString('utf8') : (missing.push(`${u.name}.file`), whole);
    return u.content !== undefined ? (missing.push(`${u.name}.${f}`), whole) : String(u[f] || '');
  });
  if (missing.length) throw new Error(`The template names ${missing.map((m) => `"${m}"`).join(', ')}, which none of the entries gives. Use {{NAME.username}} and {{NAME.password}} for a login and {{NAME.file}} for a file, NAME as in entries.`);
  if (!used.every((u) => new RegExp(`\\{\\{\\s*${u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`, 'i').test(template))) throw new Error('Every entry must be used in the template.');
  return Buffer.from(out);
}

function create(dataDir) {
  const file = path.join(dataDir, 'secret-files.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; } };
  const save = (list) => { fs.writeFileSync(`${file}.tmp`, JSON.stringify(list, null, 2), { mode: 0o600 }); fs.renameSync(`${file}.tmp`, file); };
  return {
    list: load,
    get: (id) => load().find((r) => r.id === id) || null,
    // The owner's yes on the card for this place, or null.
    granted: (place) => load().find((r) => r.place === place) || null,
    // The owner's yes on a card: the place may be written from now on.
    allow(a) {
      const list = load();
      const had = list.find((r) => r.place === a.place);
      if (had) return had;
      const r = { id: crypto.randomUUID().slice(0, 8), botId: a.botId, place: a.place, entries: a.entries, target: a.target, sshKey: a.sshKey || null, path: a.path, mode: a.mode, owner: a.owner, template: a.template || '', allowedAt: new Date().toISOString(), placedAt: null };
      save([...list, r]);
      return r;
    },
    placed(id) {
      const list = load();
      const r = list.find((x) => x.id === id);
      if (r) { r.placedAt = new Date().toISOString(); save(list); }
      return r || null;
    },
    // Gone from the target: so is the owner's yes for it.
    remove(id) { save(load().filter((r) => r.id !== id)); },
    // Where each entry of the Vault lies, for its card on the Vault page: entry id -> [{ id, where, botId, at, written }].
    // A place allowed and not written yet is listed too, so that the owner can take the yes back.
    byEntry() {
      const out = new Map();
      for (const r of load()) {
        for (const e of r.entries) out.set(e.id, [...(out.get(e.id) || []), { id: r.id, where: whereOf(r), botId: r.botId, at: r.placedAt || r.allowedAt, written: !!r.placedAt }]);
      }
      return out;
    },
  };
}

module.exports = { create, request, render, whereOf, placeOf, validPath, PATH, MODE, OWNER, HOST, COMPUTER, MAX_BYTES, MAX_ENTRIES };
