// The Chief's memory review (#117): on the review's day and time, a run of the Chief with no tools over its own
// notes and the shared notes, whose proposals become skill cards in Needs you; the owner's yes creates and gives the
// skill and removes the notes it replaces, and a no is not proposed again. lib/chief-review.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, makeBot, waitFor } = require('./helpers');
const review = require('../lib/chief-review');

// ---------- what an answer proposes ----------

const NOTES = [{ id: 'n1', owner: 'chief', text: 'To file an expense: open the sheet, add a row, check the total.' }, { id: 'n2', owner: '_shared', text: 'Bart lives in Kraków.' }];
const BOTS = [{ id: 'b1', name: 'Cook', skills: [] }, { id: 'b2', name: 'Shopper', skills: ['price-check'] }];
const SKILLS = [{ name: 'price-check', description: 'Check a price', instructions: 'Look it up twice.' }];
const NEW = { kind: 'skill', name: 'expense-filing', description: 'When filing an expense', instructions: '1. Open the sheet.', bots: ['Cook', 'Chief of Staff'], replaces: ['n1'], reason: 'It is a how-to.' };
const SHARE = { kind: 'share', name: 'price-check', bots: ['Cook', 'Shopper'], reason: 'Cook buys too.' };

test('an answer proposes at most three skills, each checked against the notes, the bots and the library', () => {
  const of = (list, opts = {}) => review.proposalsOf(JSON.stringify({ proposals: list }), { notes: NOTES, bots: BOTS, skills: SKILLS, library: ['price-check'], ...opts });
  const [made, shared] = of([NEW, SHARE]);
  assert.deepEqual([made.kind, made.name, made.bots, made.names, made.replaces, made.key], ['skill', 'expense-filing', ['b1', 'chief'], ['Cook', 'Chief of Staff'], ['n1'], 'skill:expense-filing']);
  assert.deepEqual([shared.kind, shared.bots, shared.instructions, shared.key], ['share', ['b1'], 'Look it up twice.', 'share:price-check:b1'], 'never to a bot that has it');
  for (const bad of [{ name: 'Bad Name' }, { name: 'price-check' }, { bots: ['Nobody'] }, { replaces: ['n9'] }, { replaces: [] }, { description: '' }, { instructions: '' }]) {
    assert.deepEqual(of([{ ...NEW, ...bad }]), [], JSON.stringify(bad));
  }
  assert.deepEqual(of([{ ...SHARE, bots: ['Shopper'] }]), [], 'every bot has it already');
  assert.deepEqual(of([{ ...SHARE, name: 'other' }]), [], 'a skill no bot wrote lately');
  assert.deepEqual(of([NEW], { skip: (key) => key === 'skill:expense-filing' }), [], 'turned down or waiting');
  assert.equal(of([NEW, { ...NEW, name: 'b', replaces: ['n2'] }, { ...NEW, name: 'c', replaces: ['n2'] }, SHARE, { ...NEW, name: 'd' }]).length, 3, 'one note in one proposal, three at most');
  assert.deepEqual(review.proposalsOf('NOTHING', {}), []);
});

test('its card is a written skill of the Chief, and its report has one line per proposal', () => {
  const [p] = review.proposalsOf([NEW], { notes: NOTES, bots: BOTS });
  const a = review.askOf(p, [NOTES[0]]);
  assert.deepEqual([a.kind, a.botId, a.forBots, a.url, a.written.from, a.written.share, a.skill.exists], ['skill', null, ['b1', 'chief'], '', 'review', false, false]);
  assert.match(a.reason, /^It is a how-to\. Replaces the note: “To file an expense/);
  assert.equal(review.lineOf(a), 'Proposes a skill for Cook and Chief of Staff: “expense-filing”');
  assert.match(review.reportOf([p]), /Proposed the skill “expense-filing” for Cook and Chief of Staff, in place of one note\./);
  assert.match(review.reportOf([]), /nothing to change/);
});

