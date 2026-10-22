// Quick answers: when a reply ends with a question the owner can answer in a word or two ("Should I
// send it?"), the bot (or the Chief) adds a last line [[choices: Yes | No]]. botdot takes it off the
// text and the chat shows the choices as buttons under the reply, so the owner taps instead of typing.
// Several questions at once go as one last line each, [[ask: …]]: the chat shows them as a card under
// the reply, each with its own box, and sends the answers back as one message.

const NOTE =
  'When your reply ends with a question the owner can answer with one of a few short choices (above all yes / no), ' +
  'add one last line: [[choices: Yes | No]]. Write the choices in the language of your reply (e.g. [[choices: Tak | Nie]]), ' +
  '2 to 4 of them, each a few words that make sense sent back to you as the answer (e.g. [[choices: Send it | Change it first | Cancel]]). ' +
  'Only for a real question to the owner, never for open questions; the line is shown as buttons, not as text.\n' +
  'When you need to ask the owner two or more questions at once, don\'t write them in the reply: end it with one line per question, ' +
  '[[ask: Which account should I send it from?]], 2 to 6 of them, each a whole question that makes sense on its own. ' +
  'The owner sees them as a card with a box under each, and their answers come back as one message with each question, then "→" and its answer ("→ –" means they skipped it). ' +
  'Don\'t add [[choices: …]] to such a reply.';

// Proactive, within bounds (#343): check what can be checked, name the next step, and offer to take it once, as one
// Yes/No question. Told to a bot in its own chat and to the Chief; a "No" in the chat is never offered again.
const OFFER =
  'Before you answer, check what you can check quickly with your connected apps and tools, only by reading (did the boarding pass arrive in the mail, was the reply already sent, is the invoice paid), and say what you found. ' +
  'When your answer has a deadline, a time window or something still open, say in one or two lines what the owner should do and when. ' +
  'When you can take that next step for them (a reminder with remind_me, a check at a later time, a draft), end your reply with one short question that offers exactly that one thing, and [[choices: …]] with a yes that names it and a no (e.g. [[choices: Yes, at 13:20 | No]]). ' +
  'At most one offer per reply, only when there is a date, a deadline or something open, never for small talk or a plain answer. ' +
  'Never offer again what the owner turned down in this chat; when they say they never want that kind of offer, save it as a note. ' +
  'A yes to your offer is the owner asking for it: do it then, and confirm in one line with the day and time in words.';

// A choices line is a line of its own, mostly the last; text the bot wrote after it (a note it saved, #38) stays text.
const RE = /^[ \t]*\[\[\s*choices\s*:([^\]\n]*)\]\][ \t]*$/gim;
const ASK = /\n?[ \t]*\[\[\s*ask\s*:([^\n]*?)\]\][ \t]*$/i;
const MAX_QUESTIONS = 6;

// { text, choices, questions }: the reply without those lines, its choices and its questions (null when there are none).
function split(text) {
  if (typeof text !== 'string') return { text, choices: null, questions: null };
  let rest = text.trimEnd();
  let choices = null;
  // Every choices line leaves the text, and the last one gives the buttons.
  const takeChoices = () => {
    const m = [...rest.matchAll(RE)].at(-1);
    if (!m) return false;
    const found = [...new Set(m[1].split('|').map((c) => c.trim().replace(/^["']|["']$/g, '')).filter((c) => c && c.length <= 40))].slice(0, 4);
    choices = found.length >= 2 ? found : null;
    rest = rest.split(RE).filter((_, i) => i % 2 === 0) // split also returns each line's captured choices
      .map((part) => part.replace(/^(?:[ \t]*\n)+/, '').trimEnd()).filter(Boolean).join('\n\n');
    return true;
  };
  const had = takeChoices();
  let asked = [];
  for (let m; (m = rest.match(ASK)); rest = rest.slice(0, m.index).trimEnd()) {
    asked = [...m[1].split(/\]\]\s*\[\[\s*ask\s*:/i).map((q) => q.trim()).filter(Boolean), ...asked]; // two on one line
  }
  if (!asked.length) return { text: had ? rest : text, choices, questions: null };
  asked = [...new Set(asked)];
  // One question is no card, and a card holds 6: the rest stay in the reply as text.
  const questions = asked.length >= 2 ? asked.slice(0, MAX_QUESTIONS) : null;
  const left = questions ? asked.slice(MAX_QUESTIONS) : asked;
  if (left.length) rest = [rest, left.join('\n\n')].filter(Boolean).join('\n\n');
  return { text: rest, choices: questions ? null : choices, questions };
}

// Whether a run's or a message's reply holds a question: answer buttons or a card of questions.
const holds = (reply) => !!(reply?.choices?.length || reply?.questions?.length);

const LINE_MAX = 200;
const oneLine = (t) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > LINE_MAX ? `${t.slice(0, LINE_MAX)}…` : t; };
// The question of a reply that holds one, in one line (docs/api.md, "A bot that asks"): of a card its first
// question, with " (+2 more)" when there are more; of answer buttons the last sentence of the reply that ends in
// a question mark, else the reply's last line. A reply that is only its buttons has them as its line.
function line(reply) {
  if (reply.questions?.length) return oneLine(reply.questions[0]) + (reply.questions.length > 1 ? ` (+${reply.questions.length - 1} more)` : '');
  const lines = String(reply.result ?? reply.text ?? '').split('\n').map((l) => l.replace(/^[\s>#*_-]+/, '').replace(/[\s*_]+$/, '')).filter(Boolean);
  const sentences = lines.flatMap((l) => l.split(/(?<=[.!?…？。！])\s+/));
  const asked = sentences.filter((x) => /[?？]["'”’»)\]]*$/.test(x)).at(-1);
  return oneLine(asked || lines.at(-1) || (reply.choices || []).join(' / '));
}

// A reply's questions as text, for a reader who gets no buttons: the Chief, for a run it started (bots.js).
// `answer` is what split returned.
function asText(answer) {
  const asked = answer.questions ? `Questions:\n${answer.questions.map((q) => `- ${q}`).join('\n')}` : answer.choices ? `Possible answers: ${answer.choices.join(' | ')}` : '';
  return asked ? [answer.text, asked].filter(Boolean).join('\n\n') : answer.text;
}

module.exports = { OFFER, NOTE, split, holds, line, asText };
