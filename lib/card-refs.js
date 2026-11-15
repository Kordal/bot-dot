// A card in the chat that talks about it (ADR 249): a bot or the Chief that tells the owner a card waits in Needs you
// puts the card's id after it, `[card <id>]`, as its prompt names it. botdot takes the ids off the text and keeps
// them on the message as `cards`, and the apps draw each card that still waits right under that message, to answer
// there. An id that waits no more draws nothing.

const MAX = 4;
// `[card 1a2b3c4d]`, also as `[[card: 1a2b3c4d]]`: the id is what the prompt names, an ask's or a login request's,
// eight hex digits (lib/asks.js, lib/login-requests.js), so "[card payment]" stays text.
const REF = /[ \t]*\[\[?\s*card\s*:?\s*([0-9a-f]{8})\s*\]\]?/gi;

const RULE = 'When you tell the owner that one of these waits for them, put its [card <id>] right after it, as listed: the app shows that card there, so they answer it in the chat. Name only a card listed here.';

// The text without its card ids, and the ids (at most 4, each once), or null for none.
function take(text) {
  if (typeof text !== 'string' || !/\[\[?\s*card\b/i.test(text)) return { text, cards: null };
  const cards = [];
  const rest = text.replace(REF, (_, id) => { if (!cards.includes(id) && cards.length < MAX) cards.push(id); return ''; })
    .replace(/[ \t]+([.,;:!?)])/g, '$1').replace(/[ \t]+$/gm, '');
  return { text: rest, cards: cards.length ? cards : null };
}

// Puts the ids `take` found on a message or a run, as `cards`; none leaves it without.
function put(target, cards) {
  if (Array.isArray(cards) && cards.length) target.cards = cards.slice(0, MAX);
  return target;
}

module.exports = { take, put, RULE, MAX };
