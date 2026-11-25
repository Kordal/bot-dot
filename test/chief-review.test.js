// The Chief's memory review (#117): on the review's day and time, a run of the Chief with no tools over its own
// notes and the shared notes, whose proposals become skill cards in Needs you; the owner's yes creates and gives the
// skill and removes the notes it replaces, and a no is not proposed again. lib/chief-review.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, makeBot, waitFor, sharedByBot } = require('./helpers');
const review = require('../lib/chief-review');
const { cardOf } = require('../lib/learning');

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

test('a proposal is tried on past tasks before its card; one worse on more is dropped, and a restart meanwhile still brings the cards', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chief-review-'));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const notes = [{ id: 'n1', owner: '_shared', text: 'To file: open the sheet.', at: '2026-01-01' }, { id: 'n2', owner: '_shared', text: 'To order: call.', at: '2026-01-01' }];
  const added = [];
  let posted = '';
  let release;
  const held = new Promise((r) => { release = r; });
  const deps = {
    dataDir: dir,
    memory: { lastReview: () => null, setLastReview: () => {}, notesOf: (o) => (o === '_shared' ? notes : []), reviewSettings: () => ({ model: 'opus' }) },
    skills: { list: () => [] }, bots: { list: () => BOTS, get: (id) => BOTS.find((b) => b.id === id) },
    asks: { list: () => [], add: (a) => added.push(a) }, attachSkill: () => {}, post: (t) => { posted = t; return 'c1'; },
    run: async () => JSON.stringify({ proposals: [{ ...NEW, bots: ['Cook'], replaces: ['n1'] }, { ...NEW, name: 'ordering', bots: ['Cook'], replaces: ['n2'] }] }),
  };
  const tried = [];
  const r = review.create({ ...deps, test: async (p) => { tried.push(p.name); await held; return p.name === 'ordering' ? { of: 4, better: 1, worse: 2, same: 1, failed: 0 } : { of: 4, better: 3, worse: 0, same: 1, failed: 0 }; } });
  const going = r.review();
  await waitFor(() => tried.length === 1, { what: 'the first to be tried' });
  assert.deepEqual(added, [], 'no card while it is tried');
  // botdot stops now and starts again: the cards of what was being tried come untried.
  review.create({ ...deps, test: async () => null });
  assert.deepEqual(added.map((a) => [a.written.name, a.written.tested]), [['expense-filing', undefined], ['ordering', undefined]]);
  added.length = 0;
  release();
  await going;
  assert.deepEqual(tried, ['expense-filing', 'ordering']);
  assert.deepEqual(added.map((a) => a.written.name), ['expense-filing'], 'the worse one gets no card');
  assert.match(added[0].reason, /^Better on 3 of 4 past tasks, worse on 0\. It is a how-to\./);
  assert.deepEqual(added[0].written.tested, { of: 4, better: 3, worse: 0, same: 1, failed: 0 });
  assert.match(posted, /- Proposed the skill “expense-filing” for Cook, in place of one note\. Better on 3 of 4 past tasks, worse on 0\./);
  assert.match(posted, /- Dropped the skill “ordering”: worse on 2 of 4 past tasks, better on 1\./);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'chief-review.json'), 'utf8'));
  assert.deepEqual([saved.testing, saved.declined.map((d) => d.key)], [[], ['skill:ordering']], 'not proposed again');
});

// ---------- notes that cannot both be true (#1714) ----------

const dated = (id, text, at, source = 'bot', owner = '_shared') => ({ id, owner, text, at, source });
const PAIRS = [
  dated('old', 'The staging database listens on port 6543.', '2026-03-02'),
  dated('new', 'Staging is on port 5433.', '2026-10-09'),
  dated('o1', 'The owner works from the office on Tuesdays.', '2026-05-01', 'owner', 'chief'),
  dated('o2', 'The owner works from home every day.', '2026-09-01', 'owner', 'chief'),
  dated('plain', 'Bart lives in Kraków.', '2026-01-01'),
  // The Chief's own notes (a bot's word, not the owner's): a pair among them is settled at once.
  dated('cold', 'The newsletter goes out on Mondays.', '2026-02-01', 'bot', 'chief'),
  dated('cnew', 'The newsletter goes out on Thursdays.', '2026-09-01', 'bot', 'chief'),
];
const EMPTY = { removed: [], proposed: [], pairs: [], over: 0 };
const settle = (raw, limit = 3, notes = PAIRS) => review.settledOf(JSON.stringify(raw), { notes, limit });

