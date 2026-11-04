// The owner's viewer passed on to a boat.dev machine's screen (lib/boat.js vncScreen): noVNC's WebSocket, opened again
// by botdot to the address boat.dev's relay carries websockify on, with the token as the cookie boat.dev asks an API
// client for. Only what a WebSocket needs goes on: never the owner's own cookies or botdot's address.
const tls = require('node:tls');

// The headers of the owner's WebSocket that websockify reads, as noVNC sends them.
const KEPT = ['sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions'];

function upgradeRequest({ host, token }, headers) {
  const lines = ['GET /websockify HTTP/1.1', `Host: ${host}`, 'Upgrade: websocket', 'Connection: Upgrade', `Origin: https://${host}`, `Cookie: _port_auth=${token}`];
  for (const name of KEPT) {
    const v = headers[name];
    if (typeof v === 'string' && v && !/[\r\n]/.test(v)) lines.push(`${name}: ${v}`);
  }
  return `${lines.join('\r\n')}\r\n\r\n`;
}

// A TLS connection to the screen's address, its upgrade asked and what the viewer already sent after its own: from
// then on the bytes go both ways as they are, and boat.dev's answer to the upgrade reaches the viewer as its own.
function open(stream, req, head, { connect = tls.connect } = {}) {
  const [hostname, port] = stream.host.split(':');
  const up = connect({ host: hostname, port: Number(port) || 443, servername: hostname });
  up.write(upgradeRequest(stream, req.headers));
  if (head?.length) up.write(head);
  return up;
}

module.exports = { open, upgradeRequest };
