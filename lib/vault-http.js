// API calls with a saved login, made by bot-dot on a bot's behalf. The bot writes {{username}} and
// {{password}} (alias {{token}}, {{secret}}) where the values go in the headers, or {{basic}} for
// base64("username:password") as HTTP Basic auth needs; bot-dot fills them in,
// sends the request only to the login's own address, and blanks the secret out of whatever comes back.
// With several logins (#228) the bot names each one: {{NAME.password}}, and the address must be one every login allows.
const http = require('http');
const https = require('https');
const dns = require('node:dns');
const net = require('node:net');
const { hostname, privateAddress, internalHost } = require('./network-address');
const githubApp = require('./github-app');

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const PLACEHOLDER = /\{\{\s*(username|password|token|secret|basic)\s*\}\}/gi;
const HAS_PLACEHOLDER = /\{\{\s*(username|password|token|secret|basic)\s*\}\}/i;
// {{NAME.password}}: NAME is everything before the last dot, so a name with dots (an address) works.
const NAMED = /\{\{\s*([^{}]+)\.(username|password|token|secret|basic)\s*\}\}/gi;
const HAS_NAMED = /\{\{\s*[^{}]+\.(username|password|token|secret|basic)\s*\}\}/i;
// At most this many logins in one call (run_with_login and api_request, #228). The tools' schemas (computer-mcp.js,
// vault-mcp.js), their text, the bot's prompt and the Docker helper (twice as many variables) say it too.
const MAX_LOGINS = 8;
const MAX_BYTES = 200 * 1024;
const MAX_IMAGE = 5 * 1024 * 1024;

const hostAllowed = (host, site) => hostname(host) === hostname(site);

// What a bot's call names (#228): `login`, one login, or `logins`, a list of 1 to MAX_LOGINS, never both. several:
// the list form, where each login's values are named by it.
function loginList({ login, logins }) {
  if (logins === undefined || logins === null) {
    if (typeof login !== 'string' || !login.trim()) return { error: 'Say which login to use (login), or several (logins)' };
    return { refs: [login], several: false };
  }
  if (login !== undefined && login !== null && login !== '') return { error: 'Give login or logins, not both' };
  if (!Array.isArray(logins) || !logins.length || logins.some((l) => typeof l !== 'string' || !l.trim())) return { error: 'logins is a list of login names from list_logins' };
  if (logins.length > MAX_LOGINS) return { error: `At most ${MAX_LOGINS} logins in one call, not ${logins.length}` };
  return { refs: logins, several: true };
}

