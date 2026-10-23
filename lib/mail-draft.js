// A mail draft as one card (#415): when the Chief has an e-mail ready that waits for the owner's word to send it,
// it ends its reply with a [[draft]] block instead of quoting the mail and asking. botdot takes the block off the
// text and keeps it on the message as `draft`; the chat draws it as a card with Send now and Not now, whose tap
// goes back to the Chief as an answer button's does. A newer draft to the same recipient with the same subject
// folds the earlier one, and [[draft sent]] says the mail went.

const SEND = 'Send now';
const KEEP = 'Not now';
const CHOICES = [SEND, KEEP];

const NOTE =
  'An e-mail draft that waits for the owner\'s word to send it (yours, or one a bot wrote, e.g. in the mailbox\'s Drafts folder) is never quoted in your reply, and you never ask in words whether to send it. ' +
  'End the reply with the draft as a block:\n[[draft]]\nTo: Name <address>\nSubject: The subject\n\nThe mail\'s text, as it will go.\n[[/draft]]\n' +
  `The owner sees it as a card with "${SEND}" and "${KEEP}", and a tap comes back to you as that message. Above the block write at most one short line (e.g. a deadline), never the mail or the question again, and no [[choices: …]] in that reply. ` +
  `"${KEEP}" keeps it in Drafts: say so in a few words and do nothing else with it. ` +
  'After a change to it, write the whole block again with the same To and Subject: the card before it folds. ' +
  'Once the mail went, say so in one line and end with the block opened by [[draft sent]], with its To and Subject and no text.';

const BLOCK = /^[ \t]*\[\[\s*draft(\s+sent)?\s*\]\][ \t]*\n([\s\S]*?)\n?[ \t]*\[\[\s*\/\s*draft\s*\]\][ \t]*$/gim;
const MAX_TEXT = 20000;
const oneLine = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

// The header lines (To, Subject) until the first empty line or the first line that is no header, then the text.
function parseBlock(sent, inner) {
  const lines = inner.replace(/\r/g, '').split('\n');
  const head = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(to|subject)\s*:\s*(.*)$/i);
    if (!m) break;
    head[m[1].toLowerCase()] = m[2];
  }
  while (i < lines.length && !lines[i].trim()) i++;
  const to = oneLine(head.to, 300);
  const subject = oneLine(head.subject, 300);
  if (!to && !subject) return null; // no header: not a draft, it stays as text
  return { to, subject, text: lines.slice(i).join('\n').trim().slice(0, MAX_TEXT), state: sent ? 'sent' : 'draft' };
}

// { text, draft }: the reply without its last draft block, and that draft (null when it has none). Other blocks
// stay in the text as written: one card a reply.
function split(text) {
  if (typeof text !== 'string') return { text, draft: null };
  const found = [...text.matchAll(BLOCK)];
  for (const m of found.reverse()) {
    const draft = parseBlock(!!m[1], m[2]);
    if (!draft) continue;
    const rest = (text.slice(0, m.index).trimEnd() + '\n\n' + text.slice(m.index + m[0].length).trim()).trim();
    return { text: rest, draft };
  }
  return { text, draft: null };
}

// Two drafts are versions of one mail when they go to the same recipient with the same subject.
const key = (d) => `${String(d?.to || '').toLowerCase()}\n${String(d?.subject || '').toLowerCase()}`;

// Put a reply's draft in its place in the chat, once the reply has ended: the drafts before it of the same mail
// fold (`earlier`), a sent one without text takes the text of the version it sent, the reply's answers are the
// card's while it waits, and the bot whose run wrote it (the reply's last chip of a run or a late result) is named
// in its footer, in place of that chip. bot(id): the bot's name, or ''.
function settle(messages, reply, bot = () => '') {
  const d = reply?.draft;
  if (!d) return;
  const before = messages.slice(0, messages.indexOf(reply) >= 0 ? messages.indexOf(reply) : messages.length)
    .filter((m) => m.role === 'chief' && m.draft && key(m.draft) === key(d));
  for (const m of before) m.draft.earlier = true;
  if (d.state === 'sent') {
    d.sentAt = reply.endedAt || new Date().toISOString();
    if (!d.text) d.text = before.at(-1)?.draft.text || '';
    delete reply.choices;
  } else {
    reply.choices = [...CHOICES];
  }
  delete reply.questions;
  const by = [...(reply.actions || [])].reverse().find((a) => (a.kind === 'run' || a.kind === 'from') && a.botId);
  const from = by ? { botId: by.botId, runId: by.runId } : before.at(-1)?.draft.botId ? { botId: before.at(-1).draft.botId, runId: before.at(-1).draft.runId } : null;
  if (from) {
    d.botId = from.botId;
    if (from.runId) d.runId = from.runId;
    const name = bot(from.botId);
    if (name) d.bot = name;
  }
}

// The open draft the owner's message answers, when it is one of the card's words: the newest draft of the chat
// that has not folded or gone, while no later reply offers answer buttons of its own. Its state becomes "kept" on Not now. Returns { draft, send } or null.
function answered(messages, text) {
  const said = String(text || '').trim().toLowerCase();
  const send = said === SEND.toLowerCase();
  if (!send && said !== KEEP.toLowerCase()) return null;
  // A later reply with answer buttons of its own ("Not now" under a checkup) is what such words answer.
  const m = [...messages].reverse().find((x) => x.role === 'chief' && !x.pending && (x.draft || x.choices?.length));
  if (!m?.draft || m.draft.earlier || m.draft.state === 'sent') return null;
  if (!send) m.draft.state = 'kept';
  return { draft: m.draft, send };
}

// What botdot tells the Chief with that answer.
const answerNote = ({ draft, send }) =>
  `<from-botdot>\nbotdot read my message as my tap on the card of your mail draft to ${draft.to || 'its recipient'}, "${draft.subject}": ${send ? 'send it now' : 'keep it in Drafts for now'}.\n</from-botdot>`;

// A draft as text, for a reader that gets no card: recall.
const asText = (d) => (d ? [`To: ${d.to}`, `Subject: ${d.subject}`, d.state === 'sent' ? 'Sent.' : d.state === 'kept' ? 'Kept in Drafts, not sent.' : 'In Drafts, not sent.', '', d.text].join('\n') : '');

module.exports = { NOTE, CHOICES, SEND, KEEP, split, key, settle, answered, answerNote, asText };
