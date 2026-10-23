// A document saved to Google Docs (#351): only while Google Docs is connected, through the action that makes a Doc
// from Markdown, at once on the owner's tap (no card), and the new document's address back.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const docGoogle = require('../lib/doc-google');

let fakes = 0;
// A stand-in for lib/connectors.js: what is connected, the action's fields, and what each run was given.
function fakeConnectors({ configured = true, apps = ['googledocs'], fields = ['title', 'markdown_text'], data = { response_data: { documentId: '1AbCdEfGhIjKlMnOp' } }, fails = null } = {}) {
  const ran = [];
  const n = ++fakes; // its own connection ids
  const C = {
    ran,
    apps,
    configured: () => configured,
    connections: async () => C.apps.map((a, i) => ({ id: `ca_${n}_${i}`, toolkit: a, status: 'ACTIVE' })),
    tools: async (app, { tool }) => [{ slug: tool, input: { properties: Object.fromEntries(fields.map((f) => [f, { type: 'string' }])) } }],
    execute: async (app, tool, args, openFile, authorize) => { await authorize({ slug: tool }); ran.push({ app, tool, args }); if (fails) throw fails(); return data; },
  };
  return C;
}

test('status: connected only when Google Docs has a working connection', async () => {
  assert.deepEqual(await docGoogle.status(fakeConnectors()), { configured: true, connected: true });
  assert.deepEqual(await docGoogle.status(fakeConnectors({ apps: ['gmail', 'googledrive'] })), { configured: true, connected: false });
  assert.deepEqual(await docGoogle.status(fakeConnectors({ configured: false })), { configured: false, connected: false }, 'no Composio: says so');
  assert.deepEqual(await docGoogle.status({ configured: () => true, connections: async () => { throw new Error('down'); } }), { configured: true, connected: false });
});

test('save: the Markdown under its title through the Markdown action, run at once, and the document\'s address back', async () => {
  const C = fakeConnectors();
  const saved = await docGoogle.save(C, { text: '# Ads budget\n\n| a | b |\n| - | - |\n| 1 | 2 |' });
  assert.deepEqual(saved, { id: '1AbCdEfGhIjKlMnOp', title: 'Ads budget', url: 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit' });
  assert.deepEqual(C.ran, [{ app: 'googledocs', tool: 'GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN', args: { title: 'Ads budget', markdown_text: '# Ads budget\n\n| a | b |\n| - | - |\n| 1 | 2 |' } }]);
  const other = fakeConnectors({ fields: ['title', 'markdown'], data: { data: { document_id: 'ZZZZZZZZZZZZ' } } });
  assert.equal((await docGoogle.save(other, { title: 'Mine', text: 'x' })).url, 'https://docs.google.com/document/d/ZZZZZZZZZZZZ/edit');
  assert.deepEqual(other.ran[0].args, { title: 'Mine', markdown: 'x' });
});

test('save refuses: nothing to save, not connected, an action that changed, an answer with no document', async () => {
  await assert.rejects(docGoogle.save(fakeConnectors(), { text: ' ' }), (e) => e.status === 400);
  await assert.rejects(docGoogle.save(fakeConnectors({ apps: [] }), { text: 'x' }), (e) => e.status === 409 && e.state === 'not-connected');
  await assert.rejects(docGoogle.save(fakeConnectors({ fields: ['title', 'body_html'] }), { text: 'x' }), (e) => e.status === 502);
  await assert.rejects(docGoogle.save(fakeConnectors({ data: { ok: true, id: 'a/b' } }), { text: 'x' }), (e) => e.status === 502);
  assert.equal(docGoogle.idOf({ a: { b: { documentId: 'javascript:alert(1)' } } }), null, 'an id is plain letters, digits, - and _');
});

test('the route: the owner asks and is told it is not connected; the Chief may not; the feature is announced', async () => {
  const { startServer } = require('./helpers');
  const srv = await startServer();
  try {
    assert.ok((await srv.api('/version')).data.features.includes('document-google-docs'));
    assert.equal((await srv.api('/export/google-docs')).data.connected, false);
    const r = await srv.api('/export/google-docs', { method: 'POST', body: { title: 'T', text: 'x' } });
    assert.equal(r.status, 409);
    assert.equal(r.data.state, 'not-connected');
    assert.equal((await srv.asChief('/export/google-docs')).status, 403);
    assert.equal((await srv.asChief('/export/google-docs', { method: 'POST', body: { text: 'x' } })).status, 403);
  } finally { await srv.stop(); }
});

// Google's answer when the connection wasn't given the access to make documents (the owner's report, 23 Oct 2026).
const SCOPES = JSON.stringify({ error: { code: 403, message: 'Request had insufficient authentication scopes.', status: 'PERMISSION_DENIED', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT', domain: 'googleapis.com', metadata: { service: 'docs.googleapis.com', method: 'google.apps.docs.v1.DocumentsService.CreateDocument' } }] } });

test('save: Google\'s raw error becomes a plain sentence with Reconnect, and the old connection stops counting', async () => {
  const { appError } = require('../lib/app-errors');
  const C = fakeConnectors({ fails: () => appError(SCOPES, { app: 'googledocs', name: 'Google Docs' }) });
  let asked = 0;
  await assert.rejects(docGoogle.save(C, { text: 'x' }, { ask: async () => { asked++; return 'no'; } }), (e) => {
    assert.equal(e.status, 409);
    assert.equal(e.state, 'reconnect');
    assert.equal(e.code, 'app-permission');
    assert.equal(e.message, "Google Docs wasn't allowed to do this.");
    assert.doesNotMatch(e.message, /[{}]|PERMISSION|403/);
    return true;
  });
  assert.equal(asked, 0, 'a known kind needs no Claude');
  assert.equal((await docGoogle.status(C)).connected, false, 'the connection that lacks the access is not offered as connected');
  await assert.rejects(docGoogle.save(C, { text: 'x' }), (e) => e.state === 'not-connected', 'a second tap connects it first');
  C.apps = ['googledocs', 'googledocs']; // connected again: a new connection
  assert.equal((await docGoogle.status(C)).connected, true);
});

test('save: an unknown error is put in one sentence by Claude, else a plain "Couldn\'t", never the raw text', async () => {
  const { appError } = require('../lib/app-errors');
  const raw = '{"error":{"code":400,"message":"Invalid requests[0].insertText: Index 5 must be less than the end index","status":"INVALID_ARGUMENT"}}';
  const fails = () => appError(raw, { app: 'googledocs', name: 'Google Docs' });
  let prompt = '';
  await assert.rejects(docGoogle.save(fakeConnectors({ fails }), { text: 'x' }, { ask: async (p) => { prompt = p; return 'Google Docs could not place part of the text. Try saving it again.\n'; } }),
    (e) => e.status === 502 && e.code === 'app-failed' && !e.state && e.message === 'Google Docs could not place part of the text. Try saving it again.');
  assert.match(prompt, /Index 5 must be less/, 'Claude reads the app\'s own words');
  const other = () => appError(raw.replace('Index 5', 'Index 6'), { app: 'googledocs', name: 'Google Docs' });
  await assert.rejects(docGoogle.save(fakeConnectors({ fails: other }), { text: 'x' }, { ask: async () => '{"not": "a sentence"}' }), (e) => e.message === "Couldn't save it to Google Docs.");
  await assert.rejects(docGoogle.save(fakeConnectors({ fails: () => new Error('fetch failed') }), { text: 'x' }, { ask: async () => { throw new Error('signed out'); } }), (e) => e.message === "Couldn't save it to Google Docs.");
});
