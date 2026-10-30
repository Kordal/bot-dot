// The target delivery date (#792): asked in the new project's review, a day or "none" (open-ended), kept on the
// project and told to the team proposal, the Chief and the team's bots.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');
const companyLib = require('../lib/company');
const teamLib = require('../lib/company-team');
const chief = require('../lib/company-chief');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

const at = (p, id) => `${p}?project=${encodeURIComponent(id)}`;

test('the server says it keeps a delivery date', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('project-delivery'));
});

test('a project keeps a day, "none", or nothing as its delivery date', async () => {
  const c = (await srv.api('/company', { method: 'POST', body: { start: 'A meal planner for busy parents' } })).data;
  assert.equal(c.deliverBy, '');
  const dated = await srv.api(at('/company', c.id), { method: 'PATCH', body: { deliverBy: '2027-03-31' } });
  assert.equal(dated.data.deliverBy, '2027-03-31');
  const open = await srv.api(at('/company', c.id), { method: 'PATCH', body: { deliverBy: 'none' } });
  assert.equal(open.data.deliverBy, 'none');
  for (const bad of ['2027-02-30', 'soon', 5]) {
    const r = await srv.api(at('/company', c.id), { method: 'PATCH', body: { deliverBy: bad } });
    assert.equal(r.status, 400, String(bad));
  }
  assert.equal((await srv.api(at('/company', c.id))).data.company.deliverBy, 'none');
  const cleared = await srv.api(at('/company', c.id), { method: 'PATCH', body: { deliverBy: '' } });
  assert.equal(cleared.data.deliverBy, '');
  // An empty project (#788) has none set.
  assert.equal((await srv.api('/company', { method: 'POST', body: { empty: true } })).data.deliverBy, '');
});

test('the team proposal, the Chief\'s chips and the project notes read the delivery date', () => {
  const base = companyLib.clean({ id: 'p1', start: 'A meal planner', goal: 'Ten paying families', deliverBy: '2027-03-31' });
  assert.match(teamLib.question(base), /Target delivery date: 2027-03-31\./);
  assert.match(chief.suggestQuestion(base, 'never'), /Target delivery date: 2027-03-31\./);
  const open = { ...base, deliverBy: 'none' };
  assert.match(teamLib.question(open), /Target delivery date: none, open-ended\./);
  assert.doesNotMatch(teamLib.question({ ...base, deliverBy: '' }), /Target delivery date/);
  assert.equal(companyLib.clean({ id: 'p2', start: 'x', deliverBy: 'tomorrow' }).deliverBy, '');
});
