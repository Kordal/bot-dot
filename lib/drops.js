// Upload from phone (ADR 165): the owner asks for a code, the web page shows it as a QR code, and the phone that scans
// it sends files to where the owner was: the message box of a chat, or a folder in Files. The code is a long random
// token, good for one place, for DROP_MS, and for at most MAX_FILES files; it lives in memory only, so a restart ends
// it. Each file the phone sends is taken by the very upload route the owner's own page uses for that place (the
// owner chose it when asking for the code), so what is checked, saved and logged is the same.
const crypto = require('node:crypto');

const DROP_MS = 10 * 60 * 1000;
const MAX_FILES = 20;
const MAX_DROPS = 20; // codes alive at once: a new one past that ends the oldest
const TOKEN = /^[A-Za-z0-9_-]{32}$/;

// Where a file may go: the upload of a message box (/api/uploads?to=…) or of a folder in Files
// (/api/{bots/<id>|chief|projects/<name>}/workspace/upload?…), as the owner's page asks for it.
const TARGET = /^\/api\/(uploads|bots\/[\w-]+\/workspace\/upload|chief\/workspace\/upload|projects\/[^/?#]+\/workspace\/upload)\?[^#\s]*$/;

function create({ now = () => Date.now() } = {}) {
  const drops = new Map(); // token -> { token, to, name, until, files: [] }
  const sweep = () => { for (const [t, d] of drops) if (d.until + DROP_MS < now()) drops.delete(t); }; // kept a while after, for the page's last look

  return {
    // A new code for `to` (a TARGET path), with the place's `name` the phone shows. Throws a 400 for anything else.
    make({ to, name }) {
      if (typeof to !== 'string' || to.length > 1000 || !TARGET.test(to)) throw Object.assign(new Error('Say where the files go.'), { status: 400 });
      sweep();
      while (drops.size >= MAX_DROPS) drops.delete(drops.keys().next().value);
      const token = crypto.randomBytes(24).toString('base64url');
      const d = { token, to, name: String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80), until: now() + DROP_MS, files: [] };
      drops.set(token, d);
      return d;
    },
    // The code, while it may still be looked at (also a while after it expired), or null.
    get(token) {
      if (typeof token !== 'string' || !TOKEN.test(token)) return null;
      sweep();
      return drops.get(token) || null;
    },
    open: (d) => !!d && d.until > now() && !d.ended,
    full: (d) => d.files.length >= MAX_FILES,
    end(token) { const d = drops.get(token); if (d) d.ended = true; return !!d; },
    // What the owner's page shows: how long it is good for, and the files so far.
    view: (d) => ({ expires: new Date(d.until).toISOString(), open: d.until > now() && !d.ended, files: d.files.map(({ id, name, size, status, saved, error }) => ({ id, name, size, status, ...(saved ? { saved } : {}), ...(error ? { error } : {}) })) }),
    // A file coming from the phone: listed at once as arriving, then as saved or failed.
    arriving(d, name, size) {
      const f = { id: crypto.randomBytes(6).toString('hex'), name: String(name || 'file').slice(0, 200), size: Number(size) || 0, status: 'arriving' };
      d.files.push(f);
      return f;
    },
  };
}

module.exports = { create, DROP_MS, MAX_FILES, TOKEN, TARGET };
