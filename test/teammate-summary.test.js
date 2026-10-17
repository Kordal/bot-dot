const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, heldRun, self } = require('./helpers');

test('a bot receiving teammate results is instructed to summarize required actions and preserve links for the owner', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const keeper = await makeBot(srv, { name: 'Proxmox Keeper' });
  const helper = await makeBot(srv, { name: 'Fleet Helper', friendly: false });
  const origin = await heldRun(srv, keeper);
  const link = 'https://example.com/device/approve?code=test-only';
  const message = `Tailscale is installed on VM 103. The owner must approve the device at ${link}`;
  const sent = await self(srv, origin.token, 'message', { to: helper.id, message, priority: true });
  assert.equal(sent.data.delivered, 'started');
  const recipient = await srv.nextRun((r) => r.args.includes(`${helper.emoji} ${helper.name}`));
  assert.match(recipient.stdin, /VM 103/);
  assert.ok(recipient.stdin.includes(link));
  assert.match(recipient.system, /summari[sz]e.*owner/i);
  assert.match(recipient.system, /preserve.*links.*required actions/i);
  assert.match(recipient.system, /never.*approval/i);
  srv.reply(`Proxmox Keeper says VM 103 needs your approval: ${link}`);
  srv.release(recipient);
  const runs = (await srv.api(`/runs?botId=${helper.id}`)).data;
  const done = await srv.finished(runs[0].id);
  assert.ok(done.result.includes(link));
  assert.equal(done.fromBot.id, keeper.id);
  assert.equal(done.trigger, 'bot');
});

test('the Chief is instructed to carry teammate links and required actions into its summary', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  srv.hold();
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'What does Proxmox Keeper need from me?' } });
  const chief = await srv.nextRun((r) => !!r.botdot);
  assert.match(chief.system, /preserve.*links.*required actions/i);
});