// run_with_login with several logins (#228): each login's values in BOTDOT_<NAME>_USERNAME and BOTDOT_<NAME>_PASSWORD,
// <NAME> its name in capitals with every character other than A-Z and 0-9 turned into "_".
const loginVar = (name) => `BOTDOT_${String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
// What stops a list of logins from having a variable each: two names that make the same one, or a name too long.
function loginVarProblems(list) {
  const seen = new Map();
  const problems = [];
  for (const { name } of list) {
    const v = loginVar(name);
    if (seen.has(v)) problems.push(`"${seen.get(v)}" and "${name}" both give ${v}_PASSWORD; use only one of them in a command.`);
    else if (v.length > 207) problems.push(`The name "${name}" is too long for a variable.`);
    else seen.set(v, name);
  }
  return problems;
}
const loginEnv = (list) => Object.fromEntries(list.flatMap((c) => [[`${loginVar(c.name)}_USERNAME`, String(c.username || '')], [`${loginVar(c.name)}_PASSWORD`, String(c.password || '')]]));

// Every form the secret could come back in, so it can be blanked out of the response.
function redactor(values) {
  const forms = new Set();
  for (const v of values.filter((x) => x && x.length >= 4)) {
    forms.add(v);
    forms.add(encodeURIComponent(v));
    forms.add(Buffer.from(v).toString('base64'));
  }
  const list = [...forms].sort((a, b) => b.length - a.length);
  return (text) => list.reduce((t, f) => t.split(f).join('[hidden]'), String(text));
}

// For what comes back from a command run with a login in the bot's computer (run_with_login): the password in
// each form above, and base64 of "username:password" as HTTP Basic auth sends it. The username is no secret. A secret
// of several lines (a private key, #155) also each long line of it, and its lines joined by spaces, as an unquoted
// `echo $BOTDOT_PASSWORD` prints it.
const linesOf = (secret) => (/\n/.test(secret) ? [secret.trim().split(/\s*\r?\n\s*/).join(' '), ...secret.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 16 && !l.startsWith('-----'))] : []);
const loginForms = ({ username, password }) => [password, password ? Buffer.from(`${username || ''}:${password}`).toString('base64') : '', ...linesOf(String(password || ''))];
// Several logins in one command (#228): one redactor over all of them, so a secret that holds another is still
// blanked whole.
const hideLogins = (list) => redactor(list.flatMap(loginForms));
const hideLogin = (creds) => hideLogins([creds]);
// For what comes back from a command run with an SSH key in its computer (run_with_ssh_key): the bot never gets the
// private key there, so this is a second guard only. The key as a whole, and each line of its body.
const hideSshKey = (privateKey) => {
  const key = String(privateKey || '');
  return redactor([key.trim(), ...key.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 16 && !l.startsWith('-----'))]);
};

// For what comes back from a command run with a file of the Vault (run_with_file, #157): the file as a whole, in each
// form above, and each long line of it, so a key printed line by line is blanked too. bytes: a Buffer.
const hideFile = (bytes) => {
  const text = Buffer.from(bytes || '').toString('utf8');
  const b64 = Buffer.from(bytes || '').toString('base64');
  // base64 as `base64` writes it, in lines of 76.
  return redactor([text.trim(), b64, ...(b64.match(/.{76}/g) || []), ...text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 16 && !l.startsWith('-----'))]);
};

// What a request says when the server's certificate is not trusted. The owner reads it on a Board tile; a bot's
// api_request gets its own words in its place (server.js), to ask for the switch with ask_vault_switch.
const CERT_UNTRUSTED = "The server's certificate isn't trusted. If this is your own server with a self-signed certificate, tick \"Accept self-signed certificate\" on this login in the Vault.";

function send({ method, url, headers, body, timeoutMs, insecureTls, lookup, maxBytes = MAX_BYTES, binary = false }) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    let req;
    try {
      req = lib.request(u, { method, headers, timeout: timeoutMs, rejectUnauthorized: !insecureTls, lookup, agent: false }, (res) => {
        const chunks = [];
        let size = 0;
        let truncated = false;
        res.on('data', (c) => {
          if (size >= maxBytes) { truncated = true; return; }
          chunks.push(c);
          size += c.length;
        });
        res.on('end', () => {
          const all = Buffer.concat(chunks);
          resolve({ status: res.statusCode, statusText: res.statusMessage, headers: res.headers, body: binary ? all : all.toString('utf8').slice(0, maxBytes), truncated });
        });
      });
    } catch (e) {
      return resolve({ error: `Couldn't build the request: ${e.message}` });
    }
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => {
      const cert = /CERT|certificate|self.signed|SSL/i.test(`${e.code} ${e.message}`);
      resolve({
        error: cert
          ? CERT_UNTRUSTED
          : e.message === 'timeout' ? 'The request timed out' : `Couldn't reach the server: ${e.code || e.message}`,
      });
    });
    if (body != null) req.write(body);
    req.end();
  });
}