test('it runs only when something changed since the last one, and a yes on a share is bound to the text shown', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chief-review-'));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let runs = 0;
  let last = null;
  const read = new Set();
  const skill = { name: 'price-check', description: 'Check a price', instructions: 'Look it up twice.', createdBy: 'bot:b2', updatedAt: '2026-01-01T00:00:00.000Z' };
  const r = review.create({
    dataDir: dir,
    memory: { lastReview: () => last, setLastReview: (_, at) => { last = at; }, notesOf: (owner) => { read.add(owner); return []; }, reviewSettings: () => ({ model: 'opus' }) },
    skills: { list: () => [skill], read: () => skill }, bots: { list: () => BOTS, get: (id) => BOTS.find((b) => b.id === id) },
    asks: { list: () => [], add: () => {} }, attachSkill: () => {}, run: async () => { runs++; return 'NOTHING'; }, post: () => 'c1',
  });
  r.due();
  await waitFor(() => runs === 1 && last, { what: 'the review' });
  r.due(); // nothing changed since
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(runs, 1);
  assert.deepEqual([...read].sort(), ['_shared', 'chief'], 'its own notes and the shared ones');
  const share = { kind: 'skill', forBots: ['b1'], written: { from: 'review', share: true, name: 'price-check', instructions: 'Look it up once.' } };
  assert.throws(() => r.approve(share), (e) => e.status === 409 && /changed since/.test(e.message));
});

// ---------- on a real botdot ----------

let srv, cook, shopper;
before(async () => {
  srv = await startServer();
  cook = await makeBot(srv, { name: 'Cook', description: 'Plans the meals and buys what they need' });
  shopper = await makeBot(srv, { name: 'Shopper', description: 'Buys the groceries' });
});
after(async () => { await srv.stop(); });

const asks = async () => (await srv.api('/asks')).data.filter((a) => a.kind === 'skill');
const notices = async () => {
  const chats = (await srv.api('/chief')).data.chats;
  const all = await Promise.all(chats.map(async (c) => (await srv.api(`/chief/chats/${c.id}`)).data.messages));
  return all.flat().filter((m) => m.notice).map((m) => m.text);
};
const reviewRuns = () => srv.runs().filter((x) => x.args.includes('🧭 Chief of Staff · memory review'));
const pad = (n) => String(n).padStart(2, '0');