test('its prompt holds the step and the limit: pairs that cannot both be true, the newer one kept, the owner\'s pair only named', () => {
  const s = review.systemPrompt({ limit: 3 });
  assert.match(s, /cannot both be true now/);
  assert.match(s, /Keep the newer one unless the older one is clearly the correction/);
  assert.match(s, /"settle"/);
  assert.match(s, /both are marked "the owner said"[^\n]*neither[^\n]*"owner_pairs"/);
  assert.match(s, /at most 3 notes of each kind/);
  assert.match(s, /one of your own notes, botdot removes it at once[^]*shared note[^]*asks the owner on a card/, 'its own at once, a shared one on a card');
  assert.match(s, /never removed or proposed for removal/);
  assert.doesNotMatch(s, /You have no tools here, and you change nothing:/, 'it no longer changes nothing');
  assert.doesNotMatch(review.systemPrompt({ limit: 0 }), /cannot both be true now/, 'no step where there is no room for a removal');
});

test('an answer settles a pair: the older of the Chief\'s own notes is removed, the older shared note is only proposed; each is checked against the notes it was handed', () => {
  const own = settle({ settle: [{ remove: 'cold', keep: 'cnew', reason: 'the day moved' }] });
  assert.deepEqual(own.removed.map((r) => [r.note.id, r.keep.id]), [['cold', 'cnew']]);
  assert.match(own.removed[0].reason, /^lost to \[cnew\] “The newsletter goes out on Thursdays\.”: the day moved$/, 'the reason names the note it lost to');
  assert.deepEqual([own.proposed, own.pairs, own.over], [[], [], 0]);
  const shared = settle({ settle: [{ remove: 'old', keep: 'new', reason: 'the port moved' }] });
  assert.deepEqual(shared.removed, [], 'a shared note is never removed at once');
  assert.deepEqual(shared.proposed.map((r) => [r.note.id, r.keep.id]), [['old', 'new']]);
  assert.equal(shared.proposed[0].reason, 'lost to “Staging is on port 5433.”: the port moved', 'its card names the newer note by its words');
  for (const bad of [{ remove: 'ghost', keep: 'new' }, { remove: 'old', keep: 'ghost' }, { remove: 'old', keep: 'old' }, { remove: 'old' }, 'old']) {
    assert.deepEqual(settle({ settle: [bad] }), EMPTY, JSON.stringify(bad));
  }
  assert.deepEqual(review.settledOf('NOTHING', { notes: PAIRS, limit: 3 }), EMPTY);
  assert.deepEqual(review.settledOf('{"proposals": []}', { notes: PAIRS, limit: 3 }), EMPTY);
  assert.deepEqual(review.settledOf('not json {', { notes: PAIRS, limit: 3 }), EMPTY);
  // Not one note twice, and not a note that lost in one pair and wins in another.
  const chain = [...PAIRS, dated('newest', 'Staging is on port 5434.', '2026-11-01')];
  const twice = settle({ settle: [{ remove: 'old', keep: 'new' }, { remove: 'old', keep: 'newest' }, { remove: 'new', keep: 'newest' }] }, 3, chain);
  assert.deepEqual(twice.proposed.map((r) => [r.note.id, r.keep.id]), [['old', 'new']]);
});

test('what the owner said is never removed: a pair of theirs is named, and a note of theirs that lost to a bot\'s is left', () => {
  const got = settle({ settle: [{ remove: 'o1', keep: 'o2' }, { remove: 'o2', keep: 'old' }], owner_pairs: [['o1', 'o2']] });
  assert.deepEqual([got.removed, got.proposed], [[], []], 'never removed, and never proposed for removal');
  assert.deepEqual(got.pairs.map((p) => p.map((n) => n.id)), [['o1', 'o2']], 'the pair, once');
  // The pair is named whether the model listed it or tried to settle it; and only a pair that are both the owner's.
  assert.deepEqual(settle({ settle: [{ remove: 'o1', keep: 'o2' }] }).pairs.map((p) => p.map((n) => n.id)), [['o1', 'o2']]);
  assert.deepEqual(settle({ owner_pairs: [['o1', 'plain']] }).pairs, []);
  assert.deepEqual(settle({ owner_pairs: [['o1', 'o1']] }).pairs, []);
  const lostToBot = settle({ settle: [{ remove: 'o1', keep: 'plain' }, { remove: 'o1', keep: 'cnew' }] });
  assert.deepEqual([lostToBot.removed, lostToBot.proposed], [[], []], 'a bot\'s note does not replace the owner\'s');
});

