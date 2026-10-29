// The owner's page of tiles is "the Board" wherever the owner, the Chief of Staff or a bot reads it (BOARD-001):
// the Chief's instructions, skill and tools, a bot's prompts and tools, the server's errors, the web page and the
// docs. The web list shows its strip while it is empty. Its identifiers keep the earlier name (the API paths,
// the feed event, data/dashboard.json): test/dashboard.test.js proves those, unchanged.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { startServer, makeBot, heldRun, self, waitFor, ROOT } = require('./helpers');
const { rpcClient } = require('./memory-helpers');
const { TOOLS } = require('../lib/mcp-server');
const { webSource } = require('./web-source');
const { words } = require('./web-page');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

const OLD = /dashboard/i;
const source = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const times = (text, re) => (text.match(new RegExp(re.source, 'gi')) || []).length;
// How often a tile reads again, as the owner chose it (#42), described once for the Chief's tools and a bot's suggest_tile.
const EVERY = 'How often it reads again while the Board is open, in seconds, as the owner chose it when asked: 60 every minute (the default), 900 every 15 minutes, 3600 hourly, 86400 daily, or 0 only when tapped (read once, then again on a tap on a value or a switch, or with tap "refresh"). At least 10.';
const EARLIER_NAME = 'The Board was called the dashboard before, so a user who still uses that word means the Board.';

// ---------- the Chief ----------

test("the Chief's instructions say Board, name its skill and tools, and say the earlier name once", async (t) => {
  srv.reply('Done.');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Put a shopping list on my board.' } });
  const turn = await srv.nextRun((r) => !!r.botdot, "the Chief's turn");
  await waitFor(async () => !(await srv.api(`/chief/chats/${chat.id}`)).data.busy, { what: 'the Chief to reply' });
  const { system } = turn;
  assert.ok(system.startsWith("You are the Chief of Staff in botdot, the user's personal team of AI helper bots.\n"), system.slice(0, 120));
  const board = system.slice(system.indexOf('\nBoard:\n'), system.indexOf('\nConnected apps:\n'));
  assert.ok(board.length > 0, 'the section "Board:"');
  assert.match(board, /^\nBoard:\n- The user has a Board: one page of tiles under headings, /);
  assert.ok(board.includes(EARLIER_NAME), 'the earlier name');
  assert.match(board, /"put a shopping list on my board"/);
  assert.match(board, /load your skill chief:board with the Skill tool and follow it, even if you loaded it earlier in this chat/);
  assert.match(board, /Its tools are get_board, test_tile, add_tile, update_tile, remove_tile and arrange_board\./);
  assert.equal(times(system, OLD), 1, 'the earlier name is said once');

  // Its tools, as its MCP server hands them out; a chat from before the update that calls the old name is told so.
  const tools = rpcClient(t, 'mcp-server.js', turn.botdot.env);
  const offered = (await tools.request('tools/list')).tools;
  assert.doesNotMatch(JSON.stringify(offered), OLD);
  for (const name of ['get_board', 'arrange_board']) assert.ok(offered.some((x) => x.name === name), name);
  await assert.rejects(tools.call('get_dashboard'), /Unknown tool get_dashboard/);
  await assert.rejects(tools.call('arrange_dashboard', { sections: ['Home'] }), /Unknown tool arrange_dashboard/);
  assert.deepEqual(Object.keys(await tools.json('get_board')).sort(), ['home', 'homeAuto', 'pending', 'sections', 'suggestions', 'tiles']);
  assert.ok(Array.isArray((await tools.json('arrange_board', { sections: ['Home'] })).tiles));
});

test("the Chief's tools: get_board and arrange_board, and no name, description or field says the earlier name", () => {
  const names = TOOLS.map((x) => x.name);
  for (const name of ['get_board', 'test_tile', 'add_tile', 'update_tile', 'remove_tile', 'arrange_board']) assert.ok(names.includes(name), name);
  for (const name of ['get_dashboard', 'arrange_dashboard']) assert.ok(!names.includes(name), name);
  assert.doesNotMatch(JSON.stringify(TOOLS.map((x) => [x.name, x.description, x.inputSchema])), OLD);
  const tool = (name) => TOOLS.find((x) => x.name === name);
  assert.equal(tool('get_board').description, "The user's Board: its headings in order, and every tile in full (sources, last value, and whether a script waits for the user's OK).");
  assert.equal(tool('add_tile').description, "Put a tile on the user's Board. Load your skill chief:board first.");
  assert.equal(tool('update_tile').description, 'Change a tile (id from get_board). Only pass the fields to change; null removes a source.');
  assert.equal(tool('remove_tile').description, 'Take a tile off the Board. A group: its tiles come out of it and stay, unless withTiles is true.');
  assert.equal(tool('add_tile').inputSchema.properties.every.description, EVERY);
  assert.match(tool('request_login').description, /^Open a secure pop-up in botdot asking the user to add a login for a website /);
  assert.match(tool('request_login').description, /\(Home Assistant, Proxmox, a tile on the Board\)/);
});

