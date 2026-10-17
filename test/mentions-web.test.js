// Mentions on the web page: public/mentions.js loaded the way the browser loads it (a plain script,
// no module), checked against the shared rules table.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const table = require('./fixtures/mentions.json');

const page = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'mentions.js'), 'utf8'), page);
const { shortName, findMentions, suggest, pick, MAX_ROWS } = page.Mentions;
const plain = (x) => JSON.parse(JSON.stringify(x)); // out of the page's realm, for deepEqual

test('web: the page gets the matcher as window.Mentions', () => {
  assert.equal(typeof page.Mentions.findMentions, 'function');
  assert.equal(page.module, undefined);
  assert.equal(MAX_ROWS, table.maxRows);
});

test('web: short names', () => {
  for (const [name, short] of table.shortNames) assert.equal(shortName(name), short, name);
});

for (const c of table.cases) {
  test(`web table: ${c.name}`, () => {
    const ctx = { chat: c.chat, ...table.worlds[c.world] };
    if (c.matches) {
      const got = plain(findMentions(c.text, ctx)).map(({ start, end, ...m }) => {
        assert.equal(c.text.slice(start, end), m.text);
        return m;
      });
      assert.deepEqual(got, c.matches);
    }
    if (c.suggestions) assert.deepEqual(plain(suggest(c.typed, ctx)).map((r) => r.text), c.suggestions);
  });
}

for (const c of table.picks) {
  test(`web table pick: ${c.name}`, () => {
    const ctx = { chat: c.chat, ...table.worlds[c.world] };
    const text = c.before.replace('|', '');
    const at = c.before.indexOf('|');
    const row = suggest(text.slice(0, at), ctx).find((r) => r.text === c.pick);
    assert.ok(row, `${c.pick} is offered`);
    const done = pick(text, at, row);
    assert.equal(`${done.text.slice(0, done.cursor)}|${done.text.slice(done.cursor)}`, c.after);
    assert.equal(done.jobsNext, c.jobsNext);
  });
}

test('web: the page loads the matcher before app.js', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const at = (src) => html.indexOf(`<script src="${src}">`);
  assert.ok(at('/mentions.js') > 0 && at('/mentions.js') < at('/app.js'));
});