test('a review removes at most a quarter of the notes it reads, at least 3; proposals use none of it, and are kept to the same number; the rest is said as left for the next', () => {
  const pairs = (owner, tag) => Array.from({ length: 6 }, (_, i) => [dated(`${tag}a${i}`, `Port is ${i}0.`, '2026-01-01', 'bot', owner), dated(`${tag}b${i}`, `Port is ${i}1.`, '2026-06-01', 'bot', owner)]).flat();
  const many = [...pairs('chief', 'c'), ...pairs('_shared', 's')];
  const of = (tag) => ({ settle: Array.from({ length: 6 }, (_, i) => ({ remove: `${tag}a${i}`, keep: `${tag}b${i}` })) });
  const ownOnly = settle(of('c'), 3, many);
  assert.deepEqual([ownOnly.removed.map((r) => r.note.id), ownOnly.over], [['ca0', 'ca1', 'ca2'], 3]);
  assert.equal(settle(of('c'), 1, many).removed.length, 1);
  assert.deepEqual(settle(of('c'), 0, many), EMPTY, 'no room for a removal, and nothing said of it');
  // Proposals are bounded by the same number, and a review that removed all it may can still propose that many.
  const both = settle({ settle: [...of('c').settle, ...of('s').settle] }, 3, many);
  assert.deepEqual([both.removed.length, both.proposed.length, both.over], [3, 3, 6], 'three removed at once and three proposed: neither uses up the other');
  assert.deepEqual(both.proposed.map((r) => r.note.id), ['sa0', 'sa1', 'sa2']);
});

test('its report says each removal with the note it lost to, each proposal as waiting, the owner\'s pair as one line, and what is left for the next review', () => {
  const got = settle({ settle: [{ remove: 'cold', keep: 'cnew' }, { remove: 'old', keep: 'new', reason: 'the port moved' }], owner_pairs: [['o1', 'o2']] });
  const text = review.reportOf([], [], { ...got, over: 2, limit: 3 });
  assert.match(text, /^Memory review of my notes and the shared notes\./);
  assert.doesNotMatch(text, /nothing to change/);
  assert.match(text, /- Removed my note “The newsletter goes out on Mondays\.”: it lost to “The newsletter goes out on Thursdays\.”\. It can be brought back for 30 days\./);
  assert.match(text, /- Proposed removing the shared note “The staging database listens on port 6543\.”: it lost to the newer “Staging is on port 5433\.”\. It waits for your OK in Needs you\./);
  assert.match(text, /- Two things you said cannot both be true: “The owner works from the office on Tuesdays\.” and “The owner works from home every day\.”\. Tell me which holds\./);
  assert.match(text, /- Left for the next review: 2 more removals \(a review settles at most 3 notes of each kind\)\./);
  assert.match(review.reportOf([], [], EMPTY), /nothing to change/);
  assert.match(review.reportOf([], [{ name: 'Cook', fields: ['prompt'] }], got), /Removed my note[^]*Changed since the last review:/);
});

