// Needs you returns the owner to where they came from (#264): once the last card open on the page is answered
// there, the page waits a moment, so that the answer can be read, and goes back to the chat (or other view) it was
// opened from. A page that opens with nothing waiting stays. This file decides; needs.js and app.js do it.
// A plain <script>, as window.NeedsReturn; the tests load it the same way.

(function (root) {

// How long the answered cards stay readable before the page leaves, in milliseconds (docs/DECISIONS.md).
const DELAY = 1200;

// Where the page returns to, from the page the owner leaves for it: the view and its id (the bot, the group or
// the Chief chat), with `list: true` when the owner came from the list of bots on a phone (the list is shown
// again, over that view), or null when there is nowhere to go back to.
// st: the page's state before Needs you opens. onList: the list of bots is what the owner sees (a phone).
function from(st, onList) {
  const v = st && st.view;
  if (!v || v === 'needs') return null;
  const id = v === 'bot' ? st.botId : v === 'group' ? st.groupId : v === 'chief' ? st.chatId : null;
  return onList ? { view: v, id: id || null, list: true } : { view: v, id: id || null };
}

// One drawing of the page. seen: a card stood open on it during this visit; open: how many stand open now;
// answered: the owner answered a card on the page during this visit. It leaves when the cards went from some to
// none during this visit and the owner answered there, never when it opened with none, nor for a card answered
// elsewhere while the owner reads.
function step(seen, open, answered) {
  return open > 0 ? { seen: true, leave: false } : { seen: false, leave: !!seen && !!answered };
}

root.NeedsReturn = { DELAY, from, step };

})(typeof window !== 'undefined' ? window : globalThis);