test('on the review day and time the Chief reviews its notes and the shared ones, proposes skills on cards, and Allow does them', async () => {
  // A how-to the owner typed into the shared notes: only the card's yes removes it.
  const noteId = (await srv.api('/memory/notes', { method: 'POST', body: { owner: '_shared', text: 'To file an expense: open the KESTREL sheet, add a row, then check the total.' } })).data.note.id;
  await srv.api('/memory/notes', { method: 'POST', body: { owner: '_shared', text: 'Bart lives in Kraków.' } });
  // A skill Shopper wrote for itself, as its learning saves one.
  const dirOf = path.join(srv.data, 'skills', 'price-check');
  fs.mkdirSync(dirOf, { recursive: true });
  fs.writeFileSync(path.join(dirOf, 'SKILL.md'), '---\nname: price-check\ndescription: Check a price before buying\n---\n\nLook the price up in two shops.\n');
  fs.writeFileSync(path.join(dirOf, '.botdot.json'), JSON.stringify({ source: 'created', createdBy: `bot:${shopper.id}`, updatedAt: new Date().toISOString() }));
  await srv.api(`/bots/${shopper.id}`, { method: 'PUT', body: { skills: ['price-check'] } });

  srv.reply(JSON.stringify({ proposals: [
    { kind: 'skill', name: 'expense-filing', description: 'When the owner asks to file an expense', instructions: '1. Open the KESTREL sheet.\n2. Add a row.\n3. Check the total.', bots: ['Cook', 'Chief of Staff'], replaces: [noteId], reason: 'Steps for a recurring task.' },
    { kind: 'share', name: 'price-check', bots: ['Cook'], reason: 'Cook buys what the meals need.' },
    { kind: 'skill', name: 'ghost', description: 'x', instructions: 'y', bots: ['Nobody'], replaces: [noteId] },
  ] }));
  // The scheduler's minute after the next one is the review's.
  const next = new Date(Date.parse(await srv.tick()) + 60_000);
  await srv.api('/memory/settings', { method: 'PUT', body: { review: { enabled: true, day: next.getDay(), time: `${pad(next.getHours())}:${pad(next.getMinutes())}` } } });
  await srv.tick();
  const run = await waitFor(() => reviewRuns()[0], { what: 'the Chief\'s review' });
  assert.ok(!run.args.includes('--allowedTools'), 'it is allowed no tool');
  assert.equal(run.args[run.args.indexOf('--tools') + 1], '');
  assert.equal(run.args[run.args.indexOf('--model') + 1], 'claude-opus-5-5', 'the review\'s model');
  assert.match(run.stdin, /KESTREL/);
  assert.match(run.stdin, /Kraków/);
  assert.match(run.stdin, /<skill name="price-check" written-by="Shopper" used-by="Shopper">/);

  const cards = await waitFor(async () => { const l = await asks(); return l.length === 2 ? l : null; }, { what: 'two cards' });
  const made = cards.find((a) => a.skill.name === 'expense-filing');
  const share = cards.find((a) => a.skill.name === 'price-check');
  assert.equal(made.text, 'Proposes a skill for Cook and Chief of Staff: “expense-filing”');
  assert.equal(made.written, true);
  assert.match(made.skill.instructions, /Open the KESTREL sheet/);
  assert.match(made.reason, /Replaces the note: “To file an expense/);
  assert.deepEqual(made.forBots.map((b) => b.name), ['Cook']);
  assert.equal(share.text, 'Proposes giving the skill “price-check” to Cook');
  const report = await waitFor(async () => (await notices()).find((t) => /Memory review/.test(t)), { what: 'the report' });
  assert.match(report, /Proposed the skill “expense-filing” for Cook and Chief of Staff, in place of one note\./);
  assert.match(report, /Proposed giving the skill “price-check” to Cook\./);
  assert.ok((await srv.api('/memory')).data.lastReviews.chief);
  assert.equal((await srv.api('/skills/expense-filing')).status, 404, 'nothing before the owner\'s yes');

  const yes = await srv.api(`/asks/${made.id}`, { method: 'POST', body: { yes: true } });
  assert.deepEqual([yes.status, yes.data.skill, yes.data.removed], [200, 'expense-filing', 1]);
  const skill = (await srv.api('/skills/expense-filing')).data;
  assert.deepEqual([skill.createdBy, skill.usedBy.sort()], ['chief', [cook.id, 'chief'].sort()]);
  assert.ok(!(await srv.api('/memory')).data.shared.some((n) => n.id === noteId), 'the note it replaces is removed');

  assert.equal((await srv.api(`/asks/${share.id}`, { method: 'POST', body: { yes: false } })).status, 200);
  assert.ok(!(await srv.api(`/bots/${cook.id}`)).data.skills.includes('price-check'));
});

test('"Review now" for the Chief reports in its chat, and what was turned down is not proposed again', async () => {
  srv.reply(JSON.stringify({ proposals: [{ kind: 'share', name: 'price-check', bots: ['Cook'], reason: 'Again.' }] }));
  const before = (await notices()).length;
  const r = await srv.asChief('/memory/review/chief', { method: 'POST' });
  assert.deepEqual([r.status, r.data.started, r.data.chief], [200, true, true]);
  const run = await waitFor(() => reviewRuns()[1], { what: 'the second review' });
  assert.match(run.stdin, /turned down: Proposes giving the skill “price-check” to Cook/);
  const report = await waitFor(async () => { const l = await notices(); return l.length > before ? l.at(-1) : null; }, { what: 'the report' });
  assert.match(report, /nothing to change/);
  assert.deepEqual(await asks(), []);
});
