// Bot names in a chat message on the web page: botNameLinks and chatLinkParts, cut out of public/app.js, read against the
// cases the Android app shares (test/fixtures/bot-names.json).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { cut } = require('./web-page');

const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'bot-names.json'), 'utf8'));
const CHIEF = { id: 'chief', name: 'Chief of Staff' };
function page(bots, chiefName = 'Chief of Staff', endings = null) {
  // Polish's endings come with the dictionary (lib/i18n/pl/phrases.json, ADR 280), as I18n.phrases; the Android app's test of
  // these cases reads Polish's alone too. endings: another's (the endings of every offered language reach the page as one list).
  const ctx = vm.createContext({ URL, I18n: { phrases: endings ? { nameEndings: endings } : { nameEndings: require('../lib/i18n/phrases').of('pl').nameEndings } }, state: { bots }, Mentions: { CHIEF: 'chief' }, CHIEF_ROLE: 'Chief of Staff', CHIEF_BOT: { ...CHIEF, name: chiefName }, chiefName: () => chiefName });
  vm.runInContext(`${cut('// What a web address shows in a chat', '// The Copy button')}${cut('const BARE_TLDS', 'function linkifyChat(root)')}${cut("// A bot's name in a message is a link", '// A tap on a bot')}
    this.botNameLinks = botNameLinks; this.chatLinkParts = chatLinkParts; this.namedBots = namedBots; this.botsToLink = botsToLink;`, ctx);
  return ctx;
}
const plain = (v) => JSON.parse(JSON.stringify(v));

for (const c of cases) {
  test(`web: bot names in ${JSON.stringify(c.text)} (${c.name})`, () => {
    const links = page([]).botNameLinks(c.text, c.bots);
    assert.deepEqual(plain(links.map((l) => [l.index, l.text, l.id])), c.links);
  });
}

test("web: in Japanese, Chinese and Korean a name is a link beside the words, with the endings of every offered language too", () => {
  const p = page([], 'Chief of Staff', require('../lib/i18n/phrases').forApps().nameEndings);
  const bots = [{ id: 'al', name: 'Alfred' }];
  const at = (text) => plain(p.botNameLinks(text, bots)).map((l) => [l.index, l.id]);
  assert.deepEqual(at('请让Alfred发送报告'), [[2, 'al']]);
  assert.deepEqual(at('今日はAlfredに聞いて'), [[3, 'al']]);
  assert.deepEqual(at('오늘 Alfred에게 물어봐'), [[3, 'al']]);
  assert.deepEqual(at('AlfredoはxAlfredに'), []); // a longer Latin word is no name, whatever stands after it
});

test('web: a name is a link beside web addresses, and never inside one', () => {
  const p = page([]);
  const bots = [{ id: 'qa', name: 'QA Tester' }, { id: 'al', name: 'Alfred' }];
  const parts = plain(p.chatLinkParts('QA Testera opens x.com/Alfred and https://x.dev/QA, QA Tester, then Alfred.', bots));
  assert.deepEqual(parts.map((l) => [l.text, l.id ?? null]), [['QA Testera', 'qa'], ['x.com/Alfred', null], ['https://x.dev/QA', null], ['QA Tester', 'qa'], ['Alfred', 'al']]);
  assert.deepEqual(plain(p.chatLinkParts('no names here', bots)), []);
});

test('web: the bots a message can name are the bots there are, and the Chief by the name the owner gave it', () => {
  assert.deepEqual(plain(page([{ id: 'qa', name: 'QA Tester', color: 'red' }]).namedBots()), [{ id: 'qa', name: 'QA Tester' }]);
  assert.deepEqual(plain(page([{ id: 'qa', name: 'QA Tester' }], 'Alfred').namedBots()), [{ id: 'chief', name: 'Alfred' }, { id: 'qa', name: 'QA Tester' }]);
});

// Where a name is a link: an element that has the selectors it sits under.
const under = (...sels) => ({ closest: (sel) => (sels.includes(sel) ? {} : null) });
const BUBBLE = '.chat-thread .bubble:not(.from-me)';
test('web: a name is a link in what a bot wrote, not in the owner\'s message, a shared room or a page that is no chat', () => {
  const bots = [{ id: 'qa', name: 'QA Tester' }, { id: 'al', name: 'Alfred' }];
  const p = page(bots);
  const ids = (el) => plain(p.botsToLink(el, bots)).map((b) => b.id);
  assert.deepEqual(ids(under(BUBBLE)), ['qa', 'al']);
  assert.deepEqual(ids(under()), []); // the owner's message (.from-me), the project overview (.po-text)
  assert.deepEqual(ids(under(BUBBLE, '#room-thread')), []);
});

test('web: no link to the bot whose chat it is, nor to the Chief in its own chat', () => {
  const bots = [{ id: 'qa', name: 'QA Tester' }, { id: 'chief', name: 'Alfred' }];
  const p = page(bots);
  p.state.botId = 'qa';
  assert.deepEqual(plain(p.botsToLink(under(BUBBLE, '#bot-thread'), bots)).map((b) => b.id), ['chief']);
  assert.deepEqual(plain(p.botsToLink(under(BUBBLE, '#chat-thread'), bots)).map((b) => b.id), ['qa']);
});
