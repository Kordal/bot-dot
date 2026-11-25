// A file dropped onto the screen viewer goes to the bot's folder on its computer (#1736, ADR 279): the page botdot
// serves carries what the viewer needs for it (the bot, the words in the account's language, the size and number the
// route takes, whether the bot's computer is on boat.dev), and the route it uploads by is the Files page's own, with
// its size limit. The drop itself is checked in a browser: test/browser/screen-drop.cjs.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { startServer, makeBot } = require('./helpers');
const { validate } = require('../lib/docker-helper');
const screenDrop = require('../lib/screen-drop');
const screenPage = require('../lib/screen-page');
const uploads = require('../lib/uploads');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-drop-'));
const socket = path.join(dir, 'helper.sock');
const put = []; // the files the computer was given: { seat, script, data }
let helper;
let srv;

before(async () => {
  helper = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { operation, args } = JSON.parse(body);
    if (!validate(operation, args)) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Invalid helper operation' })); }
    let value = null;
    if (operation === 'inspect' || operation === 'details' || operation === 'screenState') value = { state: 'running' };
    if (operation === 'listAll') value = {};
    if (operation === 'update.status') value = { supported: false };
    if (operation === 'putFile') {
      put.push({ seat: args[0], script: args[1].script, data: Buffer.from(args[1].data, 'base64') });
      // What the upload script answers once the file is in its place: the name it was saved as.
      value = { code: 0, stdout: `ok ${/^n='([^']*)'$/m.exec(args[1].script)?.[1]}\n`, stderr: '' };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ value }));
  });
  await new Promise((r) => helper.listen(socket, r));
  srv = await startServer({ env: { BOT_DOT_HELPER_SOCKET: socket } });
});
after(async () => { await srv.stop(); await new Promise((r) => helper.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });

const attr = (body) => JSON.parse(body.match(/data-drop="([^"]*)"/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
const upload = (bot, name, bytes, query = '?root=computer') => fetch(`${srv.base}/api/bots/${bot.id}/workspace/upload${query}`, {
  method: 'POST', headers: { 'X-Bot-Dot': '1', 'X-File-Name': encodeURIComponent(name), 'Content-Type': 'application/octet-stream' }, body: bytes,
});

test("the viewer's page carries what a drop needs: the bot, the route's limits and the words in the account's language", async (t) => {
  const ann = await makeBot(srv, { name: 'Ann', computer: 'linux' });
  t.after(() => srv.api('/settings', { method: 'PUT', body: { language: 'en' } }));
  assert.equal((await srv.api(`/bots/${ann.id}/computer`, { method: 'POST', body: { action: 'start' } })).status, 200);
  const get = async () => (await fetch(`${srv.base}/computer/${ann.id}/vnc.html?view_only=0`)).text();

  const en = await get();
  assert.doesNotMatch(en, /\{drop\}/, 'the mark is filled');
  const drop = attr(en);
  assert.equal(drop.bot, ann.id);
  assert.equal(drop.boat, false);
  assert.equal(drop.maxBytes, uploads.MAX_BYTES);
  assert.equal(drop.maxFiles, uploads.MAX_FILES);
  assert.equal(drop.words.hint, "Drop the file to put it in the bot's folder");
  assert.equal(drop.words.done, "{name} is in the bot's folder.");
  assert.equal(drop.words.big, "{name} is over {mb} MB: it wasn't sent.");

  assert.equal((await srv.api('/settings', { method: 'PUT', body: { language: 'pl' } })).status, 200);
  const pl = attr(await get());
  assert.equal(pl.words.hint, 'Upuść plik, aby trafił do folderu bota');
  assert.equal(pl.words.done, 'Plik {name} jest w folderze bota.');
  assert.equal(pl.words.watching, 'Przejmij sterowanie, aby upuścić plik na ekran.');
  // Every word the viewer asks for has its Polish, with the same placeholders.
  const english = screenDrop.words('en');
  const polish = screenDrop.words('pl');
  for (const key of Object.keys(english)) {
    assert.notEqual(polish[key], english[key], `${key} has its Polish`);
    assert.deepEqual(polish[key].match(/\{\w+\}/g)?.sort(), english[key].match(/\{\w+\}/g)?.sort(), `${key} keeps its placeholders`);
  }
});

test("a bot whose computer is on boat.dev is told so in the page: its files have no upload route there yet", () => {
  const html = '<div data-drop="{drop}">{lang}</div>';
  const boat = attr(screenPage.page(html, 'en', 'bot-b', { boat: true }));
  assert.equal(boat.boat, true);
  assert.equal(boat.bot, 'bot-b');
  assert.equal(attr(screenPage.page(html, 'en', 'bot-b')).boat, false);
  assert.match(boat.words.boat, /External Virtual PC/);
});

test("the viewer uploads by the Files page's route: into the bot's own folder on the computer, never over a file, up to the limit", async () => {
  const bea = await makeBot(srv, { name: 'Bea', computer: 'linux' });
  put.length = 0;
  const r = await upload(bea, 'Q3 report.txt', Buffer.from('hello'));
  assert.equal(r.status, 201);
  const saved = await r.json();
  assert.equal(saved.size, 5);
  assert.equal(saved.name, 'Q3 report.txt', 'the name it was saved as');
  assert.equal(put.length, 1);
  assert.equal(put[0].data.toString(), 'hello');
  assert.equal(put[0].seat.bot, bea.id, "on Bea's seat of the computer");
  assert.match(put[0].script, new RegExp(`/workspace/${bea.id}`), "in the bot's own folder");
  assert.match(put[0].script, /mv -n/, 'a file that is there is never written over');

  // Over the limit: refused whole, in plain words, and nothing reaches the computer.
  const big = await upload(bea, 'big.bin', Buffer.alloc(uploads.MAX_BYTES + 1));
  assert.equal(big.status, 413);
  assert.match((await big.json()).error, /over 25 MB/);
  assert.equal(put.length, 1, 'nothing more was put there');
});
