// @ts-check
// Upload from phone through the front door (ADR 165): a phone with no session opens /drop/<account>/<token>, the
// address in the QR code, and sends its files to /drop/<account>/<token>/files. They reach that account's botdot
// server as /api/drop/<token>[/files], marked X-Botdot-Drop, which botdot answers with that code's page and upload
// alone. The botdot server checks the code; the front door names the account and slows down wrong codes. Also what
// the tests' stand-in front door (test/helpers.js) passes on, so that both pass it the same way.
const { ACCOUNT_NAME } = require('./store');

// The address's parts, or null for a path that is none. A code is 32 letters, digits, - and _ (lib/drops.js).
/** @param {string} pathname @returns {{ account: string, token: string, path: string } | null} */
function dropOf(pathname) {
  const m = /^\/drop\/([^/]+)\/([A-Za-z0-9_-]{32})(\/files)?\/?$/.exec(String(pathname));
  if (!m || !ACCOUNT_NAME.test(m[1])) return null;
  return { account: m[1], token: m[2], path: `/api/drop/${m[2]}${m[3] || ''}` };
}

// What a phone's request carries on: its file's name and body, its language, and what the front door says of it.
// Nothing else the phone wrote: no cookie, no key, no Tailscale login.
const KEPT = ['x-bot-dot', 'x-file-name', 'content-type', 'content-length', 'transfer-encoding', 'accept-language', 'user-agent', 'host'];
/** @param {import('http').IncomingMessage} req @param {string} account @param {string} client @param {string} proto */
function dropHeaders(req, account, client, proto) {
  /** @type {import('http').OutgoingHttpHeaders} */
  const out = {};
  for (const k of KEPT) if (req.headers[k] !== undefined) out[k] = req.headers[k];
  out['x-forwarded-for'] = client;
  out['x-forwarded-proto'] = proto;
  out['x-botdot-account'] = account;
  out['x-botdot-drop'] = '1';
  return out;
}

module.exports = { dropOf, dropHeaders };