test("the Chief's skill is chief:board, without the earlier name and without the row's place", () => {
  const skills = path.join(ROOT, 'chief-skills', 'skills');
  assert.equal(fs.existsSync(path.join(skills, 'dashboard')), false, 'chief-skills/skills/dashboard is gone');
  const skill = source('chief-skills/skills/board/SKILL.md');
  assert.match(skill, /^---\nname: board\ndescription: "Build and change the user's Board: [^\n]+"\n---\n\n# The user's Board\n/);
  assert.doesNotMatch(skill, OLD);
  assert.doesNotMatch(skill, /`place`|\brow in the app's list\b|drag it there/, 'the row of the list has no place to set');
  // It asks how often the tile refreshes before adding it (#42), with buttons and a default, and how to change it.
  assert.match(skill, /\n3\. \*\*Ask how often it refreshes\*\* when the tile reads its value itself, unless the user said: one question, with \[\[choices: Every minute \(default\) \| Every 15 minutes \| Hourly \| Only when I tap\]\] or the four that fit it, your default first\. Say that it refreshes only while the Board is open, and that more often means more reads, and more runs of its script for a tile whose read is a script\. Put the answer in `every` \(seconds; 0 for only when tapped\)\.\n4\. \*\*Add it\*\*/);
  assert.ok(skill.includes('- How often it refreshes: `update_tile` with `every`.'), 'changing it later');
  for (const text of ['Your tools: `get_board`, `test_tile`, `add_tile`, `update_tile`, `remove_tile`, `arrange_board`.', '**Look first:** call `get_board`.', '"It\'s on your Board, under Home."', '`arrange_board` with `sections` or `tiles`', '`arrange_board` with `rename`']) {
    assert.ok(skill.includes(text), text);
  }
});

// ---------- a bot ----------

test("a bot reads of the owner's Board: in its run, in its weekly review, and in its tools' replies", async (t) => {
  const bot = await makeBot(srv, { name: 'Morning Brief', emoji: '🌅' });
  const tile = await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'note', title: 'Today', bot: bot.id } });
  assert.equal(tile.status, 201, JSON.stringify(tile.data));

  // Its tools, with a tile to fill: what they say, and what they answer.
  const first = await heldRun(srv, bot);
  t.after(() => { srv.unhold(); srv.release(first.rec); });
  const tools = rpcClient(t, 'self-mcp.js', first.rec.self.env);
  const offered = (await tools.request('tools/list')).tools;
  assert.doesNotMatch(JSON.stringify(offered), OLD);
  const described = (name) => offered.find((x) => x.name === name)?.description || '';
  assert.match(described('set_tile'), /^Put a new value on one of your tiles on the owner's Board \(they're listed in your instructions\)\. /);
  assert.match(described('suggest_tile'), /^Suggest a tile for the owner's Board: when they ask you to put something there, .+ It waits faded on their Board and as a card in your chat, /);
  assert.match(described('suggest_tile'), / When the owner asked for it, call this only after they answered your one question about what they want \(or their request left no doubt\)\. /);
  assert.equal(offered.find((x) => x.name === 'suggest_tile').inputSchema.properties.every.description, EVERY, "the refresh the owner chose, as the Chief's tools say it");
  assert.equal(await tools.text('suggest_tile', { kind: 'note', title: 'Shopping', reason: 'You asked me for a shopping list.' }),
    "Suggested. It waits on the owner's Board and in your chat until they tap Add. Tell them in one short sentence.");
  assert.equal(await tools.text('set_tile', { tile: 'Today', value: 'Rain at 3.' }), 'Done. The Board shows it now.');
  srv.unhold(); srv.release(first.rec);
  await srv.finished(first.run.id);

  // Its next run: a tile to fill and a suggestion waiting.
  const second = await heldRun(srv, bot, 'any news?');
  t.after(() => { srv.unhold(); srv.release(second.rec); });
  const { system } = second.rec;
  assert.match(system, /You fill these tiles on the owner's Board: "Today" \(note\)\. When your task or the owner says so, update them with set_tile/);
  assert.match(system, /The owner's Board is their one page of tiles \(switches, buttons, values, lists, notes, or tiles built from blocks with sliders, a colour wheel, charts and more\)\. When the owner asks you to put something on it, first ask /);
  assert.match(system, /Put their answer in every\. Then, or when you notice they keep asking you for the same action or the same value \(3 times or more\), suggest a tile with suggest_tile/);
  assert.match(system, /Tell them in one short sentence that it waits on their Board\. Your tiles already there: "Today"\. Your suggestions still waiting: "Shopping"\./);
  // Asked for a tile, it first asks one question (#31): short, about this request, with buttons for short options.
  assert.match(system, /When the owner asks you to put something on it, first ask them exactly one short question that checks what they want, specific to that request \(for a light: an on\/off switch, a brightness slider or its state as a value\), with the options as \[\[choices: …\]\] when they are a few short ones, and suggest the tile only after they answer\. Skip the question when their request already leaves no doubt\./);
  assert.ok(system.indexOf('first ask them exactly one short question') < system.indexOf('suggest a tile with suggest_tile'), 'the question comes before the suggestion');
  // Then how often it refreshes (#42), for a tile that reads its value itself: with buttons and a default, and what more often costs.
  assert.match(system, /Skip the question when their request already leaves no doubt\. Once that is clear, and the tile reads its value itself, ask how often it should refresh, unless they said: offer the four choices that fit it, your default first, e\.g\. \[\[choices: Every minute \(default\) \| Every 15 minutes \| Hourly \| Only when I tap\]\], and say that it refreshes only while the Board is open, and that more often means more reads, and more runs of its script for a tile whose read is a script\. Put their answer in every\. Then, or when you notice/);
  assert.doesNotMatch(system, OLD);
  assert.doesNotMatch(second.rec.stdin, OLD);
  srv.unhold(); srv.release(second.rec);
  await srv.finished(second.run.id);

  // Its weekly memory review.
  const started = await srv.api(`/memory/review/${bot.id}`, { method: 'POST' });
  const review = await srv.nextRun((x) => x.stdin.includes('memory review'), 'the review run');
  assert.match(review.stdin, /\n\n5\. The owner's Board: if the runs show them asking you for the same action or the same value 3 times or more \(a light switched, a reading checked\), suggest a tile for it with suggest_tile, /);
  assert.match(review.stdin, /<\/api-calls>\nYour tiles already on the Board: "Today"\.\nYour suggestions still waiting: "Shopping"\./);
  assert.doesNotMatch(review.stdin, OLD);
  assert.doesNotMatch(review.system, OLD);
  await srv.finished(started.data.run.id);
});

// ---------- the server's errors ----------

test('the errors name the Board and get_board', async (t) => {
  const unknown = await srv.asChief('/dashboard/tiles/t_nope', { method: 'PUT', body: { title: 'Lamp' } });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.data.error, 'No tile with id t_nope. Use get_board to see them.');

  const picture = await srv.api('/dashboard/tiles/t_nope/image/camera');
  assert.equal(picture.status, 404);
  assert.equal(picture.data.error, 'No cached picture. Refresh the Board first.');

  const bot = await makeBot(srv, { name: 'Light Keeper', emoji: '💡' });
  const { rec, token } = await heldRun(srv, bot);
  t.after(() => { srv.unhold(); srv.release(rec); });
  assert.equal((await self(srv, token, 'tile', { id: 'Lamp', value: 'on' })).data.error, 'You have no tiles to fill on the Board.');
  const lamp = await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'note', title: 'Lamp' } });
  assert.equal(lamp.status, 201, JSON.stringify(lamp.data));
  assert.equal((await self(srv, token, 'suggest', { tile: { kind: 'note', title: 'Lamp' }, reason: 'You ask for it often.' })).data.error, "It's already on the Board.");
  srv.unhold(); srv.release(rec);

  // Tiles until it is full.
  const added = [];
  let refused = null;
  for (let n = (await srv.api('/dashboard?quiet')).data.tiles.length; n <= 60 && !refused; n++) {
    const r = await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'note', title: `Filler ${n}` } });
    if (r.status === 201) added.push(r.data.id); else refused = r;
  }
  assert.equal((await srv.api('/dashboard?quiet')).data.tiles.length, 60);
  assert.equal(refused?.status, 400);
  assert.equal(refused.data.error, 'The Board is full (60 tiles). Remove some first.');
  for (const id of added) await srv.api(`/dashboard/tiles/${id}`, { method: 'DELETE' });
});

