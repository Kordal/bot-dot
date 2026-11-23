// The front door passes a request's body on to botdot (lib/front-door/calls.js sendOn). botdot may refuse a request
// the moment the last byte of its body has come (a phone's file that is too large, 413) and close at once. Whatever
// is written after that last byte fails on the closed socket (EPIPE), and the sender got the front door's 502 in
// place of botdot's answer: an end of the request written apart from the last chunk was that write. It made "a phone
// upload into a project folder over 25 MB is refused" (test/phone-upload.test.js) fail now and then, and any such
// refusal of a large body through the real front door.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable, Writable } = require('node:stream');
const { sendOn } = require('../lib/front-door/calls');

// A request to botdot that notes what it is handed, and a request of the sender with its chunks.
function fakes({ headers, chunks, fullAt = 0 }) {
  const calls = [];
  let written = 0;
  const up = Object.assign(new EventEmitter(), {
    flushHeaders: () => calls.push(['flushHeaders']),
    write(c) { calls.push(['write', c.length]); written += 1; return written !== fullAt; },
    end(c) { calls.push(['end', c ? c.length : 0]); },
  });
  const req = Object.assign(Readable.from(chunks, { objectMode: false }), { headers });
  return { calls, up, req };
}
const done = (req) => new Promise((resolve) => setImmediate(() => setImmediate(resolve))).then(() => req);

test('the last chunk of a body goes to botdot with its end, so that nothing is written after it', async () => {
  const chunks = [Buffer.alloc(1000, 1), Buffer.alloc(1000, 2), Buffer.alloc(1000, 3)];
  const { calls, up, req } = fakes({ headers: { 'content-length': '3000' }, chunks });
  sendOn(req, up);
  await done(req);
  assert.deepEqual(calls, [['flushHeaders'], ['write', 1000], ['write', 1000], ['end', 1000]]);
});

test('a body that waits for botdot to take what it was given goes on once it has', async () => {
  const chunks = [Buffer.alloc(1000, 1), Buffer.alloc(1000, 2), Buffer.alloc(1000, 3)];
  const { calls, up, req } = fakes({ headers: { 'content-length': '3000' }, chunks, fullAt: 1 });
  sendOn(req, up);
  await done(req);
  assert.deepEqual(calls, [['flushHeaders'], ['write', 1000]]);
  up.emit('drain');
  await done(req);
  assert.deepEqual(calls, [['flushHeaders'], ['write', 1000], ['write', 1000], ['end', 1000]]);
});

test('a body of unknown length is piped and ended as it ends; one without a body is a single write', async () => {
  const calls = [];
  const up = Object.assign(new Writable({ write(c, _e, cb) { calls.push(['write', c.length]); cb(); }, final(cb) { calls.push(['end']); cb(); } }), { flushHeaders: () => calls.push(['flushHeaders']) });
  const req = Object.assign(Readable.from([Buffer.alloc(10, 1)], { objectMode: false }), { headers: { 'transfer-encoding': 'chunked' } });
  sendOn(req, up);
  await done(req);
  assert.deepEqual(calls, [['flushHeaders'], ['write', 10], ['end']]);

  const none = fakes({ headers: { 'content-length': '0' }, chunks: [] });
  sendOn(none.req, none.up);
  assert.deepEqual(none.calls, [['end', 0]]);
});
