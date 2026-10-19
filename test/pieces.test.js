// A bot's outfit: its hat, from the kit in the figure definition (lib/figure.json) or drawn, in the
// piece format of ADR 004. The kit, the one check of a piece (lib/pieces.js), the outfit on the server,
// in the API and in the Chief's tools. How the web page draws a hat is in figure.test.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, feed, waitFor, ROOT } = require('./helpers');
const { rpcClient } = require('./memory-helpers');
const { KIT, SLOTS, NAME, names, pieceProblem, outfitAfter, stored } = require('../lib/pieces');

const def = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib', 'figure.json'), 'utf8'));
const copy = (x) => JSON.parse(JSON.stringify(x));
const PASS = 'correct horse battery staple';

// Two hats drawn in the ADR 004 format, as the Chief draws one when the kit has nothing: a fez and a
// straw hat with a flower.
const FEZ = { shapes: [
  { shape: 'path', d: [['M', 2.8, 4.4], ['L', 3.4, 0.8], ['L', 6.6, 0.8], ['L', 7.2, 4.4], ['Z']], fill: 'deep' },
  { shape: 'rect', x: 4.4, y: 0.4, w: 3.4, h: 0.9, r: 0.4, fill: 'main' },
  { shape: 'circle', cx: 7.8, cy: 1.9, r: 0.8, fill: 'main' },
] };
const STRAW = { shapes: [
  { shape: 'path', d: [['M', 3, 4.2], ['Q', 3, 1.4, 5, 1.4], ['Q', 7, 1.4, 7, 4.2], ['Z']], fill: 'deep' },
  { shape: 'line', x1: 0.8, y1: 4.2, x2: 9.2, y2: 4.2, stroke: 'deep', width: 1.2 },
  { shape: 'circle', cx: 6.6, cy: 3.2, r: 0.9, fill: 'main' },
] };
// Too tall for a hat's box.
const TALL = { shapes: [{ shape: 'rect', x: 2, y: 1, w: 5, h: 7, fill: 'deep' }] };

test('kit: hats only; every hat passes the check a drawn hat will, and has a name and a meaning', () => {
  assert.deepEqual(SLOTS, ['hat']);
  assert.deepEqual(Object.keys(KIT), ['limits', 'hat']);
  assert.deepEqual(KIT.limits, { shapes: 6, commands: 16, stroke: [0.8, 2] });
  assert.deepEqual([KIT.hat.box, KIT.hat.origin], [[10, 6], [5, 3.5]]);
  assert.equal(names('hat').length, 20, 'the hats that could be recognised on a head in the list on a phone (docs/archive/evidence/FIG-012)');
  for (const [name, piece] of Object.entries(KIT.hat.pieces)) {
    assert.match(name, NAME);
    assert.equal(pieceProblem('hat', piece), null, name);
    assert.match(piece.means, /^[A-Z][^:]{3,40}: .{5,70}$/, `${name} says what it is and what it stands for`);
    // No hat is a thin line alone: each has a filled shape at least 2 units wide, or a stroke of 0.9 or more.
    assert.ok(piece.shapes.some((x) => x.fill || x.width >= 0.9), name);
    assert.ok(piece.shapes.filter((x) => x.shape === 'line').every((x) => x.width >= 0.8), name);
  }
  assert.ok(Object.hasOwn(KIT.hat.pieces, def.chief.outfit.hat), "the Chief's hat is in the kit");
  assert.deepEqual(Object.keys(def.chief.outfit), ['hat']);
});

