// Files as secrets of the Vault (#157): a `.pem` the owner picks, kept in Bitwarden, that a bot uses in one command on
// its computer (run_with_file) and never reads. What botdot accepts is data here: a type is its extension and a check
// of its content, so adding one later needs no new design. On its own, without Bitwarden, as the tests and the
// Docker helper need it too.
const MAX_BYTES = 64 * 1024; // the owner's limit (#157): a key or a certificate is a few KB
const TYPES = {
  // A PEM file: a key or a certificate, text between BEGIN and END lines.
  '.pem': { check: (bytes) => /-----BEGIN [A-Z0-9 ]+-----/.test(bytes.toString('latin1')), not: "That isn't a PEM file: it has no -----BEGIN line." },
};
const ACCEPTED = Object.keys(TYPES);
const kb = (n) => `${Math.ceil(n / 1024)} KB`;

// The name the file has in the computer: its own, of letters, digits, dot, dash and underscore only. The same check in
// the Docker helper, so no name can leave the folder botdot makes for it.
const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/;
function fileNameOf(name) {
  const base = String(name || '').split(/[\\/]/).pop().trim();
  const ext = (base.match(/\.[A-Za-z0-9]{1,9}$/) || [''])[0].toLowerCase();
  const stem = base.slice(0, base.length - ext.length).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 90) || 'file';
  return `${stem}${ext}`;
}

// The file the owner picked, as the apps send it: its name and its bytes in base64. Refused with a sentence for the
// owner when it is empty, too big or of a type botdot does not take; nothing is saved then.
function readFile({ fileName, content }) {
  const name = fileNameOf(fileName);
  const ext = (name.match(/\.[a-z0-9]+$/) || [''])[0];
  if (typeof content !== 'string' || !content) throw new Error('Pick the file.');
  if (content.length > Math.ceil(MAX_BYTES / 3) * 4 + 4) throw new Error(`That file is bigger than ${kb(MAX_BYTES)}, the most a file in the Vault can be.`);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(content)) throw new Error("Couldn't read the file. Pick it again.");
  const bytes = Buffer.from(content, 'base64');
  if (!bytes.length) throw new Error('That file is empty.');
  if (bytes.length > MAX_BYTES) throw new Error(`That file is ${kb(bytes.length)}. A file in the Vault can be at most ${kb(MAX_BYTES)}.`);
  if (!TYPES[ext]) throw new Error(`The Vault takes only ${ACCEPTED.join(', ')} files for now.`);
  if (!TYPES[ext].check(bytes)) throw new Error(TYPES[ext].not);
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

module.exports = { MAX_BYTES, ACCEPTED, FILE_NAME, FIELD, fileNameOf, readFile, toFields, fromFields, isFileItem };
