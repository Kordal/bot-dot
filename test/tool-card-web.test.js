// The card of a tool to install on the web page (TOOL-003): public/tool-card.js loaded the way the browser
// loads it (a plain script), for the card's markup from a registry ask, an ask from a link and an ask with
// unknown or missing fields, every value escaped; then the page's own code, cut out of app.js and run against
// stand-ins: the card under its bot's head, its place in the chats and among the banner's heads, and what
// Install and Decline send and show. The card on a real page is walked in test/browser/tool-card.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const page = vm.createContext({});
vm.runInContext(read('tool-card.js'), page);
const { ToolCard } = page;
const app = read('app.js');
const css = read('style.css');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// A part of app.js, from one line of it up to another.
const cut = (from, to) => {
  const a = app.indexOf(from), b = app.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `app.js has "${from}" … "${to}"`);
  return app.slice(a, b);
};
const plain = (x) => JSON.parse(JSON.stringify(x)); // out of the page's realm, for deepEqual

const CODER = { id: 'coder', name: 'Coder', color: '#7f77dd' };
// As GET /api/asks hands them out (docs/api.md "A tool to install").
const GH = {
  id: 'a1', kind: 'tool', botId: 'coder', bot: CODER, reason: 'Coder needs it to open the pull request.', at: '2026-10-03T09:00:00.000Z',
  title: 'Install gh for Coder?', meta: 'asked by the Chief', body: 'GitHub CLI.\n\nWhy: Coder needs it to open the pull request.',
  facts: [{ label: 'Version', value: '2.101.0' }, { label: 'Source', value: "botdot's registry (conda-forge), checksum verified" }, { label: 'Size', value: '14 MB' }, { label: 'Runs as', value: 'Coder only' }, { label: 'Stays', value: 'across botdot updates' }],
  tool: { name: 'gh', version: '2.101.0', summary: 'GitHub CLI.', source: { type: 'registry', registry: 'conda-forge' }, platform: 'linux-aarch64', size: 14_000_000, packages: 3 }, askedBy: 'chief',
};
const SHA = '3f9a0c5d1e7b4a6f8c2d9e0b1a3c5d7f9e1b3a5c7d9f0e2b4a6c8d0e2f4a6c2e';
const STRIPE = {
  id: 'a2', kind: 'tool', botId: 'coder', bot: CODER, at: '2026-10-03T09:05:00.000Z',
  title: 'Install stripe for Coder?', meta: 'from a link you gave · asked by the Chief', body: 'Stripe CLI.\n\nWhy: Coder needs it to replay test payments.',
  warning: 'Not from the approved list. Make sure you trust the source.',
  facts: [{ label: 'Version', value: '1.31.0' }, { label: 'Source', value: 'https://github.com/stripe/stripe-cli/releases/download/v1.31.0/stripe_1.31.0_linux_arm64.tar.gz' }, { label: 'File', value: 'stripe_1.31.0_linux_arm64.tar.gz' }, { label: 'Checksum', value: `sha256 ${SHA}` }, { label: 'Size', value: '12 MB' }, { label: 'Runs as', value: 'Coder only' }],
};
const rows = (html) => [...html.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)].map((m) => [m[1], m[2]]);

test('web: the page gets it as window.ToolCard, before app.js', () => {
  assert.equal(typeof ToolCard.parts, 'function');
  const html = read('index.html');
  const at = (src) => html.indexOf(`<script src="${src}">`);
  assert.ok(at('/tool-card.js') > 0 && at('/tool-card.js') < at('/app.js'));
});

