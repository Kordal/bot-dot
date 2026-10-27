// A tar of plain files and folders (ustar), made and read by botdot itself, to copy and move between a bot's folder on
// botdot and the account's computer (#603), where box packs and unpacks it with tar. Nothing else is written: a link,
// a device or any other kind of entry read from a tar is left out, and a name that leaves the tar's folder ("..", an
// absolute path) is refused.
const BLOCK = 512;

const refused = (message) => Object.assign(new Error(message), { status: 400, state: 'refused' });

function field(buf, at, len, value) {
  const b = Buffer.from(String(value), 'utf8');
  if (b.length > len) throw refused('A name is too long to copy.');
  b.copy(buf, at);
}
const octal = (n, len) => `${Math.max(0, Math.floor(n)).toString(8).padStart(len - 1, '0')}\0`;

// A name of at most 100 bytes, or one split at a / into a prefix of at most 155 and a name of at most 100.
function splitName(name) {
  if (Buffer.byteLength(name) <= 100) return ['', name];
  const parts = name.split('/');
  for (let i = parts.length - 1; i > 0; i--) {
    const prefix = parts.slice(0, i).join('/'); const rest = parts.slice(i).join('/');
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100) return [prefix, rest];
  }
  throw refused('A name is too long to copy.');
}

function header({ name, type, size = 0, mtimeMs = Date.now() }) {
  const h = Buffer.alloc(BLOCK);
  const [prefix, short] = splitName(type === 'folder' ? `${name}/` : name);
  field(h, 0, 100, short);
  field(h, 100, 8, octal(type === 'folder' ? 0o755 : 0o644, 8));
  field(h, 108, 8, octal(0, 8));
  field(h, 116, 8, octal(0, 8));
  field(h, 124, 12, octal(size, 12));
  field(h, 136, 12, octal(mtimeMs / 1000, 12));
  h.fill(' ', 148, 156);
  h[156] = type === 'folder' ? 0x35 : 0x30;
  field(h, 257, 6, 'ustar\0');
  field(h, 263, 2, '00');
  field(h, 345, 155, prefix);
  let sum = 0;
  for (const c of h) sum += c;
  field(h, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
  return h;
}

// entries: [{ name (names joined by /), type: 'file' | 'folder', data? (a Buffer, for a file), mtimeMs? }].
function pack(entries) {
  const out = [];
  for (const e of entries) {
    const data = e.type === 'file' ? e.data || Buffer.alloc(0) : null;
    out.push(header({ name: e.name, type: e.type, size: data ? data.length : 0, mtimeMs: e.mtimeMs }));
    if (data) {
      out.push(data);
      const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
      if (pad) out.push(Buffer.alloc(pad));
    }
  }
  out.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(out);
}

const text = (buf, at, len) => { const s = buf.subarray(at, at + len); const end = s.indexOf(0); return (end < 0 ? s : s.subarray(0, end)).toString('utf8'); };

// What a tar holds: [{ name, type: 'file' | 'folder', data? }], plain files and folders only. Throws on a broken tar
// and on a name outside it.
function unpack(buf) {
  const out = [];
  let at = 0;
  while (at + BLOCK <= buf.length) {
    const h = buf.subarray(at, at + BLOCK);
    if (h.every((c) => c === 0)) break;
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (sum !== parseInt(text(h, 148, 8).trim(), 8)) throw refused('The copy came back broken.');
    const size = parseInt(text(h, 124, 12).trim() || '0', 8);
    const flag = String.fromCharCode(h[156] || 0x30);
    const prefix = text(h, 345, 155);
    const name = (prefix ? `${prefix}/${text(h, 0, 100)}` : text(h, 0, 100)).replace(/^(\.\/)+/, '').replace(/\/+$/, '');
    const start = at + BLOCK;
    at = start + Math.ceil(size / BLOCK) * BLOCK;
    if (at > buf.length) throw refused('The copy came back broken.');
    if (!name || name === '.') continue;
    if (name.startsWith('/') || name.split('/').some((p) => p === '..' || p === '.' || p === '')) throw refused('The copy holds a name outside its folder.');
    if (flag === '5') out.push({ name, type: 'folder' });
    else if (flag === '0' || flag === '\0') out.push({ name, type: 'file', data: Buffer.from(buf.subarray(start, start + size)) });
  }
  return out;
}

module.exports = { pack, unpack, BLOCK };