test('a piece: each limit is checked, with the reason', () => {
  const ok = { shape: 'rect', x: 1, y: 1, w: 2, h: 2, fill: 'main' };
  const why = (shapes) => pieceProblem('hat', { shapes });
  assert.equal(why([ok]), null);
  assert.equal(why([{ shape: 'circle', cx: 5, cy: 3, r: 2, stroke: 'deep', width: 0.8 }, { shape: 'line', x1: 0, y1: 0, x2: 10, y2: 6, stroke: 'main', width: 2 }, { shape: 'path', d: [['M', 1, 1], ['L', 2, 2], ['Q', 3, 3, 4, 4], ['C', 5, 5, 6, 5, 7, 4], ['Z']], fill: 'deep', stroke: 'main', width: 1 }]), null);
  const bad = [
    [[], /1 to 6 shapes/],
    [Array(7).fill(ok), /1 to 6 shapes/],
    [[null], /shape 1: a shape is an object/],
    [[ok, { ...ok, shape: 'ellipse' }], /shape 2: a shape is one of rect, circle, line, path/],
    [[{ shape: ['rect'], x: 999, y: -5, w: -1, h: 0, fill: 'main' }], /a shape is one of rect, circle, line, path/], // a list is not a name
    [[{ shape: 'path', d: [['M', 1, 1], [['L'], 2, 2]], fill: 'main' }], /a path command is one of M, L, Q, C, Z/],
    [[{ ...ok, href: 'https://example.com' }], /has no "href"/],
    [[{ ...ok, x: '1' }], /x of a rect must be a number/],
    [[{ ...ok, x: NaN }], /must be a number/],
    [[{ ...ok, fill: 'red' }], /fill is one of main, deep/],
    [[{ ...ok, fill: 'white' }], /fill is one of main, deep/], // the tones of a face are not a hat's
    [[{ ...ok, fill: 'ink' }], /fill is one of main, deep/],
    [[{ ...ok, fill: undefined }], /needs a fill or a stroke/],
    [[{ ...ok, stroke: 'deep' }], /a stroke has a width from 0.8 to 2/],
    [[{ ...ok, stroke: 'deep', width: 0.5 }], /a stroke has a width from 0.8 to 2/],
    [[{ ...ok, stroke: 'deep', width: 2.5 }], /a stroke has a width from 0.8 to 2/],
    [[{ ...ok, width: 1 }], /only a stroke has one/],
    [[{ ...ok, w: 0 }], /above 0/],
    [[{ ...ok, x: 9, w: 2 }], /outside its box \(0 to 10 across, 0 to 6 down\)/],
    [[{ ...ok, r: 1.5 }], /half its shorter side/],
    [[{ shape: 'circle', cx: 1, cy: 3, r: 2, fill: 'main' }], /a circle is outside its box/],
    [[{ shape: 'circle', cx: 5, cy: 3, r: 0, fill: 'main' }], /an r above 0/],
    [[{ shape: 'line', x1: 0, y1: 0, x2: 5, y2: 7, stroke: 'main', width: 1 }], /a line is outside its box/],
    [[{ shape: 'line', x1: 0, y1: 0, x2: 5, y2: 5, fill: 'main' }], /a line has a stroke and no fill/],
    [[{ shape: 'path', d: 'M0 0L1 1', fill: 'main' }], /a list of 2 to 16 commands/],
    [[{ shape: 'path', d: [['M', 0, 0], ...Array(16).fill(['L', 1, 1])], fill: 'main' }], /a list of 2 to 16 commands/],
    [[{ shape: 'path', d: [['L', 0, 0], ['L', 1, 1]], fill: 'main' }], /starts with its one M/],
    [[{ shape: 'path', d: [['M', 0, 0], ['M', 1, 1]], fill: 'main' }], /starts with its one M/],
    [[{ shape: 'path', d: [['M', 0, 0], ['A', 1, 1, 0, 0, 1, 2, 2]], fill: 'main' }], /one of M, L, Q, C, Z/],
    [[{ shape: 'path', d: [['M', 0, 0], ['L', 1]], fill: 'main' }], /L takes 2 numbers/],
    [[{ shape: 'path', d: [['M', 0, 0], ['Q', 1, 1, '2', 2]], fill: 'main' }], /Q takes 4 numbers/],
    [[{ shape: 'path', d: [['M', 0, 0], ['C', 1, 1, 2, 2, 3, 6.5]], fill: 'main' }], /a path is outside its box/],
  ];
  for (const [shapes, reason] of bad) assert.match(String(why(shapes)), reason, JSON.stringify(shapes).slice(0, 80));
  // The hat's is the one box there is: nothing is a piece for the hand or the body.
  for (const slot of ['holds', 'cape', 'constructor']) assert.match(pieceProblem(slot, { shapes: [ok] }), /a piece is a hat/);
  assert.match(pieceProblem('hat', '<svg>'), /a list of shapes/);
  assert.match(pieceProblem('hat', { shapes: [ok], href: 'https://example.com' }), /a piece has no "href"/);
  assert.match(pieceProblem('hat', { shapes: [ok], means: ['<b>'] }), /a line of text/);
});

