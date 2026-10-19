// @ts-check
// A call through the front door (ADR 026, ADR 028): POST <front door>/call/<account>/<bot>/<job> with the job's key
// reaches that account's botdot server as POST /api/bots/<bot>/jobs/<job>/call, without a session. The botdot server
// checks the key; the front door names the account, says who sent it and slows down wrong keys. Also what the
// tests' stand-in front door (test/helpers.js) passes on, so that both pass a call the same way.
const { ACCOUNT_NAME } = require('./store');
const { clientOf } = require('./limits');

// The call address's parts, or null for a path that is no call address. Ids are letters, digits, - and _, so
// nothing in them is decoded, and the account's name is one an account can have.
/** @param {string} pathname @returns {{ account: string, botId: string, jobId: string, path: string } | null} */
function callOf(pathname) {
  const m = /^\/call\/([^/]+)\/([\w-]+)\/([\w-]+)$/.exec(String(pathname));
  if (!m || !ACCOUNT_NAME.test(m[1])) return null;
  return { account: m[1], botId: m[2], jobId: m[3], path: `/api/bots/${m[2]}/jobs/${m[3]}/call` };
}

// Whether a path is a call as a botdot server takes it. A session never sends one: a call goes to its call address,
// where it is counted (front-door.js takeCall).
/** @param {string} pathname */
const isPassedCall = (pathname) => /^\/api\/bots\/[^/]+\/jobs\/[^/]+\/call\/?$/.test(String(pathname));

// What a call carries on to the botdot server: its key or its signature (a signed call, #37: botdot's form with its
// timestamp, or GitHub's), its body's headers, and what the front door says of it. Nothing else the sender wrote: no
// cookie, no Chief's or run's key, no Tailscale login (anyone on the internet could write one).
const KEPT = ['authorization', 'x-botdot-signature-256', 'x-botdot-timestamp', 'x-hub-signature-256', 'content-type', 'content-length', 'transfer-encoding', 'user-agent', 'host'];
/** @param {import('http').IncomingMessage} req @param {string} account @param {string} client */
function callHeaders(req, account, client) {
  /** @type {import('http').OutgoingHttpHeaders} */
  const out = {};
  for (const k of KEPT) if (req.headers[k] !== undefined) out[k] = req.headers[k];
  out['x-forwarded-for'] = client;
  out['x-botdot-account'] = account;
  return out;
}

// A request's body on to its botdot server (`up`, the request to it). Without a body the request goes in one write:
// botdot may answer it and close at once (a refused call, a bad address), and a later write to the closed socket
// would fail and turn botdot's answer into a 502.
/** @param {import('http').IncomingMessage} req @param {import('http').ClientRequest} up */
function sendOn(req, up) {
  const length = req.headers['content-length'];
  if (length === '0' || (length === undefined && req.headers['transfer-encoding'] === undefined)) {
    req.resume();
    up.end();
    return;
  }
  up.flushHeaders(); // botdot may answer before the body comes, or without it (a body that is too large)
  req.pipe(up);
}

module.exports = { callOf, clientOf, callHeaders, isPassedCall, sendOn };
