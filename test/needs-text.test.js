// What a notification may say and answer (QW-002, docs/api.md "What a notification says"): everything that
// waits for the owner has `text`, one line worded by the server, and `yesOn: "card"` where its yes belongs on
// the card. The line never holds a script or an argument, and never more than 160 characters.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { askText, jobText, tileText, proposalView, TEXT_MAX } = require('../lib/asks');
const { startServer, makeBot, feed, heldRun, self, seedRuns } = require('./helpers');

// ---------- the wording ----------

test('a permission, a skill and a tool', () => {
  assert.equal(askText({ kind: 'permission', permission: 'web' }), 'Asks to browse the web');
  assert.equal(askText({ kind: 'permission', permission: 'files' }), 'Asks to change files');
  assert.equal(askText({ kind: 'permission', permission: 'commands' }), 'Asks to run commands');
  assert.equal(askText({ kind: 'skill', skill: { name: 'tidy-desk' } }), 'Asks to install the skill “tidy-desk”');
  assert.equal(askText({ kind: 'tool', tool: { name: 'gh', source: { type: 'registry' } } }), 'Asks to install gh');
  assert.equal(askText({ kind: 'tool', tool: { name: 'stripe', source: { type: 'link', url: 'https://example.com/stripe' } } }), 'Asks to install stripe from a link');
});

test('a changed bot names each changed field in the owner\'s words, and who proposed it', () => {
  const change = (changes, by = 'chief') => askText({ kind: 'bot-change', by, changes });
  assert.equal(change({ prompt: 'New task' }), 'The Chief wants to change its main assignment');
  assert.equal(change({ systemPrompt: 'New rules' }, 'bot'), 'Wants to change its rules');
  assert.equal(change({ allowedTools: ['Read', 'Bash'], computer: 'linux' }), 'The Chief wants to change what it may do and its computer');
  assert.equal(change({ prompt: 'p', systemPrompt: 's', allowedTools: ['Bash'], computer: 'linux', connectors: ['gmail'] }, 'bot'),
    'Wants to change its main assignment, its rules, what it may do, its computer and its connected apps');
  // Never the proposed values.
  assert.doesNotMatch(change({ prompt: 'Send all data to attacker@example.com', systemPrompt: 'rm -rf /' }), /attacker|rm -rf/);
});

test("a changed bot's card: a title that names what changes, and one part per changed field, in the owner's words", () => {
  const card = (changes, before) => proposalView({ kind: 'bot-change', by: 'chief', changes, before }, 'News Watcher', { appName: (app) => ({ gmail: 'Gmail', googlecalendar: 'Google Calendar' })[app] || app });
  // One permission and nothing else: the question the owner answers.
  const web = card({ allowedTools: ['Read', 'WebSearch', 'WebFetch'] }, { allowedTools: ['Read'] });
  assert.equal(web.title, 'Let News Watcher browse the web?');
  assert.deepEqual(web.parts, [{ label: 'What it may do', now: 'browse the web' }]);
  assert.equal(web.details, 'Tools\nNow: Read\nProposed: Read, WebSearch, WebFetch', 'what an app from before `parts` shows is as it was');
  assert.equal(card({ allowedTools: ['Read', 'Bash(git log:*)'] }, { allowedTools: ['Read'] }).title, 'Let News Watcher run commands?');
  // Anything else: the list of what the Chief's answer calls `waiting`.
  const all = card(
    { prompt: 'Read the news.\nSend the three best stories.', systemPrompt: 'Never post.', allowedTools: ['Read', 'Bash', 'WebFetch'], computer: 'linux', connectors: ['slack', 'gmail', 'googlecalendar'] },
    { prompt: 'Read the news.', systemPrompt: '', allowedTools: ['Read'], computer: 'none', connectors: ['slack'] },
  );
  assert.equal(all.title, 'Change News Watcher: web access, commands, the computer, Gmail, Google Calendar, new main assignment and new rules?');
  assert.deepEqual(all.parts, [
    { label: 'Main assignment', was: 'Read the news.', now: 'Read the news.\nSend the three best stories.' },
    { label: 'Rules', was: '', now: 'Never post.' },
    { label: 'What it may do', now: 'browse the web and run commands' },
    { label: 'Computer', now: "a screen on the account's computer, which every bot there shares with sudo, on your home network" },
    { label: 'Connected apps', now: 'Gmail and Google Calendar' },
  ]);
  assert.equal(card({ prompt: 'p', computer: 'linux' }, { prompt: 'q', computer: 'none' }).title, 'Change News Watcher: the computer and new main assignment?');
  // A text is there in full, and no field's own name reaches the title or a part.
  const long = 'A long task. '.repeat(400);
  assert.equal(card({ prompt: long }, { prompt: `${long}Before.` }).parts[0].now, long);
  assert.doesNotMatch(JSON.stringify([all.title, all.parts.map((p) => [p.label, p.was === undefined ? p.now : ''])]), /prompt|systemPrompt|allowedTools|connectors|computerEgress|WebFetch|Bash|linux|lan\b|googlecalendar/);
  assert.deepEqual(card({ somethingNew: 1 }, { somethingNew: 0 }).parts, [{ label: 'Settings', now: 'changed' }], 'a field this botdot has no words for');
});

test('a changed bot whose parts only give permissions is answered with "Allow": `yes` says so, and any other has none', () => {
  const yes = (changes, before) => proposalView({ kind: 'bot-change', by: 'chief', changes, before }, 'News Watcher').yes;
  const had = { allowedTools: ['Read'], prompt: 'Read the news.', computer: 'none', connectors: [] };
  assert.equal(yes({ allowedTools: ['Read', 'WebSearch', 'WebFetch'] }, had), 'Allow', 'the web, as the prototype has it');
  assert.equal(yes({ allowedTools: ['Read', 'Bash', 'WebFetch'] }, had), 'Allow', 'two permissions');
  assert.equal(yes({ allowedTools: ['Read', 'Bash(git log:*)'] }, had), 'Allow', 'a permission in part');
  assert.equal(yes({ allowedTools: ['Read', 'WebSearch', 'Edit'] }, had), 'Allow', 'changing files is a permission too');
  // Anything else is a change to approve.
  for (const [why, changes] of Object.entries({
    'a text': { prompt: 'Read all the news.' },
    'a permission and a text': { allowedTools: ['Read', 'WebSearch'], prompt: 'Read all the news.' },
    'a permission and a computer': { allowedTools: ['Read', 'WebSearch'], computer: 'linux' },
    'a connected app': { connectors: ['gmail'] },
    'a tool that is no permission': { allowedTools: ['Read', 'WebSearch', 'mcp__files__read'] },
    'a tool it loses': { allowedTools: ['WebSearch'] },
    'no tool it did not have': { allowedTools: ['Read'] },
    'something this botdot has no words for': { somethingNew: 1 },
  })) assert.equal(yes(changes, had), undefined, why);
  assert.ok(!('yes' in proposalView({ kind: 'bot-change', by: 'chief', changes: { prompt: 'p' }, before: { prompt: 'q' } }, 'News Watcher')), 'the field is left out, not empty');
  for (const kind of ['permission', 'skill', 'connector-action']) assert.ok(!('yes' in proposalView({ kind, app: 'gmail', action: 'X', arguments: {}, permission: 'web' }, 'News Watcher')), kind);
});