test('an outfit is { hat }: a kit name or a drawn hat; what is worn stays; anything else is refused', () => {
  assert.equal(outfitAfter(undefined, null), null, 'never given one');
  assert.equal(outfitAfter(null, null), null);
  assert.equal(outfitAfter({}, null), null, 'an empty outfit says nothing: still never dressed');
  assert.deepEqual(outfitAfter({ hat: '' }, null), { hat: '' }, 'no hat, on purpose');
  assert.deepEqual(outfitAfter({}, { hat: 'cap' }), { hat: 'cap' });
  assert.deepEqual(outfitAfter({ hat: 'cap' }, null), { hat: 'cap' });
  const worn = { hat: 'cap' };
  assert.deepEqual(outfitAfter(undefined, worn), worn);
  assert.deepEqual(outfitAfter(null, worn), worn);
  assert.deepEqual(outfitAfter({ hat: 'beret' }, worn), { hat: 'beret' });
  assert.deepEqual(outfitAfter({ hat: '' }, worn), { hat: '' }, 'only "" takes the hat off');
  // null says nothing about the hat: "" is the only way to say "none".
  assert.equal(outfitAfter({ hat: null }, null), null, 'a never-dressed bot stays never dressed, so the dresser still dresses it');
  assert.deepEqual(outfitAfter({ hat: null }, worn), worn);
  // Bots hold nothing any more: "holds" is refused like any key that is not "hat", with the reason.
  assert.throws(() => outfitAfter({ holds: 'envelope' }, worn), /^Error: An outfit has no "holds"\. Its only key is "hat", for what the bot wears on its head: a bot is a head with a hat and holds nothing\.$/);
  assert.throws(() => outfitAfter({ hat: 'crown', holds: '' }, worn), /An outfit has no "holds"/, 'also beside a valid hat, also empty');
  assert.throws(() => outfitAfter({ holds: null }, null), /An outfit has no "holds"/, 'also as null on a never-dressed bot');
  // A key that is no slot is refused, not ignored: a misspelt one would otherwise change nothing, silently.
  for (const key of ['HAT', 'held', 'body']) assert.throws(() => outfitAfter({ [key]: 'cap' }, worn), new RegExp(`^Error: An outfit has no "${key}"\\. Its only key is "hat"`), key);
  assert.throws(() => outfitAfter({ '<img src=x>': 'cap' }, worn), /^Error: An outfit has no such key\. Its only key is "hat"/, 'a key that is not a short plain word is not repeated');
  assert.throws(() => outfitAfter({ ['x'.repeat(5000)]: 'cap' }, worn), (e) => e.message.length < 300);
  assert.throws(() => outfitAfter({ hat: 'sombrero' }, worn), /no hat called "sombrero" in the kit\. outfit\.hat is one of: cap, top-hat, .*propeller; or "" for none; or a hat you draw/);
  assert.throws(() => outfitAfter({ hat: 'envelope' }, worn), /no hat called "envelope"/, 'what bots used to hold is no hat');
  for (const odd of ['constructor', 'toString', '__proto__', 7, true, ['cap'], [{ shapes: [FEZ.shapes[0]] }], () => 'cap', Symbol('cap'), 7n]) assert.throws(() => outfitAfter({ hat: odd }, worn), /no hat called .* in the kit\. outfit\.hat is one of: cap, .*; or "" for none; or a hat you draw, \{ "shapes": \[\.\.\.\] \}\./, String(odd));
  assert.throws(() => outfitAfter({ hat: 'x'.repeat(5000) }, worn), (e) => e.message.length < 600, 'a long wrong name is not echoed in full');
  assert.throws(() => outfitAfter('cap', worn), /outfit is \{ hat \}/);
  // A drawn hat takes the place of a kit name.
  const dressed = outfitAfter({ hat: FEZ }, worn);
  assert.deepEqual(dressed, { hat: FEZ });
  assert.notEqual(dressed.hat, FEZ, 'what is stored is a copy');
  // What is stored is what was checked, value by value: nothing a list could carry besides its items.
  const sly = copy(FEZ);
  sly.shapes.toJSON = () => '<svg>';
  sly.shapes[0].d.toJSON = () => 'M0 0';
  sly.shapes[0].d.extra = '<script>';
  assert.equal(JSON.stringify(outfitAfter({ hat: sly }, worn).hat), JSON.stringify(FEZ));
  assert.deepEqual(outfitAfter({ hat: '' }, dressed), { hat: '' }, 'a drawn hat comes off');
  assert.deepEqual(outfitAfter({ hat: 'crown' }, dressed), { hat: 'crown' }, 'or gives way to a kit hat');
  assert.throws(() => outfitAfter({ hat: TALL }, worn), /The hat you drew can't be worn: shape 1: a rect is outside its box \(0 to 10 across, 0 to 6 down\)\. Fix that and send outfit\.hat again as \{ "shapes": \[\.\.\.\] \}: 1 to 6 shapes, every point from 0 to 10 across and 0 to 6 down\./);
  assert.throws(() => outfitAfter({ hat: { shapes: [] } }, worn), /The hat you drew can't be worn: a piece has 1 to 6 shapes\./);
  assert.throws(() => outfitAfter({ hat: {} }, worn), /can't be worn: a piece has a list of shapes/);
  assert.throws(() => outfitAfter({ hat: { ...FEZ, means: 'A fez: travel' } }, worn), /a drawn piece has only "shapes", no "means"/, 'a meaning is the kit\'s');
  // A hat that is worn stays when it is sent back as it was read, whatever the check says today.
  const old = { hat: { shapes: [{ shape: 'ellipse' }] } };
  assert.deepEqual(outfitAfter(copy(old), old), old);
  assert.deepEqual(outfitAfter({ hat: 'bonnet' }, { hat: 'bonnet' }), { hat: 'bonnet' }, 'also one the kit has since lost');
});

test('a bot stored with a held object: it is ignored, and gone once the bot is saved', () => {
  assert.deepEqual(stored({ hat: 'cap', holds: 'envelope' }), { hat: 'cap' });
  // A held object and no hat: nothing of it is left, so it counts as never dressed and the dresser gives it a hat.
  assert.equal(stored({ hat: '', holds: 'envelope' }), null);
  assert.equal(stored({ holds: 'envelope' }), null);
  assert.equal(stored({ hat: null, holds: { shapes: [] } }), null, 'also one that was drawn');
  assert.deepEqual(stored({ hat: '', holds: '' }), { hat: '' }, 'it held nothing: no hat, on purpose');
  assert.deepEqual(stored({ hat: '' }), { hat: '' });
  assert.deepEqual(outfitAfter(undefined, { hat: '', holds: 'envelope' }), null, 'never dressed, and stays so until it is given a hat');
  assert.deepEqual(outfitAfter({ hat: 'cap' }, { hat: '', holds: 'envelope' }), { hat: 'cap' });
  assert.deepEqual(stored({ hat: FEZ, holds: 'mug' }), { hat: FEZ });
  for (const none of [null, undefined, 'cap', ['cap']]) assert.equal(stored(none), null);
  // A change keeps the hat and nothing else, whatever was there before.
  assert.deepEqual(outfitAfter({}, { hat: 'cap', holds: 'envelope' }), { hat: 'cap' });
  assert.deepEqual(outfitAfter(undefined, { hat: 'cap', holds: 'envelope' }), { hat: 'cap' });
  assert.deepEqual(outfitAfter({ hat: 'beret' }, { hat: 'cap', holds: 'envelope' }), { hat: 'beret' });
});

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

test('the API: a hat is stored and returned as { hat }; a bot without one stays without', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('outfits'));
  assert.deepEqual((await srv.api('/figure')).data.kit, def.kit);
  const plain = await makeBot(srv, { name: 'Plain' });
  assert.equal(plain.outfit, null);
  const mail = await makeBot(srv, { name: 'Mail Keeper', outfit: { hat: 'cap' } });
  assert.deepEqual(mail.outfit, { hat: 'cap' });
  const none = await makeBot(srv, { name: 'Night Watch', outfit: { hat: '' } });
  assert.deepEqual(none.outfit, { hat: '' });
  const list = (await srv.api('/bots')).data;
  assert.deepEqual(list.map((b) => [b.name, b.outfit]), [['Plain', null], ['Mail Keeper', { hat: 'cap' }], ['Night Watch', { hat: '' }]]);
  assert.deepEqual((await srv.api(`/bots/${mail.id}`)).data.outfit, { hat: 'cap' });
  // Another change leaves the hat alone, also when the whole bot is sent back (as the web page's editor does).
  assert.deepEqual((await srv.api(`/bots/${mail.id}`, { method: 'PUT', body: { description: 'Keeps an eye on the mail' } })).data.outfit, { hat: 'cap' });
  assert.deepEqual((await srv.api(`/bots/${mail.id}`, { method: 'PUT', body: { ...mail, color: '#e24b4a' } })).data.outfit, { hat: 'cap' });
  assert.equal((await srv.api(`/bots/${plain.id}`, { method: 'PUT', body: { ...plain, color: '#e24b4a' } })).data.outfit, null);
});

test('the API: a change reaches open apps; an unknown hat and a held object are refused with the reason', async () => {
  const bot = await makeBot(srv, { name: 'Changer', outfit: { hat: 'crown' } });
  const live = feed(srv);
  try {
    await live.wait('hello');
    const seen = live.events.length;
    const r = await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { outfit: { hat: 'beret' } } });
    assert.deepEqual([r.status, r.data.outfit], [200, { hat: 'beret' }]);
    await waitFor(() => live.events.slice(seen).some((e) => e.type === 'bots'), { what: 'a bots event after the change' }); // the feed says the bots changed: apps fetch them again
    for (const [outfit, reason] of [
      [{ hat: 'sombrero' }, /no hat called "sombrero" in the kit\. outfit\.hat is one of: cap, top-hat, .*; or "" for none; or a hat you draw/],
      [{ holds: 'envelope' }, /An outfit has no "holds"\. Its only key is "hat", for what the bot wears on its head: a bot is a head with a hat and holds nothing\./],
      [{ hat: 'cap', holds: 'envelope' }, /An outfit has no "holds"/],
      [{ hat: 'cap', holds: '' }, /An outfit has no "holds"/],
      [{ hat: ['cap'] }, /no hat called/],
      ['cap', /outfit is \{ hat \}/],
      [{ HAT: 'cap' }, /An outfit has no "HAT"\. Its only key is "hat"/],
    ]) {
      const bad = await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { name: 'Renamed', outfit } });
      assert.equal(bad.status, 400);
      assert.match(bad.data.error, reason);
      const kept = (await srv.api(`/bots/${bot.id}`)).data;
      assert.deepEqual([kept.name, kept.outfit], ['Changer', { hat: 'beret' }], 'nothing of a refused change is kept');
    }
    // A null hat changes nothing; on a bot never dressed it leaves the bot for the dresser.
    assert.deepEqual((await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { outfit: { hat: null } } })).data.outfit, { hat: 'beret' });
    const bare = await makeBot(srv, { name: 'Bare', outfit: { hat: null } });
    assert.equal(bare.outfit, null);
    for (const outfit of [{ hat: 'sombrero' }, { hat: 'cap', holds: 'envelope' }]) {
      const none = await srv.api('/bots', { method: 'POST', body: { name: 'Odd', prompt: 'Do it.', outfit } });
      assert.equal(none.status, 400);
      assert.ok(!(await srv.api('/bots')).data.some((b) => b.name === 'Odd'), 'no bot is made with an outfit that is refused');
    }
    assert.deepEqual((await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { outfit: { hat: '' } } })).data.outfit, { hat: '' });
  } finally { live.close(); }
});

