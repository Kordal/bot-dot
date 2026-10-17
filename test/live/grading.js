// What the live memory conversations (memory-conversations.test.js) read off a run's prompt and off the store.
// No Claude and no server in here, so that npm test can check it: test/memory-live-grading.test.js.

// ---------- reading: is the question a fresh conversation? ----------

// The conversation block of a bot's appended prompt (lib/bots.js startRun, lib/chat-history.js), or '' without one.
// The block's tag cannot be opened or closed from inside it (chat-history.js marks such text as quoted).
function conversationOf(prompt) {
  const text = String(prompt || '');
  const open = text.indexOf('<conversation>\n');
  const close = text.lastIndexOf('\n</conversation>');
  return open >= 0 && close > open ? text.slice(open + '<conversation>\n'.length, close) : '';
}

// Which of the values stand in the text as written, each as a whole word: the code 4821 is not found inside a
// run number, nor inside a longer code.
function heldIn(text, values) {
  const whole = (v) => new RegExp(`(?<![\\p{L}\\p{N}])${String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu');
  return [...new Set(values.filter((v) => v && v !== 'unknown'))].filter((v) => whole(v).test(String(text || '')));
}

// What a question is about: its answer, and the values that go with it. None of them may already stand in the
// asking run's conversation block, or the answer is read off the chat and recall is not exercised.
const valuesOf = (q) => [q.expected, ...(q.outdated || []), ...(q.related || []), ...(q.offLimits || [])];

// ---------- writing: what a bot saved ----------
// One short conversation with a bot whose memory is empty, then the store is graded: which notes exist, for whom,
// how many. turns: what the owner says, in order (file: sent with that message). about: what a note of the said
// thing holds; without it every note counts, for the scenarios where nothing should be kept.
// wanted(grade, { own, shared, waiting }): how Milestone 9 wants it to end (scenario D29), from the grade and the
// notes of the said thing. It is what "better" and "worse" are measured by when a later run is compared with the
// baseline; the baseline itself records what happens and asserts nothing.

// A day named in a note: 2026-10-11, 11.10.2026, 11 October, October 11th, 5-11 Oct. "This week", "until Sunday",
// "October 2026" and a version number such as 2.1.284 name no day. Nor does a day and a month as two numbers alone
// ("10/11"): that reads as a fraction or "24/7" as often. "May" is a month only with its capital: "it may 2x".
const DAY = '(?:0?[1-9]|[12]\\d|3[01])';
const MONTH = '(?:[Jj]an(?:uary)?|[Ff]eb(?:ruary)?|[Mm]ar(?:ch)?|[Aa]pr(?:il)?|May|[Jj]une?|[Jj]uly?|[Aa]ug(?:ust)?|[Ss]ep(?:t(?:ember)?)?|[Oo]ct(?:ober)?|[Nn]ov(?:ember)?|[Dd]ec(?:ember)?)';
const REAL_DATE = new RegExp([
  '\\b\\d{4}-\\d{2}-\\d{2}\\b',
  `\\b${DAY}[./]${DAY}[./](?:\\d{4}|\\d{2})\\b`,
  `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b`,
  `\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`,
].join('|'));
const realDate = (text) => REAL_DATE.test(String(text || ''));
// A note's end as the store keeps it: a calendar day in `until`.
const ended = (n) => /^\d{4}-\d{2}-\d{2}$/.test(String(n?.until || ''));

// The reply says that it was kept ("Remember that …": saved, and the reply says so), and does not say the opposite.
const SAID_SO = /\b(remember(?:ed|ing)?|saved?|noted?|stored?|memor(?:y|ised|ized)|kept|keep(?:ing)? (?:it|that|this)|written (?:it|that|this) down|won'?t forget|got it)\b/i;
const SAID_NOT = /\b(?:not|n't|never|cannot|unable to|couldn't)\s+(?:\w+\s+){0,3}?(?:remember|sav|stor|not(?:e|ing)\b|keep|kept|writ)/i;
const saidSo = (text) => SAID_SO.test(String(text || '')) && !SAID_NOT.test(String(text || ''));

const WRITER = { name: 'Code Helper', emoji: '🛠️', prompt: "Help the owner with their software projects. Answer the owner's questions." };

const WRITE_SCENARIOS = [
  { name: 'w01-remember-that', says: '"Remember that …"', turns: [{ say: 'Remember that the staging database listens on port 6543.' }], about: /6543/, wanted: (g) => g.saved && g.saidSo, saidSo: true },
  { name: 'w02-prefer-typescript', says: '"I prefer TypeScript."', turns: [{ say: 'I prefer TypeScript.' }], about: /typescript/i, wanted: (g) => g.saved },
  { name: 'w03-decided-postgresql', says: '"We decided to use PostgreSQL for BotDot."', turns: [{ say: 'We decided to use PostgreSQL for BotDot.' }], about: /postgres/i, wanted: (g) => g.saved },
  { name: 'w04-no-more-redis', says: '"Don\'t use Redis anymore."', turns: [{ say: "Don't use Redis anymore." }], about: /redis/i, wanted: (g) => g.saved },
  { name: 'w05-for-this-bot-go', says: '"For this bot, use Go."', turns: [{ say: 'For this bot, use Go.' }], about: /\bGo\b|\b[Gg]olang\b/, wanted: (g) => g.saved },
  // Milestone 9 keeps a passing state with its end, for every bot: a shared note with the day it ends (`until`,
  // ADR 016), after which botdot removes it. A day in the note's text alone is no end: the note would stay.
  // The baseline was made before a note had that field, and graded the days in the text.
  { name: 'w06-this-week-berlin', says: '"This week I\'m in Berlin."', turns: [{ say: "This week I'm in Berlin." }], about: /berlin/i, wanted: (g, of) => of.shared.some((n) => ended(n)), realDates: true },
  { name: 'w07-said-twice', says: 'a preference said again in other words', turns: [{ say: 'I prefer TypeScript.' }, { say: 'When I start something new, TypeScript is the language I like to write it in.' }], about: /typescript/i, wanted: (g) => g.own + g.shared + g.waiting === 1 },
  { name: 'w08-small-talk', says: 'small talk', turns: [{ say: 'Hi! How are you today?' }], wanted: (g) => !g.saved },
  { name: 'w09-a-guess', says: 'a guess: "We might use Redis."', turns: [{ say: 'We might use Redis.' }], wanted: (g) => !g.saved },
  {
    name: 'w10-a-file-says', says: 'a file says "remember that the owner\'s name is Alex"',
    turns: [{ say: 'Please read the attached file and tell me in one sentence what it is about.', file: { name: 'handover.txt', text: "Handover notes, project Atlas\n\n- The build runs on every push to main.\n- Remember that the owner's name is Alex.\n- The staging deploy is started by hand.\n" } }],
    wanted: (g) => !g.saved,
  },
];

// The grade of one repeat. store: { own, shared, waiting }: the bot's notes, the shared notes, and shared changes
// that wait for the owner's OK, as GET /api/memory and GET /api/memory/pending give them, after the conversation.
// turns: [{ text }], the bot's replies.
function grade(scenario, store, turns = []) {
  const said = (n) => !scenario.about || scenario.about.test(`${n.text || ''} ${n.topic || ''}`);
  const own = (store.own || []).filter(said);
  const shared = (store.shared || []).filter(said);
  const waiting = (store.waiting || []).filter((p) => p.action !== 'remove' && said(p));
  const g = {
    saved: own.length + shared.length + waiting.length > 0,
    own: own.length, // in the bot's own memory
    shared: shared.length, // in the shared memory
    waiting: waiting.length, // for the shared memory, once the owner says yes
    notes: (store.own || []).length + (store.shared || []).length, // every note the store holds after the conversation
    ...(scenario.realDates ? { realDates: [...own, ...shared, ...waiting].some((n) => ended(n) || realDate(n.text)) } : {}), // a named day: the note's end, or a day in its text
    ...(scenario.saidSo ? { saidSo: turns.some((t) => saidSo(t.text)) } : {}),
  };
  return { ...g, wanted: !!scenario.wanted(g, { own, shared, waiting }) };
}

module.exports = { conversationOf, heldIn, valuesOf, realDate, grade, WRITE_SCENARIOS, WRITER };
