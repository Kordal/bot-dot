// The skill kit:pages (#398): how a bot or the Chief builds a page from blocks. It ships in bot-skills/ with the image,
// every bot that uses skills loads it (unless it is switched off for that bot), the Chief loads it for a page, its
// examples draw with no block that cannot be drawn, and it names only tools a bot or the Chief has.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { startServer, makeBot, waitFor, ROOT } = require('./helpers');
const { esc, words } = require('./web-page');
const { parseSkillMd, kitSkills, KIT_DIR } = require('../lib/skills');
const { chiefSkills } = require('../lib/chief');
const { TOOLS: CHIEF_TOOLS } = require('../lib/mcp-server');
const pb = require('../lib/page-blocks');

const FILE = path.join(ROOT, 'bot-skills', 'skills', 'pages', 'SKILL.md');
const skill = () => fs.readFileSync(FILE, 'utf8');
// The complete pages in the skill: each in a ````markdown fence.
const examples = () => [...skill().matchAll(/^````markdown\n([\s\S]*?)\n````$/gm)].map((m) => m[1]);

// The tiles the live example binds to, as the Board hands them to a page (lib/dashboard.js forPage).
const tile = (id, title, value, history) => ({ tile: { id, title, reads: {} }, data: { value }, history: { value: history }, times: { value: history.map((_, i) => i + 1) } });
const TILES = [
  tile('t_disk', 'Disk', 71, [64, 66, 69, 71]),
  tile('t_mem', 'Memory', 48, [52, 50, 48]),
  tile('t_load', 'Load', 0.4, [0.9, 0.6, 0.4]),
  tile('t_backup', 'Last backup', '2026-10-22T06:43:00Z', []),
];
const board = { tile: (ref) => TILES.find((t) => t.tile.id === ref || t.tile.title.toLowerCase() === String(ref).toLowerCase()) || null };

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