// The Chief's own tools (lib/mcp-server.js), spoken to as Claude speaks to them.
function chiefTools(t) {
  const client = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey });
  return { list: async () => (await client.request('tools/list')).tools, call: (name, args) => client.request('tools/call', { name, arguments: args }) };
}

test("the Chief's tools speak of a hat only: the kit is listed to choose from, a hat is set and changed, a wrong name comes back with the right ones", async (t) => {
  const chief = chiefTools(t);
  const tools = await chief.list();
  for (const name of ['create_bot', 'update_bot']) {
    const props = tools.find((x) => x.name === name).inputSchema.properties;
    const field = props.outfit;
    assert.match(field.description, /fits its name and task/);
    assert.deepEqual(Object.keys(field.properties), ['hat'], 'an outfit has one key');
    // A hat is a kit name or a drawn hat: the tool lets both through and the server checks them.
    assert.deepEqual(field.properties.hat.anyOf[0], { type: 'string', enum: [...names('hat'), ''] });
    assert.equal(field.properties.hat.anyOf[1].type, 'object');
    for (const [piece, p] of Object.entries(KIT.hat.pieces)) assert.ok(field.properties.hat.description.includes(`${piece} (${p.means.split(': ')[1]})`), `${name} lists ${piece}`);
    // Nothing tells the Chief of a body, a hand or something to hold.
    const said = JSON.stringify(props);
    assert.doesNotMatch(said, /holds|held object|to hold|in its hand|stick figure|the hand\b/i, name);
    assert.match(props.color.description, /a head in its colour, wearing a hat/);
  }
  const text = (r) => r.content[0].text;
  const made = await chief.call('create_bot', { name: 'Fleet Doctor', prompt: 'Check the servers.', outfit: { hat: 'nurse' } });
  assert.ok(!made.isError, text(made));
  const bot = JSON.parse(text(made));
  assert.deepEqual(bot.outfit, { hat: 'nurse' });
  // "Give it a hard hat instead."
  const changed = await chief.call('update_bot', { id: bot.id, outfit: { hat: 'hard-hat' } });
  assert.deepEqual(JSON.parse(text(changed)).outfit, { hat: 'hard-hat' });
  const renamed = await chief.call('update_bot', { id: bot.id, description: 'Checks the servers every morning' });
  assert.deepEqual(JSON.parse(text(renamed)).outfit, { hat: 'hard-hat' }, 'another change keeps the hat');
  const wrong = await chief.call('update_bot', { id: bot.id, outfit: { hat: 'stethoscope' } });
  assert.equal(wrong.isError, true);
  assert.match(text(wrong), /no hat called "stethoscope" in the kit\. outfit\.hat is one of: cap, top-hat, /);
  const held = await chief.call('update_bot', { id: bot.id, outfit: { holds: 'doctor-bag' } });
  assert.equal(held.isError, true);
  assert.match(text(held), /unknown field "holds" in outfit/, 'the tool itself knows no such field');
  assert.deepEqual((await srv.api(`/bots/${bot.id}`)).data.outfit, { hat: 'hard-hat' }, 'the bot keeps its hat');
  const listed = JSON.parse(text(await chief.call('list_bots', {}))).find((b) => b.id === bot.id);
  assert.deepEqual(listed.outfit, { hat: 'hard-hat' }, 'the Chief sees what each bot wears');
  // No outfit sent: the bot is made, as a bare head.
  const bare = JSON.parse(text(await chief.call('create_bot', { name: 'Bare', prompt: 'Do it.' })));
  assert.equal(bare.outfit, null);
});

