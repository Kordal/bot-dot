// Setup's phone (ADR 205): GET /api/setup carries the address a phone opens as a QR code botdot drew, and none when
// botdot opens only on its own machine.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let srv;
after(async () => { if (srv) await srv.stop(); });

test('the setup route has no QR code while botdot opens only on this machine', async () => {
  srv = await startServer();
  const a = (await srv.api('/setup')).data.access;
  assert.equal(a.qr, null);
  assert.equal(a.tailnet, false);
});

test('the QR code is an SVG of the address alone', () => {
  const svg = require('../lib/routes/drops').qrSvg('https://botdot.example.ts.net');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*aria-hidden="true"><rect[^>]*\/><path d="M[\d hvz.M-]+" fill="#000"\/><\/svg>$/);
});