// ---------- the web page ----------

const app = webSource();
const css = source('public/style.css');
// A part of app.js, from one line of it up to another.
const cut = (from, to) => {
  const a = app.indexOf(from), b = app.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `app.js has "${from}" … "${to}"`);
  return app.slice(a, b);
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shown = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const EMPTY_STRIP = 'Board · Nothing on it yet›';

// dashStrip() of app.js, run against a stand-in state: what the list shows above the Chief of Staff.
function strip(dash, view = 'chief') {
  const page = vm.createContext({ ...words, esc, state: { dash, view }, tintOf: (c) => c || 'var(--c)' });
  vm.runInContext(`${cut('// The tiles of the Board that', '// The tiles that don\'t fit whole')}\nthis.dashStrip = dashStrip;`, page);
  return page.dashStrip();
}
const note = (fields) => ({ id: 't1', kind: 'note', title: 'Shopping', parent: null, approved: true, look: { dot: null, short: '' }, ...fields });

test('web: the list shows no strip before the Board has loaded, and none while searching', () => {
  assert.equal(strip(undefined), '');
  assert.equal(strip(null), '');
  assert.ok(app.includes('if (!q) items.push(dashStrip());'), 'drawContacts leaves it out while the search box has text');
});

test('web: with no tile to show, the strip reads "Board · Nothing on it yet" and opens the Board', () => {
  for (const [what, tiles] of [
    ['zero tiles', []],
    ['a tile whose script waits for the OK', [note({ approved: false })]],
    ['only tiles inside a group', [note({ parent: 't0' })]],
  ]) {
    const html = strip({ sections: [], tiles, pending: [], suggestions: [] });
    assert.equal(shown(html), EMPTY_STRIP, what);
    assert.match(html, /^<button class="dash-strip " data-contact="dashboard" title="Board">/, 'the same strip button, which the list opens the Board with');
    assert.match(html, /<span class="tiles"><span class="none"><b>Board<\/b> · Nothing on it yet<\/span><\/span><span class="more">›<\/span><\/button>$/);
    assert.doesNotMatch(html, /class="[^"]*\bcontact\b/, 'never a contact row');
  }
  assert.match(strip({ tiles: [] }, 'dashboard'), /^<button class="dash-strip active" /, 'marked while the Board is open');
  // Its two parts: the name in the text colour, the rest muted as the strip is; one line, never cut by fitStrip.
  assert.match(css, /\.dash-strip \{[^}]*\bcolor: var\(--muted\);/);
  assert.match(css, /\.dash-strip \.tiles \{[^}]*overflow: hidden; white-space: nowrap;/);
  assert.match(css, /\.dash-strip \.none \{ flex: none; \}/);
  assert.match(css, /\.dash-strip \.none b \{ color: var\(--text\); font-weight: 600; \}/);
  assert.doesNotMatch(cut('function fitStrip() {', 'new ResizeObserver(() => fitStrip())'), /empty|none/, 'fitStrip hides tiles only');
});

