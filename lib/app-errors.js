// A connected app's failure in plain words. An app answers a failed action with its own error, often its API's JSON
// (Google's 403 { "status": "PERMISSION_DENIED", "reason": "ACCESS_TOKEN_SCOPE_INSUFFICIENT", … }): never shown to a
// person as it is. The kinds that are known get a short sentence and what helps; any other is put in one sentence by
// Claude for a person who waits for it (explain), else a plain "Couldn't …". The app's own words stay as `detail`, for
// a bot and for the log.
//
// code    what went wrong: 'app-permission' (the app wasn't given this access), 'app-signed-out', 'app-busy' (too many
//         requests), 'app-down' (not reached, or failing on its side), or 'app-failed' (anything else)
// action  what helps: 'reconnect' (connect the app again and allow what it asks for), 'retry' (later), or null

const KINDS = [
  { code: 'app-permission', action: 'reconnect', re: /access_token_scope_insufficient|insufficient (authentication )?scopes?|insufficientpermissions|missing (required )?scopes?/i, says: (n) => `${n} wasn't allowed to do this.` },
  { code: 'app-signed-out', action: 'reconnect', re: /invalid_grant|unauthenticated|"code":\s*401\b|\b401 unauthorized|invalid[_ ]credentials|invalid_token|token (has )?(been )?(expired|revoked)|(expired|revoked) token/i, says: (n) => `${n} is signed out.` },
  { code: 'app-busy', action: 'retry', re: /"code":\s*429\b|\b429 too many|rate.?limit|resource_exhausted|quota exceeded|too many requests/i, says: (n) => `${n} is busy. Try again in a minute.` },
  { code: 'app-down', action: 'retry', re: /"code":\s*50[0-4]\b|"status":\s*"unavailable"|backend error|econnreset|etimedout|enotfound|econnrefused|socket hang up/i, says: (n) => `${n} can't be reached right now. Try again later.` },
];

// What a bot is told to do about it, after the sentence.
const FOR_BOT = { reconnect: 'Ask the owner to reconnect it on the Connectors page.', retry: 'Try again later.' };

const MAX_DETAIL = 2000;
const detailOf = (raw) => String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_DETAIL);

// The kind of an app's error, from its own words: { code, action, message }, or code 'app-failed' with no message.
function classify(raw, name = 'The app') {
  const text = detailOf(raw);
  const k = KINDS.find((x) => x.re.test(text));
  return k ? { code: k.code, action: k.action, message: k.says(name) } : { code: 'app-failed', action: null, message: null };
}

// An Error for an app's failed action: message plain when the kind is known, else `fallback`; with code, action, app
// and the app's own words as detail. status: 409 when reconnecting helps, 503 when a retry may, else 502.
function appError(raw, { app = null, name = 'The app', fallback } = {}) {
  const k = classify(raw, name);
  const status = k.action === 'reconnect' ? 409 : k.action === 'retry' ? 503 : 502;
  return Object.assign(new Error(k.message || fallback || `${name} couldn't do it.`), { status, code: k.code, action: k.action, app, detail: detailOf(raw), appError: true });
}

// The same failure as a bot reads it: the sentence, what to do, and the app's own words.
const forBot = (e) => [e.message, FOR_BOT[e.action], e.detail && e.detail !== e.message ? `The app said: ${e.detail.slice(0, 600)}` : ''].filter(Boolean).join(' ');

// One sentence a person can read, from words Claude wrote: one line, no markup, no codes. Null when it isn't one.
function sentence(text) {
  const s = String(text ?? '').trim().split('\n')[0].trim().replace(/^["'“]+|["'”]+$/g, '').trim();
  if (s.length < 8 || s.length > 200 || /[{}<>`[\]]|https?:/.test(s)) return null;
  return s;
}

const said = new Map(); // detail -> Claude's sentence, for the same error asked again
const KEEP = 50;

// A failed action of an app explained for a person who waits for it (e.g. the owner's tap on "Save to Google Docs"):
// e from appError. A kind that is known keeps its sentence; any other is put in one sentence by Claude, else
// `fallback` stays. ask(prompt, opts): lib/dresser.js askClaude. Never throws.
async function explain(e, { doing, ask, ms = 30_000 } = {}) {
  if (!e?.appError || e.code !== 'app-failed' || !e.detail || typeof ask !== 'function') return e;
  let s = said.get(e.detail);
  if (!s) {
    const prompt = [
      'An action failed in botdot, an app where a person runs AI bots and connects their apps.',
      `It was trying to ${doing || 'run an action of a connected app'}.`,
      'The app answered with this error:',
      e.detail,
      '',
      'Write one short sentence, at most 20 words, for a person who is not technical: what went wrong and what they can do about it.',
      'No error codes, no JSON, no quotes, no links. Answer with the sentence only.',
    ].join('\n');
    s = sentence(await ask(prompt, { llm: { model: 'haiku' }, ms, what: 'to explain an error' }).catch(() => null));
    if (s) { said.set(e.detail, s); if (said.size > KEEP) said.delete(said.keys().next().value); }
  }
  if (s) e.message = s;
  return e;
}

module.exports = { classify, appError, forBot, explain, sentence, KINDS };
