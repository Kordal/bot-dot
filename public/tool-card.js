// The card of a tool the Chief asks to install for a bot, in Needs you and in the chats (docs/api.md
// "A tool to install"). The botdot server hands the card out as data: `title`, `meta`, `body`, `warning`
// (only for a tool from a link) and `facts`, rows of label and value. This file draws the fields it knows
// and decides no wording: only the two buttons are the page's. Every value comes from a registry or from a
// link, so it is text, never markup.
// A plain <script>, as window.ToolCard, loaded before app.js; the tests load it the same way.

(function (root) {

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A field as text: a string, or a number as it is written. Anything else (a list, an object, nothing) is not drawn.
const text = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

// Whether an ask is a tool's.
const is = (ask) => !!ask && ask.kind === 'tool';

// Rows of a label and a value, in the server's order: every row that has a label or a value, also labels this app never saw.
const rowsOf = (list) => (Array.isArray(list) ? list : [])
  .map((f) => ({ label: text(f?.label), value: text(f?.value) }))
  .filter((f) => f.label || f.value);
// Such rows as one block of the card: a faint label and its value per row. '' without a row.
// Other cards whose rows the server hands out are drawn by it too: a connected-app action, a changed bot (needs.js).
const rows = (list) => { const r = rowsOf(list); return r.length ? `<div class="need-body"><dl class="nb need-facts">${r.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('')}</dl></div>` : ''; };

const BUTTONS = `<button class="btn sm" data-need-no>${tr('Decline')}</button><button class="btn sm primary" data-need-yes>${tr('Install')}</button>`;

// The card's parts as markup, for the page's own card: the title, the meta line, the body (what the tool is and
// why, then the warning of a tool from a link, then the facts) and the buttons. A part the ask lacks is left out.
function parts(ask) {
  const body = text(ask?.body), warning = text(ask?.warning);
  return {
    title: esc(text(ask?.title)),
    meta: esc(text(ask?.meta)),
    body: (body ? `<div class="need-body"><div class="nb">${esc(body)}</div></div>` : '')
      + (warning ? `<div class="need-body need-warn" role="note"><div class="nb">⚠️ ${esc(warning)}</div></div>` : '')
      + rows(ask?.facts),
    actions: BUTTONS,
  };
}

root.ToolCard = { is, parts, text, rows };
})(typeof globalThis !== 'undefined' ? globalThis : this);