test('web: with tiles the strip is as before, and its hover title reads "Board"', () => {
  const html = strip({ tiles: [
    note({ title: 'Shopping' }),
    note({ id: 't2', kind: 'value', title: 'Temp <3', look: { dot: { filled: true, color: 'ok' }, short: '21.5 °C' } }),
    note({ id: 't3', kind: 'switch', title: 'Lamp', look: { dot: { filled: false }, short: '' } }),
    note({ id: 't4', title: 'Hidden', parent: 't9' }),
    note({ id: 't5', title: 'Waiting', approved: false }),
  ] });
  assert.match(html, /^<button class="dash-strip " data-contact="dashboard" title="Board">/);
  assert.equal(shown(html), 'ShoppingTemp &lt;3 21.5 °CLamp›');
  assert.ok(html.includes('<span class="tiles"><span class="t"><i style="--c:var(--c)"></i>Shopping</span><span class="t"><i style="--c:ok"></i>Temp &lt;3 <b>21.5 °C</b></span><span class="t"><i class="off" style="--c:var(--c)"></i>Lamp</span></span><span class="more">›</span></button>'), html);
  assert.doesNotMatch(html, /Nothing on it yet|class="none"|Hidden|Waiting/);
});

test('web: the empty page is headed "Board" and teaches in two lines, with suggestions under them', () => {
  const page = cut('function renderDashboard() {', '// A tile a bot suggested');
  assert.ok(page.includes("<h1>${tr('Board')}</h1>"));
  const empty = page.slice(page.indexOf('<div class="dash-empty">'), page.indexOf('</div>`}', page.indexOf('<div class="dash-empty">')));
  assert.deepEqual(empty.match(/<p>.*<\/p>/g), [
    "<p>${tr('Tiles for the things you use most: a light switch, the temperature, a shopping list, a morning summary.')}</p>",
    "<p>${tr('Nothing is on it yet. Tell the Chief or any bot, for example: {example}', { example: `<i>${tr('“Put a shopping list on my board.”')}</i>` })}</p>",
  ]);
  assert.match(page, /\$\{d\.tiles\.length \? '' : `<div class="dash-empty">/, 'only with zero tiles');
  assert.ok(page.indexOf(`<h3 class="dash-sec">${'$'}{tr('Suggested')}</h3>`) > page.indexOf('<div class="dash-empty">'), 'what bots suggested comes after the two lines');
  assert.match(css, /\.dash-empty i \{ color: var\(--text\); font-style: normal; \}/, 'the example in the text colour');
});

test("web: the cards, the answered label and the confirmation say \"your Board\"", () => {
  assert.equal(times(app, /tr\('Put “\{title\}” on your Board\?', \{ title: esc\(t\.title\) \}\)/), 1, 'a suggested tile');
  assert.equal(times(app, /title: tr\('Put “\{title\}” on your Board\?', \{ title: t\.title \}\)/), 1, 'a tile whose script waits: its card\'s title, escaped where it is drawn (tileCard)');
  assert.ok(app.includes("if (x.kind === 'tilesug') return yes ? tr('On your Board') : tr('Not added');"));
  assert.ok(app.includes("confirm(tr('Remove “{title}” from your Board?', { title: t.title }))"));
  assert.doesNotMatch(app, /your dashboard/i);
  assert.doesNotMatch(app, />Dashboard</);
  assert.doesNotMatch(app, /title="Dashboard"/);
});

// ---------- the docs and the descriptions ----------

test('the docs: the user guide section "Board", the API section "The Board", and the terms Board and Tile', () => {
  assert.match(source('README.md'), /^A messenger-style app for a team of \*\*bots\*\*\./m);
  const readme = source('README.md') + '\n' + source('docs/user-guide.md');
  assert.match(readme, /\n## Board\n\nThe \*\*Board\*\* is a page of tiles for the things you use most: [^.]+\. The strip at the top of the sidebar \(and of the Android list\), above the Chief of Staff, shows its tiles' names and values and opens it\./);
  assert.match(readme, /While the Board is empty, the strip reads "Board · Nothing on it yet", and the page says in two lines what it is for and what to tell the Chief or a bot\./);
  assert.match(readme, /The Chief follows its skill `chief:board`\./);
  assert.doesNotMatch(readme, /Dashboard row|Drag the (Dashboard|Board)/);
  assert.deepEqual(readme.split('\n').filter((line) => OLD.test(line.replace(/Composio('s)? dashboard|data\/dashboard\.json|lib\/dashboard\.js/g, ''))), [], 'neither botdot, the web page nor the Board is called a dashboard');

  const api = source('docs/api.md');
  assert.match(api, /\n## The Board\n\nThe owner's page of tiles\. Its paths \(`\/api\/dashboard…`\), its feed event \(`dashboard`\) and its data file \(`data\/dashboard\.json`\) keep its earlier name, `dashboard`\.\n/);
  assert.doesNotMatch(api, /the dashboard/i);

  const context = source('CONTEXT.md');
  assert.match(context, /^# botdot\n\nA messenger-style app for a team of AI bots, run by a Chief of Staff\. /);
  // Needs you is followed by what waits in it and what follows its answer (Card and Carry on, Milestone 6), then the Board.
  assert.ok(context.includes([
    '_Avoid_: resume (a Claude session is resumed), retry, rerun',
    '',
    '**Board**:',
    'The owner\'s one page of tiles for the things they use most, under short headings. The Chief of Staff builds it by chat, and any bot may suggest a tile for it. The list shows it as one strip above the Chief of Staff: its tiles\' names and values, or "Nothing on it yet"; the keypad as one line of the same above its pages. Its API paths, feed event and data file keep its earlier name, `dashboard`.',
    '_Avoid_: dashboard, home, panel',
    '',
    '**Tile**:',
    'One thing on the Board: a switch, a button, a value, a list, a note, a group of tiles, a bot\'s page, or one built from blocks. A tile with a source belongs to a bot, whose saved logins and workspace it uses.',
    '_Avoid_: card (a card waits in Needs you), widget',
    '',
  ].join('\n')), 'Board and Tile, after Needs you and its two terms');
  assert.ok(context.indexOf('**Needs you**:') < context.indexOf('**Card**:') && context.indexOf('**Card**:') < context.indexOf('**Carry on**:') && context.indexOf('**Carry on**:') < context.indexOf('**Board**:'), 'Needs you, Card, Carry on, Board');
  assert.equal(context.split('\n').filter((line) => OLD.test(line)).length, 4, 'the earlier name: where the term records it, its Avoid line, and the Avoid lines of the Admin page (ADR 028) and the Keypad (ADR 029)');
});

test('package.json and the server describe botdot without the earlier name', () => {
  assert.equal(JSON.parse(source('package.json')).description, 'botdot server: a team of headless Claude Code bots, run by a Chief of Staff');
  assert.match(source('server.js'), /^#!\/usr\/bin\/env node\n\/\/ bot-dot: a messenger-style app for a team of headless Claude Code bots\.\n/);
});

// What is left of the earlier name in the server, the web page and the skill is an identifier: an API path, the
// feed event, the data file, a file, function, variable, view or CSS name. Every other line is named here.
test('the server, the web page and the skill say "dashboard" only as an identifier', () => {
  const IDENTIFIERS = [
    /\/dashboard\b/g, /\bdashboard\\?\//g, /\|dashboard\|/g, // the API paths, also in the access rules
    /\| dashboard \|/g, // the view, in app.js's list of views
    /\bdashboard\.(json|js)\b/g, // the data file, lib/dashboard.js
    /(['"`])dashboard\1/g, // the view, the feed event, data-contact
    /[#-]dashboard\b/g, // the address #dashboard, the id view-dashboard
    /\b(dashboardOf|dashboardNote|dashboardNoteForReview|renderDashboard)\b/g,
    /\bdashboard\.[a-zA-Z]+\(/g, /\bconst dashboard = /g, // server.js: the module and its calls
  ];
  const prose = (line) => IDENTIFIERS.reduce((rest, re) => rest.replace(re, ''), line);
  const files = ['server.js', ...['lib', 'lib/routes', 'public'].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => /\.(js|html|css|json)$/.test(f)).map((f) => `${d}/${f}`)), 'chief-skills/skills/board/SKILL.md', 'chief-skills/skills/memory-setup/SKILL.md'];
  const left = files.flatMap((file) => source(file).split('\n').filter((line) => OLD.test(prose(line))).map((line) => `${file}: ${line.trim()}`));
  const COMPOSIO = /Composio(\\?'s)? dashboard|Composio account, for its dashboard|^lib\/connectors\.js: \/\/ dashboard, else Composio's own login/; // Composio's own page
  assert.deepEqual(left.filter((line) => !COMPOSIO.test(line) && !line.includes(EARLIER_NAME)), []);
  assert.equal(left.filter((line) => line.includes(EARLIER_NAME)).length, 1, "the Chief's one sentence");
});

