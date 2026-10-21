// The document viewer (#251): a file read for the apps to show it themselves, never served as a page on botdot's
// address. A view is JSON, { name, size, at, kind, type, text?, truncated }: `kind` says how the apps draw it
// (markdown, text, csv, image or none), `text` is the start of a text file, at most VIEW_BYTES and VIEW_LINES lines.
// It also finds the file a path in a bot's reply names: in the bot's workspace on this server, or on the account's
// computer under /home/box or /workspace, read there as box with a fixed script (docs/DECISIONS.md, 2026-10-21).
const fs = require('./principal-fs');
const path = require('path');

const VIEW_BYTES = 1024 * 1024;
const VIEW_LINES = 1000;
const MARKDOWN = new Set(['md', 'markdown']);
const CSV = new Set(['csv', 'tsv']);
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const TEXT = new Set(['txt', 'text', 'log', 'json', 'jsonl', 'ndjson', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env', 'xml', 'html', 'htm',
  'css', 'scss', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs',
  'php', 'pl', 'lua', 'r', 'sql', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'diff', 'patch', 'srt', 'vtt', 'tex', 'rst', 'adoc', 'org', 'gitignore', 'dockerfile', 'makefile']);
// Media types by extension, for a view's `type` and a download's Content-Type (lib/routes/files.js). No HTML: a page
// from a bot is never named as one.
const TYPES = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  csv: 'text/csv', tsv: 'text/tab-separated-values', txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', json: 'application/json', zip: 'application/zip',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

const extOf = (name) => (String(name).match(/\.([a-z0-9]{1,10})$/i)?.[1] || '').toLowerCase();
function kindOf(name) {
  const ext = extOf(name);
  if (MARKDOWN.has(ext)) return 'markdown';
  if (CSV.has(ext)) return 'csv';
  if (IMAGE.has(ext)) return 'image';
  if (TEXT.has(ext)) return 'text';
  return 'none';
}

// A view of a file from its first bytes (`head`, at most VIEW_BYTES + 1 of them) and its whole size.
function viewOf(name, head, size, at, { text = true } = {}) {
  let kind = kindOf(name);
  const ext = extOf(name);
  const base = { name, size, at: at ? new Date(at).toISOString() : null, type: TYPES[ext] || (kind === 'none' ? 'application/octet-stream' : 'text/plain') };
  // Text with a NUL in it is no text: a binary file with a text name.
  if (['markdown', 'csv', 'text'].includes(kind) && head.subarray(0, 8000).includes(0)) kind = 'none';
  if (!['markdown', 'csv', 'text'].includes(kind)) return { ...base, kind, truncated: false };
  let s = head.subarray(0, VIEW_BYTES).toString('utf8');
  let truncated = size > VIEW_BYTES || head.length > VIEW_BYTES;
  // Cut at 1 MB: the last line, perhaps a CSV row cut in two, is left out whole.
  if (truncated) s = s.includes('\n') ? s.slice(0, s.lastIndexOf('\n') + 1) : s.replace(/�+$/, '');
  const lines = s.split('\n');
  if (lines.length > VIEW_LINES + (lines.at(-1) === '' ? 1 : 0)) { s = lines.slice(0, VIEW_LINES).join('\n'); truncated = true; }
  return { ...base, kind, truncated, ...(text ? { text: s.replace(/^﻿/, '') } : {}) };
}

// The first VIEW_BYTES + 1 bytes of a file on this server.
function readHead(file) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = fs.createReadStream(file, { start: 0, end: VIEW_BYTES });
    stream.on('data', (c) => chunks.push(c));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

// A view of a file on this server. `text: false` for its size and kind alone.
async function viewFile(file, name, opts = {}) {
  const st = fs.statSync(file);
  const head = opts.text === false && !['markdown', 'csv', 'text'].includes(kindOf(name)) ? Buffer.alloc(0) : await readHead(file);
  return viewOf(name, head, st.size, st.mtime, opts);
}

const refused = (message, status = 403, state = 'refused') => Object.assign(new Error(message), { status, state });
const gone = () => refused('This file is gone.', 404, 'gone');
const OUTSIDE = "botdot opens only files in the bot's folder, /home/box and /workspace.";

// Where a path in a bot's reply points: { where: 'computer', path } for /home/box/…, ~/… and /workspace/…, or
// { where: 'workspace', path } for one relative to the bot's workspace. Throws for any other, and for "..".
const COMPUTER_ROOTS = ['/home/box', '/workspace'];
function placeOf(p) {
  let s = String(p || '').trim();
  if (!s || s.length > 4096 || s.includes('\0')) throw refused('Say which file.', 400);
  if (s.split('/').includes('..')) throw refused(OUTSIDE);
  if (s.startsWith('~/')) s = `/home/box/${s.slice(2)}`;
  if (s.startsWith('/')) {
    const clean = path.posix.normalize(s);
    if (!COMPUTER_ROOTS.some((r) => clean.startsWith(`${r}/`))) throw refused(OUTSIDE);
    return { where: 'computer', path: clean };
  }
  return { where: 'workspace', path: path.posix.normalize(s.replace(/^(\.\/)+/, '')) };
}

// A file in a bot's workspace: its real path, a regular file inside the workspace once links are followed.
function inWorkspace(workspace, rel) {
  let root, real;
  try { root = fs.realpathSync(workspace); } catch { throw gone(); }
  try { real = fs.realpathSync(path.join(workspace, rel)); } catch (e) { throw e.code === 'EACCES' ? refused(OUTSIDE) : gone(); }
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) throw refused(OUTSIDE);
  if (!fs.statSync(real).isFile()) throw refused('That is a folder, not a file.', 400, 'not-file');
  return real;
}

// The script that reads a file on the account's computer, as box: it follows links itself and answers one line,
// "ok <size> <mtime>", then the file's first `max` bytes in base64, or one word for why not. `roots` for the tests.
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
function computerScript(file, { roots = COMPUTER_ROOTS, max = VIEW_BYTES + 1 } = {}) {
  const inRoots = roots.map((r) => `${shq(r)}/*`).join('|');
  return [
    `p=${shq(file)}`,
    'f=$(realpath -e -- "$p" 2>/dev/null) || { echo gone; exit 0; }',
    `case "$f" in ${inRoots}) ;; *) echo outside; exit 0;; esac`,
    '[ -f "$f" ] || { echo not-file; exit 0; }',
    '[ -r "$f" ] || { echo gone; exit 0; }',
    'echo "ok $(stat -c %s -- "$f") $(stat -c %Y -- "$f")"',
    `head -c ${max} -- "$f" | base64 | tr -d '\\n'`,
  ].join('\n');
}
// What that script answered: { size, at, bytes } or a thrown refusal.
function computerAnswer(stdout) {
  const [first = '', rest = ''] = String(stdout || '').split(/\n([\s\S]*)/);
  const m = first.trim().match(/^ok (\d+) (\d+)$/);
  if (m) return { size: Number(m[1]), at: new Date(Number(m[2]) * 1000), bytes: Buffer.from(rest.trim(), 'base64') };
  if (first.trim() === 'outside') throw refused(OUTSIDE);
  if (first.trim() === 'not-file') throw refused('That is a folder, not a file.', 400, 'not-file');
  throw gone();
}

module.exports = { TYPES, VIEW_BYTES, VIEW_LINES, kindOf, viewOf, viewFile, placeOf, inWorkspace, computerScript, computerAnswer, refused, gone, OUTSIDE };