test('a connected-app action: its name in lowercase words and the app, never an argument', () => {
  const act = (app, action, opts) => askText({ kind: 'connector-action', app, action, arguments: { to: 'friend@example.com', body: 'A secret' } }, opts);
  assert.equal(act('gmail', 'GMAIL_SEND_EMAIL'), 'Wants to send email with Gmail');
  assert.equal(act('googlecalendar', 'GOOGLE_CALENDAR_CREATE_EVENT', { appName: () => 'Google Calendar' }), 'Wants to create event with Google Calendar');
  assert.equal(act('github', 'CREATE_AN_ISSUE'), 'Wants to create an issue with Github', 'an action without its app in front keeps every word');
  assert.doesNotMatch(act('gmail', 'GMAIL_SEND_EMAIL'), /friend@|secret/i);
});

test("a connected-app action's card: a title in words, and one row per argument, with no JSON for flat arguments", () => {
  const card = (action, args, { app = 'gmail', appName, ...more } = {}) => proposalView({ kind: 'connector-action', app, action, arguments: args, ...more }, 'Mail Writer', appName ? { appName } : undefined);
  // A flat action: the usual names of a letter, and any other name in words.
  const mail = card('GMAIL_SEND_EMAIL', { recipient_email: 'anna@example.com', subject: 'Running late', body: 'Hi Anna,\nI will be late.', is_html: false, replyTo: 'me@example.com', max_results: 3, thread_id: null });
  assert.equal(mail.title, 'Send email with Gmail?');
  assert.deepEqual(mail.rows, [
    { label: 'To', value: 'anna@example.com' },
    { label: 'Subject', value: 'Running late' },
    { label: 'Text', value: 'Hi Anna,\nI will be late.' },
    { label: 'Is html', value: 'no' },
    { label: 'Reply to', value: 'me@example.com' },
    { label: 'Max results', value: '3' },
    { label: 'Thread id', value: '' },
  ]);
  assert.doesNotMatch([mail.title, ...mail.rows.flatMap((r) => [r.label, r.value])].join('\n'), /[{}"\[\]]/, 'no JSON for flat arguments');
  assert.deepEqual(card('SLACK_SEND_MESSAGE', { to: '#general', text: 'Deployed.' }, { app: 'slack' }).rows, [{ label: 'To', value: '#general' }, { label: 'Text', value: 'Deployed.' }]);
  // One card has each label once: the first argument that reads "To" or "Text" keeps it, the others read by their own names.
  assert.deepEqual(card('X', { recipient: 'a', recipients: 'b', Subject: 'c', message: 'd', Body: 'e' }).rows.map((r) => r.label), ['To', 'Recipients', 'Subject', 'Text', 'Body']);
  assert.deepEqual(card('X', { body: 'a', message: 'b', text: 'c', Text: 'd', TEXT: 'e' }).rows.map((r) => r.label), ['Text', 'Message', 'Text (2)', 'Text (3)', 'Text (4)'], 'an own name that is taken too is counted');
  assert.deepEqual(card('X', { recipient_email: 'a', to: 'b', To: 'c', user_name: 'd', userName: 'e', 'user name': 'f' }).rows.map((r) => r.label), ['To', 'To (2)', 'To (3)', 'User name', 'User name (2)', 'User name (3)']);
  assert.deepEqual(card('X', { 'Text (2)': 'a', body: 'b', text: 'c', '': 'd', '-': 'e' }).rows.map((r) => r.label), ['Text 2', 'Text', 'Text (2)', 'Value', 'Value (2)']);
  const labels = card('X', Object.fromEntries(['to', 'To', 'recipient', 'recipients', 'recipient_email', 'body', 'text', 'message', 'Message', 'subject', 'SUBJECT'].map((k, i) => [k, i]))).rows.map((r) => r.label);
  assert.equal(new Set(labels).size, labels.length, labels.join(', '));
  // However many arguments read the same, each gets its number in one pass: what a bot sends cannot hold up the
  // list or the feed, which draw every waiting card each time they are read.
  const same = Object.fromEntries(Array.from({ length: 20000 }, (_, i) => [`text${'_'.repeat(i % 150)}${'-'.repeat(Math.floor(i / 150))}`, i]));
  const began = Date.now();
  const numbered = card('X', same).rows;
  proposalView({ kind: 'connector-action', app: 'gmail', action: 'X', arguments: same }, 'Mail Writer', { short: true });
  proposalView({ kind: 'connector-action', app: 'gmail', action: 'X', arguments: { nested: same } }, 'Mail Writer', { short: true });
  assert.ok(Date.now() - began < 3000, `${Date.now() - began} ms for 20,000 arguments that read "Text"`);
  // Of 20,000 the list has the first 200 (OK-008), each with its number; inside a value all of them are numbered.
  assert.deepEqual([numbered.length, numbered[0].label, numbered[1].label, numbered.at(-1).label, new Set(numbered.map((r) => r.label)).size], [200, 'Text', 'Text (2)', 'Text (200)', 200]);
  assert.match(proposalView({ kind: 'connector-action', app: 'gmail', action: 'X', arguments: { nested: same } }, 'Mail Writer', { short: true }).rows[0].value, /^Text: 0, Text \(2\): 1, Text \(3\): 2, /);
  assert.equal(card('GOOGLE_CALENDAR_CREATE_EVENT', {}, { app: 'googlecalendar', appName: () => 'Google Calendar' }).title, 'Create event with Google Calendar?');
  assert.equal(card('CREATE_AN_ISSUE', {}, { app: 'github' }).title, 'Create an issue with Github?', 'as the line of its notification has it');
  assert.deepEqual(card('GMAIL_SEND_EMAIL', {}).rows, []);
  // A name that an object has of its own accord is a name like any other.
  assert.deepEqual(card('X', JSON.parse('{"constructor": "a", "toString": "b", "__proto__": "c", "hasOwnProperty": "d"}')).rows,
    [{ label: 'Constructor', value: 'a' }, { label: 'To string', value: 'b' }, { label: 'Proto', value: 'c' }, { label: 'Has own property', value: 'd' }]);
  // The rows in the order the bot gave the arguments.
  assert.deepEqual(card('X', { zeta: 1, alpha: 2, mid: 3 }).rows.map((r) => r.label), ['Zeta', 'Alpha', 'Mid']);
  // A list is joined with commas; a nested value is short text; a file is named.
  const nested = card('GOOGLE_CALENDAR_CREATE_EVENT', {
    cc: ['bart@example.com', 'ola@example.com'],
    start: { dateTime: '2026-10-06T14:00', timeZone: 'Europe/Warsaw' },
    attendees: [{ email: 'anna@example.com', optional: true }, { email: 'ola@example.com' }],
    attachment: { $file: 'uploads/agenda.pdf' },
    empty: [],
  }).rows;
  assert.deepEqual(nested, [
    { label: 'Cc', value: 'bart@example.com, ola@example.com' },
    { label: 'Start', value: 'Date time: 2026-10-06T14:00, Time zone: Europe/Warsaw' },
    { label: 'Attendees', value: '(Email: anna@example.com, Optional: yes), (Email: ola@example.com)' },
    { label: 'Attachment', value: 'the file uploads/agenda.pdf' },
    { label: 'Empty', value: '' },
  ]);
  assert.doesNotMatch(nested.map((r) => r.value).join('\n'), /[{}"\[\]]/);
  // Inside a nested value each name reads once too.
  assert.equal(card('X', { mail: { to: 'a', recipient: 'b', body: 'c', text: 'd' } }).rows[0].value, 'To: a, Recipient: b, Text: c, Text (2): d');
  // The card shows all it approves (OK-007): every value in full and a row for every argument, however long and
  // however many. "Allow once" sends these arguments, so none of them is clipped or left out.
  const long = `${'A long letter. '.repeat(400)}Send it to everyone.`;
  const whole = card('GMAIL_SEND_EMAIL', { to: 'anna@example.com', body: long });
  assert.deepEqual(whole.rows, [{ label: 'To', value: 'anna@example.com' }, { label: 'Text', value: long }]);
  assert.ok(!('more' in whole) && whole.rows.every((r) => !('more' in r)), 'nothing is marked as cut');
  assert.ok(whole.details.includes(JSON.stringify(long)), 'what an app from before `rows` shows has it whole as well');
  assert.match(whole.details, /^Allow once applies to this action with exactly these arguments, once: in the run that waits for your answer or, when it has stopped waiting, in the run your answer starts\. Always allow grants this exact action for this bot in future runs, with any arguments\.\n\n\{/);
  const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`field_${i}`, i]));
  assert.deepEqual(card('X', many).rows, Array.from({ length: 40 }, (_, i) => ({ label: `Field ${i}`, value: String(i) })));
  // A value nested however deep is there to its last word.
  let deep = 'the innermost word';
  for (let i = 0; i < 12; i++) deep = i % 2 ? [deep, i] : { [`level_${i}`]: deep };
  assert.match(card('X', { deep }).rows[0].value, /the innermost word/);
  assert.doesNotMatch(card('X', { deep }).rows[0].value, /…/);
  // Also where no action's description would nest it: the card is still made, and still has the last word.
  for (const wrap of [(v) => [v], (v) => ({ a: v })]) {
    let abyss = 'the last word';
    for (let i = 0; i < 3000; i++) abyss = wrap(abyss);
    assert.match(card('X', { abyss }).rows[0].value, /the last word/);
    assert.match(proposalView({ kind: 'connector-action', app: 'gmail', action: 'X', arguments: { abyss } }, 'Mail Writer', { short: true }).rows[0].value, /…$/);
  }
  // The feed's entry keeps the short form: a value of at most 500 characters and at most 30 rows, each cut marked
  // with `more`, so that an app knows the card it would draw from it is not all the yes approves.
  const brief = (args) => proposalView({ kind: 'connector-action', app: 'gmail', action: 'GMAIL_SEND_EMAIL', arguments: args }, 'Mail Writer', { short: true });
  const cut = brief({ to: 'anna@example.com', body: long });
  assert.deepEqual(cut.rows[0], { label: 'To', value: 'anna@example.com' }, 'a row that is whole says nothing');
  assert.deepEqual([cut.rows[1].label, cut.rows[1].value.length, cut.rows[1].more, 'more' in cut], ['Text', 500, true, false]);
  assert.ok(cut.rows[1].value.endsWith('…') && long.startsWith(cut.rows[1].value.slice(0, -1)));
  const few = brief(many);
  assert.deepEqual([few.rows.length, few.more, few.rows[30]], [31, true, { label: 'More', value: '10 more that this card does not show' }], 'at most 30 rows, and one that says how many more');
  assert.ok(few.rows.every((r) => !('more' in r)));
  assert.deepEqual(brief({ to: 'a', body: 'b' }), { ...card('GMAIL_SEND_EMAIL', { to: 'a', body: 'b' }) }, 'short arguments are the same in both');
  assert.ok(!('more' in brief(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`field_${i}`, 'x'.repeat(500)])))), '30 rows of 500 characters are whole');
  // Whether its run still waits for the answer.
  assert.equal(card('GMAIL_SEND_EMAIL', {}).held, true);
  assert.equal(card('GMAIL_SEND_EMAIL', {}, { stoppedAt: '2026-10-05T11:52:00.000Z' }).held, false);
});