test('web: the Board is looked at again on its own, so a tile\'s "5 minutes ago" moves on: every minute away from it, every 15 s on it, and at once on coming back to the page', () => {
  const calls = [];
  let tick = null, onVisible = null;
  const document = { hidden: false, addEventListener: (type, fn) => { if (type === 'visibilitychange') onVisible = fn; } };
  const page = vm.createContext({
    state: { view: 'chief' }, document, loadDash: (quiet = false) => calls.push(quiet),
    setInterval: (fn, ms) => { assert.equal(ms, 15_000); tick = fn; },
  });
  vm.runInContext(cut("// While it's on screen, the stale tiles are read again", 'const LEVEL = {'), page);
  for (let i = 0; i < 8; i++) tick();
  assert.deepEqual(calls, [true, true], 'away from the Board: a quiet look once a minute');
  calls.length = 0;
  page.state.view = 'dashboard';
  tick();
  assert.deepEqual(calls, [false], 'on the Board: its stale tiles are read again');
  calls.length = 0;
  document.hidden = true;
  for (let i = 0; i < 8; i++) tick();
  onVisible();
  assert.deepEqual(calls, [], 'nothing while the page is hidden');
  document.hidden = false;
  onVisible();
  page.state.view = 'chief';
  onVisible();
  assert.deepEqual(calls, [false, true], 'back on the page: at once');
});