// creds: { name, type, site, username, password, insecureTls } from vault.credentials(), or a list of
// { key, creds } for several logins (#228), key the name the bot gave it. Returns text for the bot.
// image: the answer is a picture (a camera snapshot for the Board): it comes back as bytes, up to 5 MB.
async function apiRequest(creds, { method = 'GET', url, headers = {}, body, timeoutSeconds = 30, image = false }) {
  const several = Array.isArray(creds);
  let list = several ? creds.map((c) => c.creds) : [creds];
  // loginList checks a bot's call; this guards any other caller.
  if (several && (!list.length || list.length > MAX_LOGINS)) throw new Error(`Give 1 to ${MAX_LOGINS} logins`);
  method = String(method).toUpperCase();
  if (!METHODS.includes(method)) throw new Error(`Method must be one of ${METHODS.join(', ')}`);
  let u;
  try { u = new URL(String(url)); } catch { throw new Error('Give a full address, e.g. https://server:8006/api2/json/version'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https addresses are allowed');
  if (u.username || u.password) throw new Error("Don't put credentials in the address; use {{username}} and {{password}} in a header");
  // Every login must allow the address: its own site or one of its owner-approved hosts.
  const savedHosts = list.map((c) => {
    const found = [c.site, ...(c.allowedHosts || [])].find((host) => hostAllowed(u.hostname, host));
    if (!found) throw new Error(`The "${c.name}" login can only be used with ${c.site} or its owner-approved hosts, not ${u.hostname}`);
    return found;
  });
  const bodyText = body == null ? null : typeof body === 'string' ? body : JSON.stringify(body);
  // Named ones only matter with several logins: a single login's request (a Board tile) may carry such text as before.
  const placeholder = (t) => HAS_PLACEHOLDER.test(t) || (several && HAS_NAMED.test(t));
  if (placeholder(String(url)) || (bodyText && placeholder(bodyText))) {
    throw new Error('Saved values can only go in headers, e.g. "Authorization": "Bearer {{password}}"');
  }

  const host = hostname(u.hostname);
  const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.promises.lookup(host, { all: true });
  if (!addresses.length) throw new Error('The login host has no address');
  if (savedHosts.some((h) => !internalHost(h)) && addresses.some((a) => privateAddress(a.address))) throw new Error('A public login host may not resolve to a private or local address');
  // Pin the checked addresses for this request: a second DNS lookup would permit rebinding.
  const lookup = (_host, options, cb) => cb(null, ...(options.all ? [addresses] : [addresses[0].address, addresses[0].family]));

  // Which login a {{NAME.field}} means: the name the bot gave in its list, or the login's own name, in any case.
  const byKey = new Map();
  // The names the bot gave come first; a login's own name only where no given name took it.
  if (several) {
    creds.forEach(({ key }, i) => byKey.set(String(key).trim().toLowerCase(), i));
    list.forEach(({ name }, i) => { const k = String(name || '').trim().toLowerCase(); if (k && !byKey.has(k)) byKey.set(k, i); });
  }
  for (const v of Object.values(headers || {})) {
    if (several && HAS_PLACEHOLDER.test(String(v))) throw new Error('With several logins, say whose value goes where: {{NAME.password}}, NAME one of logins');
    if (!several && HAS_NAMED.test(String(v))) throw new Error('{{NAME.password}} needs logins: a list of the logins to use; with login, write {{password}}');
    if (several) for (const [, name] of String(v).matchAll(NAMED)) {
      if (!byKey.has(name.trim().toLowerCase())) throw new Error(`"${name.trim()}" isn't one of the logins of this request; add it to logins`);
    }
  }

  // A GitHub App is used by its installation token, never its key (lib/github-app.js): made only for a request that
  // is about to be sent.
  list = await Promise.all(list.map((c) => githubApp.asLogin(c)));
  const basics = list.map((c) => Buffer.from(`${c.username}:${c.password}`).toString('base64'));
  const value = (i, k) => {
    k = k.toLowerCase();
    return k === 'username' ? list[i].username : k === 'basic' ? basics[i] : list[i].password;
  };
  const fill = (v) => (several
    ? String(v).replace(NAMED, (_, name, k) => value(byKey.get(name.trim().toLowerCase()), k))
    : String(v).replace(PLACEHOLDER, (_, k) => value(0, k)));
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (/[\r\n]/.test(String(v)) || !/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(k)) throw new Error(`Invalid header "${k}"`);
    if (/^(host|connection|transfer-encoding|content-length)$/i.test(k)) throw new Error(`The "${k}" header is managed by botdot`);
    out[k] = fill(v);
  }
  if (bodyText != null && typeof body !== 'string' && !Object.keys(out).some((k) => k.toLowerCase() === 'content-type')) out['Content-Type'] = 'application/json';

  const secrets = [...list.map((c) => c.password), ...basics].filter(Boolean);
  const hide = redactor([...secrets, ...Object.values(out).filter((v) => secrets.some((x) => v.includes(x)))]);
  const insecureTls = list.every((c) => !!c.insecureTls);
  const r = await send({ method, url: u.toString(), headers: out, body: bodyText, lookup, timeoutMs: Math.min(Math.max(Number(timeoutSeconds) || 30, 1), 120) * 1000, insecureTls, ...(image ? { binary: true, maxBytes: MAX_IMAGE } : {}) });
  if (r.error) return { ok: false, text: hide(r.error) };
  const type = r.headers['content-type'] || '';
  if (image) {
    if (r.status >= 400) return { ok: true, status: r.status, text: `HTTP ${r.status}` };
    if (!/^image\/(png|jpeg|gif|webp|bmp)\b/i.test(type)) return { ok: false, text: `That isn't a picture (${type || 'no type'})` };
    if (r.truncated) return { ok: false, text: 'The picture is bigger than 5 MB' };
    return { ok: true, status: r.status, type: type.split(';')[0].trim().toLowerCase(), image: r.body };
  }
  const location = r.headers.location ? `\nRedirects to (not followed): ${r.headers.location}` : '';
  const text = `HTTP ${r.status} ${r.statusText || ''}${type ? ` · ${type}` : ''}${location}\n\n${r.body}${r.truncated ? '\n…(response cut off at 200 KB)' : ''}`;
  return { ok: true, status: r.status, text: hide(text), body: hide(r.body) };
}

module.exports = { apiRequest, hostAllowed, hideLogin, hideLogins, hideSshKey, hideFile, loginList, loginVar, loginVarProblems, loginEnv, CERT_UNTRUSTED, MAX_LOGINS };