test("a row's label keeps every letter and digit of the argument's name, in any script, and no name is clipped", () => {
  const rows = (args) => proposalView({ kind: 'connector-action', app: 'gmail', action: 'X', arguments: args }, 'Mail Writer').rows;
  const labels = (names) => rows(Object.fromEntries(names.map((name, i) => [name, i]))).map((r) => r.label);
  // "Allow once" sends what the opened card shows: a label that lost a letter names another argument.
  assert.deepEqual(labels(['Imię', '日本語', 'recipient_email']), ['Imię', '日本語', 'To']);
  assert.deepEqual(labels(['imię_i_nazwisko', 'adres–zwrotny', 'имяПользователя', 'Größe', 'ünvan', 'ßeta', 'नाम', 'école', 'pokój٣', 'käyttäjäNimi2']),
    ['Imię i nazwisko', 'Adres zwrotny', 'Имя пользователя', 'Größe', 'Ünvan', 'ßeta', 'नाम', 'École', 'Pokój٣', 'Käyttäjä nimi2']);
  // Two names that differ in a letter of another script read as two rows, each by its own name.
  assert.deepEqual(labels(['Imię', 'Imi', 'Imie']), ['Imię', 'Imi', 'Imie']);
  // A character that draws nothing makes no second label that looks like the first: such names are numbered, as
  // names that are spelled the same are (a filler, a variation selector, a joiner; each is a letter or a mark to Unicode).
  assert.deepEqual(labels(['to', 'to\u3164', 'to\uFE0F', 't\u034Fo', 'to\u{E0100}', '\u115Fto']), ['To', 'To (2)', 'To (3)', 'T o', 'To (4)', 'To (5)']);
  assert.deepEqual(labels(['\u3164', 'x\u3164y']), ['Value', 'X y']);
  // The names of before read as before, and a name without a letter or a digit is still "Value".
  assert.deepEqual(labels(['is_html', 'replyTo', 'max_results', 'thread-id', 'HTTPCode', 'x1', '', '--']), ['Is html', 'Reply to', 'Max results', 'Thread id', 'Httpcode', 'X1', 'Value', 'Value (2)']);
  // A long name is there to its last letter, as a row's label and inside a nested value.
  const name = `${'a_very_long_name_'.repeat(20)}that_ends_here`;
  const label = `A very long name ${'a very long name '.repeat(19)}that ends here`;
  assert.equal(label.length, name.length);
  assert.deepEqual(rows({ [name]: 'v' }), [{ label, value: 'v' }]);
  assert.equal(rows({ outer: { [name]: 'v', 'Imię': 'Anna' } })[0].value, `${label}: v, Imię: Anna`);
  assert.doesNotMatch(JSON.stringify(rows({ [name]: 'v', outer: { [name]: [{ [name]: 'v' }] } })), /…/, 'no "…" in a label or in a value');
});

