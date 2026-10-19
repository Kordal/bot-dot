#!/usr/bin/env node
// A stand-in for the Bitwarden CLI (bw), for the tests: nothing leaves the machine. It unlocks with any
// master password and keeps the items of the bot-dot folder in $BITWARDENCLI_APPDATA_DIR/items.json
// (lib/bitwarden.js gives every call that folder): `list items` reads them, and `create item`, `edit item`
// and `delete item` change them, taking the item as bw does (base64 JSON on stdin). Every call is noted in
// calls.jsonl beside them (its arguments, never its input), so a test can tell whether an item was edited.
// Everything else answers nothing and succeeds. A file `slow` beside them holding a command's first two words
// (`create item`) makes that command answer only after 4 seconds, as a Bitwarden that is slow to reply.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2).filter((a) => a !== '--nointeraction');
const out = (text) => process.stdout.write(text);
const dir = process.env.BITWARDENCLI_APPDATA_DIR;
const FILE = dir && path.join(dir, 'items.json');
const items = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } };
const keep = (list) => fs.writeFileSync(FILE, JSON.stringify(list));
const given = () => JSON.parse(Buffer.from(fs.readFileSync(0, 'utf8'), 'base64').toString('utf8'));

if (dir) fs.appendFileSync(path.join(dir, 'calls.jsonl'), `${JSON.stringify(args)}\n`);
const slow = (() => { try { return fs.readFileSync(path.join(dir, 'slow'), 'utf8').trim(); } catch { return ''; } })();
if (slow && slow === args.slice(0, 2).join(' ')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 4000);

if (args[0] === 'status') out(JSON.stringify({ status: 'locked', userEmail: 'owner@example.com' }));
else if (args[0] === 'unlock') out('fixture-session');
else if (args[0] === 'list' && args[1] === 'folders') out(JSON.stringify([{ id: 'folder-1', name: 'bot-dot' }]));
else if (args[0] === 'list' && args[1] === 'items') out(JSON.stringify(items()));
else if (args[0] === 'create' && args[1] === 'item') {
  const item = { ...given(), id: crypto.randomUUID(), revisionDate: new Date().toISOString() };
  keep([...items(), item]);
  out(JSON.stringify(item));
} else if (args[0] === 'edit' && args[1] === 'item') {
  const item = { ...given(), id: args[2], revisionDate: new Date().toISOString() };
  keep(items().map((x) => (x.id === args[2] ? item : x)));
  out(JSON.stringify(item));
} else if (args[0] === 'delete' && args[1] === 'item') keep(items().filter((x) => x.id !== args[2]));
