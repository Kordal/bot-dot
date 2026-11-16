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
function page(bots, chiefName = 'Chief of Staff') {
  const ctx = vm.createContext({ URL, state: { bots }, Mentions: { CHIEF: 'chief' }, CHIEF_ROLE: 'Chief of Staff', CHIEF_BOT: { ...CHIEF, name: chiefName }, chiefName: () => chiefName });
  vm.runInContext(`${cut('// What a web address shows in a chat', '// The Copy button')}${cut('const BARE_TLDS', 'function linkifyChat(root)')}${cut("// A bot's name in a message is a link", '// A tap on a bot')}
    this.botNameLinks = botNameLinks; this.chatLinkParts = chatLinkParts; this.namedBots = namedBots;`, ctx);
  return ctx;
}
const plain = (v) => JSON.parse(JSON.stringify(v));

for (const c of cases) {
  test(`web: bot names in ${JSON.stringify(c.text)} (${c.name})`, () => {
    const links = page([]).botNameLinks(c.text, c.bots);
    assert.deepEqual(plain(links.map((l) => [l.index, l.text, l.id])), c.links);
  });
}

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
