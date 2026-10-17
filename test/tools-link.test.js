// A tool from a link (lib/tools.js, lib/tools-link.js, ADR 007): for a tool the registry does not have, the
// Chief asks with a link and the command's name, botdot downloads that one file to note its checksum, the card
// warns and says whose link it is, and Install places exactly that file. The links lead to a file server of
// the test's own (link-helpers.js); the stranger's files themselves are in tools-link-files.test.js. As in
// tools.test.js the installer runs as the tests' own user; what needs the tools user is in privilege-broker.test.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { startServer, makeBot, waitFor } = require('./helpers');
const { rpcClient } = require('./memory-helpers');
const { sha, elf, script, tarGz, zip, fileServer, OTHER_MACHINE } = require('./link-helpers');

let srv, files, dir, cache, env, coder, runner, reader, chat, ran;

const toolsJson = (s = srv) => { try { return JSON.parse(fs.readFileSync(path.join(s.data, 'tools.json'), 'utf8')); } catch { return { bots: {} }; } };
const installed = (bot, name) => toolsJson().bots[bot.id]?.[name] || null;
const auditLog = () => { try { return fs.readFileSync(path.join(srv.data, 'audit.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map(({ time, ...l }) => l); } catch { return []; } };
const folder = (bot) => path.join(srv.data, 'tools', bot.id);
const listing = (at) => (fs.existsSync(at) ? fs.readdirSync(at, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [`${e.name}/`, ...listing(path.join(at, e.name)).map((x) => `${e.name}/${x}`)] : [e.name])).sort() : null);
const cards = async () => (await srv.api('/asks')).data;
const askLink = (bot, link, command, more = {}, chatId = chat.id) => srv.asChief('/asks', { method: 'POST', body: { kind: 'tool', bot: bot.id, link, command, reason: 'It needs it for the work.', chatId, ...more } });
const answer = (id, yes) => srv.api(`/asks/${id}`, { method: 'POST', body: { yes } });
const chiefTurn = (re) => srv.nextRun((r) => r.botdot && re.test(r.stdin), `a Chief turn about ${re}`);
const quiet = () => waitFor(async () => (await srv.api('/chief')).data.busy === false, { what: 'the Chief to finish' });
// The owner writes in a Chief chat, and the Chief has replied.
async function say(text, chatId = chat.id) {
  const sent = await srv.api(`/chief/chats/${chatId}/messages`, { method: 'POST', body: { text } });
  assert.ok(sent.status < 300, JSON.stringify(sent.data));
  const turn = await srv.nextRun((r) => r.botdot && r.stdin.includes(text), 'the Chief turn');
  await quiet();
  return turn;
}
async function install(card) {
  assert.deepEqual((await answer(card.id, true)).data, { ok: true, installing: true });
  const turn = await chiefTurn(new RegExp(`Installed: ${card.tool.name}`));
  await quiet();
  return turn;
}
const start = async () => { srv = await startServer({ dir, env }); };

// The three forms a link can lead to. The scripts leave a line in `ran` when something starts them.
const STRIPE = '/stripe/stripe-cli/releases/download/v1.31.0/stripe_1.31.0_linux.tar.gz';
const stripeFile = (says = 'stripe 1.31.0') => tarGz([
  { name: 'stripe_1.31.0/', type: '5' },
  { name: 'stripe_1.31.0/install.sh', data: script('the installer', ran), mode: 0o755 },
  { name: 'stripe_1.31.0/stripe', data: script(says, ran), mode: 0o755 },
  { name: 'stripe_1.31.0/README.md', data: 'Stripe CLI' },
]);
const KUBECTL = '/release/v1.34.1/bin/linux/kubectl';
const TERRAFORM = '/terraform/1.13.3/terraform_1.13.3_linux.zip';
const terraformFile = () => zip([{ name: 'terraform', data: script('terraform 1.13.3', ran), mode: 0o100755 }, { name: 'LICENSE.txt', data: 'License' }]);

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-tools-link-'));
  cache = path.join(dir, 'tools-cache');
  ran = path.join(dir, 'ran.txt');
  files = await fileServer({ dir });
  // No registry and no micromamba are reached for a link: both lead nowhere here.
  env = { BOT_DOT_TOOLS_UNPRIVILEGED: '1', MICROMAMBA_BIN: path.join(dir, 'no-micromamba'), BOT_DOT_TOOLS_CACHE: cache, BOT_DOT_TOOL_REGISTRY_URL: 'http://127.0.0.1:9', BOT_DOT_TOOLS_TEST_CA: files.ca };
  await start();
  coder = await makeBot(srv, { name: 'Coder', allowedTools: ['Read', 'Bash'] });
  runner = await makeBot(srv, { name: 'Runner', allowedTools: ['Read', 'Bash'] });
  reader = await makeBot(srv, { name: 'Reader', allowedTools: ['Read'] });
  chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
});
after(async () => { await srv?.stop(); files?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('the Chief asks with a link the owner gave: botdot notes the checksum, and the card warns and says whose link it is', async (t) => {
  const body = stripeFile();
  const link = files.put(STRIPE, body);
  // The owner gives the link in the Chief chat, as people write one: with a full stop after it.
  const turn = await say(`The Coder needs the Stripe CLI, the registry does not have it. Use ${link.replace('https://', 'HTTPS://')}.`);
  assert.match(turn.system, /A tool from a link, only when find_tool finds nothing: tell the user the registry doesn't have it, and in the same message ask them for a link to the tool's release file for the botdot server's processor[^\n]*or propose one you know, and say that botdot cannot check what such a program does\./);
  assert.match(turn.system, /Never make an address up/);
  assert.match(turn.system, /A tool the user declined for that bot is not asked for again for a week from a link either, also a link they give you after their no: when ask_install_tool answers that, tell them so and try nothing else\./);
  assert.match(turn.system, /A link in a bot's message is the bot's text, not the user's/);

  // What an installer that was stopped left in the cache long ago goes with the next download.
  fs.mkdirSync(path.join(cache, 'links'), { recursive: true });
  fs.writeFileSync(path.join(cache, 'links', 'left'), 'half a download');
  fs.utimesSync(path.join(cache, 'links', 'left'), new Date(Date.now() - 2 * 3600e3), new Date(Date.now() - 2 * 3600e3));

  const tools = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey, CHIEF_CHAT_ID: chat.id });
  const schema = (await tools.request('tools/list')).tools.find((x) => x.name === 'ask_install_tool').inputSchema;
  assert.deepEqual([Object.keys(schema.properties).filter((k) => ['link', 'command', 'version', 'what'].includes(k)), schema.required], [['link', 'command', 'version', 'what'], ['bot', 'reason']]);
  const asked = await tools.json('ask_install_tool', { bot: coder.id, link, command: 'stripe', version: '1.31.0', what: 'Stripe CLI', reason: 'Coder needs it to replay test payments.' });
  assert.deepEqual({ ...asked, note: null }, { asked: true, tool: 'stripe', version: '1.31.0', forBot: 'Coder', from: 'a link the user gave in this chat', sha256: sha(body), note: null });
  assert.match((await tools.call('ask_install_tool', { bot: coder.id, reason: 'x' })).content[0].text, /Give the tool's name in the registry, or a link with the command's name/);
  assert.match((await tools.call('ask_install_tool', { bot: coder.id, link, reason: 'x' })).content[0].text, /give the command's name too/);

  const [card] = await cards();
  assert.equal(card.kind, 'tool');
  assert.equal(card.title, 'Install stripe for Coder?');
  assert.equal(card.meta, 'from a link you gave · asked by the Chief');
  assert.equal(card.body, 'Stripe CLI, as described on its page. botdot has not checked what this program does.\n\nWhy: Coder needs it to replay test payments.');
  assert.equal(card.warning, 'Not from the approved list. Make sure you trust the source.');
  assert.deepEqual(card.facts, [
    { label: 'Version', value: '1.31.0' },
    { label: 'Source', value: `${files.host}/stripe/stripe-cli/releases/download/v1.31.0` },
    { label: 'File', value: 'stripe_1.31.0_linux.tar.gz' },
    { label: 'Checksum', value: `sha256 ${sha(body).slice(0, 4)}…${sha(body).slice(-4)}` },
    { label: 'Size', value: '1 kB' },
    { label: 'Runs as', value: 'Coder only' },
  ]);
  assert.deepEqual(card.tool.source, { type: 'link', url: link, sha256: sha(body), command: 'stripe', from: 'owner' });
  assert.equal(card.tool.size, body.length);
  assert.equal(card.tool.packages, undefined);

  // Downloaded once, by the installer, and not kept; nothing is installed and nothing from the file was started.
  assert.equal(files.asked(STRIPE), 1);
  assert.deepEqual(listing(path.join(cache, 'links')), []);
  assert.equal(listing(folder(coder)), null);
  assert.deepEqual(toolsJson(), { bots: {} });
  assert.ok(!fs.existsSync(ran), 'nothing from the file ran');
  // The same ask twice is one card, and the file is not fetched again for it.
  assert.equal((await askLink(coder, link, 'stripe')).data.id, card.id);
  assert.equal((await cards()).length, 1);
  assert.equal(files.asked(STRIPE), 1);
  // Another link for the same command while that card waits: the owner answers the first one.
  assert.match((await askLink(coder, files.put('/other/stripe', elf()), 'stripe')).data.error, /A card for stripe for Coder waits in Needs you already, for another file than this one \(from a link\)/);
});

test('a link the owner did not write in that chat is the Chief\'s: the card says the Chief proposed it', async () => {
  const body = elf();
  const link = files.put(KUBECTL, body);
  // No version and no description given: the card has no Version row, and says only what botdot can say.
  const a = await askLink(runner, link, 'kubectl', { reason: 'Runner needs it to look at the cluster.' });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.equal(a.data.meta, 'from a link the Chief proposed · asked by the Chief');
  assert.equal(a.data.body, 'botdot has not checked what this program does.\n\nWhy: Runner needs it to look at the cluster.');
  assert.equal(a.data.warning, 'Not from the approved list. Make sure you trust the source.');
  assert.deepEqual(a.data.facts.map((f) => f.label), ['Source', 'File', 'Checksum', 'Size', 'Runs as']);
  assert.deepEqual(a.data.facts.slice(0, 2), [{ label: 'Source', value: `${files.host}/release/v1.34.1/bin/linux` }, { label: 'File', value: 'kubectl' }]);
  assert.equal(a.data.tool.source.from, 'chief');

  // The owner's link counts in the chat they wrote it in, and only as they wrote it.
  const other = (await srv.api('/chief/chats', { method: 'POST' })).data;
  const stripe = `${files.origin}${STRIPE}`;
  const elsewhere = await askLink(runner, stripe, 'stripe', {}, other.id);
  assert.equal(elsewhere.data.meta, 'from a link the Chief proposed · asked by the Chief', 'the owner wrote it in another chat');
  await answer(elsewhere.data.id, false);
  assert.deepEqual(auditLog().at(-1), { actor: 'owner', action: 'tool.declined', bot: runner.id, tool: 'stripe', sha256: elsewhere.data.tool.source.sha256 });
  // The owner's no stands for a week, whatever names the tool next: the Chief's link again, the registry's name …
  const declined = /The owner declined stripe for Runner on \d{4}-\d\d-\d\d\. botdot doesn't ask for it again for a week\./;
  assert.match((await askLink(runner, stripe, 'stripe', {}, other.id)).data.error, declined);
  assert.match((await srv.asChief('/asks', { method: 'POST', body: { kind: 'tool', bot: runner.id, name: 'stripe', reason: 'x', chatId: other.id } })).data.error, declined);
  // … and a link the owner writes themselves after that no: the Chief gets the reason, nothing is fetched and no card appears.
  await say(`Take ${stripe} for the Runner after all.`, other.id);
  const fetched = files.asked(STRIPE);
  const own = await askLink(runner, stripe, 'stripe', {}, other.id);
  assert.equal(own.status, 400, JSON.stringify(own.data));
  assert.match(own.data.error, declined);
  assert.equal(files.asked(STRIPE), fetched, 'the file is not fetched for it');
  assert.ok(!(await cards()).some((c) => c.botId === runner.id && c.tool.name === 'stripe'), 'no card');
  // A week later it can be asked again, and the link is the one the owner wrote in this chat.
  const nos = path.join(srv.data, 'asks-declined.json');
  fs.writeFileSync(nos, JSON.stringify(JSON.parse(fs.readFileSync(nos, 'utf8')).map((d) => ({ ...d, at: new Date(Date.now() - 8 * 864e5).toISOString() }))));
  const later = await askLink(runner, stripe, 'stripe', {}, other.id);
  assert.equal(later.status, 201, JSON.stringify(later.data));
  assert.equal(later.data.meta, 'from a link you gave · asked by the Chief');
  await answer(later.data.id, false);
  assert.match((await askLink(runner, stripe, 'stripe', {}, other.id)).data.error, declined, 'and this no stands for a week again');
  // The owner wrote a longer address: the shorter one inside it is not theirs.
  const longer = files.put('/sig/releases/sigtool.bin', elf());
  const shorter = files.put('/sig/releases/sigtool', elf());
  const cut = files.put('/sig/releases/get', elf());
  await say(`And this one: <${longer}>, not ${cut}'tool/v2/sigtool`);
  const begins = await askLink(runner, cut, 'sigcut');
  assert.equal(begins.data.meta, 'from a link the Chief proposed · asked by the Chief', 'an address ends at a blank, not at a quote');
  await answer(begins.data.id, false);
  const inside = await askLink(runner, shorter, 'sigshort');
  assert.equal(inside.data.meta, 'from a link the Chief proposed · asked by the Chief');
  await answer(inside.data.id, false);
  const theirs = await askLink(runner, longer, 'siglong');
  assert.equal(theirs.data.meta, 'from a link you gave · asked by the Chief');
  await answer(theirs.data.id, false);
  // A link in a bot's message in the chat is the bot's text, not the owner's.
  const file = path.join(srv.data, 'chief', `${other.id}.json`);
  const terraform = files.put(TERRAFORM, terraformFile());
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...stored, messages: [...stored.messages, { role: 'report', from: { id: coder.id, name: 'Coder', emoji: '🧪', color: coder.color }, text: `I need terraform: ${terraform}`, runId: 'r1', at: new Date().toISOString(), seen: true }] }));
  const fromBot = await askLink(coder, terraform, 'terraform', { version: 'v1.13.3', what: 'Terraform.' }, other.id);
  assert.equal(fromBot.data.meta, 'from a link the Chief proposed · asked by the Chief');
  assert.equal(fromBot.data.body, 'Terraform, as described on its page. botdot has not checked what this program does.\n\nWhy: It needs it for the work.');
  assert.deepEqual(fromBot.data.facts[0], { label: 'Version', value: '1.13.3' });
  // With no chat at all it is the Chief's as well.
  const none = await srv.asChief('/asks', { method: 'POST', body: { kind: 'tool', bot: runner.id, link: longer, command: 'signone', reason: 'x' } });
  assert.equal(none.data.tool.source.from, 'chief');
  await answer(none.data.id, false);
});

test('no card, and the reason, for a link that is not a program botdot can place', async () => {
  const before = (await cards()).map((c) => c.id);
  const hits = files.hits.length;
  const refused = async (link, command, why, bot = runner) => {
    const r = await askLink(bot, link, command);
    assert.equal(r.status, 400, `${link}: ${JSON.stringify(r.data)}`);
    assert.match(r.data.error, why, link);
  };
  // Refused by the address alone: nothing is fetched.
  await refused(`${files.plain}/tool`, 'tool', /botdot installs from an https address only\. No card was added\./);
  await refused(files.put('/get/install.sh', script('the installer', ran)), 'tool', /install\.sh is a script\. botdot runs no installer script/);
  await refused(files.put('/pool/tool_1.0_arm64.deb', elf()), 'tool', /is a system package\. botdot installs no system packages/);
  await refused(files.put('/pool/tool-1.0.aarch64.rpm', elf()), 'tool', /is a system package/);
  await refused(`${files.origin}/x/tool?download=1`, 'tool', /"\?" or "#" part/);
  await refused(files.put('/x/tool', elf()), 'Tool Name', /Give the command's name with the link/);
  await refused(`${files.origin}/x/tool`, 'tool', /Reader may not run commands/, reader);
  assert.match((await askLink(runner, `${files.origin}/x/tool`, 'tool', { version: '1; rm -rf' })).data.error, /isn't a version/);
  assert.equal(files.hits.length, hits, 'none of these was fetched');
  assert.deepEqual(files.plainHits, []);

  // Refused by what answers, or does not.
  await refused(`${files.origin}/no/such/tool`, 'tool', /The link does not answer \(HTTP 404\)\. No card was added\./);
  await refused('https://127.0.0.1:9/tool', 'tool', /The link does not answer/);
  await refused(files.put('/away/tool', '', { redirect: `${files.plain}/tool` }), 'tool', /redirects to an address that is not https/);
  assert.deepEqual(files.plainHits, [], 'the address that is not https was never asked');
  await refused(files.put('/big/tool', elf(), { says: 200 * 1024 * 1024 + 1 }), 'tool', /larger than botdot installs from a link \(200 MB\)/);
  // Refused by what the file is.
  await refused(files.put('/get/tool', script('the installer', ran)), 'tool', /The file is a script\. botdot runs no installer script/);
  await refused(files.put('/pool/tool', '!<arch>\ndebian-binary   1700000000  0     0     100644  4         `\n2.0\n'), 'tool', /system package \(\.deb\)/);
  await refused(files.put('/pool/tool2', Buffer.from([0xed, 0xab, 0xee, 0xdb, 3, 0, 0, 0])), 'tool', /system package \(\.rpm\)/);
  await refused(files.put('/other/tool', elf(OTHER_MACHINE)), 'tool', /is a program for .*; this botdot server's processor is .*\. Give the link to the release for/);
  await refused(files.put('/pack/tool.tar.gz', tarGz([{ name: 'pkg/other', data: elf(), mode: 0o755 }])), 'tool', /The archive holds no file named tool\. It has: other\./);
  await refused(files.put('/pack/tool.zip', zip([{ name: 'pkg/tool/', mode: 0o040755 }, { name: 'pkg/tool/readme', data: 'x' }])), 'tool', /The archive holds no file named tool\./);
  await refused(files.put('/pack/arch.tar.gz', tarGz([{ name: 'tool', data: elf(OTHER_MACHINE), mode: 0o755 }])), 'tool', /tool in the archive is a program for/);
  await refused(files.put('/pack/link.tar.gz', tarGz([{ name: 'tool', data: elf(), mode: 0o755 }, { name: 'latest', type: '2', linkname: 'tool' }])), 'tool', /The archive holds a link/);
  await refused(files.put('/pack/up.tar.gz', tarGz([{ name: 'tool', data: elf(), mode: 0o755 }, { name: '../up', data: 'x' }])), 'tool', /"\.\."/);

  assert.deepEqual((await cards()).map((c) => c.id), before, 'no card was added');
  assert.deepEqual(listing(path.join(cache, 'links')), [], 'and no download was kept');
  assert.ok(!fs.existsSync(ran), 'nothing from any of these files ran');
  assert.ok(!auditLog().some((l) => l.tool === 'tool'));
});

test('Install fetches the file again and places it: a program, a .tar.gz and a .zip, each as the tool\'s one command', async (t) => {
  const waiting = await cards();
  const card = (name) => waiting.find((c) => c.tool.name === name);

  // A .tar.gz, for the Coder.
  const fetched = files.asked(STRIPE);
  const turn = await install(card('stripe'));
  assert.match(turn.stdin, new RegExp(`Installed: stripe 1\\.31\\.0 for 🧪 Coder \\(bot id ${coder.id}\\)\\. Its commands: stripe\\.`));
  assert.match(turn.stdin, /It is the file from the link the user approved \(https:\/\/127\.0\.0\.1:\d+\/stripe\/.*\), not a tool from the registry\./);
  assert.equal(turn.botdot.env.CHIEF_CHAT_ID, chat.id);
  assert.equal(files.asked(STRIPE), fetched + 1, 'fetched again for the install');
  assert.deepEqual(fs.readdirSync(path.join(folder(coder), 'bin')), ['stripe'], 'the named command is its only command: not install.sh');
  assert.deepEqual(listing(path.join(folder(coder), 'stripe')), ['.botdot-tool.json', 'bin/', 'bin/stripe', 'files/', 'files/stripe_1.31.0/', 'files/stripe_1.31.0/README.md', 'files/stripe_1.31.0/install.sh', 'files/stripe_1.31.0/stripe']);
  assert.equal(fs.statSync(folder(coder)).mode & 0o777, 0o750);
  const kept = installed(coder, 'stripe');
  assert.deepEqual({ name: kept.name, version: kept.version, source: kept.source, commands: kept.commands, askedBy: kept.askedBy, list: kept.list },
    { name: 'stripe', version: '1.31.0', source: card('stripe').tool.source, commands: ['stripe'], askedBy: 'chief', list: undefined });
  assert.deepEqual(auditLog().at(-1), { actor: 'owner', action: 'tool.installed', bot: coder.id, tool: 'stripe', version: '1.31.0', sha256: kept.source.sha256 });
  // Nothing from the file was started by the ask or the install; the bot starts it, and here the test does.
  assert.ok(!fs.existsSync(ran), 'nothing from the file ran during the ask or the install');
  assert.equal(execFileSync(path.join(folder(coder), 'bin', 'stripe'), { encoding: 'utf8' }).trim(), 'stripe 1.31.0 (botdot test tool)');
  assert.equal(fs.readFileSync(ran, 'utf8'), 'stripe 1.31.0\n');
  fs.rmSync(ran);
  // Asked for again from this same file: botdot says it is there, once it has seen that it starts, as at a start.
  assert.match((await askLink(coder, `${files.origin}${STRIPE}`, 'stripe', { version: '1.31.0' })).data.error, /stripe 1\.31\.0 is already installed for Coder, from this same file/);
  assert.equal(fs.readFileSync(ran, 'utf8'), 'stripe 1.31.0\n', 'run once, as that bot, to see that it starts');
  fs.rmSync(ran);

  // A .zip, for the Coder too: two tools, two commands.
  await install(card('terraform'));
  assert.deepEqual(fs.readdirSync(path.join(folder(coder), 'bin')).sort(), ['stripe', 'terraform']);
  assert.deepEqual(listing(path.join(folder(coder), 'terraform')), ['.botdot-tool.json', 'bin/', 'bin/terraform', 'files/', 'files/LICENSE.txt', 'files/terraform']);
  assert.equal(installed(coder, 'terraform').version, '1.13.3');
  assert.ok(!fs.existsSync(ran));

  // One program file, for the Runner, with no version: the file itself is the command.
  const told = await install(card('kubectl'));
  assert.match(told.stdin, new RegExp(`Installed: kubectl for 🧪 Runner \\(bot id ${runner.id}\\)\\. Its commands: kubectl\\.`));
  assert.deepEqual(listing(folder(runner)), ['bin/', 'bin/kubectl', 'kubectl/', 'kubectl/.botdot-tool.json', 'kubectl/bin/', 'kubectl/bin/kubectl']);
  assert.deepEqual(fs.readFileSync(path.join(folder(runner), 'bin', 'kubectl')), elf());
  assert.equal(fs.statSync(path.join(folder(runner), 'kubectl', 'bin', 'kubectl')).mode & 0o777, 0o755);
  assert.deepEqual(auditLog().at(-1), { actor: 'owner', action: 'tool.installed', bot: runner.id, tool: 'kubectl', sha256: sha(elf()) });

  // The Chief lists them with where they came from, and the bot is told what it has.
  const tools = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey });
  const has = (await tools.json('list_tools', { bot: coder.id })).tools;
  assert.deepEqual(has.map((x) => [x.name, x.version, x.commands.join(), x.source.type]), [['stripe', '1.31.0', 'stripe', 'link'], ['terraform', '1.13.3', 'terraform', 'link']]);
  await srv.api(`/bots/${runner.id}/run`, { method: 'POST', body: { prompt: 'What do you have?' } });
  const mine = await srv.nextRun((r) => r.self && r.stdin.includes('What do you have?'));
  assert.match(mine.system, /Installed tools \([^)]*\): kubectl\./);
  assert.deepEqual(listing(path.join(cache, 'links')), []);
});

test('a file that changed since the owner saw the card is refused at Install: nothing is installed, and the audit log says so', async () => {
  const link = files.put('/hey/releases/hey_linux', elf(undefined, 'hey rc'));
  const a = await askLink(runner, link, 'hey', { version: '0.1.4-rc.1' });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  const approved = a.data.tool.source.sha256;
  assert.equal(approved, sha(elf(undefined, 'hey rc')));
  const was = [listing(folder(runner)), JSON.stringify(toolsJson().bots)];
  files.put('/hey/releases/hey_linux', elf(undefined, 'hey rc, changed'));
  await answer(a.data.id, true);
  const turn = await chiefTurn(/Not installed: hey 0\.1\.4-rc\.1 for 🧪 Runner/);
  assert.match(turn.stdin, /Reason: The file behind the link is not the file that was approved: its checksum differs\./);
  assert.match(turn.stdin, /Nothing was changed/);
  await quiet();
  assert.deepEqual([listing(folder(runner)), JSON.stringify(toolsJson().bots)], was, 'nothing was installed');
  assert.equal(toolsJson().installing, undefined);
  assert.deepEqual(auditLog().at(-1), { actor: 'owner', action: 'tool.failed', bot: runner.id, tool: 'hey', version: '0.1.4-rc.1', sha256: approved, cause: 'checksum' });
  assert.deepEqual(listing(path.join(cache, 'links')), []);

  // A link that no longer answers at Install fails the same way, as a network failure.
  files.put('/hey/releases/hey_linux', elf(undefined, 'hey rc'));
  const again = await askLink(runner, link, 'hey', { version: '0.1.4-rc.1' });
  files.put('/hey/releases/hey_linux', '', { redirect: `${files.origin}/gone` });
  await answer(again.data.id, true);
  assert.match((await chiefTurn(/Not installed: hey 0\.1\.4-rc\.1/)).stdin, /Reason: The link does not answer \(HTTP 404\)\./);
  await quiet();
  assert.deepEqual(auditLog().at(-1), { actor: 'owner', action: 'tool.failed', bot: runner.id, tool: 'hey', version: '0.1.4-rc.1', sha256: approved, cause: 'network' });
  assert.equal(installed(runner, 'hey'), null);
});

test('at a later start a tool from a link is installed again only when the file still has the approved checksum; otherwise the owner is told once', async () => {
  const notices = async () => (await Promise.all((await srv.api('/chief')).data.chats.map(async (c) => (await srv.api(`/chief/chats/${c.id}`)).data.messages))).flat().filter((m) => m.notice);
  const again = () => auditLog().filter((l) => l.actor === 'botdot' && l.tool === 'stripe');
  // A restore brought the list back and not the files.
  await srv.stop();
  fs.rmSync(folder(coder), { recursive: true });
  const fetched = files.asked(STRIPE);
  await start();
  await waitFor(() => fs.existsSync(path.join(folder(coder), 'bin', 'stripe')) && fs.existsSync(path.join(folder(coder), 'bin', 'terraform')), { what: 'the tools to be installed again' });
  assert.equal(files.asked(STRIPE), fetched + 1, 'fetched again');
  assert.equal(execFileSync(path.join(folder(coder), 'bin', 'stripe'), { encoding: 'utf8' }).trim(), 'stripe 1.31.0 (botdot test tool)');
  await waitFor(() => again().length === 1, { what: 'the audit line' });
  assert.deepEqual(again(), [{ actor: 'botdot', action: 'tool.installed', bot: coder.id, tool: 'stripe', version: '1.31.0', sha256: installed(coder, 'stripe').source.sha256 }]);
  assert.deepEqual((await cards()).filter((c) => c.tool?.name === 'stripe' && c.botId === coder.id), [], 'with no new card');
  assert.deepEqual(await notices(), []);

  // The same, but the file behind the link is another one now: it is not installed, and the owner is told once.
  await srv.stop();
  fs.rmSync(path.join(folder(coder), 'stripe'), { recursive: true });
  files.put(STRIPE, stripeFile('stripe 1.31.0, changed'));
  await start();
  const [said] = await waitFor(async () => { const n = await notices(); return n.length ? n : null; }, { what: 'the owner to be told' });
  assert.equal(said.text, '⚠️ stripe 1.31.0 could not be installed again for Coder: The file behind the link is not the file that was approved: its checksum differs. Coder is without it until then. Ask me to install it again when that is fixed.');
  assert.ok(!fs.existsSync(path.join(folder(coder), 'stripe')), 'the changed file is not installed');
  assert.ok(!fs.existsSync(path.join(folder(coder), 'bin', 'stripe')));
  assert.ok(fs.existsSync(path.join(folder(coder), 'bin', 'terraform')), 'its other tool is there');
  assert.equal(installed(coder, 'stripe').source.sha256, sha(stripeFile()), 'it stays on the list, with the checksum the owner approved');
  assert.deepEqual(again().at(-1), { actor: 'botdot', action: 'tool.failed', bot: coder.id, tool: 'stripe', version: '1.31.0', sha256: sha(stripeFile()), cause: 'checksum' });
  // And when the file is gone: not installed either, and the owner was told already.
  await srv.stop();
  files.drop(STRIPE);
  await start();
  await waitFor(() => again().filter((l) => l.action === 'tool.failed').length === 2, { what: 'the second try' });
  assert.equal(again().at(-1).cause, 'network');
  assert.ok(!fs.existsSync(path.join(folder(coder), 'bin', 'stripe')));
  assert.equal((await notices()).length, 1, 'once');
  // The file is the approved one again: the next start installs it, and that clears the problem.
  await srv.stop();
  files.put(STRIPE, stripeFile());
  await start();
  await waitFor(() => fs.existsSync(path.join(folder(coder), 'bin', 'stripe')) && !installed(coder, 'stripe').problem, { what: 'stripe to be back' });
  assert.ok(!fs.readFileSync(ran, 'utf8').includes('changed'), 'the changed file never ran');
});
