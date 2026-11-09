// The Play screenshots' scene (docs/google-play/README.md): a real botdot server with the tests' stand-in Claude
// (test/fixtures/fake-claude.js) and scratch data, staged as the README's screenshots are. Only the data is staged;
// every pixel is the Android app's own code (drive.cjs takes the pictures on an emulator).
// node docs/google-play/screenshots/scene.cjs <dir>: writes <dir>/scene.json ({ port, bots }) once it serves, and
// stops when <dir>/stop appears.
process.env.TZ = 'Europe/Brussels';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = fs.existsSync(path.join(process.cwd(), 'test', 'helpers.js')) ? process.cwd() : '/home/user/bot-dot';
const { startServer, makeBot, self, waitFor, writeData } = require(path.join(ROOT, 'test', 'helpers'));
const { shortName } = require(path.join(ROOT, 'public', 'mentions.js'));

const OUT = path.resolve(process.argv[2] || '.');
fs.mkdirSync(OUT, { recursive: true });
const ENV = { TZ: 'Europe/Brussels' };

// "This morning": today at 07:00 here, or yesterday's when it is not 08:00 yet.
const morning = (() => { const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1); d.setHours(7, 0, 0, 0); return d.getTime(); })();
const at = (min) => new Date(morning + min * 60_000).toISOString();
const fence = (type, v) => `\`\`\`${type}\n${JSON.stringify(v)}\n\`\`\``;

const NEWS_1 = `**Good morning! Three things worth knowing today**

1. **Rail strike called off.** The unions reached a deal late last night, so trains run as normal all week.
2. **Heat pump grants extended.** The scheme now runs until the end of March, and older homes qualify too.
3. **New Raspberry Pi announced.** Twice as fast, same size; it ships from next month.

Nothing urgent on your other topics: no storm warnings, and your football club plays on Sunday as planned.`;
const NEWS_2 = `Yes, it looks like you do. The grant now covers homes built before 2010 with an energy label of C or lower, and yours is a D.

- **What it pays for:** the heat pump and its installation.
- **Deadline:** applications close on 31 March.
- **What you need:** the installer's quote and your energy label.

Want me to remind you when the installer sends the quote?`;

const PAGE = [
  fence('hero', { eyebrow: 'Weekly report · Server Watch', title: 'Home server', lead: 'Backups, disks and updates of the last seven days. Kept up to date every Monday at 07:00.', tags: ['weekly', 'live'] }),
  fence('kpi', [
    { label: 'Uptime', value: 99.9, unit: '%', points: [99.5, 99.7, 99.6, 99.8, 99.9, 99.8, 99.9], sub: '7 days', color: 'ok' },
    { label: 'Disk', value: 62, unit: '%', max: 100, sub: '380 GB free', good: 'down' },
    { label: 'Backups', value: 7, of: 7, sub: 'all verified', change: false },
    { label: 'Updates', value: 3, sub: 'waiting for your OK', change: false, color: 'warn' },
  ]),
  fence('grid', { columns: 2, blocks: [
    { type: 'chart', title: 'CPU, last 7 days', style: 'bar', unit: '%', labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], series: [{ label: 'CPU', points: [18, 24, 22, 41, 33, 15, 19], color: '#3b82f6' }] },
    { type: 'chart', title: 'Disk by folder', style: 'hbar', unit: 'GB', bars: [{ label: 'Photos', value: 410 }, { label: 'Backups', value: 260 }, { label: 'Media', value: 180 }, { label: 'Other', value: 60 }] },
  ] }),
  '## Status',
  fence('status', [{ text: 'Backups', level: 'ok' }, { text: 'Certificates', level: 'ok' }, { text: 'Kernel update', level: 'warn' }]),
  fence('callout', { title: 'Waits for you', text: 'The kernel update needs a restart. Say **restart tonight** and I will do it at 03:00.', level: 'warn' }),
  '## This week',
  '- Nightly backups ran at 03:10 and were checked by restoring one file each.\n- The media disk went from 58% to 62% after the holiday photos were imported.\n- The certificate of the photo library renews itself on 2 December.',
].join('\n\n');