test('a review removes the Chief\'s own loser at once and only proposes the shared one; nothing for an answer with nothing to settle', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chief-review-'));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const removed = [];
  const proposed = [];
  let waiting = [];
  let posted = '';
  let prompted = null;
  let answer = JSON.stringify({ settle: [{ remove: 'cold', keep: 'cnew', reason: 'the day moved' }, { remove: 'old', keep: 'new', reason: 'the port moved' }, { remove: 'o1', keep: 'o2' }] });
  const make = () => review.create({
    dataDir: dir, removalLimit: (n) => Math.max(3, Math.floor(n / 4)),
    memory: {
      lastReview: () => null, setLastReview: () => {}, notesOf: (o) => PAIRS.filter((n) => n.owner === o), reviewSettings: () => ({ model: 'opus' }),
      removeNote: (owner, id, opts) => { removed.push([owner, id, opts]); },
      pending: () => waiting, propose: (p) => { proposed.push(p); },
    },
    skills: { list: () => [] }, bots: { list: () => BOTS, get: (id) => BOTS.find((b) => b.id === id) },
    asks: { list: () => [], add: () => {} }, attachSkill: () => {}, post: (t) => { posted = t; return 'c1'; },
    run: async ({ system, prompt }) => { prompted = { system, prompt }; return answer; },
  });
  const done = await make().review();
  assert.deepEqual(removed.map(([owner, id, o]) => [owner, id, o.by, /^lost to \[cnew\]/.test(o.reason)]), [['chief', 'cold', 'chief', true]], 'only the Chief\'s own note, as the Chief');
  assert.deepEqual(proposed.map((p) => [p.action, p.owner, p.noteId, p.by, p.reason]), [['remove', '_shared', 'old', 'chief', 'lost to “Staging is on port 5433.”: the port moved']], 'the shared one waits on a card');
  assert.deepEqual(done.proposals, []);
  assert.match(prompted.system, /at most 3 notes of each kind/, 'a quarter of the 7 notes it reads is under the least, 3');
  assert.match(posted, /Removed my note “The newsletter goes out on Mondays\.”/);
  assert.match(posted, /Proposed removing the shared note “The staging database listens on port 6543\.”[^\n]*waits for your OK in Needs you/);
  assert.match(posted, /Two things you said cannot both be true/);
  // A shared note that already waits on a card is not proposed (or said) again.
  removed.length = 0; proposed.length = 0;
  waiting = [{ action: 'remove', noteId: 'old' }];
  await make().review();
  assert.deepEqual(proposed, []);
  assert.doesNotMatch(posted, /Proposed removing/);
  waiting = [];
  removed.length = 0;
  answer = 'NOTHING';
  await make().review();
  assert.deepEqual([removed, proposed], [[], []]);
  assert.match(posted, /nothing to change/);
  // A removal or a proposal that fails is left out of the report and does not stop the review.
  answer = JSON.stringify({ settle: [{ remove: 'cold', keep: 'cnew' }, { remove: 'old', keep: 'new' }] });
  const broken = review.create({ ...{ dataDir: dir, removalLimit: () => 3, memory: { lastReview: () => null, setLastReview: () => {}, notesOf: (o) => PAIRS.filter((n) => n.owner === o), removeNote: () => { throw new Error('No note with id cold'); }, propose: () => { throw new Error('No note with id old'); }, reviewSettings: () => ({}) }, skills: { list: () => [] }, bots: { list: () => BOTS, get: () => null }, asks: { list: () => [], add: () => {} }, attachSkill: () => {}, post: (t) => { posted = t; return 'c1'; }, run: async () => answer } });
  await broken.review();
  assert.match(posted, /nothing to change/);
});

// Against the real store: a shared note waits and is still there; the Chief's own is gone at once and comes back for 30 days.
test('with the real store: the shared loser stays until the owner says yes, the Chief\'s own loser is removed with a reason and can be brought back', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chief-review-store-'));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const memory = require('../lib/memory').create(dir);
  const sOld = memory.addNote('_shared', 'The staging database listens on port 6543.', { by: 'bot', source: 'bot', similarIn: [] }).note;
  const sNew = memory.addNote('_shared', 'Staging is on port 5433.', { by: 'bot', source: 'bot', similarIn: [] }).note;
  const cOld = memory.addNote('chief', 'The newsletter goes out on Mondays.', { by: 'chief', source: 'bot', similarIn: [] }).note;
  const cNew = memory.addNote('chief', 'The newsletter goes out on Thursdays.', { by: 'chief', source: 'bot', similarIn: [] }).note;
  const oOld = memory.addNote('_shared', 'The owner works from the office on Tuesdays.', { by: 'you', source: 'owner', similarIn: [] }).note;
  const oNew = memory.addNote('_shared', 'The owner works from home every day.', { by: 'you', source: 'owner', similarIn: [] }).note;
  let posted = '';
  const r = review.create({
    dataDir: dir, memory, skills: { list: () => [] }, bots: { list: () => BOTS, get: () => null }, asks: { list: () => [], add: () => {} },
    removalLimit: (n) => Math.max(3, Math.floor(n / 4)), attachSkill: () => {}, post: (t) => { posted = t; return 'c1'; },
    run: async () => JSON.stringify({ settle: [
      { remove: cOld.id, keep: cNew.id, reason: 'the day moved' }, { remove: sOld.id, keep: sNew.id, reason: 'the port moved' }, { remove: oOld.id, keep: oNew.id },
    ], owner_pairs: [[oOld.id, oNew.id]] }),
  });
  await r.review();
  // The shared note: still there, and a card waits for it, with the note and the newer one it lost to.
  assert.ok(memory.getNote(sOld.id), 'the shared note still exists');
  const cards = memory.pending();
  assert.equal(cards.length, 1);
  assert.deepEqual([cards[0].action, cards[0].owner, cards[0].noteId, cards[0].by, !!cards[0].guarded], ['remove', '_shared', sOld.id, 'chief', false]);
  assert.equal(cards[0].current.text, 'The staging database listens on port 6543.', 'the card shows the note it would remove');
  const card = cardOf(cards[0]);
  assert.deepEqual([card.title, card.yes, card.no], ['Remove from the shared memory', 'Approve', 'Decline']);
  assert.match(card.meta, /Staging is on port 5433\./, 'and the newer note it lost to');
  // The owner's pair: both notes untouched, no card, named in the report.
  assert.ok(memory.getNote(oOld.id) && memory.getNote(oNew.id));
  assert.match(posted, /Two things you said cannot both be true/);
  assert.match(posted, /Proposed removing the shared note “The staging database listens on port 6543\.”/);
  // The Chief's own note: gone at once, with the reason, and it can be brought back.
  assert.ok(!memory.getNote(cOld.id));
  assert.ok(memory.getNote(cNew.id));
  const gone = memory.removedOf(['chief']);
  const entry = (gone.notes || gone)[0];
  assert.match(entry.reason || '', /^lost to \[[^\]]+\] “The newsletter goes out on Thursdays\.”: the day moved$/);
  assert.match(posted, /Removed my note “The newsletter goes out on Mondays\.”[^\n]*30 days/);
  const back = memory.restoreNote(entry.vid, { by: 'you' });
  assert.equal(back.note.text, 'The newsletter goes out on Mondays.');
  // Only the owner's yes removes the shared one.
  assert.ok(memory.getNote(sOld.id));
  memory.settle(cards[0].id, true);
  assert.ok(!memory.getNote(sOld.id));
  assert.ok(memory.getNote(sNew.id));
  // A second review proposes it no more (the note is gone), and one that has the card waiting asks for no second card.
  await r.review();
  assert.deepEqual(memory.pending(), []);
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
  // The scheduler's minute after the next one is the review's, in the test server's zone (UTC), not this machine's (#1273).
  const next = new Date(Date.parse(await srv.tick()) + 60_000);
  await srv.api('/memory/settings', { method: 'PUT', body: { review: { enabled: true, day: next.getUTCDay(), time: `${pad(next.getUTCHours())}:${pad(next.getUTCMinutes())}` } } });
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

