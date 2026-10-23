// The Chief's own jobs on the web page (#408): listed in its settings with when they run, a switch and Remove, from
// a server that has them, and drawn again from the feed's chief_jobs. The page's own code, cut out of public/ and
// run against stand-in elements and a stand-in server.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, cut, esc, element } = require('./web-page');

function jobs({ answer = null } = {}) {
  const box = element();
  const calls = [];
  const ctx = vm.createContext({
    esc, toast() {}, $: (sel) => (sel === '#chief-job-list' ? box : null), $$: () => [],
    api: async (p, opts = {}) => { calls.push([opts.method || 'GET', p]); if (answer instanceof Error) throw answer; return answer; },
  });
  vm.runInContext(`${cut('// Its own jobs (#408)', '// The library skills you gave the Chief')} this.drawChiefJobs = drawChiefJobs;`, ctx);
  return { ctx, box, calls };
}

test('its jobs are listed with when they run, paused ones say so, and text is never markup', async () => {
  const t = jobs();
  await t.ctx.drawChiefJobs([
    { id: 'cj1', name: 'News <b>', task: 'Tell me what is new', when: 'Every weekday at 08:00', on: true },
    { id: 'cj2', name: 'Weather', task: 'x'.repeat(200), when: 'Every day at 07:00', on: false },
  ]);
  assert.match(t.box.innerHTML, /News &lt;b&gt;/);
  assert.match(t.box.innerHTML, /Every weekday at 08:00/);
  assert.match(t.box.innerHTML, /Every day at 07:00 · paused/);
  assert.match(t.box.innerHTML, /x{160}…/, 'a long task is cut');
  assert.equal((t.box.innerHTML.match(/data-chief-job-on checked/g) || []).length, 1);
  assert.equal(t.calls.length, 0, 'the feed gave the list');
});

test('without jobs it says none; it reads the server when no list is given', async () => {
  const t = jobs({ answer: { jobs: [] } });
  await t.ctx.drawChiefJobs();
  assert.deepEqual(t.calls, [['GET', '/chief/jobs']]);
  assert.match(t.box.innerHTML, /None yet/);
});

test('the section shows only from a server with chief-jobs, and the feed redraws it', () => {
  const part = cut('function renderChiefSettings()', '\n}\n');
  assert.match(part, /state\.features\.includes\('chief-jobs'\)/);
  assert.match(part, /drawChiefJobs\(\)/);
  assert.match(app, /es\.addEventListener\('chief_jobs'[\s\S]{0,200}drawChiefJobs\(d\.jobs\)/);
});