test('the skill parses, is named pages, ships as the plugin "kit" and is listed among the Chief\'s skills', () => {
  const { meta, body } = parseSkillMd(skill());
  assert.equal(meta.name, 'pages');
  assert.match(meta.description, /page/);
  assert.match(meta.description, /overview/);
  assert.ok(meta.description.length <= 200, 'short: every bot is told it with each run');
  assert.match(body, /^# /m);
  assert.equal(JSON.parse(fs.readFileSync(path.join(KIT_DIR, '.claude-plugin', 'plugin.json'), 'utf8')).name, 'kit');
  assert.deepEqual(kitSkills().map((k) => k.name), ['pages']);
  assert.deepEqual(kitSkills(['pages']), [], 'switched off by its name');
  assert.deepEqual(kitSkills(['kit:pages']), [], 'or by its full name');
  assert.ok(chiefSkills().some((x) => x.startsWith('- kit:pages: ')));
  assert.match(fs.readFileSync(path.join(ROOT, '.dockerignore'), 'utf8'), /^!bot-skills\/$/m, 'it goes into the image');
});

test('its examples draw with every block: no block that cannot be drawn, on the server and on the web page', () => {
  const pages = examples();
  assert.equal(pages.length, 3, 'a project overview, a server status page and a weekly report');
  const ctx = vm.createContext({ ...words, esc, md: (s) => `<p>${esc(s)}</p>`, $$: () => [], $: () => null });
  vm.runInContext(`${fs.readFileSync(path.join(ROOT, 'public', 'blocks.js'), 'utf8')}\nthis.pageHTML = pageHTML;`, ctx);
  for (const [i, md] of pages.entries()) {
    assert.deepEqual(pb.inspect(md, board).problems, [], `example ${i + 1}`);
    const { parts } = pb.render(md, board);
    const blocks = parts.filter((p) => p.block).map((p) => p.block);
    assert.ok(blocks.length >= 4, `example ${i + 1} is built from blocks`);
    assert.equal(blocks[0].type, 'hero', `example ${i + 1} opens with a hero`);
    assert.ok(blocks.every((b) => b.type !== 'error'), `example ${i + 1}: ${JSON.stringify(blocks.filter((b) => b.type === 'error'))}`);
    assert.doesNotMatch(ctx.pageHTML(parts), /could not be drawn/, `example ${i + 1} on the web page`);
    assert.doesNotMatch(pb.plain(md, board), /could not be drawn/, `example ${i + 1} as text`);
  }
  // The live one reads its tiles: their values, recent values and change.
  const { parts, tiles } = pb.render(pages[1], board);
  assert.deepEqual(tiles.sort(), ['t_backup', 't_disk', 't_load', 't_mem']);
  const disk = parts.find((p) => p.block?.type === 'grid' && p.block.blocks[0].type === 'kpi').block.blocks[0];
  assert.equal(disk.text, '71');
  assert.deepEqual(disk.points, [64, 66, 69, 71]);
  assert.equal(disk.delta.good, false, 'more disk use is bad news');
});

test('the skill names only tools a bot or the Chief has, and is plain', () => {
  const selfTools = fs.readFileSync(path.join(ROOT, 'lib', 'self-mcp.js'), 'utf8');
  const computerTools = fs.readFileSync(path.join(ROOT, 'lib', 'computer-mcp.js'), 'utf8');
  const has = (name) => CHIEF_TOOLS.some((t) => t.name === name) || selfTools.includes(`name: '${name}'`) || computerTools.includes(`name: '${name}'`);
  const named = [...new Set([...skill().matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]))];
  for (const name of ['save_page', 'suggest_tile', 'add_tile', 'start_interactive_page', 'publish_interactive_page']) assert.ok(named.includes(name), name);
  assert.deepEqual(named.filter((n) => !has(n)), []);
  const text = skill();
  assert.doesNotMatch(text, /—/, 'no em dashes');
  assert.doesNotMatch(text, /dashboard/i, 'the Board is the word');
  // HTML only where it belongs: the interactive pages' section, which names the kit's elements (#400).
  assert.doesNotMatch(text.replace(/^## Interactive pages[\s\S]*?(?=^## )/m, ''), /<[a-z]+[ >]/i, 'no HTML in the blocks\' part');
});

test("a bot's run loads kit:pages and is told it has it; one with it switched off does not", async () => {
  const bot = await makeBot(srv, { name: 'Page Maker' });
  srv.reply('Done.');
  await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Make me an overview page' } });
  const run = await srv.nextRun((x) => x.args.includes(`${bot.emoji} ${bot.name}`), 'the bot\'s run');
  assert.ok(run.skills.includes('kit:pages'), `loaded: ${run.skills}`);
  assert.equal(run.pluginReadable, true);
  assert.match(run.system, /Skills you have \(load one with the Skill tool when it fits the task\):\n- kit:pages: Build a page/);
  await waitFor(async () => !(await srv.api(`/bots/${bot.id}`)).data.running, { what: 'the run to end' });

  await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { disabledSkills: ['kit:pages'] } });
  srv.reply('Done.');
  await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Again' } });
  const off = await srv.nextRun((x) => x.args.includes(`${bot.emoji} ${bot.name}`), 'the bot\'s second run');
  assert.ok(!off.skills.includes('kit:pages'));
  assert.doesNotMatch(off.system, /- kit:pages:/);
});

test("the Chief loads kit:pages and is told to use it when asked for a page or an overview", async () => {
  srv.reply('Done.');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Make me an overview of my servers.' } });
  const turn = await srv.nextRun((r) => !!r.botdot, "the Chief's turn");
  await waitFor(async () => !(await srv.api(`/chief/chats/${chat.id}`)).data.busy, { what: 'the Chief to reply' });
  assert.ok(turn.skills.includes('kit:pages') && turn.skills.includes('chief:board'), `loaded: ${turn.skills}`);
  assert.match(turn.system, /When the user asks for a page, an overview, a report or a status page, or to change one of your pages, load your skill kit:pages with the Skill tool and follow it/);
});