test('on a real botdot the Chief\'s review proposes removing the older shared note of a pair on a card in Needs you, and the note stays until the owner\'s yes', async () => {
  // Two notes a bot concluded (what the owner typed is theirs, and the review leaves it).
  const older = await sharedByBot(srv, cook, 'The staging database listens on port 6543.');
  const newer = await sharedByBot(srv, cook, 'Staging is on port 5433.');
  srv.unhold();
  srv.reply(JSON.stringify({ settle: [{ remove: older.id, keep: newer.id, reason: 'the port moved' }] }));
  const before = (await notices()).length;
  const runs = reviewRuns().length;
  assert.equal((await srv.asChief('/memory/review/chief', { method: 'POST' })).status, 200);
  const run = await waitFor(() => reviewRuns()[runs], { what: 'the review' });
  const system = fs.readFileSync(run.args[run.args.indexOf('--append-system-prompt-file') + 1], 'utf8');
  assert.match(system, /cannot both be true now[^]*at most 3 notes/);
  const report = await waitFor(async () => { const l = await notices(); return l.length > before ? l.at(-1) : null; }, { what: 'the report' });
  assert.match(report, /Proposed removing the shared note “The staging database listens on port 6543\.”: it lost to the newer “Staging is on port 5433\.”\. It waits for your OK in Needs you\./);
  const shared = (await srv.api('/memory')).data.shared.map((n) => n.id);
  assert.ok(shared.includes(older.id) && shared.includes(newer.id), 'both stay until the owner says');
  // The card in Needs you shows the note it would remove and the newer one it lost to.
  const card = await waitFor(async () => (await srv.api('/memory/pending')).data.find((c) => c.action === 'remove' && c.noteId === older.id), { what: 'the card' });
  assert.deepEqual([card.title, card.yes, card.no, card.current.text], ['Remove from the shared memory', 'Approve', 'Decline', 'The staging database listens on port 6543.']);
  assert.match(card.meta, /Staging is on port 5433\./);
  assert.equal(card.bot?.name, 'Chief of Staff');
  // Their yes removes the older one, and only that one.
  assert.equal((await srv.api(`/memory/pending/${card.id}`, { method: 'POST', body: { approve: true } })).status, 200);
  const after = (await srv.api('/memory')).data.shared.map((n) => n.id);
  assert.ok(!after.includes(older.id) && after.includes(newer.id));
});