test('web: a tool from the registry: the title, the meta line, the body, the facts in the server\'s order, Decline and Install', () => {
  const t = ToolCard.parts(GH);
  assert.equal(t.title, 'Install gh for Coder?');
  assert.equal(t.meta, 'asked by the Chief');
  assert.ok(t.body.startsWith('<div class="need-body"><div class="nb">GitHub CLI.\n\nWhy: Coder needs it to open the pull request.</div></div>'), 'what it is and why, as the server wrote it');
  assert.deepEqual(rows(t.body), [['Version', '2.101.0'], ['Source', 'botdot&#39;s registry (conda-forge), checksum verified'], ['Size', '14 MB'], ['Runs as', 'Coder only'], ['Stays', 'across botdot updates']]);
  assert.match(t.body, /<div class="need-body"><dl class="nb need-facts"><dt>Version<\/dt>/, 'the facts are one block of label and value rows');
  assert.doesNotMatch(t.body, /need-warn|⚠️/, 'no warning for a tool from the registry');
  assert.equal(t.actions, '<button class="btn sm" data-need-no>Decline</button><button class="btn sm primary" data-need-yes>Install</button>');
  assert.equal(ToolCard.is(GH), true);
  for (const other of [{ kind: 'skill' }, { kind: 'permission' }, { kind: 'bot-change' }, {}, null, undefined]) assert.equal(ToolCard.is(other), false);
});

test('web: a tool from a link: its warning between the body and the facts, marked as a warning, and the rows a link has', () => {
  const t = ToolCard.parts(STRIPE);
  assert.equal(t.meta, 'from a link you gave · asked by the Chief');
  const body = t.body.indexOf('Stripe CLI.'), warn = t.body.indexOf('<div class="need-body need-warn" role="note">'), facts = t.body.indexOf('<dl class="nb need-facts">');
  assert.ok(body >= 0 && body < warn && warn < facts, 'the body, then the warning, then the facts');
  assert.match(t.body, /<div class="need-body need-warn" role="note"><div class="nb">⚠️ Not from the approved list\. Make sure you trust the source\.<\/div><\/div>/);
  assert.equal((t.body.match(/need-warn/g) || []).length, 1);
  assert.deepEqual(rows(t.body).map((r) => r[0]), ['Version', 'Source', 'File', 'Checksum', 'Size', 'Runs as'], 'labels this app never saw are drawn too');
  assert.deepEqual(rows(t.body)[3], ['Checksum', `sha256 ${SHA}`], 'a value is drawn whole, however long');
  assert.match(t.actions, /Decline<\/button>.*Install<\/button>/);
});