(async () => {
  let srv = await startServer({ env: ENV });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (r, what) => { if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.data)}`); return r.data; };
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    for (const e of ((await srv.api('/whats-new')).data.entries || [])) await srv.api('/whats-new/seen', { method: 'POST', body: { id: e.id } });

    // ---- the bots ----
    const bot = async (name, color, hat, description, prompt, more = {}) => {
      const b = await makeBot(srv, { name, emoji: '🤖', color, description, prompt });
      ok(await srv.api(`/bots/${b.id}`, { method: 'PUT', body: { outfit: { hat }, ...more } }), `bot ${name}`);
      return b;
    };
    const news = await bot('News Monitor', '#378add', 'cap', 'Morning news on the topics you follow.', 'Every morning, read the news on my topics and send me the three things worth knowing.', { pinned: 1 });
    const home = await bot('Home Helper', '#1d9e75', 'beanie', 'Lights, heating and the house.', 'Look after the lights, the heating and the thermostats of the house.', { pinned: 2 });
    const inbox = await bot('Inbox Triage', '#7f77dd', 'top-hat', 'Sorts the mail, drafts the answers.', 'Read my new mail, tell me which need an answer and draft them.', { group: 'Daily' });
    const plan = await bot('Weekly Planner', '#ef9f27', 'graduate', 'Plans the week from the calendar.', 'Plan my week from the calendar and the to-dos.', { group: 'Daily' });
    const recipe = await bot('Recipe Finder', '#d4537e', 'chef', 'Dinner ideas from what is in the fridge.', 'Suggest three dinners from what is in the fridge.', { group: 'Home' });
    const watch = await bot('Server Watch', '#d85a30', 'hard-hat', 'Backups, disks and updates of the home server.', 'Watch the home server: backups, disks, updates.', { group: 'Tech' });

    // ---- the Board ----
    const add = async (body) => ok(await srv.api('/dashboard/tiles', { method: 'POST', body }), `tile ${body.title}`);
    const val = (id, value) => srv.asChief(`/dashboard/tiles/${id}/value`, { method: 'PUT', body: { value } });
    const mail = await add({ kind: 'value', title: 'Unread mail', section: 'Today', bot: inbox.id });
    for (const v of [6, 9, 8, 11, 12, 14]) await val(mail.id, v);
    const next = await add({ kind: 'value', title: 'Next up', section: 'Today', bot: plan.id, value: '09:30 Team sync' });
    const note = await add({ kind: 'note', title: 'Morning summary', section: 'Today', bot: news.id, size: 'wide' });
    await val(note.id, '**Rail strike called off:** trains run as normal.\n\n**Heat pump grants** extended until March.\n\nNothing urgent on your other topics.');
    const temp = await add({ kind: 'value', title: 'Living room', section: 'Home', bot: home.id, unit: '°C', size: 'wide' });
    for (const v of [20.4, 20.7, 20.8, 21, 21.2, 21.1, 21.4, 21.5]) await val(temp.id, v);
    const heating = await add({ kind: 'switch', title: 'Heating', section: 'Home', bot: home.id, read: { type: 'script', script: 'echo on' }, turnOn: { type: 'script', script: 'true' }, turnOff: { type: 'script', script: 'true' } });
    await add({ kind: 'switch', title: 'Hall light', section: 'Home', bot: home.id, read: { type: 'script', script: 'echo off' }, turnOn: { type: 'script', script: 'true' }, turnOff: { type: 'script', script: 'true' } });
    await add({ kind: 'button', title: 'All lights off', section: 'Home', bot: home.id, do: { type: 'script', script: 'true' } });
    await add({ kind: 'list', title: 'Shopping', section: 'Home', bot: recipe.id, value: ['Leeks', 'Potatoes', 'Gruyère', 'Oat milk', 'Lemons'] });
    const disk = await add({ kind: 'custom', title: 'Disk', section: 'Server', bot: watch.id, every: 300, read: { type: 'script', script: 'echo \'{"used": 62, "free": "380 GB"}\'' }, face: [{ type: 'kpi', bind: 'value.used', unit: '%', max: 100, sub: '{{value.free}} free', spark: false, change: false, good: 'down' }] });
    await add({ kind: 'custom', title: 'Backups', section: 'Server', bot: watch.id, value: { state: 'ok', last: '03:10' }, face: [{ type: 'status', text: 'All good', level: '{{value.state}}' }, { type: 'text', text: 'last {{value.last}} · 7 of 7 verified', muted: true }] });
    const cpu = await add({ kind: 'custom', title: 'CPU and RAM', section: 'Server', bot: watch.id, size: 'wide', value: { cpu: 30, ram: 60 }, face: [{ type: 'chart', label: 'last hour', unit: '%', series: [{ bind: 'value.cpu', label: 'CPU', color: '#3b82f6' }, { bind: 'value.ram', label: 'RAM', color: 'ok' }] }] });
    for (const [c, r] of [[22, 58], [28, 59], [35, 61], [31, 60], [44, 63], [38, 62], [27, 61], [24, 60]]) await val(cpu.id, { cpu: c, ram: r });
    ok(await srv.api('/dashboard/layout', { method: 'PUT', body: { home: [mail.id, next.id, temp.id, heating.id, disk.id] } }), 'home tiles');

    // ---- this morning's chats, written while botdot is stopped ----
    await srv.stop();
    const runs = path.join(srv.data, 'runs');
    fs.mkdirSync(runs, { recursive: true });
    let n = 0;
    const run = (b, startMin, endMin, fields) => {
      const id = `seed-${String(n++).padStart(4, '0')}`;
      fs.writeFileSync(path.join(runs, `${id}.json`), JSON.stringify({ id, botId: b.id, botName: b.name, kind: 'ai', trigger: 'manual', status: 'success', prompt: 'p', customPrompt: true,
        startedAt: at(startMin), endedAt: at(endMin), result: 'Done.', error: null, notificationAudience: 'owner', ...fields }));
    };
    // Yesterday's, all read.
    run(recipe, -760, -759, { prompt: 'What can I cook tonight? We have leeks, potatoes and some cheese.', result: 'Three ideas from what you have:\n\n1. **Leek and potato soup** with toasted cheese bread, 35 minutes.\n2. **Potato gratin** with leeks and Gruyère, 50 minutes.\n3. **Leek tart** with a green salad, 45 minutes.\n\nThe soup is the quickest. Want the recipe?' });
    run(watch, -1500, -1499, { prompt: 'How are the disks?', result: 'All four disks are healthy. The media disk is at 62%.' });
    // This morning's.
    run(news, 50, 51, { prompt: 'What is in the news this morning?', result: NEWS_1 });
    run(news, 56, 57, { prompt: 'Anything new on the heat pump grants? Do we qualify?', result: NEWS_2 });
    run(inbox, 30, 31, { trigger: 'schedule', jobId: 'mail', jobName: 'Morning mail', customPrompt: false, notify: 'always', reporting: 'delivered', prompt: 'Morning mail', result: '**14 new emails: 2 need an answer.**\n\n- The school asks whether you can help at the winter fair on 12 December. I drafted a yes.\n- Your landlord wants a date for the boiler check. I suggested Tuesday morning.\n\nThe other 12 are newsletters and receipts: archived.' });
    run(inbox, 45, 46, { prompt: 'Send the answer to the school.', result: 'Sent. I also put the winter fair in your calendar for 12 December, 14:00 to 17:00.' });
    // Done: a task the Chief handed it this morning, which the owner has not looked at.
    run(plan, 20, 21, { startedBy: 'chief', notificationAudience: 'internal', prompt: 'Put the dentist on Tuesday into the week plan.', result: 'Added: Tuesday 10:30, dentist. I moved the gym to Wednesday.' });
    writeData(path.join(srv.data, 'read-positions.json'), { version: 1, since: at(-120), chats: {} });
    srv = await startServer({ dir: srv.dir, env: ENV });

    // ---- Server Watch saves its weekly page, and asks for a tile with a script ----
    srv.hold();
    const pageRun = ok(await srv.api(`/bots/${watch.id}/run`, { method: 'POST', body: { prompt: 'Write this week\'s report of the home server as a page.' } }), 'page run');
    const rec = await srv.nextRun((x) => x.self?.env && x.args.includes(`🤖 ${watch.name}`), 'Server Watch\'s run');
    const saved = await self(srv, rec.self.env.RUN_TOKEN, 'page', { title: 'Home server', markdown: PAGE, sources: ['the server\'s logs', 'smartctl', 'the backup reports'] });
    if (!saved.data.ok || saved.data.problems?.length) throw new Error(`page: ${JSON.stringify(saved.data)}`);
    srv.reply('This week\'s report is ready: uptime 99.9%, all 7 backups verified, and 3 updates wait for your OK.');
    srv.release(rec);
    await srv.finished(pageRun.id || pageRun.run?.id);
    srv.unhold();

    // ---- the Chief makes a bot ----
    const chat = ok(await srv.api('/chief/chats', { method: 'POST' }), 'chief chat');
    fs.writeFileSync(path.join(srv.out, 'events.json'), JSON.stringify([
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'mk', name: 'mcp__botdot__create_bot', input: { name: 'Recipe Finder' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'mk', content: JSON.stringify({ id: recipe.id, name: 'Recipe Finder' }) }] } },
    ]));
    srv.reply('Done: **Recipe Finder** is on your list.\n\nEvery day at 17:00 it looks at what you told it is in the fridge and suggests three dinners, the quickest first. It never orders groceries or buys anything.\n\nTell it what you have, or say *"add it to the shopping list"* under any recipe.');
    ok(await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Make me a bot that suggests three dinners each evening from what is in the fridge.' } }), 'chief message');
    await waitFor(async () => !(await srv.api(`/chief/chats/${chat.id}`)).data.busy, { timeout: 20000, what: 'the Chief\'s reply' });
    fs.rmSync(path.join(srv.out, 'events.json'));
    // The second turn: the Chief puts a tile with a script on the Board, which waits for the owner's OK.
    srv.reply('Both are set up:\n\n- **Router uptime**, a tile for Server Watch under Server. It reads the router every 5 minutes.\n- **Night mode**, a job for Home Helper, every day at 22:30: night scene on, thermostats to 17 °C.\n\nEach is one command with no AI, and runs on this computer, so both wait for your OK below.');
    srv.hold();
    ok(await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Can you also put my router\'s uptime on the Board, and have Home Helper switch the house to night mode at 22:30?' } }), 'chief message 2');
    const chiefRun = await srv.nextRun((x) => x.stdin.includes('uptime'), 'the Chief\'s second turn');
    ok(await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'value', title: 'Router uptime', section: 'Server', bot: watch.id, every: 300, read: { type: 'script', script: 'ssh router uptime -p | sed "s/^up //"' } } }), 'router tile');
    ok(await srv.asChief(`/bots/${home.id}/jobs`, { method: 'POST', body: { name: 'Night mode', kind: 'script', cron: '30 22 * * *', script: 'ha-cli scene apply night', assessment: 'A fixed routine at a fixed time: no AI needed.' } }), 'job');
    srv.release(chiefRun);
    srv.unhold();
    await waitFor(async () => !(await srv.api(`/chief/chats/${chat.id}`)).data.busy, { timeout: 20000, what: 'the Chief\'s second reply' });
    await srv.api('/read', { method: 'POST', body: { app: 'scene', chat: `chief:${chat.id}` } });
    await srv.api('/read', { method: 'POST', body: { app: 'scene', chat: null } });

    // ---- a project: the kitchen renovation ----
    const reno = await bot('Reno Planner', '#1aa39a', 'sun-hat', 'Keeps the renovation on track.', 'Plan the kitchen renovation: the steps, the dates and who does what.', { group: 'Kitchen' });
    const quotes = await bot('Quote Chaser', '#c06cd9', 'headphones', 'Asks contractors and follows up.', 'Ask contractors for quotes for the kitchen and follow up until they answer.', { group: 'Kitchen' });
    const style = await bot('Style Scout', '#e0a526', 'beret', 'Finds tiles, fronts and colours.', 'Find tiles, cabinet fronts and colours that fit the kitchen.', { group: 'Kitchen' });
    ok(await srv.api('/company', { method: 'POST', body: { empty: true, name: 'Kitchen renovation' } }), 'project');
    const pq = '';
    ok(await srv.api(`/company/teams${pq}`, { method: 'POST', body: { name: 'Kitchen crew', bots: [reno.id, quotes.id, style.id], lead: reno.id } }), 'team');
    const c0 = (await srv.api('/company')).data.company;
    const day = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    ok(await srv.api('/company', { method: 'PATCH', body: { goal: 'A new kitchen by the end of January', objectives: [
      { id: 'o1', name: 'Quotes in', current: 2, target: 3 },
      { id: 'o2', name: 'Choices made', current: 5, target: 8 },
    ] } }), 'goals');
    ok(await srv.api('/company', { method: 'PATCH', body: { board: ['goals', 'teams', 'calendar', 'todo', 'files'] } }), 'board');
    for (const t of [
      { text: 'Pick the worktop: oak or quartz', due: day(2) },
      { text: 'Chase the third quote', bot: quotes.id, due: day(1) },
      { text: 'Shortlist three tile samples', bot: style.id, due: day(3) },
      { text: 'Book the electrician for the new sockets', bot: reno.id, due: day(5) },
      { text: 'Measure the window wall again' },
    ]) ok(await srv.api('/company/todos', { method: 'POST', body: t }), 'todo');
    for (const e of [{ title: 'Site visit: first contractor', day: day(1), time: '10:00' }, { title: 'Tile showroom', day: day(3), time: '15:30' }, { title: 'Decide on the quote', day: day(6) }]) ok(await srv.api('/company/events', { method: 'POST', body: e }), 'event');
    const group = (await srv.api('/group-chats')).data.groups?.find?.((g) => g.team) || (await srv.api('/group-chats')).data.find?.((g) => g.team);
    if (group) ok(await srv.api(`/group-chats/${group.id}`, { method: 'PUT', body: { category: 'Kitchen' } }), 'team category');
    if (!group) throw new Error(`no team chat: ${JSON.stringify((await srv.api('/group-chats')).data).slice(0, 300)}`);
    fs.writeFileSync(path.join(srv.out, `result-${shortName('Reno Planner')}.txt`), 'Two of three quotes are in, and the site visit is tomorrow at 10:00. @QuoteChaser can you sum up the quotes?');
    fs.writeFileSync(path.join(srv.out, `result-${shortName('Quote Chaser')}.txt`), 'Here is where the quotes stand:\n\n| Contractor | Start | Takes |\n| --- | --- | --- |\n| Oakline Kitchens | 6 January | 3 weeks |\n| Brightwood | 13 January | 2 weeks |\n| Northside Joinery | waiting | — |\n\nI wrote to Northside again this morning; they promised an answer by Monday.');
    ok(await srv.api(`/group-chats/${group.id}/messages`, { method: 'POST', body: { text: 'Where are we with the quotes?' } }), 'team message');
    await waitFor(async () => { const r = (await srv.api(`/group-chats/${group.id}/chat`)).data; return JSON.stringify(r).includes('Northside again') && !(r.working || []).length; }, { timeout: 30000, what: 'the team\'s replies' }).catch(async (e) => { console.log(JSON.stringify((await srv.api(`/group-chats/${group.id}/chat`)).data).slice(0, 3000)); throw e; });
    await sleep(500);
    for (const f of fs.readdirSync(srv.out).filter((f) => /^result-/.test(f))) fs.rmSync(path.join(srv.out, f));
    void c0;

    // ---- Home Helper at work ----
    fs.writeFileSync(path.join(srv.out, `hold-${shortName('Home Helper')}`), '');
    fs.writeFileSync(path.join(srv.out, 'events.json'), JSON.stringify([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Checking the thermostats in every room.' }, { type: 'tool_use', id: 'th', name: 'Bash', input: { command: 'ha-cli climate list', description: 'Read the thermostats' } }] } },
    ]));
    ok(await srv.api(`/bots/${home.id}/run`, { method: 'POST', body: { prompt: 'Which windows are open, and is it warm enough in the kids\' room?' } }), 'home run');
    await waitFor(async () => (await srv.api('/bots')).data.find((b) => b.id === home.id)?.running, { what: 'Home Helper at work' });
    await sleep(1500);
    fs.rmSync(path.join(srv.out, 'events.json'));

    await srv.api('/dashboard/refresh', { method: 'POST', body: { all: true } });
    await sleep(2000);

    // ---- served until drive.cjs is done ----
    fs.writeFileSync(path.join(OUT, 'scene.json'), JSON.stringify({ port: Number(new URL(srv.base).port), base: srv.base, bots: { news: news.id, home: home.id, watch: watch.id, recipe: recipe.id }, chief: chat.id, team: group.id }));
    console.log('serving', srv.base);
    while (!fs.existsSync(path.join(OUT, 'stop'))) await sleep(1000);
  } finally {
    for (const f of fs.existsSync(srv.out) ? fs.readdirSync(srv.out).filter((f) => /^hold/.test(f)) : []) fs.rmSync(path.join(srv.out, f));
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