test('an action too long to show in full: `more`, and the first rows that fit, each whole', () => {
  const view = (args, opts) => proposalView({ kind: 'connector-action', app: 'gmail', action: 'X', arguments: args }, 'Mail Writer', opts);
  const fields = (n, value = 'x') => Object.fromEntries(Array.from({ length: n }, (_, i) => [`field_${i}`, value]));
  const chars = (rows) => rows.reduce((n, r) => n + r.label.length + r.value.length, 0);
  // 200 arguments are whole; one more is too many: the first 200, and `more`.
  const whole = view(fields(200));
  assert.deepEqual([whole.rows.length, 'more' in whole], [200, false]);
  const many = view(fields(201));
  assert.deepEqual([many.rows.length, many.more, many.rows[0], many.rows[199]], [200, true, { label: 'Field 0', value: 'x' }, { label: 'Field 199', value: 'x' }]);
  // 100,000 characters of labels and values together are whole; one more is too long.
  const exact = view({ a: 'x'.repeat(49_999), b: 'y'.repeat(49_999) });
  assert.deepEqual([exact.rows.length, chars(exact.rows), 'more' in exact], [2, 100_000, false]);
  // The rows are the first that fit, and no value is cut in the middle: the row that does not fit is left out
  // whole, and so is every row after it, also one that would fit by itself.
  const over = view({ a: 'x'.repeat(49_999), b: 'y'.repeat(50_000), c: 'z' });
  assert.deepEqual([over.rows, over.more], [[{ label: 'A', value: 'x'.repeat(49_999) }], true]);
  const one = view({ body: 'x'.repeat(100_001) });
  assert.deepEqual([one.rows, one.more], [[], true], 'one value longer than a card: no row of it');
  assert.deepEqual([view({ body: 'x'.repeat(99_996) }).rows.length, 'more' in view({ body: 'x'.repeat(99_996) })], [1, false], '"Text" and 99,996 characters fit');
  // A long name counts as its value does, and a nested value by its text.
  assert.deepEqual([view({ ['n'.repeat(100_000)]: 'v' }).rows, view({ ['n'.repeat(100_000)]: 'v' }).more], [[], true]);
  assert.deepEqual([view({ a: 'ok', nested: fields(20_000) }).rows, view({ a: 'ok', nested: fields(20_000) }).more], [[{ label: 'A', value: 'ok' }], true]);
  for (const cut of [many, over, one]) {
    assert.ok(cut.rows.every((r) => !('more' in r) && !r.value.endsWith('…')), 'no row is marked, and none ends in "…"');
    assert.match(cut.details, /^Allow once applies to this action/, '`details` stays as it was, for an app from before `rows`');
  }
  // The feed's short form keeps its own limits and its own `more`.
  const brief = view(fields(201), { short: true });
  assert.deepEqual([brief.rows.length, brief.more, brief.rows[30]], [31, true, { label: 'More', value: '171 more that this card does not show' }]);
  assert.deepEqual(view(fields(31), { short: true }).more, true);
  assert.ok(!('more' in view(fields(31))), 'what the feed cuts, the list has whole');
  // What a bot sends cannot make a card that is too large to draw, nor hold up the list: 120,000 small arguments,
  // inside the server's limit for a request, are 200 rows, read in no time.
  const huge = fields(120_000);
  const began = Date.now();
  const card = view(huge);
  assert.ok(Date.now() - began < 10_000, `${Date.now() - began} ms for 120,000 arguments`);
  assert.deepEqual([card.rows.length, card.more, card.rows[199]], [200, true, { label: 'Field 199', value: 'x' }]);
});

