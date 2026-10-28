// Settings → Usage on the web page (#301): public/usage.js run against stand-ins. It asks for the account's today, then
// shows the last 7 days; Today, 30 days and custom days ask the server for those; the totals, a bar a day and a row a
// bot are drawn, names as text; and Settings draws the card only from a server that has token-usage.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, esc, element, words } = require('./web-page');

const answerFor = (from, to) => {
  const days = [];
  for (let d = from; d <= to; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)) days.push(d);
  const n = (i) => (i === days.length - 1 ? 2000 : i === 0 ? 1000 : 0);
  return {
    from, to, today: '2026-10-22', timeZone: 'Europe/Warsaw', keepDays: 400,
    totals: { inputTokens: 1234, outputTokens: 56789, cacheReadTokens: 2500000, cacheWriteTokens: 0, totalTokens: 2558023, runs: 4 },
    bots: [
      { id: 'b1', name: 'News <b>Watcher</b>', totalTokens: 2000, runs: 2 },
      { id: null, chief: true, name: 'Chief of Staff', totalTokens: 1000, runs: 1 },
      { id: 'old', name: 'Gone Bot', gone: true, totalTokens: 10, runs: 1 },
    ],
    days: days.map((day, i) => ({ day, totalTokens: n(i) })),
  };
};

function page({ fail = null } = {}) {
  const calls = [];
  const ctx = vm.createContext({ ...words,
    api: async (url) => {
      calls.push(url);
      if (fail) throw new Error(fail);
      const q = new URL(url, 'http://x').searchParams;
      return answerFor(q.get('from') || '2026-10-22', q.get('to') || '2026-10-22');
    },
    esc, encodeURIComponent, Date, Math, Number, URL,
  });
  vm.runInContext(`${read('usage.js')}\nthis.Usage = Usage;`, ctx);
  return { U: ctx.Usage, calls };
}

test('web: index.html loads usage.js after boot.js, and Settings draws the card only with token-usage', () => {
  const scripts = [...read('index.html').matchAll(/<script src="\/([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.indexOf('usage.js') > scripts.indexOf('boot.js'));
  const settings = read('settings.js');
  assert.match(settings, /state\.features\.includes\('token-usage'\) \? '<details class="bs-row bs-more" id="usage-card"><\/details>'/, 'a row of Settings that opens under itself');
  assert.match(settings, /typeof Usage !== 'undefined'\) Usage\.open\(\$\('#usage-card', root\)\)/);
});

test('web: it opens on the last 7 days of the account, with totals, a bar a day and a row a bot', async () => {
  const p = page();
  const box = element();
  await p.U.open(box);
  assert.deepEqual([...p.calls], ['/usage', '/usage?from=2026-10-16&to=2026-10-22']);
  const h = box.innerHTML;
  assert.match(h, /data-usage-preset="7" aria-pressed="true"/);
  assert.match(h, /Input tokens<\/div><b>1,234<\/b>/);
  assert.match(h, /Output tokens<\/div><b>56\.8k<\/b>/);
  assert.match(h, /Cache read<\/div><b>2\.5M<\/b>/);
  assert.match(h, /Cache write<\/div><b>0<\/b>/);
  assert.match(h, /All tokens<\/div><b>2\.6M<\/b>/);
  assert.doesNotMatch(h, /cost|\$/i, 'no cost anywhere');
  assert.equal((h.match(/class="usage-bar"/g) || []).length, 7);
  assert.match(h, /<i style="height:100%"><\/i>/, 'the busiest day is the tallest');
  assert.match(h, /<i style="height:0%"><\/i>/, 'a day with nothing has no bar');
  assert.match(h, /News &lt;b&gt;Watcher&lt;\/b&gt;/);
  assert.doesNotMatch(h, /<b>Watcher/);
  assert.match(h, /Chief of Staff/);
  assert.match(h, /Gone Bot <span class="faint">\(deleted\)<\/span>/);
});

test('web: Today, 30 days and custom days ask for those days; custom days never run backwards', async () => {
  const p = page();
  await p.U.open(element());
  await p.U.pick('today');
  await p.U.pick('30');
  assert.deepEqual(p.calls.slice(2), ['/usage?from=2026-10-22&to=2026-10-22', '/usage?from=2026-09-23&to=2026-10-22']);
  await p.U.pick('custom');
  assert.equal(p.calls.length, 4, 'Custom asks nothing until a day is picked');
  await p.U.setDay('from', '2026-10-01');
  await p.U.setDay('to', '2026-09-01'); // before from: from follows
  assert.deepEqual(p.calls.slice(4), ['/usage?from=2026-10-01&to=2026-10-22', '/usage?from=2026-09-01&to=2026-09-01']);
  assert.equal(p.U.setDay('from', 'not a day'), undefined);
});

test('web: a failure is said in the card', async () => {
  const p = page({ fail: 'Only the owner sees the usage.' });
  const box = element();
  await p.U.open(box);
  assert.match(box.innerHTML, /Only the owner sees the usage\./);
});

test('web: numbers read short', () => {
  const { U } = page();
  assert.deepEqual([U.tokens(0), U.tokens(9999), U.tokens(12345), U.tokens(123456), U.tokens(1234567), U.tokens(12345678)], ['0', '9,999', '12.3k', '123k', '1.2M', '12M']);
  assert.deepEqual({ ...U.rangeOf('7', '2026-03-02') }, { from: '2026-02-24', to: '2026-03-02' });
});
