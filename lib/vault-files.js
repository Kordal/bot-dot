// Files as secrets of the Vault (#157): any file the owner picks (a key, a certificate, a .conf, a .env, #231), kept in
// Bitwarden, that a bot uses in one command on its computer (run_with_file) and never reads. Only its size is checked.
// On its own, without Bitwarden, as the tests and the Docker helper need it too.
const MAX_BYTES = 64 * 1024; // the owner's limit (#157, kept in #231): a key or a config file is a few KB
const kb = (n) => `${Math.ceil(n / 1024)} KB`;

// The name the file has in the computer: its own, of letters, digits, dot, dash and underscore only, and never `.` or
// `..`; a dotfile such as `.env` keeps its name (#231). The same check in the Docker helper, so no name can leave the
// folder botdot makes for it.
const FILE_NAME = /^(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;
function fileNameOf(name) {
  const base = String(name || '').split(/[\\/]/).pop().trim().replace(/[^A-Za-z0-9._-]+/g, '_');
  if (/^\.*$/.test(base)) return 'file';
  // An extension follows at least one character: `.env` is a name, not an extension.
  const ext = (base.match(/.(\.[A-Za-z0-9]{1,9})$/) || ['', ''])[1];
  return `${base.slice(0, base.length - ext.length).slice(0, 90)}${ext.toLowerCase()}`;
}

// The file the owner picked, as the apps send it: its name and its bytes in base64. Refused with a sentence for the
// owner when it is missing, unreadable, empty or too big; nothing is saved then.
function readFile({ fileName, content }) {
  const name = fileNameOf(fileName);
  if (typeof content !== 'string' || !content) throw new Error('Pick the file.');
  if (content.length > Math.ceil(MAX_BYTES / 3) * 4 + 4) throw new Error(`That file is bigger than ${kb(MAX_BYTES)}, the most a file in the Vault can be.`);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(content)) throw new Error("Couldn't read the file. Pick it again.");
  const bytes = Buffer.from(content, 'base64');
  if (!bytes.length) throw new Error('That file is empty.');
  if (bytes.length > MAX_BYTES) throw new Error(`That file is ${kb(bytes.length)}. A file in the Vault can be at most ${kb(MAX_BYTES)}.`);
  return { fileName: name, bytes };
}

// In Bitwarden a file is a secure note of the bot-dot folder with hidden fields: `botdot-file` holds its name, and
// `botdot-file-1`, `-2`… its bytes in base64, in pieces small enough for a field (Bitwarden refuses a field of more
// than 5000 encrypted characters). Works on every Bitwarden plan, and the bytes reach `bw` on stdin only, where an
// attachment would need Premium and the file on the server's disk.
const FIELD = 'botdot-file';
const PIECE = 3000;
const HIDDEN = 1; // Bitwarden's hidden field type
function toFields(fileName, bytes) {
  const b64 = bytes.toString('base64');
  const fields = [{ name: FIELD, value: fileName, type: 0, linkedId: null }];
  for (let i = 0; i * PIECE < b64.length; i++) fields.push({ name: `${FIELD}-${i + 1}`, value: b64.slice(i * PIECE, (i + 1) * PIECE), type: HIDDEN, linkedId: null });
  return fields;
}
const isFileItem = (it) => it?.type === 2 && (it.fields || []).some((f) => f?.name === FIELD);
// Its name and its bytes, in base64, from those fields; in order of their number, whatever order Bitwarden keeps.
function fromFields(fields = []) {
  const name = String(fields.find((f) => f?.name === FIELD)?.value || '');
  const pieces = fields.map((f) => [Number((String(f?.name).match(new RegExp(`^${FIELD}-([0-9]+)$`)) || [])[1]), f?.value]).filter(([n]) => n > 0).sort(([a], [b]) => a - b);
  const content = pieces.map(([, v]) => String(v || '')).join('');
  return { fileName: fileNameOf(name), content, size: Buffer.from(content, 'base64').length };
}

module.exports = { MAX_BYTES, FILE_NAME, FIELD, fileNameOf, readFile, toFields, fromFields, isFileItem };
