// API calls with a saved login, made by bot-dot on a bot's behalf. The bot writes {{username}} and
// {{password}} (alias {{token}}, {{secret}}) where the values go in the headers, or {{basic}} for
// base64("username:password") as HTTP Basic auth needs; bot-dot fills them in,
// sends the request only to the login's own address, and blanks the secret out of whatever comes back.
const http = require('http');
const https = require('https');
const dns = require('node:dns');
const net = require('node:net');
const { hostname, privateAddress, internalHost } = require('./network-address');

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const PLACEHOLDER = /\{\{\s*(username|password|token|secret|basic)\s*\}\}/gi;
const HAS_PLACEHOLDER = /\{\{\s*(username|password|token|secret|basic)\s*\}\}/i;
const MAX_BYTES = 200 * 1024;
const MAX_IMAGE = 5 * 1024 * 1024;

const hostAllowed = (host, site) => hostname(host) === hostname(site);

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
// each form above, and base64 of "username:password" as HTTP Basic auth sends it. The username is no secret.
const hideLogin = ({ username, password }) => redactor([password, password ? Buffer.from(`${username || ''}:${password}`).toString('base64') : '']);
// For what comes back from a command run with an SSH key in its computer (run_with_ssh_key): the bot never gets the
// private key there, so this is a second guard only. The key as a whole, and each line of its body.
const hideSshKey = (privateKey) => {
  const key = String(privateKey || '');
  return redactor([key.trim(), ...key.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 16 && !l.startsWith('-----'))]);
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

// creds: { name, site, username, password, insecureTls } from vault.credentials(). Returns text for the bot.
// image: the answer is a picture (a camera snapshot for the Board): it comes back as bytes, up to 5 MB.
async function apiRequest(creds, { method = 'GET', url, headers = {}, body, timeoutSeconds = 30, image = false }) {
  method = String(method).toUpperCase();
  if (!METHODS.includes(method)) throw new Error(`Method must be one of ${METHODS.join(', ')}`);
  let u;
  try { u = new URL(String(url)); } catch { throw new Error('Give a full address, e.g. https://server:8006/api2/json/version'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https addresses are allowed');
  if (u.username || u.password) throw new Error("Don't put credentials in the address; use {{username}} and {{password}} in a header");
  const savedHost = [creds.site, ...(creds.allowedHosts || [])].find((host) => hostAllowed(u.hostname, host));
  if (!savedHost) throw new Error(`The "${creds.name}" login can only be used with ${creds.site} or its owner-approved hosts, not ${u.hostname}`);
  const bodyText = body == null ? null : typeof body === 'string' ? body : JSON.stringify(body);
  if (HAS_PLACEHOLDER.test(String(url)) || (bodyText && HAS_PLACEHOLDER.test(bodyText))) {
    throw new Error('Saved values can only go in headers, e.g. "Authorization": "Bearer {{password}}"');
  }

  const host = hostname(u.hostname);
  const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.promises.lookup(host, { all: true });
  if (!addresses.length) throw new Error('The login host has no address');
  if (!internalHost(savedHost) && addresses.some((a) => privateAddress(a.address))) throw new Error('A public login host may not resolve to a private or local address');
  // Pin the checked addresses for this request: a second DNS lookup would permit rebinding.
  const lookup = (_host, options, cb) => cb(null, ...(options.all ? [addresses] : [addresses[0].address, addresses[0].family]));

  const basic = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
  const fill = (v) => String(v).replace(PLACEHOLDER, (_, k) => {
    k = k.toLowerCase();
    return k === 'username' ? creds.username : k === 'basic' ? basic : creds.password;
  });
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (/[\r\n]/.test(String(v)) || !/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(k)) throw new Error(`Invalid header "${k}"`);
    if (/^(host|connection|transfer-encoding|content-length)$/i.test(k)) throw new Error(`The "${k}" header is managed by botdot`);
    out[k] = fill(v);
  }
  if (bodyText != null && typeof body !== 'string' && !Object.keys(out).some((k) => k.toLowerCase() === 'content-type')) out['Content-Type'] = 'application/json';

  const hide = redactor([creds.password, basic, ...Object.values(out).filter((v) => v.includes(creds.password || '\u0000') || v.includes(basic))]);
  const r = await send({ method, url: u.toString(), headers: out, body: bodyText, lookup, timeoutMs: Math.min(Math.max(Number(timeoutSeconds) || 30, 1), 120) * 1000, insecureTls: !!creds.insecureTls, ...(image ? { binary: true, maxBytes: MAX_IMAGE } : {}) });
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

module.exports = { apiRequest, hostAllowed, hideLogin, hideSshKey, CERT_UNTRUSTED };
