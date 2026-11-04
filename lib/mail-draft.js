// A mail draft as one card (#415): when the Chief has an e-mail ready that waits for the owner's word to send it,
// it ends its reply with a [[draft]] block instead of quoting the mail and asking. botdot takes the block off the
// text and keeps it on the message as `draft`; the chat draws it as a card with Send now and Not now, whose tap
// goes back to the Chief as an answer button's does. A newer draft to the same recipient with the same subject
// folds the earlier one, and [[draft sent]] says the mail went. A look's message may hold one too (#422): a reply the
// owner owes, drafted by a look that only reads, so it is in no mailbox yet (`unsaved`) until Send now. An Attach:
// line names a file the mail carries: the card shows it, and opens it when it is a file of that chat (the owner's
// upload, a bot's file).
const { put } = require('./choices');

const SEND = 'Send now';
const KEEP = 'Not now';
const CHOICES = [SEND, KEEP];

const NOTE =
  'An e-mail draft that waits for the owner\'s word to send it (yours, or one a bot wrote, e.g. in the mailbox\'s Drafts folder) is never quoted in your reply, and you never ask in words whether to send it. ' +
  'End the reply with the draft as a block:\n[[draft]]\nTo: Name <address>\nSubject: The subject\nAttach: file.pdf\n\nThe mail\'s text, as it will go.\n[[/draft]]\n' +
  'Write one Attach: line for each file the mail carries, with its name as the chat shows it, and none for a mail without files. ' +
  `The owner sees it as a card with "${SEND}" and "${KEEP}", and a tap comes back to you as that message. Above the block write at most one short line (e.g. a deadline), never the mail or the question again, and no [[choices: …]] in that reply. ` +
  `"${KEEP}" keeps it in Drafts: say so in a few words and do nothing else with it. ` +
  `A reply you drafted in a message you wrote first is in no mailbox yet: on "${SEND}", make it a draft in that email's thread, then send that draft; on "${KEEP}", leave it unsent. ` +
  'After a change to it, write the whole block again with the same To and Subject: the card before it folds. ' +
  'Once the mail went, say so in one line and end with the block opened by [[draft sent]], with its To and Subject and no text.';

const BLOCK = /^[ \t]*\[\[\s*draft(\s+sent)?\s*\]\][ \t]*\n([\s\S]*?)\n?[ \t]*\[\[\s*\/\s*draft\s*\]\][ \t]*$/gim;
const MAX_TEXT = 20000;
const MAX_FILES = 20;
const oneLine = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

// A file's name as an Attach: line writes it: without a path or quotes.
const fileName = (s) => oneLine(s, 1000).replace(/^["'`]+|["'`]+$/g, '').split(/[\\/]/).pop().trim().slice(0, 255);

// The header lines (To, Subject, Attach) until the first empty line or the first line that is no header, then the text.
function parseBlock(sent, inner) {
  const lines = inner.replace(/\r/g, '').split('\n');
  const head = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(to|subject|attach(?:ments?)?)\s*:\s*(.*)$/i);
    if (!m) break;
    const field = m[1].toLowerCase();
    if (field.startsWith('attach')) (head.attach ||= []).push(m[2]);
    else head[field] = m[2];
  }
  while (i < lines.length && !lines[i].trim()) i++;
  const to = oneLine(head.to, 300);
  const subject = oneLine(head.subject, 300);
  if (!to && !subject) return null; // no header: not a draft, it stays as text
  const names = (head.attach || []).map(fileName).filter(Boolean).slice(0, MAX_FILES);
  return { to, subject, text: lines.slice(i).join('\n').trim().slice(0, MAX_TEXT), state: sent ? 'sent' : 'draft', ...(names.length ? { attachments: names.map((name) => ({ name })) } : {}) };
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
    if (!d.attachments && before.at(-1)?.draft.attachments) d.attachments = before.at(-1).draft.attachments;
    delete reply.choices;
    delete reply.yes;
  } else {
    put(reply, [...CHOICES]);
  }
  delete reply.questions;
  if (d.attachments) d.attachments = attach(d.attachments, messages.slice(0, messages.indexOf(reply) >= 0 ? messages.indexOf(reply) + 1 : messages.length));
  const by = [...(reply.actions || [])].reverse().find((a) => (a.kind === 'run' || a.kind === 'from') && a.botId);
  const from = by ? { botId: by.botId, runId: by.runId } : before.at(-1)?.draft.botId ? { botId: before.at(-1).draft.botId, runId: before.at(-1).draft.runId } : null;
  if (from) {
    d.botId = from.botId;
    if (from.runId) d.runId = from.runId;
    const name = bot(from.botId);
    if (name) d.bot = name;
  }
}

// The draft's files, each as the chat has it ({ name, file, size }, newest first) so that the apps open it as they
// open it there: the owner's upload ("uploads/…") or a bot's file ("<runId>/<name>"). A name the chat has no file of
// stays a name: the mail may carry a file the bot made, never shown here. A line of several names, "a.pdf, b.pdf",
// is read as those names when the whole is no file of the chat.
function attach(list, messages) {
  const known = new Map();
  for (const m of [...messages].reverse()) {
    for (const f of [...(m.attachments || []), ...(m.files || [])]) {
      if (!f?.name || !f.file) continue;
      const it = { name: f.name, file: f.file, ...(f.size ? { size: f.size } : {}) };
      // By its name, and by its file's own ("123-ab-Scan.pdf"), which is what the Chief's path to it ends in.
      for (const k of [f.name, String(f.file).split('/').pop()].map((x) => x.toLowerCase())) if (!known.has(k)) known.set(k, it);
    }
  }
  const out = [];
  for (const f of list) {
    const name = f.name;
    if (f.file) { out.push(f); continue; } // a version before found it already
    const parts = known.has(name.toLowerCase()) ? [name] : name.split(/\s*[,;]\s*/).filter(Boolean);
    const several = parts.length > 1 && parts.some((p) => known.has(p.toLowerCase()));
    for (const p of several ? parts : [name]) out.push(known.get(p.toLowerCase()) || { name: p });
  }
  const seen = new Set();
  return out.filter((f) => !seen.has(f.name.toLowerCase()) && seen.add(f.name.toLowerCase())).slice(0, MAX_FILES);
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
  `<from-botdot>\nbotdot read my message as my tap on the card of your mail draft to ${draft.to || 'its recipient'}, "${draft.subject}"${draft.unsaved ? ' (not in the mailbox yet)' : ''}: ${send ? 'send it now' : draft.unsaved ? 'not now, leave it unsent' : 'keep it in Drafts for now'}.\n</from-botdot>`;

// A draft as text, for a reader that gets no card: recall.
const asText = (d) => (d ? [`To: ${d.to}`, `Subject: ${d.subject}`, ...(d.attachments || []).map((f) => `Attach: ${f.name}`), d.state === 'sent' ? 'Sent.' : d.unsaved ? 'Not sent, not in the mailbox yet.' : d.state === 'kept' ? 'Kept in Drafts, not sent.' : 'In Drafts, not sent.', '', d.text].join('\n') : '');

module.exports = { NOTE, CHOICES, SEND, KEEP, split, key, settle, answered, answerNote, asText };
