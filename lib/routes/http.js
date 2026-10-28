// The HTTP side every route module shares: NEXT, what a module's handler returns when none of its routes is asked
// for (server.js then tries the next one), and sending JSON, errors and request bodies.
const fs = require('../principal-fs');
const zlib = require('zlib');
const { said } = require('../i18n');

// A handler's answer when the request is not one of its routes.
const NEXT = Symbol('next route');

// Gzip what's worth it, when the client takes it (lists of runs and chats go to phones over Tailscale).
const takesGzip = (req) => /\bgzip\b/.test(String(req?.headers['accept-encoding'] || ''));

// An error is said in the language of whoever asked (server.js readerLanguage, #649) where the dictionary has it.
function send(res, status, body) {
  const lang = res.req?.lang;
  if (lang && status >= 400 && body && typeof body.error === 'string') body = { ...body, error: said(lang, body.error) };
  const text = JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding' };
  if (text.length > 1024 && takesGzip(res.req)) {
    res.writeHead(status, { ...headers, 'Content-Encoding': 'gzip' });
    // Compressed off the main thread. The headers are out at once (res.headersSent), so nothing answers twice.
    return zlib.gzip(text, { level: 4 }, (err, buf) => (err ? res.destroy() : res.end(buf)));
  }
  res.writeHead(status, headers);
  res.end(text);
}

// An error that answers with its own HTTP status (the request handler sends it).
const httpError = (status, message) => Object.assign(new Error(message), { status });

// A JSON request body, up to 1 MB. A longer one is read to the end but not kept.
function readBody(req, max = 1e6) {
  return readRaw(req, max).then((buf) => {
    const data = buf.toString('utf8');
    try { return data ? JSON.parse(data) : {}; } catch { throw httpError(400, 'The request body is not valid JSON.'); }
  });
}

// A request's body as it came, up to `max` bytes; a larger one is a 413.
function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on('data', (c) => {
      if (!chunks) return;
      size += c.length;
      if (size <= max) return chunks.push(c);
      chunks = null;
      reject(httpError(413, 'Body too large'));
    });
    req.on('end', () => { if (chunks) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

// Resolves once a request's body has ended, or more than `max` more bytes of it came, which are dropped.
function drained(req, max) {
  if (req.readableEnded) return Promise.resolve();
  return new Promise((resolve) => {
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > max) resolve(); });
    req.on('end', resolve);
    req.on('error', resolve);
    req.on('close', resolve);
  });
}

// A file from disk; if it disappears or can't be read on the way, the answer just ends.
function sendFile(res, file, headers) {
  const stream = fs.createReadStream(file);
  stream.on('error', () => { if (!res.headersSent) { res.writeHead(404); res.end('Not found'); } else res.destroy(); });
  stream.once('open', () => { res.writeHead(200, headers); stream.pipe(res); });
}

// Work on the Vault that a request waits for at most this long. Bitwarden can be slow (each of its commands is a
// program of its own, one at a time, lib/bitwarden.js) or locked: the answer then says what happened (`words`:
// { late, failed }), rather than leave the page or the Chief's tool waiting until the connection drops ("fetch
// failed"). The work itself goes on after a late answer.
const VAULT_WAIT_MS = Number(process.env.BOT_DOT_VAULT_WAIT_MS) || 45_000;
function inTime(work, words) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(httpError(503, `Bitwarden didn't answer in time. ${words.late}`)), VAULT_WAIT_MS);
  });
  const refused = (e) => { throw e.status ? e : httpError(503, `${e.message} ${words.failed}`); };
  return Promise.race([work.catch(refused), late]).finally(() => clearTimeout(timer));
}

module.exports = { NEXT, send, httpError, readBody, readRaw, drained, sendFile, inTime };
