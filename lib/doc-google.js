// A document saved to Google Docs (#351): the owner's tap on "Save to Google Docs" is their OK for this one action of
// their connected Google Docs (ADR 047), so it runs at once with no card. The Markdown goes to Composio's action that
// makes a Google Doc from Markdown, under the document's title; the answer is the new document's address.
const { titleOf, mdBlocks } = require('./doc-export');

const APP = 'googledocs';
const TOOL = 'GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN';
const MAX_TEXT = 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{10,200}$/;

const err = (status, message, state) => Object.assign(new Error(message), { status, ...(state ? { state } : {}) });

// Whether Google Docs is connected now: { connected }.
async function status(C) {
  if (!C.configured()) return { connected: false };
  return { connected: (await C.connectedApps().catch(() => [])).includes(APP) };
}

// The id of the document an answer names, wherever the action put it.
function idOf(data, depth = 0) {
  if (!data || typeof data !== 'object' || depth > 4) return null;
  for (const k of ['documentId', 'document_id', 'id']) if (typeof data[k] === 'string' && ID_RE.test(data[k])) return data[k];
  for (const v of Object.values(data)) { const id = idOf(v, depth + 1); if (id) return id; }
  return null;
}

// Saves { title, text } as a new Google Doc: { id, url, title }.
async function save(C, { title, text } = {}) {
  if (typeof text !== 'string' || !text.trim()) throw err(400, 'Nothing to save.');
  if (Buffer.byteLength(text) > MAX_TEXT) throw err(400, 'Too long to save: at most 1 MB of text.');
  if (!(await status(C)).connected) throw err(409, 'Google Docs is not connected. Connect it on the Connectors page.', 'not-connected');
  const t = titleOf(title, mdBlocks(text));
  // The action's own name for the text, as Composio describes it.
  const [tool] = await C.tools(APP, { tool: TOOL });
  const props = Object.keys(tool?.input?.properties || {});
  const field = ['markdown_text', 'markdown', 'text', 'content'].find((f) => props.includes(f));
  if (!field || !props.includes('title')) throw err(502, "Google Docs' action has changed: botdot can't save to it.");
  const data = await C.execute(APP, TOOL, { title: t, [field]: text }, null, () => {}); // the owner's tap is the OK
  const id = idOf(data);
  if (!id) throw err(502, 'Google Docs saved nothing botdot can open.');
  return { id, title: t, url: `https://docs.google.com/document/d/${id}/edit` };
}

module.exports = { APP, TOOL, status, save, idOf };
