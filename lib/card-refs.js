// A card in the chat that talks about it (ADR 249): a bot or the Chief that tells the owner a card waits in Needs you
// puts the card's id after it, `[card <id>]`, as its prompt names it. botdot takes the ids off the text and keeps
// them on the message as `cards`, and the apps draw each card that still waits right under that message, to answer
// there. An id that waits no more draws nothing.

const MAX = 4;
// `[card 1a2b3c4d]`, also as `[[card: 1a2b3c4d]]`: the id is what the prompt names, an ask's or a login request's,
// eight hex digits (lib/asks.js, lib/login-requests.js), so "[card payment]" stays text.
const REF = /[ \t]*\[\[?\s*card\s*:?\s*([0-9a-f]{8})\s*\]\]?/gi;

const RULE = 'When you tell the owner that one of these waits for them, put its [card <id>] right after it, as listed: the app shows that card there, so they answer it in the chat. Name only a card listed here.';

// Code, fenced or inline, is left as it is: an id there is text the bot shows, not a card.
const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/;

// The text without its card ids, and the ids (at most 4, each once), or null for none. Only each id and the spaces
// before it leave the text; everything else stays as it was written. `allowed` (a Set): the ids its prompt listed,
// which alone are kept: what a bot writes is not trusted, so naming another bot's card shows nothing.
function take(text, allowed = null) {
  if (typeof text !== 'string' || !/\[\[?\s*card\b/i.test(text)) return { text, cards: null };
  const cards = [];
  const rest = text.split(CODE).map((part, i) => (i % 2 ? part : part.replace(REF, (_, found) => {
    const id = found.toLowerCase();
    if (!cards.includes(id) && cards.length < MAX && (!allowed || allowed.has(id))) cards.push(id);
    return '';
  }))).join('');
  return { text: rest, cards: cards.length ? cards : null };
}

// Puts the ids `take` found on a message or a run, as `cards`; none leaves it without.
function put(target, cards) {
  if (Array.isArray(cards) && cards.length) target.cards = cards.slice(0, MAX);
  return target;
}

// The ids in lines that end with `[card <id>]`, as the prompts list them.
const idsIn = (lines) => new Set([...String((lines || []).join(' ')).matchAll(REF)].map((m) => m[1].toLowerCase()));

module.exports = { take, put, idsIn, RULE, MAX };
