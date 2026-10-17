const assert = require('node:assert/strict');
const { waitFor } = require('../helpers');

// Uses only a synthetic value and an in-memory page; no real login or account.
async function secretAcceptance(helper, id) {
  const html = `<title>Helper secret acceptance</title><h1>Helper secret acceptance</h1><input type="password" autofocus oninput="document.getElementById('result').textContent = this.value === 'synthetic-fixture-value' ? 'SYNTHETIC_SECRET_TYPED' : 'waiting'"><p id="result">waiting</p>`;
  const url = 'data:text/html,' + encodeURIComponent(html).replace(/'/g, '%27');
  await helper('startProgram', [id, `camoufox-browser '${url}' >/tmp/acceptance-browser.log 2>&1`]);
  // Readiness is the bridge's own answer: the browser is open when it can say where it is (#311).
  await waitFor(async () => (await helper('typeSecret', [id, { op: 'where' }])).ok, { timeout: 30000, every: 1000, what: 'the browser secret bridge' });
  const result = await helper('typeSecret', [id, { site: '', field: 'password', value: 'synthetic-fixture-value' }]);
  assert.equal(result.ok, true, result.error);
}
module.exports = { secretAcceptance };