test('the API: a drawn hat is stored, returned with the bot and kept when its colour changes', async () => {
  const made = await srv.api('/bots', { method: 'POST', body: { name: 'Traveller', prompt: 'Plan trips.', color: '#ef9f27', outfit: { hat: FEZ } } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.deepEqual(made.data.outfit, { hat: FEZ });
  const id = made.data.id;
  assert.deepEqual((await srv.api(`/bots/${id}`)).data.outfit, { hat: FEZ });
  assert.deepEqual((await srv.api('/bots')).data.find((b) => b.id === id).outfit, { hat: FEZ });
  // Tones are names, not colours: a new colour leaves every shape as it was.
  const blue = await srv.api(`/bots/${id}`, { method: 'PUT', body: { color: '#378add' } });
  assert.deepEqual([blue.data.color, blue.data.outfit], ['#378add', { hat: FEZ }]);
  // The whole bot sent back, as the web page's editor and update_bot do: still the same hat.
  const back = await srv.api(`/bots/${id}`, { method: 'PUT', body: { ...blue.data, color: '#d4537e' } });
  assert.deepEqual([back.data.color, back.data.outfit], ['#d4537e', { hat: FEZ }]);
  const live = feed(srv);
  try {
    await live.wait('hello');
    const seen = live.events.length;
    assert.deepEqual((await srv.api(`/bots/${id}`, { method: 'PUT', body: { outfit: { hat: STRAW } } })).data.outfit, { hat: STRAW });
    await waitFor(() => live.events.slice(seen).some((e) => e.type === 'bots'), { what: 'a bots event after the drawn hat' });
  } finally { live.close(); }
});

test('the API: a drawn hat that breaks a limit is refused with the reason, and the bot keeps its hat', async () => {
  const worn = { hat: FEZ };
  const bot = await makeBot(srv, { name: 'Keeper', outfit: worn });
  const ok = { shape: 'rect', x: 1, y: 1, w: 2, h: 2, fill: 'main' };
  const path = (...d) => ({ shape: 'path', d, fill: 'deep' });
  const deep = (n) => { let v = 1; for (let i = 0; i < n; i++) v = [v]; return v; };
  for (const [piece, reason] of [
    // One per limit of ADR 004.
    [{ shapes: Array(7).fill(ok) }, /The hat you drew can't be worn: a piece has 1 to 6 shapes\. Fix that and send outfit\.hat again as \{ "shapes": \[\.\.\.\] \}: 1 to 6 shapes, every point from 0 to 10 across and 0 to 6 down\./],
    [{ shapes: [] }, /a piece has 1 to 6 shapes/],
    [{ shapes: [ok, { ...ok, y: 5 }] }, /The hat you drew can't be worn: shape 2: a rect is outside its box \(0 to 10 across, 0 to 6 down\)/],
    [{ shapes: [{ shape: 'circle', cx: 9, cy: 3, r: 2, fill: 'main' }] }, /shape 1: a circle is outside its box \(0 to 10 across, 0 to 6 down\)/],
    [{ shapes: [{ shape: 'ellipse', cx: 4, cy: 3, rx: 2, ry: 1, fill: 'main' }] }, /shape 1: a shape is one of rect, circle, line, path/],
    [{ shapes: [path(['M', 1, 1], ['A', 2, 2, 0, 0, 1, 4, 4])] }, /shape 1: a path command is one of M, L, Q, C, Z/],
    [{ shapes: [path(['M', 1, 1], ['l', 2, 2])] }, /a path command is one of M, L, Q, C, Z/],
    [{ shapes: [path(['M', 1, 1], ...Array(16).fill(['L', 2, 2]))] }, /a path's d is a list of 2 to 16 commands/],
    [{ shapes: [{ shape: 'path', d: 'M1 1L8 5Z', fill: 'deep' }] }, /a path's d is a list of 2 to 16 commands/],
    [{ shapes: [{ ...ok, stroke: 'deep', width: 0.5 }] }, /a stroke has a width from 0.8 to 2/],
    [{ shapes: [{ ...ok, stroke: 'deep', width: 3 }] }, /a stroke has a width from 0.8 to 2/],
    [{ shapes: [{ ...ok, x: '1' }] }, /shape 1: x of a rect must be a number/],
    [{ shapes: [{ ...ok, w: null }] }, /w of a rect must be a number/],
    [{ shapes: [path(['M', 1, 1], ['L', '8', 5])] }, /L takes 2 numbers/],
    [{ shapes: [{ ...ok, fill: '#ff0000' }] }, /fill is one of main, deep/],
    [{ shapes: [{ ...ok, fill: 'white' }] }, /fill is one of main, deep/],
    [{ shapes: [{ shape: 'rect', x: 1, y: 1, w: 2, h: 2 }] }, /a shape needs a fill or a stroke/],
    // Hostile input: markup, links and scripts wherever a string could go; numbers too big to draw; nesting; floods.
    [{ shapes: [{ ...ok, fill: '"/><script>alert(1)</script>' }] }, /fill is one of main, deep/],
    [{ shapes: [{ ...ok, shape: '<svg onload=alert(1)>' }] }, /a shape is one of rect, circle, line, path/],
    [{ shapes: [{ ...ok, href: 'javascript:alert(1)' }] }, /a rect has no "href"/],
    [{ shapes: [{ ...ok, style: 'background:url(https://example.com)' }] }, /a rect has no "style"/],
    [{ shapes: [{ ...ok, transform: 'scale(99)' }] }, /a rect has no "transform"/],
    [{ shapes: [path(['M', 1, 1], ['L<script>', 2, 2])] }, /a path command is one of M, L, Q, C, Z/],
    [{ shapes: [path(['M', 1, 1], ['L', 2, '2"/><script>'])] }, /L takes 2 numbers/],
    [{ shapes: [ok], means: '<img src=x onerror=alert(1)>' }, /a drawn piece has only "shapes", no "means"/],
    [{ shapes: [ok], ['<b>'.repeat(500)]: 1 }, /a drawn piece has only "shapes", no other field\./],
    [{ shapes: [ok], '<img src=x onerror=a()>': 1 }, /a drawn piece has only "shapes", no other field\./],
    [{ shapes: [{ ...ok, ['<script>alert(1)</script>'.repeat(200)]: 1 }] }, /shape 1: a rect has no such field; it has fill, stroke, width, x, y, w, h, r\./],
    [{ shapes: [{ ...ok, ['K'.repeat(900000)]: 1 }] }, /a rect has no such field/],
    ['<img src=x onerror=a()>', /There is no hat called that in the kit/],
    ['x'.repeat(5000), /There is no hat called that in the kit/],
    [{ shapes: [{ ...ok, x: 1e308 }] }, /a rect is outside its box/],
    [{ shapes: [{ ...ok, w: 1e308 }] }, /a rect is outside its box/],
    [{ shapes: [{ ...ok, x: -1e-9 }] }, /a rect is outside its box/],
    [{ shapes: [{ shape: 'circle', cx: 4, cy: 3, r: 1e21, fill: 'main' }] }, /a circle is outside its box/],
    [{ shapes: [path(['M', 1, 1], ['C', 2, 2, 3, 3, 4, 9007199254740993])] }, /a path is outside its box/],
    [{ shapes: [{ ...ok, x: deep(200) }] }, /x of a rect must be a number/],
    [{ shapes: [path(['M', 1, 1], ['L', deep(200), 2])] }, /L takes 2 numbers/],
    [{ shapes: [deep(200)] }, /shape 1: a shape is an object/],
    [{ shapes: [{ ...ok, d: deep(200) }] }, /a rect has no "d"/],
    [{ shapes: deep(200) }, /shape 1: a shape is an object/],
    [{ shapes: Array(5000).fill(ok) }, /a piece has 1 to 6 shapes/],
    [{ shapes: [path(['M', 1, 1], ...Array(5000).fill(['L', 2, 2]))] }, /a path's d is a list of 2 to 16 commands/],
    [{ shapes: [path(['M', 1, 1], ['L', ...Array(5000).fill(2)])] }, /L takes 2 numbers/],
    [{ shapes: { length: 1, 0: ok } }, /a piece has a list of shapes/],
    [{ shapes: '<svg><script>alert(1)</script></svg>' }, /a piece has a list of shapes/],
    [{}, /a piece has a list of shapes/],
  ]) {
    const bad = await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { name: 'Renamed', outfit: { hat: piece } } });
    const sent = JSON.stringify(piece).slice(0, 90);
    assert.equal(bad.status, 400, sent);
    assert.match(bad.data.error, reason, sent);
    assert.ok(bad.data.error.length < 400, `a short reason: ${bad.data.error.length} characters`);
    assert.ok(!/<script|<svg|<img|javascript:/.test(bad.data.error), `no markup comes back in the reason: ${bad.data.error}`);
    const kept = (await srv.api(`/bots/${bot.id}`)).data;
    assert.deepEqual([kept.name, kept.outfit], ['Keeper', worn], `nothing of a refused change is kept: ${sent}`);
  }
  // "__proto__" as a key: refused like any other field, and nothing leaks into other objects.
  const proto = await srv.api(`/bots/${bot.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, raw: `{"outfit":{"hat":{"shapes":[{"shape":"rect","x":1,"y":1,"w":2,"h":2,"fill":"main","__proto__":{"fill":"main"}}]}}}` });
  assert.equal(proto.status, 400);
  assert.match(proto.data.error, /a rect has no such field/);
  assert.equal({}.fill, undefined);
  // More than the server reads in one request: refused before anything is parsed.
  const flood = await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { outfit: { hat: { shapes: Array(60000).fill(ok) } } } });
  assert.ok(flood.status >= 400, `a flood of shapes: ${flood.status}`);
  assert.deepEqual((await srv.api(`/bots/${bot.id}`)).data.outfit, worn);
  // No bot is made with a hat that can't be worn.
  const none = await srv.api('/bots', { method: 'POST', body: { name: 'Odd Baker', prompt: 'Do it.', outfit: { hat: { shapes: Array(7).fill(ok) } } } });
  assert.equal(none.status, 400);
  assert.ok(!(await srv.api('/bots')).data.some((b) => b.name === 'Odd Baker'));
});

test("the Chief's drawing guidance takes its numbers from the figure definition", () => {
  const source = fs.readFileSync(path.join(ROOT, 'lib', 'mcp-server.js'), 'utf8');
  const hat = source.slice(source.indexOf('function outfitHat('), source.indexOf('const BOT_FIELDS'));
  assert.ok(hat.includes('figure.head.r') && hat.includes('figure.attach.hat.scale') && hat.includes('KIT.hat.box') && hat.includes('KIT.hat.origin'));
  // No number is written out in the guidance itself: each is the definition's, or advice named beside it.
  assert.equal(hat.match(/`[^`]*`/g).join(' ').replace(/\$\{[^}]*\}/g, '').match(/\d+(\.\d+)?/g), null);
});

test("the Chief's tools: told to use the kit first and how to draw, a drawn hat is stored, a bad one comes back with the reason", async (t) => {
  const chief = chiefTools(t);
  const tools = await chief.list();
  for (const name of ['create_bot', 'update_bot']) {
    const field = tools.find((x) => x.name === name).inputSchema.properties.outfit;
    assert.match(field.description, /Use the kit first/);
    assert.match(field.description, /Only when nothing in the kit fits/);
    assert.match(field.description, /A hat you draw is \{ "shapes"/);
    assert.match(field.description, /1 to 6 shapes/);
    assert.match(field.description, /2 to 16 commands/);
    assert.match(field.description, /0\.8 to 2/);
    assert.match(field.properties.hat.description, /a box 10 wide and 6 high/);
    // Where the head is is said in the definition's own numbers, in the hat's units: the head's width over the hat's scale.
    const head = Math.round((2 * def.head.r / def.attach.hat.scale) * 10) / 10;
    assert.ok(field.properties.hat.description.includes(`The top of the head is at (${KIT.hat.origin.join(', ')}) and the head is a circle ${head} wide below that point, so centre the hat on x = ${KIT.hat.origin[0]},`));
    assert.ok(field.properties.hat.description.includes(`lie at y about ${Math.round((KIT.hat.origin[1] + 0.9) * 10) / 10} (just over the top of the head)`), 'the brim is said from the top of the head');
    // The worked example is a hat the server takes as it stands.
    const example = JSON.parse(field.description.match(/Example, a fez: (\{.*\})$/m)[1]);
    assert.equal(pieceProblem('hat', example), null);
    assert.deepEqual(outfitAfter({ hat: example }, null), { hat: example });
  }
  const text = (r) => r.content[0].text;
  const made = await chief.call('create_bot', { name: 'Garden Helper', prompt: 'Say when to water.', outfit: { hat: STRAW } });
  assert.ok(!made.isError, text(made));
  const bot = JSON.parse(text(made));
  assert.deepEqual(bot.outfit, { hat: STRAW });
  assert.deepEqual((await srv.api(`/bots/${bot.id}`)).data.outfit, { hat: STRAW });
  // Another change through the tool sends the whole bot back: the drawn hat stays.
  assert.deepEqual(JSON.parse(text(await chief.call('update_bot', { id: bot.id, color: '#378add' }))).outfit, { hat: STRAW });
  assert.deepEqual(JSON.parse(text(await chief.call('update_bot', { id: bot.id, outfit: { hat: FEZ } }))).outfit, { hat: FEZ });
  assert.deepEqual(JSON.parse(text(await chief.call('list_bots', {}))).find((b) => b.id === bot.id).outfit, { hat: FEZ }, 'the Chief sees what it drew');
  // A hat outside its box: the reason comes back, and the bot keeps what it wore.
  const wide = await chief.call('update_bot', { id: bot.id, outfit: { hat: { shapes: [{ shape: 'rect', x: 1, y: 1, w: 12, h: 3, fill: 'deep' }] } } });
  assert.equal(wide.isError, true);
  assert.match(text(wide), /The hat you drew can't be worn: shape 1: a rect is outside its box \(0 to 10 across, 0 to 6 down\)\. Fix that and send outfit\.hat again/);
  const thin = await chief.call('create_bot', { name: 'Thin', prompt: 'Do it.', outfit: { hat: { shapes: [{ shape: 'line', x1: 1, y1: 1, x2: 8, y2: 5, stroke: 'deep', width: 0.3 }] } } });
  assert.equal(thin.isError, true);
  assert.match(text(thin), /shape 1: a stroke has a width from 0\.8 to 2/);
  assert.deepEqual((await srv.api(`/bots/${bot.id}`)).data.outfit, { hat: FEZ });
  assert.ok(!(await srv.api('/bots')).data.some((b) => b.name === 'Thin'));
});

test('the hat survives a restart, a backup and a restore', async () => {
  const a = await startServer();
  let b;
  try {
    const bot = await makeBot(a, { name: 'Mail Keeper', outfit: { hat: 'cap' } });
    const bare = await makeBot(a, { name: 'Bare' });
    const none = await makeBot(a, { name: 'Undressed', outfit: { hat: '' } });
    const drawn = await makeBot(a, { name: 'Traveller', outfit: { hat: FEZ } });
    await a.stop();
    b = await startServer({ dir: a.dir });
    const after = (await b.api('/bots')).data;
    assert.deepEqual(after.find((x) => x.id === bot.id).outfit, { hat: 'cap' });
    assert.equal(after.find((x) => x.id === bare.id).outfit, null, 'never dressed');
    assert.deepEqual(after.find((x) => x.id === none.id).outfit, { hat: '' }, 'no hat, on purpose');
    assert.deepEqual(after.find((x) => x.id === drawn.id).outfit, { hat: FEZ }, 'a drawn hat, shape for shape');
    assert.equal((await b.api('/backups/passphrase', { method: 'PUT', body: { passphrase: PASS } })).status, 200);
    const made = (await b.api('/backups/now', { method: 'POST' })).data;
    assert.equal(made.count, 1, JSON.stringify(made));
    assert.deepEqual((await b.api(`/bots/${bot.id}`, { method: 'PUT', body: { outfit: { hat: 'crown' } } })).data.outfit, { hat: 'crown' });
    assert.deepEqual((await b.api(`/bots/${drawn.id}`, { method: 'PUT', body: { outfit: { hat: 'chef' } } })).data.outfit, { hat: 'chef' });
    const restore = await b.api('/backups/restore', { method: 'POST', body: { file: made.last.name, passphrase: PASS } });
    assert.equal(restore.data.ok, true, JSON.stringify(restore.data));
    await b.exited; // a restore restarts the server
    b = await startServer({ dir: a.dir });
    assert.deepEqual((await b.api(`/bots/${bot.id}`)).data.outfit, { hat: 'cap' });
    assert.deepEqual((await b.api(`/bots/${drawn.id}`)).data.outfit, { hat: FEZ }, 'the restore brings the drawn hat back');
  } finally { await a.stop(); await b?.stop(); }
});

test('a bot stored with a held object loads without error, is returned without it, and loses it in the file when next saved', async () => {
  const a = await startServer();
  let b;
  try {
    const mail = await makeBot(a, { name: 'Mail Keeper', outfit: { hat: 'cap' } });
    const news = await makeBot(a, { name: 'News Reader', outfit: { hat: '' } });
    const baker = await makeBot(a, { name: 'Baker', outfit: { hat: FEZ } });
    const plain = await makeBot(a, { name: 'Plain' });
    await a.stop();
    // As the stick-figure build saved them: a held object beside the hat, from the kit or drawn.
    const file = path.join(a.data, 'bots.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const loaf = { shapes: [{ shape: 'rect', x: 1, y: 2, w: 7, h: 6, fill: 'deep' }] };
    saved.find((x) => x.id === mail.id).outfit = { hat: 'cap', holds: 'envelope' };
    saved.find((x) => x.id === news.id).outfit = { hat: '', holds: 'newspaper' };
    saved.find((x) => x.id === baker.id).outfit = { hat: FEZ, holds: loaf };
    fs.writeFileSync(file, JSON.stringify(saved));
    b = await startServer({ dir: a.dir });
    const outfits = async () => Object.fromEntries((await b.api('/bots')).data.map((x) => [x.name, x.outfit]));
    assert.deepEqual(await outfits(), { 'Mail Keeper': { hat: 'cap' }, 'News Reader': null, Baker: { hat: FEZ }, Plain: null }, 'the held object is ignored; a bot with a hat is not dressed again, one that only held something counts as never dressed');
    assert.deepEqual((await b.api(`/bots/${mail.id}`)).data.outfit, { hat: 'cap' });
    assert.ok(fs.readFileSync(file, 'utf8').includes('"holds"'), 'reading alone writes nothing');
    // The next save of the bots, of any bot, writes them without it.
    assert.equal((await b.api(`/bots/${plain.id}`, { method: 'PUT', body: { description: 'Changed' } })).status, 200);
    assert.ok(!fs.readFileSync(file, 'utf8').includes('"holds"'), 'gone from the file');
    assert.deepEqual(await outfits(), { 'Mail Keeper': { hat: 'cap' }, 'News Reader': null, Baker: { hat: FEZ }, Plain: null });
    // The whole bot sent back as an older page read it, held object and all, is refused; the hat alone is fine.
    const old = await b.api(`/bots/${mail.id}`, { method: 'PUT', body: { outfit: { hat: 'cap', holds: 'envelope' } } });
    assert.equal(old.status, 400);
    assert.match(old.data.error, /An outfit has no "holds"/);
    assert.deepEqual((await b.api(`/bots/${mail.id}`, { method: 'PUT', body: { outfit: { hat: 'beret' } } })).data.outfit, { hat: 'beret' });
  } finally { await a.stop(); await b?.stop(); }
});
