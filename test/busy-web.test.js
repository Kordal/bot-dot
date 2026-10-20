// A press whose answer waits on the server (Bitwarden can take several seconds): the web page's whileBusy
// (public/app.js). The button says it works and it and the buttons beside it can't be pressed, until the answer
// comes; a second press meanwhile sends nothing; then all are as they were, also after a failure.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { element, whileBusy } = require('./web-page');

function buttons() {
  const yes = element({}, { textContent: 'Approve' });
  const no = element({}, { textContent: 'Decline' });
  const off = element({}, { textContent: 'Later', disabled: true });
  const foot = element({ button: [yes, no, off] });
  for (const b of [yes, no, off]) b.parentElement = foot;
  return { yes, no, off };
}

test('web: a button says it works until the answer comes, and a second press sends nothing', async () => {
  const { yes, no, off } = buttons();
  let sent = 0, done;
  const press = () => whileBusy(yes, 'Approving…', () => { sent++; return new Promise((r) => { done = r; }); });
  const first = press();
  assert.equal(yes.textContent, 'Approving…');
  assert.deepEqual([yes.disabled, no.disabled, off.disabled], [true, true, true]);
  assert.equal(await press(), undefined);
  assert.equal(sent, 1, 'the second press sent nothing');
  done('answer');
  assert.equal(await first, 'answer');
  assert.equal(yes.textContent, 'Approve');
  assert.deepEqual([yes.disabled, no.disabled, off.disabled], [false, false, true], 'a button that was off stays off');
});

test('web: after a failure the buttons are as they were, and can be pressed again', async () => {
  const { yes, no } = buttons();
  await assert.rejects(whileBusy(no, 'Declining…', async () => { throw new Error('Bitwarden is locked'); }), /locked/);
  assert.equal(no.textContent, 'Decline');
  assert.deepEqual([yes.disabled, no.disabled], [false, false]);
  assert.equal(await whileBusy(no, 'Declining…', async () => 'again'), 'again');
});

test('web: with a spinner the button turns one while it works, and drops it after, also after a failure (#154)', async () => {
  const { yes } = buttons();
  let seen;
  await whileBusy(yes, 'Creating connection…', async () => { seen = [yes.textContent, yes.classList.contains('spin')]; }, true);
  assert.deepEqual(seen, ['Creating connection…', true]);
  assert.deepEqual([yes.textContent, yes.classList.contains('spin')], ['Approve', false]);
  await assert.rejects(whileBusy(yes, 'Creating connection…', async () => { throw new Error('Bitwarden is locked'); }, true), /locked/);
  assert.deepEqual([yes.textContent, yes.classList.contains('spin'), yes.disabled], ['Approve', false, false]);
  await whileBusy(yes, 'Approving…', async () => { seen = [yes.textContent, yes.classList.contains('spin')]; });
  assert.deepEqual(seen, ['Approving…', false], 'without it, none');
});