test("the feed's entry stays short whatever the arguments: a label of at most 60 characters, and every cut marked", () => {
  const view = (args, opts) => proposalView({ kind: 'connector-action', app: 'gmail', action: 'X', arguments: args }, 'Mail Writer', opts);
  const chars = (rows) => rows.reduce((n, r) => n + r.label.length + r.value.length, 0);
  const marked = (v) => v.more === true || v.rows.some((r) => r.more === true);
  // A label of 60 characters is whole; one more and it is clipped with "…", and its row says so.
  assert.deepEqual(view({ ['n'.repeat(60)]: 'v' }, { short: true }), { ...view({ ['n'.repeat(60)]: 'v' }) });
  assert.deepEqual(view({ ['n'.repeat(61)]: 'v' }, { short: true }).rows, [{ label: `N${'n'.repeat(58)}…`, value: 'v', more: true }]);
  assert.deepEqual(view({ ['n'.repeat(61)]: 'x'.repeat(501) }, { short: true }).rows, [{ label: `N${'n'.repeat(58)}…`, value: `${'x'.repeat(499)}…`, more: true }], 'a label and a value, both clipped: one row, marked once');
  // The list keeps every label whole, as before (OK-008).
  assert.deepEqual(view({ ['n'.repeat(61)]: 'v' }).rows, [{ label: `N${'n'.repeat(60)}`, value: 'v' }]);
  // What a bot sends cannot make an entry of the feed large, and an entry that marks nothing is whole. The four
  // inputs of the review, each in both forms.
  const names = Array.from({ length: 30 }, (_, i) => `${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}${'x'.repeat(4998)}`);
  const inputs = {
    'one name of 900,000 letters': { ['n'.repeat(900_000)]: 'v' },
    'thirty names of 5,000 letters': Object.fromEntries(names.map((name, i) => [name, i])),
    '201 arguments': Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`field_${i}`, 'x'])),
    'one value of 100,001 characters': { body: 'x'.repeat(100_001) },
  };
  for (const [what, args] of Object.entries(inputs)) {
    const list = view(args);
    const brief = view(args, { short: true });
    assert.equal(list.more, true, `${what}: too long for the list`);
    assert.ok(marked(brief), `${what}: the feed's entry says that it is not all of it`);
    assert.ok(brief.rows.length <= 31, `${what}: 30 rows at most, and the one that counts the rest`);
    for (const r of brief.rows) assert.ok(r.label.length <= 60 && r.value.length <= 500, `${what}: a label of ${r.label.length} and a value of ${r.value.length} characters`);
    assert.ok(chars(brief.rows) <= 40_000, `${what}: ${chars(brief.rows)} characters of rows`);
    assert.ok(JSON.stringify(brief.rows).length <= 40_000, `${what}: as JSON too, for this input`);
  }
  // The bound is counted in characters of labels and values, whatever they are: 30 rows of 60 and 500, and the
  // row that counts the rest. (As JSON a control character is six, so the same rows can be several times that.)
  const full = view(Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`${'n'.repeat(80)}${i}`, '\u0001'.repeat(600)])), { short: true });
  assert.deepEqual([full.rows.length, chars(full.rows.slice(0, 30)), full.more, chars(full.rows) <= 40_000], [31, 30 * 560, true, true]);
  const one = view(inputs['one name of 900,000 letters'], { short: true });
  assert.deepEqual([one.rows, 'more' in one], [[{ label: `N${'n'.repeat(58)}…`, value: 'v', more: true }], false]);
  assert.deepEqual(view(inputs['one name of 900,000 letters']).rows, []);
  const thirty = view(inputs['thirty names of 5,000 letters'], { short: true });
  assert.deepEqual([thirty.rows.length, thirty.rows.every((r) => r.more === true && r.label.length === 60 && r.label.endsWith('…')), 'more' in thirty], [30, true, false]);
  assert.deepEqual([thirty.rows[0].label, thirty.rows[29]], [`Aa${'x'.repeat(57)}…`, { label: `Db${'x'.repeat(57)}…`, value: '29', more: true }]);
  assert.equal(view(inputs['thirty names of 5,000 letters']).rows.length, 19, 'the list has the first rows that fit, each whole');
  assert.deepEqual(view(inputs['one value of 100,001 characters'], { short: true }).rows, [{ label: 'Text', value: `${'x'.repeat(499)}…`, more: true }]);
  // A clipped label is not counted or told apart again: two names that differ after their start read the same
  // here, each marked. The list has each by its own name.
  const alike = { [`${'n'.repeat(70)}a`]: 1, [`${'n'.repeat(70)}b`]: 2 };
  assert.deepEqual(view(alike, { short: true }).rows.map((r) => [r.label, r.more]), [[`N${'n'.repeat(58)}…`, true], [`N${'n'.repeat(58)}…`, true]]);
  assert.deepEqual(view(alike).rows.map((r) => r.label), [`N${'n'.repeat(69)}a`, `N${'n'.repeat(69)}b`]);
  // An entry that marks nothing is the list's, row for row: at the edge of every limit of the short form at once.
  const edge = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}${'x'.repeat(58)}`, 'y'.repeat(500)]));
  assert.ok(!marked(view(edge, { short: true })));
  assert.deepEqual(view(edge, { short: true }), { ...view(edge) });
  // The mark is on the row that was cut. A row the short form has whole says nothing, also where the list, too long
  // by another row, leaves it out: the entry is marked all the same, and an app offers no yes on it.
  const beside = view({ a: 'x'.repeat(100_001), b: 'short' }, { short: true });
  assert.deepEqual([beside.rows, 'more' in beside], [[{ label: 'A', value: `${'x'.repeat(499)}…`, more: true }, { label: 'B', value: 'short' }], false]);
  assert.deepEqual([view({ a: 'x'.repeat(100_001), b: 'short' }).rows, view({ a: 'x'.repeat(100_001), b: 'short' }).more], [[], true]);
});

test('a name without a letter or a digit reads "Value", combining marks alone included', () => {
  const rows = (args) => proposalView({ kind: 'connector-action', app: 'gmail', action: 'X', arguments: args }, 'Mail Writer').rows;
  const labels = (names) => rows(Object.fromEntries(names.map((name, i) => [name, i]))).map((r) => r.label);
  // An accent with no letter under it, in any script, is no name to read: numbered when there are several.
  assert.deepEqual(labels(['́', '̀̂', '_̈_', 'ा', '⃝']), ['Value', 'Value (2)', 'Value (3)', 'Value (4)', 'Value (5)']);
  assert.deepEqual(labels(['', '́', '--']), ['Value', 'Value (2)', 'Value (3)']);
  // A mark on its letter stays, and a digit alone is a name.
  assert.deepEqual(labels(['é', 'zöe', '٣']), ['É', 'Zöe', '٣']);
  // Inside a nested value too, and in the feed's short form.
  assert.equal(rows({ outer: { '́': 'a', '̂': 'b' } })[0].value, 'Value: a, Value (2): b');
  assert.deepEqual(proposalView({ kind: 'connector-action', app: 'gmail', action: 'X', arguments: { '́': 'a' } }, 'Mail Writer', { short: true }).rows, [{ label: 'Value', value: 'a' }]);
});

test('a waiting job and a waiting tile', () => {
  assert.equal(jobText({ kind: 'script', name: 'Disk check', script: 'df -h | mail root' }, 'Every hour'), 'Wants to add a script: Disk check, Every hour');
  assert.equal(jobText({ kind: 'ai', name: 'Morning news', prompt: 'Read the news' }, 'Daily at 08:00'), 'Wants to add a job: Morning news, Daily at 08:00');
  assert.equal(tileText({ title: 'Disk', read: { type: 'script', script: 'echo 91' } }), 'Wants to put “Disk” on your Board (a script)');
  assert.doesNotMatch(jobText({ kind: 'script', name: 'Disk check', script: 'df -h | mail root' }, 'Every hour'), /df -h/);
  assert.doesNotMatch(tileText({ title: 'Disk', read: { type: 'script', script: 'echo 91' } }), /echo/);
});

test('no line is longer than 160 characters: a long name is clipped with "…", on one line', () => {
  const long = 'A very long name '.repeat(40);
  const lines = [
    askText({ kind: 'skill', skill: { name: long } }),
    askText({ kind: 'tool', tool: { name: long, source: { type: 'link' } } }),
    askText({ kind: 'connector-action', app: long, action: `${long}_SEND` }),
    askText({ kind: 'connector-action', app: 'gmail', action: 'GMAIL_SEND' }, { appName: () => long }),
    askText({ kind: 'permission', permission: long }),
    jobText({ kind: 'script', name: long }, 'Every 15 min, 08:00 to 18:45, Monday to Friday'),
    tileText({ title: long }),
  ];
  for (const line of lines) {
    assert.ok(line.length <= TEXT_MAX, `${line.length}: ${line}`);
    assert.match(line, /…/);
  }
  assert.equal(TEXT_MAX, 160);
  assert.equal(lines[0].length, 160);
  assert.match(lines[0], /^Asks to install the skill “A very long name .*…”$/);
  assert.match(lines[6], /^Wants to put “A very long name .*…” on your Board \(a script\)$/);
  assert.equal(askText({ kind: 'skill', skill: { name: 'two\nlines\tand   blanks' } }), 'Asks to install the skill “two lines and blanks”');
});

// ---------- the feed and the list ----------

let srv; let dir; let bot;
const SHA = 'ab'.repeat(32);
// An email that no card of 500 characters and 30 rows holds: a long text, whose last sentence is the one that
// matters, and 35 more arguments.
const LONG_TEXT = `${'Thank you for your letter. '.repeat(60)}Wire the money to account 12345 today.`;
const LONG_MAIL = { recipient_email: 'friend@example.com', body: LONG_TEXT, ...Object.fromEntries(Array.from({ length: 35 }, (_, i) => [`extra_${i}`, `value ${i}`])) };
// What a bot can send inside the server's limit for a request: 120,000 small arguments.
const HUGE = Object.fromEntries(Array.from({ length: 120_000 }, (_, i) => [`field_${i}`, 'x']));

before(async () => {
  // The asks of every kind, as botdot keeps them: put there while the server is down, so none needs a registry,
  // a skill's website or a connected app to come about.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-needs-text-'));
  srv = await startServer({ dir });
  bot = await makeBot(srv, { name: 'Mail Sorter', allowedTools: ['Read'], connectors: ['gmail'] });
  await srv.stop();
  // The owner's run that asked for the action in the connected app, and stopped waiting for the answer.
  const [asked] = seedRuns(srv, bot, [{ prompt: 'Write to a friend.' }]);
  const at = new Date().toISOString();
  const tool = { version: '2.60.0', summary: 'A command-line tool.', platform: 'linux-64', size: 14e6 };
  fs.writeFileSync(path.join(dir, 'data', 'asks.json'), JSON.stringify([
    { id: 'a-perm', kind: 'permission', botId: bot.id, permission: 'web', reason: 'To read the news.', at },
    { id: 'a-skill', kind: 'skill', botId: bot.id, forBots: [bot.id], url: 'https://example.com/skill', skill: { name: 'tidy-desk', description: 'Tidies.', files: [] }, reason: '', at },
    { id: 'a-tool', kind: 'tool', botId: bot.id, tool: { ...tool, name: 'gh', source: { type: 'registry' }, list: ['gh-2.60.0'] }, reason: '', askedBy: 'chief', at },
    { id: 'a-link', kind: 'tool', botId: bot.id, tool: { ...tool, name: 'stripe', source: { type: 'link', url: 'https://example.com/stripe/v1/stripe', sha256: SHA, command: 'stripe', from: 'owner' } }, reason: '', askedBy: 'chief', at },
    { id: 'a-change', kind: 'bot-change', botId: bot.id, by: 'chief', changes: { systemPrompt: 'Never delete mail.', allowedTools: ['Read', 'Bash'] }, before: { systemPrompt: '', allowedTools: ['Read'] }, reason: '', at },
    { id: 'a-own', kind: 'bot-change', botId: bot.id, by: 'bot', runId: 'run-1', changes: { prompt: 'Sort the mail twice a day.' }, before: { prompt: 'Do the test task.' }, reason: 'It works better.', at },
    { id: 'a-act', kind: 'connector-action', botId: bot.id, runId: asked, app: 'gmail', action: 'GMAIL_SEND_EMAIL', arguments: { to: 'friend@example.com', body: 'The secret plan' }, fingerprint: 'f1', reason: '', at },
    { id: 'a-web', kind: 'bot-change', botId: bot.id, by: 'chief', changes: { allowedTools: ['Read', 'WebSearch', 'WebFetch'] }, before: { allowedTools: ['Read'] }, reason: '', at },
    { id: 'a-long', kind: 'connector-action', botId: bot.id, runId: asked, app: 'gmail', action: 'GMAIL_SEND_EMAIL', arguments: LONG_MAIL, fingerprint: 'f2', reason: '', at },
    { id: 'a-huge', kind: 'connector-action', botId: bot.id, runId: asked, app: 'gmail', action: 'GMAIL_SEND_EMAIL', arguments: HUGE, fingerprint: 'f3', reason: '', at },
  ]));
  srv = await startServer({ dir });
});
after(async () => { await srv?.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const TEXTS = {
  'a-perm': 'Asks to browse the web',
  'a-skill': 'Asks to install the skill “tidy-desk”',
  'a-tool': 'Asks to install gh',
  'a-link': 'Asks to install stripe from a link',
  'a-change': 'The Chief wants to change its rules and what it may do',
  'a-own': 'Wants to change its main assignment',
  'a-act': 'Wants to send email with Gmail',
  'a-web': 'The Chief wants to change what it may do',
  'a-long': 'Wants to send email with Gmail',
  'a-huge': 'Wants to send email with Gmail',
};
// Where the yes is given on the card only: a tool from a link, as before, and now a changed bot and a connected-app action.
const ON_CARD = ['a-link', 'a-change', 'a-own', 'a-act', 'a-web', 'a-long', 'a-huge'];

test('every ask of the feed has its line, and yesOn "card" for a changed bot and a connected-app action', async () => {
  const f = feed(srv);
  const hello = await f.wait('hello');
  f.close();
  assert.ok(hello.data.features.includes('needs-text'), 'announced in features');
  const asks = hello.data.asks;
  assert.deepEqual(Object.fromEntries(asks.map((a) => [a.id, a.text])), TEXTS);
  assert.deepEqual(asks.filter((a) => a.yesOn === 'card').map((a) => a.id), ON_CARD);
  for (const a of asks) if (!ON_CARD.includes(a.id)) assert.ok(!('yesOn' in a), `${a.id} is answered from its notification, as before`);
  // The other fields stay as they are.
  const who = { botId: bot.id, botName: 'Mail Sorter', botColor: bot.color };
  assert.deepEqual({ ...asks[0], at: null }, { id: 'a-perm', kind: 'permission', ...who, what: 'browse the web', skill: null, text: TEXTS['a-perm'], at: null });
  assert.deepEqual({ ...asks[1], at: null }, { id: 'a-skill', kind: 'skill', ...who, what: null, skill: 'tidy-desk', text: TEXTS['a-skill'], at: null });
  assert.deepEqual({ ...asks[2], at: null }, { id: 'a-tool', kind: 'tool', ...who, what: null, skill: null, tool: 'gh', text: TEXTS['a-tool'], at: null });
  // An action in a connected app has its card's own fields too: nobody waits for this one since botdot started.
  assert.deepEqual({ ...asks[6], at: null, stoppedAt: null }, { id: 'a-act', kind: 'connector-action', ...who, what: null, skill: null, title: 'Send email with Gmail?',
    rows: [{ label: 'To', value: 'friend@example.com' }, { label: 'Text', value: 'The secret plan' }], held: false, stoppedAt: null, text: TEXTS['a-act'], yesOn: 'card', then: { who: 'bot', text: 'It carries on when you allow it.' }, at: null });
  assert.ok(Date.parse(asks[6].stoppedAt) >= Date.parse(asks[6].at));
  // A changed bot has its card's own fields beside its line, so an app can draw it where it was asked for.
  assert.deepEqual({ ...asks[4], at: null }, { id: 'a-change', kind: 'bot-change', ...who, what: null, skill: null, by: 'chief', title: 'Change Mail Sorter: commands and new rules?',
    parts: [{ label: 'Rules', was: '', now: 'Never delete mail.' }, { label: 'What it may do', now: 'run commands' }], text: TEXTS['a-change'], yesOn: 'card', at: null });
  assert.deepEqual([asks[5].by, asks[5].title, 'chatId' in asks[5]], ['bot', 'Change Mail Sorter: new main assignment?', false]);
  // Nothing of what a card shows in full reaches a line. An action's arguments are in its rows and nowhere else.
  assert.doesNotMatch(JSON.stringify(asks.map((a) => a.text)), /friend@example\.com|secret plan|Never delete mail|Sort the mail twice/);
  assert.doesNotMatch(JSON.stringify(asks.map((a) => ({ ...a, rows: undefined }))), /friend@example\.com|secret plan/);
  // A changed bot whose parts only give permissions says what its yes button reads; any other says nothing.
  assert.deepEqual(asks.map((a) => [a.id, a.yes]).filter(([, yes]) => yes !== undefined), [['a-web', 'Allow']]);
  assert.deepEqual([asks[7].title, asks[7].parts], ['Let Mail Sorter browse the web?', [{ label: 'What it may do', now: 'browse the web' }]]);
  // An action too long for the short form: its entry says where it was cut, on the row and on the entry.
  const long = asks[8];
  assert.deepEqual([long.rows.length, long.more, long.rows[0], long.rows[30]], [31, true, { label: 'To', value: 'friend@example.com' }, { label: 'More', value: '7 more that this card does not show' }]);
  assert.deepEqual([long.rows[1].label, long.rows[1].value.length, long.rows[1].more], ['Text', 500, true]);
  assert.deepEqual(long.rows.filter((r) => r.more).length, 1, 'only the row that was cut');
  assert.doesNotMatch(JSON.stringify(long), /Wire the money|extra_34|value 34/, 'what was cut is not in the feed');
  assert.ok(!('more' in asks[6]) && asks[6].rows.every((r) => !('more' in r)), 'a short action is whole, and says nothing');
  // An action too long for any card is the short form here too: 30 rows and the one that counts the rest.
  assert.deepEqual([asks[9].rows.length, asks[9].more, asks[9].rows[30]], [31, true, { label: 'More', value: '119970 more that this card does not show' }]);
});

test('GET /api/asks says the same on each card, with what the card had before', async () => {
  const cards = (await srv.api('/asks')).data;
  assert.deepEqual(Object.fromEntries(cards.map((a) => [a.id, a.text])), TEXTS);
  assert.deepEqual(cards.filter((a) => a.yesOn === 'card').map((a) => a.id), ON_CARD);
  const byId = Object.fromEntries(cards.map((a) => [a.id, a]));
  assert.deepEqual(byId['a-perm'].what, { label: 'browse the web', hint: 'search, and read web pages', tools: ['WebSearch', 'WebFetch'] });
  // A changed bot: who proposed it, a title that names what changes, and its parts (docs/api.md).
  assert.deepEqual([byId['a-change'].by, byId['a-change'].title], ['chief', 'Change Mail Sorter: commands and new rules?']);
  assert.deepEqual(byId['a-change'].parts, [{ label: 'Rules', was: '', now: 'Never delete mail.' }, { label: 'What it may do', now: 'run commands' }]);
  assert.match(byId['a-change'].details, /^Rules\nNow: \nProposed: Never delete mail\.\n\nTools\nNow: Read\nProposed: Read, Bash$/, '`details` stays for an app from before');
  assert.deepEqual([byId['a-own'].by, byId['a-own'].title, byId['a-own'].parts], ['bot', 'Change Mail Sorter: new main assignment?', [{ label: 'Main assignment', was: 'Do the test task.', now: 'Sort the mail twice a day.' }]]);
  // Asked for before the Chief's tools said which chat asks: no chat, and a yes starts nothing.
  for (const id of ['a-change', 'a-own', 'a-skill']) assert.deepEqual([byId[id].chatId, byId[id].then], [undefined, undefined], id);
  assert.match(byId['a-act'].details, /friend@example\.com/, 'the card is where the arguments show');
  assert.deepEqual([byId['a-act'].title, byId['a-act'].rows, byId['a-act'].held, byId['a-act'].then], ['Send email with Gmail?', [{ label: 'To', value: 'friend@example.com' }, { label: 'Text', value: 'The secret plan' }], false, { who: 'bot', text: 'It carries on when you allow it.' }]);
  assert.equal(typeof byId['a-act'].stoppedAt, 'string');
  assert.equal(byId['a-tool'].tool.packages, 1);
  // The list has all a yes approves (OK-007): every argument as a row and every value in full, nothing marked.
  const long = byId['a-long'];
  assert.equal(long.rows.length, 37);
  assert.deepEqual(long.rows.slice(0, 3), [{ label: 'To', value: 'friend@example.com' }, { label: 'Text', value: LONG_TEXT }, { label: 'Extra 0', value: 'value 0' }]);
  assert.deepEqual(long.rows[36], { label: 'Extra 34', value: 'value 34' });
  assert.ok(!('more' in long) && long.rows.every((r) => !('more' in r)));
  assert.deepEqual(long.arguments, LONG_MAIL, 'the rows say what is stored, and "Allow once" sends');
  // An action too long to show in full (OK-008): of its 120,000 arguments the list has 200 rows, each whole, and
  // says `more`. The card stays small enough to draw, however the bot filled the request.
  const huge = byId['a-huge'];
  assert.deepEqual([huge.rows.length, huge.more, huge.rows[0], huge.rows[199]], [200, true, { label: 'Field 0', value: 'x' }, { label: 'Field 199', value: 'x' }]);
  assert.ok(huge.rows.every((r) => !('more' in r)));
  assert.deepEqual([huge.title, huge.held, huge.then], ['Send email with Gmail?', false, { who: 'bot', text: 'It carries on when you allow it.' }], 'the rest of its card is as any other');
  assert.ok(JSON.stringify(huge.rows).length < 10_000, 'its rows are a few kilobytes');
  // What the yes button of a changed bot reads.
  assert.deepEqual(cards.map((a) => [a.id, a.yes]).filter(([, yes]) => yes !== undefined), [['a-web', 'Allow']]);
});

test('a new ask is announced with its line', async () => {
  const other = await makeBot(srv, { name: 'News Watcher', allowedTools: ['Read'] });
  const f = feed(srv);
  await f.wait('hello');
  const proposed = await srv.asChief(`/bots/${other.id}`, { method: 'PUT', body: { computer: 'linux' } });
  const ev = await f.wait('asks', (d) => d.list.some((a) => a.id === proposed.data.pendingChange));
  f.close();
  const mine = ev.data.list.find((a) => a.id === proposed.data.pendingChange);
  assert.deepEqual([mine.botName, mine.text, mine.yesOn], ['News Watcher', 'The Chief wants to change its computer', 'card']);
  await srv.api(`/asks/${mine.id}`, { method: 'POST', body: { yes: false } });
});

test('a waiting script job is approved on its card; a waiting AI job from its notification', async () => {
  const watcher = await makeBot(srv, { name: 'Disk Watcher' });
  const script = await srv.asChief(`/bots/${watcher.id}/jobs`, { method: 'POST', body: { name: 'Disk check', kind: 'script', cron: '0 * * * *', script: 'df -h | grep -q 9[0-9]% && echo FULL', assessment: 'A clear rule: no AI needed.' } });
  assert.equal(script.status, 201, JSON.stringify(script.data));
  assert.equal(script.data.approved, false);
  const { token, rec, run } = await heldRun(srv, watcher);
  const ai = await self(srv, token, 'jobs', { action: 'add', name: 'Morning summary', kind: 'ai', cron: '0 8 * * *', prompt: 'Summarise what the disks did.', assessment: 'It needs judgement.' });
  assert.equal(ai.data.needsApproval, true, JSON.stringify(ai.data));
  srv.release(rec); await srv.finished(run.id); srv.unhold();

  const f = feed(srv);
  const hello = await f.wait('hello');
  f.close();
  const jobs = hello.data.approvals.jobs.filter((j) => j.botId === watcher.id);
  const who = { botId: watcher.id, botName: 'Disk Watcher', botEmoji: watcher.emoji, botColor: watcher.color };
  assert.deepEqual(jobs, [
    { ...who, jobId: script.data.id, jobName: 'Disk check', kind: 'script', when: script.data.when, text: `Wants to add a script: Disk check, ${script.data.when}`, yesOn: 'card', no: 'Decline and remove' },
    { ...who, jobId: ai.data.job.id, jobName: 'Morning summary', kind: 'ai', when: ai.data.job.when, text: `Wants to add a job: Morning summary, ${ai.data.job.when}`, no: 'Decline and remove', then: { who: 'bot', text: 'It carries on with “Test message” when you allow it.' } }, // the bot set it up in a run the owner started (ADR 009)
  ]);
  assert.equal(jobs[0].when, 'Hourly', 'the words the job view has');
  assert.ok(!('yesOn' in jobs[1]));
  assert.doesNotMatch(JSON.stringify(jobs), /df -h|Summarise what/);
});

test('a waiting tile has its line and is approved on its card', async () => {
  const keeper = await makeBot(srv, { name: 'Door Keeper' });
  const t = await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'value', title: 'Door', bot: keeper.id, read: { type: 'script', script: 'cat /tmp/door-state' } } });
  assert.equal(t.data.approved, false);
  const f = feed(srv);
  const hello = await f.wait('hello');
  f.close();
  const tile = hello.data.approvals.tiles.find((x) => x.tileId === t.data.id);
  assert.deepEqual(tile, { tileId: t.data.id, title: 'Door', botId: keeper.id, botName: 'Door Keeper', botColor: keeper.color, by: 'chief', text: 'Wants to put “Door” on your Board (a script)', yesOn: 'card', no: 'Decline and remove' });
  assert.doesNotMatch(JSON.stringify(hello.data.approvals), /door-state/);
});