test('web: every value is text, never markup', () => {
  const BAD = '<img src=x onerror="alert(1)">\'&</div><script>alert(2)</script>';
  const fields = { title: 'T', meta: 'M', body: 'B', warning: 'W', facts: [{ label: 'L', value: 'V' }] };
  const cases = {
    title: { ...fields, title: BAD },
    meta: { ...fields, meta: BAD },
    body: { ...fields, body: BAD },
    warning: { ...fields, warning: BAD },
    'a fact\'s label': { ...fields, facts: [{ label: BAD, value: 'V' }] },
    'a fact\'s value': { ...fields, facts: [{ label: 'L', value: BAD }] },
  };
  for (const [field, ask] of Object.entries(cases)) {
    const t = ToolCard.parts({ kind: 'tool', ...ask });
    const html = t.title + t.meta + t.body;
    assert.ok(html.includes(esc(BAD)), `${field}: escaped`);
    assert.doesNotMatch(html, /<img|<script|onerror="|<\/div><script/, `${field}: no markup of its own`);
    // Only the card's own tags are left: the blocks, the facts' list and nothing else.
    assert.deepEqual([...new Set(html.match(/<[a-z]+/g))].sort(), ['<dd', '<div', '<dl', '<dt'], field);
  }
  assert.deepEqual(plain(ToolCard.parts({ kind: 'tool', title: 'a & b', meta: '"quoted"' })), { title: 'a &amp; b', meta: '&quot;quoted&quot;', body: '', actions: ToolCard.parts(GH).actions });
});

test('web: an ask with fields this app does not know, or without some it knows, is drawn from what is there', () => {
  // A newer server: more on the ask, and more on a fact.
  const newer = { ...GH, notes: '<b>new</b>', badge: { text: 'Popular' }, facts: [...GH.facts.map((f) => ({ ...f, icon: 'star', href: 'https://example.com' })), { label: 'Licence', value: 'MIT' }] };
  const t = ToolCard.parts(newer);
  assert.equal(t.title, 'Install gh for Coder?');
  assert.deepEqual(rows(t.body).map((r) => r[0]), ['Version', 'Source', 'Size', 'Runs as', 'Stays', 'Licence']);
  assert.doesNotMatch(t.title + t.meta + t.body, /new|Popular|star|example\.com/);

  // Without facts, without a warning, without both.
  const noFacts = ToolCard.parts({ ...STRIPE, facts: undefined });
  assert.doesNotMatch(noFacts.body, /need-facts|<dl/);
  assert.match(noFacts.body, /need-warn/);
  const noWarning = ToolCard.parts({ ...GH, warning: undefined });
  assert.doesNotMatch(noWarning.body, /need-warn/);
  assert.equal(ToolCard.parts({ kind: 'tool', title: 'Install jq for Coder?', body: 'A JSON processor.' }).body, '<div class="need-body"><div class="nb">A JSON processor.</div></div>');
  for (const facts of [[], null, 'Version 1', 7, {}, { label: 'Version', value: '1' }]) assert.doesNotMatch(ToolCard.parts({ ...GH, facts }).body, /<dl/, JSON.stringify(facts));
  for (const warning of ['', '   ', null, false, {}, ['x']]) assert.doesNotMatch(ToolCard.parts({ ...GH, warning }).body, /need-warn/, JSON.stringify(warning));

  // Rows that are not rows are left out; a number is drawn as it is written; half a row is drawn as half.
  const odd = ToolCard.parts({ ...GH, facts: [null, 'x', 5, [], {}, { label: {}, value: [] }, { label: 'Packages', value: 3 }, { label: 'Only a label' }, { value: 'only a value' }, { label: '  ', value: '' }] });
  assert.deepEqual(rows(odd.body), [['Packages', '3'], ['Only a label', ''], ['', 'only a value']]);

  // Nothing at all: an empty card with its buttons, and never the word "undefined".
  for (const ask of [{ kind: 'tool' }, {}, null, undefined, { kind: 'tool', title: null, meta: 5, body: {}, warning: [], facts: 'no' }]) {
    const e = ToolCard.parts(ask);
    assert.equal(e.body, '');
    assert.equal(e.title, '');
    assert.match(e.actions, /data-need-no.*data-need-yes/);
    assert.doesNotMatch(e.title + e.meta + e.body, /undefined|null|\[object/);
  }
  assert.equal(ToolCard.parts({ kind: 'tool', meta: 5 }).meta, '5');
});

// The page's needCardHTML, with stand-ins for what it uses.
function cards(open = []) {
  const box = vm.createContext({ ToolCard, esc, needsOpen: new Set(open), botLabel: (b) => (b ? `<svg class="fig fig-small"></svg>${esc(b.name)}` : '') });
  vm.runInContext(`${cut('function needCardHTML(x, here = null) {', 'function renderNeeds() {')}; this.needCardHTML = needCardHTML;`, box);
  return box.needCardHTML;
}
const item = (a) => ({ key: `ask:${a.id}`, kind: 'ask', a, bot: a.bot || null, color: a.bot?.color });

test('web: Needs you draws a tool ask as one card under its bot\'s head, closed until it is clicked', () => {
  const html = cards()(item(GH));
  assert.equal((html.match(/class="card need-card/g) || []).length, 1, 'one card');
  assert.match(html, /<div class="card need-card need-tool" data-need="ask:a1" title="Click to see it all">/);
  const order = ['<div class="need-who"><svg class="fig fig-small"></svg>Coder</div>', '<div class="need-title">Install gh for Coder?</div>', '<div class="need-meta">asked by the Chief</div>',
    '<div class="need-body"><div class="nb">GitHub CLI.', '<dl class="nb need-facts">', '<div class="need-actions"><button class="btn sm" data-need-no>Decline</button><button class="btn sm primary" data-need-yes>Install</button></div>'];
  const at = order.map((part) => html.indexOf(part));
  assert.ok(at.every((i) => i >= 0), `every part is there: ${at}`);
  assert.deepEqual(at, [...at].sort((a, b) => a - b), 'the head, the title, the meta line, the body, the facts, the buttons');
  assert.doesNotMatch(html, /Install the skill|undefined/, 'not a skill card with an empty name');
  assert.match(cards(['ask:a1'])(item(GH)), /class="card need-card need-tool open"/, 'a card that was clicked open stays open when the page draws again');

  const link = cards()(item(STRIPE));
  assert.ok(link.indexOf('Stripe CLI.') < link.indexOf('need-warn') && link.indexOf('need-warn') < link.indexOf('need-facts'));
  // Text from a link is text in the page's card too.
  const bad = cards()(item({ ...STRIPE, id: '"><img src=x>', title: '<b>t</b>', meta: '<i>m</i>', warning: '<u>w</u>', bot: { ...CODER, name: '<s>Coder</s>' } }));
  assert.doesNotMatch(bad, /<img|<b>|<i>|<u>|<s>/);
  assert.match(bad, /data-need="ask:&quot;&gt;&lt;img src=x&gt;"/);
  // A bot that is gone: the card without a head.
  assert.doesNotMatch(cards()(item({ ...GH, bot: null })), /need-who/);
});

test('web: the other asks are drawn as before', () => {
  const draw = cards();
  const skill = draw(item({ id: 's1', kind: 'skill', url: 'https://github.com/a/skill', skill: { name: 'tidy', description: 'Tidies.' }, forBots: [CODER], reason: 'For the weekly clean-up.' }));
  assert.match(skill, /<div class="card need-card" data-need="ask:s1"/);
  assert.match(skill, /Install the skill "tidy"\?/);
  assert.match(skill, /github\.com\/a\/skill · for Coder/);
  assert.doesNotMatch(skill, /need-tool|need-facts/);
  const permission = draw(item({ id: 'p1', kind: 'permission', bot: CODER, permission: 'bash', what: { label: 'run commands', hint: 'it runs commands on the botdot server' }, reason: 'To run the checks.' }));
  assert.match(permission, /Let it run commands\?/);
  assert.match(permission, /data-need-yes>Allow<\/button>/);
});

test('web: the card is in the chat of the bot it is for and in the Chief\'s, and in no other bot\'s', () => {
  const asks = [GH, { id: 'p1', kind: 'permission', botId: 'coder', bot: CODER, permission: 'bash' }, { id: 's1', kind: 'skill', botId: null, bot: null, url: 'https://x' }, { ...STRIPE, botId: 'gone', bot: null }];
  const box = vm.createContext({ ToolCard, state: { dash: null }, botById: () => null, CHIEF_COLOR: '#d85a30', needsItems: () => asks.map(item) });
  vm.runInContext(`${cut('const fromChief = (x) =>', '// Put the cards')}; this.chatNeeds = chatNeeds;`, box);
  const keys = (scope) => plain(box.chatNeeds(scope).map((x) => x.key));
  assert.deepEqual(keys('coder'), ['ask:a1', 'ask:p1'], "the bot's own chat: its tool, and its permission as before");
  assert.deepEqual(keys('chief'), ['ask:a1', 'ask:s1', 'ask:a2'], "the Chief's chat: the tools it asked for, and its skill as before");
  assert.deepEqual(keys('reader'), [], "another bot's chat: nothing");
  // There, the card's head is hidden in the bot's own chat and shown in the Chief's (whose bot is it for).
  assert.match(css, /\.chat-needs:not\(\[data-scope="chief"\]\) \.need-who \{ display: none; \}/);
});

test('web: the banner has a head for a tool ask, in its bot\'s colour and hat', () => {
  const marks = [];
  const box = vm.createContext({
    state: { bw: null, asks: [GH, { ...STRIPE, botId: 'gone', bot: null }], memPending: [], dash: null, chats: [] }, loginReq: { pending: [] }, pendingJobs: () => [],
    botById: (id) => (id === 'coder' ? CODER : null), colorOf: (b) => b.color, CHIEF_BOT: { id: 'chief', name: 'Chief of Staff' }, CHIEF_COLOR: '#d85a30',
    botMark: (b) => { marks.push(b.id); return `<svg data-bot="${b.id}"></svg>`; }, Figure: { CHIEF: { hat: 'chief' }, small: (color) => `<svg data-chief="${color}"></svg>` },
  });
  vm.runInContext(`${cut('function needsItems() {', '// The banner:')}; this.needsItems = needsItems; this.needsFigures = needsFigures;`, box);
  const items = box.needsItems();
  assert.deepEqual(plain(items.map((x) => [x.key, x.kind, x.bot?.id ?? null, x.color])), [['ask:a1', 'ask', 'coder', '#7f77dd'], ['ask:a2', 'ask', null, '#d85a30']]);
  const figs = box.needsFigures(items);
  assert.equal((figs.match(/<i /g) || []).length, 2, 'one head per ask');
  assert.match(figs, /<svg data-bot="coder"><\/svg>/);
  assert.match(figs, /<svg data-chief="#d85a30"><\/svg>/, "a tool for a bot that is gone: the Chief's head");
  assert.deepEqual(marks, ['coder']);
  // Review opens the page with the cards: a tool is answered on its card.
  assert.match(cut('function openNeed(x) {', '// Decided cards stay'), /return setView\('needs'\); \/\/ anything else/);
});

// The page's decide(), against a card that stands in for the one on screen.
// where: the places the card is on the page, null for the Needs you page or the chat it is in.
function decider({ fail = null, where = [null] } = {}) {
  const calls = [], toasts = [];
  const els = where.map((scope) => {
    const el = { classes: ['card', 'need-card', 'need-tool'], outerHTML: '<div class="card need-card need-tool done"></div>', closest: (sel) => (sel === '.chat-needs' && scope ? { dataset: { scope } } : null),
      actions: { innerHTML: '<button data-need-no>Decline</button><button data-need-yes>Install</button>' } };
    el.classList = { add: (c) => el.classes.push(c) };
    return el;
  });
  const [el] = els, { actions } = el;
  let refreshed = 0;
  const box = vm.createContext({
    ToolCard, esc, CSS: { escape: (s) => s }, needsDone: new Map(), chatDecided: new Map(), PLAN_APPROVAL: '', loadDash() {},
    api: async (url, opts) => { calls.push([url, opts.method, opts.body]); if (fail) throw new Error(fail); return { ok: true, installing: true }; },
    toast: (text, bad) => toasts.push([text, !!bad]),
    $$: (sel) => (sel === '.need-card[data-need="ask:a1"]' ? els : []),
    $: (sel, card) => (sel === '.need-actions' ? card.actions : sel === '.need-title' ? { textContent: GH.title } : null),
    refreshNeeds: () => { refreshed++; },
  });
  vm.runInContext(`${cut('async function decide(x, yes', 'async function refreshNeeds() {')}; this.decide = decide;`, box);
  return { box, el, els, actions, calls, toasts, refreshed: () => refreshed };
}

test('web: Install and Decline send the ask\'s answer, and the card shows as done', async () => {
  const yes = decider();
  await yes.box.decide(item(GH), true);
  assert.deepEqual(plain(yes.calls), [['/asks/a1', 'POST', { yes: true, always: false }]]);
  assert.ok(yes.el.classes.includes('done'), 'the card fades');
  assert.equal(yes.actions.innerHTML, '<span class="muted">Installing</span>', 'the install goes on by itself: not "Installed" yet');
  assert.equal(yes.box.needsDone.get('ask:a1'), yes.el.outerHTML, 'it stays on the page, faded, until the owner leaves it');
  assert.equal(yes.refreshed(), 1);
  assert.deepEqual(yes.toasts, []);

  const no = decider();
  await no.box.decide(item(GH), false);
  assert.deepEqual(plain(no.calls), [['/asks/a1', 'POST', { yes: false, always: false }]]);
  assert.equal(no.actions.innerHTML, '<span class="muted">Declined</span>');
  assert.ok(no.el.classes.includes('done'));

  // In a chat: a faded line with the card's title, as for a skill. The card may stand in the Chief's chat and in
  // its bot's at once (one of them out of sight): each chat keeps its own line.
  const chat = decider({ where: ['chief', 'coder'] });
  await chat.box.decide(item(GH), true);
  const line = (scope) => ({ scope, title: 'Install gh for Coder?', label: 'Installing' });
  assert.deepEqual(plain([...chat.box.chatDecided.values()]), [line('chief'), line('coder')]);
  assert.equal(chat.box.needsDone.size, 0);
  assert.ok(chat.els.every((c) => c.classes.includes('done') && c.actions.innerHTML === '<span class="muted">Installing</span>'), 'both cards fade');
  // Leaving for the bot's chat drops the Chief chat's line and keeps the bot's (the page's own rule in updateChatNeeds).
  assert.match(cut('function updateChatNeeds(thread, scope) {', '// "Always approve" a script job'), /for \(const \[k, d\] of chatDecided\) if \(d\.scope !== scope\) chatDecided\.delete\(k\);/);
});

test('web: an answer the server refuses, or that does not reach it, leaves the card and says why', async () => {
  for (const fail of ['That request was already answered.', 'Failed to fetch']) {
    for (const answer of [true, false]) {
      const d = decider({ fail });
      await d.box.decide(item(GH), answer);
      assert.equal(d.calls.length, 1);
      assert.deepEqual(d.toasts, [[fail, true]], 'the problem, as a toast, as for other asks');
      assert.ok(!d.el.classes.includes('done'), 'the card is not faded');
      assert.match(d.actions.innerHTML, /data-need-no.*data-need-yes/, 'its buttons stay');
      assert.equal(d.box.needsDone.size + d.box.chatDecided.size, 0);
      assert.equal(d.refreshed(), 0);
    }
  }
});

test('web: long values wrap inside the card, the warning is amber, and a closed card keeps its warning and shows whole lines', () => {
  assert.match(css, /\.need-tool \.need-title, \.need-tool \.need-meta, \.need-tool \.nb \{ overflow-wrap: anywhere; \}/, 'an address, a checksum or a file\'s name breaks anywhere');
  assert.match(css, /\.need-body \.need-facts \{ display: grid; grid-template-columns: fit-content\(40%\) minmax\(0, 1fr\);[^}]*white-space: normal; \}/, 'two columns; the value\'s may shrink');
  assert.match(css, /\.need-facts dt \{ color: var\(--faint\); \}/, 'a faint label');
  assert.match(css, /\.need-facts dd \{ margin: 0; min-width: 0; \}/);
  assert.match(css, /\.need-body\.need-warn \{ border: 1px solid var\(--warn-line\); \}/, 'the theme\'s warning line (tests/theme-parity.test.js)');
  // Closed, a card hides every block after the first; the warning is the exception, cut to two lines.
  const hide = css.indexOf('.need-card:not(.open) .need-body ~ .need-body, .need-card:not(.open) .job-why { display: none; }');
  const keep = css.indexOf('.need-card:not(.open) .need-body.need-warn { display: block; }');
  assert.ok(hide > 0 && keep > hide, 'the rule that keeps the warning comes after the one that hides the blocks, with the same weight');
  assert.match(css, /\.need-card:not\(\.open\) \.need-warn div\.nb \{ -webkit-line-clamp: 2; \}/);
  // Closed, a block is limited by a count of lines and by no height: a height can end inside a line (TOOL-010).
  assert.match(css, /\.need-card:not\(\.open\) \.need-body div\.nb, \.need-card:not\(\.open\) \.need-body pre\.nb \{ display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; \}/);
  const closed = css.match(/^\.need-card:not\(\.open\)[^{]*\{[^}]*\}/gm);
  assert.ok(closed?.length, 'the rules of a closed card');
  for (const rule of closed) assert.doesNotMatch(rule, /[{;\s](?:max-)?height:/, `no height limit on a closed card: ${rule}`);
  assert.match(css, /\.need-card:not\(\.open\) \.need-facts > :nth-child\(n\+7\) \{ display: none; \}/, 'a card of facts alone: its first three rows, whole');
  // The click that opens a card is the page's, for every card: open, the blocks all show.
  assert.match(cut('function wireNeedCards(root, items) {', '// ---------- approvals in the chat ----------'), /el\.onclick = \(e\) => \{ if \(e\.target\.closest\('button'\)\) return; el\.classList\.toggle\('open'\);/);
});
