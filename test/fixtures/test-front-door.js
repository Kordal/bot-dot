#!/usr/bin/env node
// A machine of one account for the Mac app's BotDotKit tests (ADR 028, #469): a test botdot server (as
// test-server.js starts one) behind the real front door (front-door.js) with one account and a setup key, as the
// Mac's local botdot server is. Prints one JSON line, { base, setupKey, chiefKey }, and stops when its stdin closes.
//
// It also stands in for the Mac app's sign-in sheet with a software passkey of its own: each line on stdin,
// { "open": "<the page's address>" }, is that page's work (make the passkey on /sign-up/<setup key>, or sign in
// with it on /sign-in), and its answer is one line: { "callback": "botdot://signed-in?code=…" } or { "error": … }.
// { "signIn": true } signs in once as a browser does, for a session in another app: { "cookie": "botdot_session=…" }.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const passkey = require('./soft-passkey');
const { startServer } = require('../helpers');
const { startFrontDoor } = require('../front-door-helpers');

(async () => {
  const srv = await startServer({ account: 'owner' });
  const setupKey = crypto.randomBytes(32).toString('base64url');
  const door = await startFrontDoor({ sockets: path.dirname(path.dirname(srv.socket)), env: { FRONT_DOOR_ONE_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: setupKey } });
  let key = null;

  async function open(address) {
    const url = new URL(address);
    const app = url.searchParams.get('app');
    const handoff = url.searchParams.get('handoff');
    const b = door.browser();
    const page = await b.get(url.pathname + url.search);
    if (page.status !== 200) return { error: `The page answered ${page.status}` };
    let r;
    if (url.pathname.startsWith('/sign-up/')) {
      const options = await b.post(`${url.pathname}/options`, { name: 'owner' });
      if (options.status !== 200) return { error: options.data?.error || `options: ${options.status}` };
      key = passkey.create({ rpId: door.rpId, origin: door.origin });
      r = await b.post(url.pathname, { name: 'owner', credential: key.register(options.data.publicKey), app, handoff });
    } else {
      if (!key) return { error: 'No passkey yet' };
      const options = await b.post('/sign-in/options', {});
      r = await b.post('/sign-in', { credential: key.signIn(options.data.publicKey), app, handoff });
    }
    return r.data?.next ? { callback: r.data.next } : { error: r.data?.error || `${r.status}` };
  }

  async function signIn() {
    const b = door.browser();
    const options = await b.post('/sign-in/options', {});
    const r = await b.post('/sign-in', { credential: key.signIn(options.data.publicKey), app: 'web' });
    return r.status === 200 ? { cookie: b.cookie() } : { error: r.data?.error || `${r.status}` };
  }

  process.stdout.write(`${JSON.stringify({ base: door.origin, setupKey, chiefKey: srv.chiefKey })}\n`);
  const stop = async () => {
    await door.stop();
    await srv.stop();
    fs.rmSync(srv.dir, { recursive: true, force: true });
    process.exit(0);
  };
  const lines = readline.createInterface({ input: process.stdin });
  lines.on('line', async (line) => {
    let answer;
    try {
      const asked = JSON.parse(line);
      answer = asked.open ? await open(asked.open) : asked.signIn ? await signIn() : { error: 'Unknown' };
    } catch (e) { answer = { error: e.message }; }
    process.stdout.write(`${JSON.stringify(answer)}\n`);
  });
  lines.on('close', stop);
  process.on('SIGTERM', stop);
})().catch((e) => { console.error(e.message); process.exit(1); });
