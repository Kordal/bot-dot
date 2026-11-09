// A proxy's test (ADR 171): one HTTPS request through it, from botdot's server, to a service that says the address it
// came from, its country and city. The same SOCKS5 and HTTP CONNECT handshake as the bridge's (deploy/desktop/
// camoufox-browser through), with the site's name resolved by the proxy. Answers { ok, ip, country, city, ms } or
// { ok: false, error }, in a few words that never hold the login.
const net = require('net');
const tls = require('tls');

const SITE = process.env.BOT_DOT_PROXY_CHECK_HOST || 'ipinfo.io';
const SITE_PORT = Number(process.env.BOT_DOT_PROXY_CHECK_PORT) || 443;
const SECONDS = 12;
const SOCKS_SAID = { 1: 'a failure', 2: 'its rules', 3: 'no network', 4: 'no such host', 5: 'a refusal', 6: 'a timeout', 7: 'no CONNECT', 8: 'no such address type' };

class Down extends Error {}

// What a socket says, read as the handshake needs it: n bytes, or up to a mark. Fails when it ends first.
function reader(sock) {
  let buf = Buffer.alloc(0);
  let waiter = null;
  let failed = null;
  const next = () => {
    if (!waiter) return;
    const n = waiter.need(buf);
    const w = waiter;
    if (n >= 0) {
      waiter = null;
      const out = buf.subarray(0, n);
      buf = buf.subarray(n);
      w.resolve(out);
    } else if (n === -2 || failed) {
      waiter = null;
      w.reject(n === -2 ? new Down('gave an answer too long') : failed);
    }
  };
  const onData = (d) => { buf = Buffer.concat([buf, d]); next(); };
  const onEnd = () => { failed ||= new Down('closed the connection'); next(); };
  const onError = (e) => { failed ||= new Down(`didn't answer (${e.code || e.name})`); next(); };
  sock.on('data', onData);
  sock.on('end', onEnd);
  sock.on('error', onError);
  const wait = (need) => new Promise((resolve, reject) => { waiter = { need, resolve, reject }; next(); });
  return {
    read: (n) => wait((b) => (b.length >= n ? n : -1)),
    until: (mark, max = 65536) => wait((b) => { const i = b.indexOf(mark); return i >= 0 ? i + mark.length : b.length > max ? -2 : -1; }),
    release: () => { sock.off('data', onData); sock.off('end', onEnd); sock.off('error', onError); },
  };
}

function socksAddress(host) {
  if (net.isIPv4(host)) return Buffer.from([1, ...host.split('.').map(Number)]);
  const name = Buffer.from(host);
  if (!name.length || name.length > 255 || net.isIPv6(host)) throw new Down("can't be asked for that address");
  return Buffer.concat([Buffer.from([3, name.length]), name]);
}

async function socksConnect(sock, r, p, host, port) {
  const signsIn = !!p.username;
  sock.write(Buffer.from(signsIn ? [5, 2, 0, 2] : [5, 1, 0]));
  const [version, method] = await r.read(2);
  if (version !== 5) throw new Down('is not a SOCKS5 proxy');
  if (method === 2 && signsIn) {
    const user = Buffer.from(p.username);
    const word = Buffer.from(p.password || '');
    sock.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([word.length]), word]));
    if ((await r.read(2))[1] !== 0) throw new Down('refused the login');
  } else if (method !== 0) throw new Down(signsIn ? 'refused the login' : 'wants a login');
  const portBytes = Buffer.alloc(2);
  portBytes.writeUInt16BE(port);
  sock.write(Buffer.concat([Buffer.from([5, 1, 0]), socksAddress(host), portBytes]));
  const [, reply, , kind] = await r.read(4);
  if (reply !== 0) throw new Down(`didn't reach ${host}: ${SOCKS_SAID[reply] || reply}`);
  const size = kind === 1 ? 4 : kind === 4 ? 16 : (await r.read(1))[0];
  await r.read(size + 2);
}

async function httpConnect(sock, r, p, host, port) {
  const target = host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
  let head = `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n`;
  if (p.username) head += `Proxy-Authorization: Basic ${Buffer.from(`${p.username}:${p.password || ''}`).toString('base64')}\r\n`;
  sock.write(`${head}\r\n`);
  const answer = (await r.until(Buffer.from('\r\n\r\n'))).toString('latin1');
  const code = answer.split('\r\n')[0].split(' ')[1] || '?';
  if (code === '407') throw new Down('refused the login');
  if (code !== '200') throw new Down(`answered ${code} for ${host}`);
}

// A socket to host:port through proxy p, the handshake done.
function through(p, host, port, seconds = SECONDS) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: p.host, port: p.port });
    sock.setTimeout(seconds * 1000, () => sock.destroy(new Down("didn't answer in time")));
    sock.once('error', (e) => reject(e instanceof Down ? e : new Down(`didn't answer (${e.code || e.name})`)));
    sock.once('connect', async () => {
      const r = reader(sock);
      try {
        await (p.type === 'socks5' ? socksConnect : httpConnect)(sock, r, p, host, port);
        r.release();
        resolve(sock);
      } catch (e) {
        sock.destroy();
        reject(e instanceof Down ? e : new Down(`didn't answer (${e.code || e.name})`));
      }
    });
  });
}

// The test: { ok, ip, country, city, ms } through p, or { ok: false, error }.
async function check(p, { site = SITE, sitePort = SITE_PORT, seconds = SECONDS, ca } = {}) {
  const began = Date.now();
  try {
    const sock = await through(p, site, sitePort, seconds);
    const body = await new Promise((resolve, reject) => {
      const t = tls.connect({ socket: sock, servername: site, ...(ca ? { ca } : {}) }, () => {
        t.write(`GET /json HTTP/1.0\r\nHost: ${site}\r\nAccept: application/json\r\nUser-Agent: botdot\r\n\r\n`);
      });
      let data = '';
      t.setEncoding('utf8');
      t.setTimeout(seconds * 1000, () => t.destroy(new Down("didn't carry the connection in time")));
      t.on('data', (d) => { data += d; if (data.length > 65536) t.destroy(); });
      t.on('end', () => resolve(data));
      t.on('close', () => resolve(data));
      t.on('error', (e) => reject(e instanceof Down ? e : new Down(`didn't carry the connection (${e.code || e.name})`)));
    });
    const json = JSON.parse(body.slice(body.indexOf('\r\n\r\n') + 4) || '{}');
    if (!net.isIP(String(json.ip || ''))) throw new Down('gave no address');
    return { ok: true, ip: json.ip, country: /^[A-Z]{2}$/.test(json.country || '') ? json.country : '', city: String(json.city || '').replace(/[^\p{L}\p{M} .'-]/gu, '').trim().slice(0, 60), ms: Date.now() - began };
  } catch (e) {
    return { ok: false, error: e instanceof Down ? e.message : 'gave no address' };
  }
}

module.exports = { check, through };
