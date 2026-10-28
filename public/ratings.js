// 👍 and 👎 under an unasked Chief message on the web page (docs/api.md "The Chief writes first").
// Two small outline thumbs after Copy; the one the owner tapped is filled in the Chief's colour. The botdot
// server stores the rating and announces it on the live feed (`rating`); this file only draws it and says what
// a tap makes of it. Against a server without `ratings` in `features` nothing shows.
// A plain <script>, as window.Ratings, loaded after unread.js (its colour check); the tests load it the same way.

(function (root) {

const VALUES = ['up', 'down'];
const LABEL = { up: tr('More like this'), down: tr('Less like this') };
const THUMB = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v11H3V10z"/><path d="M7 10l4-8a2.5 2.5 0 0 1 2.5 2.5V8h5.3a2 2 0 0 1 2 2.4l-1.5 8A2 2 0 0 1 17.3 20H7z"/></svg>';

// A rating as the server has it: 'up', 'down', or null for anything else.
const value = (r) => (VALUES.includes(r) ? r : null);

// What a tap on `tapped` makes of the current rating: the filled one clears, the other one moves it.
const next = (current, tapped) => (value(tapped) === null ? value(current) : value(current) === tapped ? null : tapped);

// Whether a message gets the thumbs: an unasked Chief message with its place in the chat, from a server that rates.
const shows = (m, features, index) => !!(Array.isArray(features) && features.includes('ratings')
  && m && m.role === 'chief' && m.unasked === true && !m.pending && Number.isInteger(index) && index >= 0);

// The thumbs of the message at place `index` of its chat (the server's index), with its rating filled.
function html(rating, index, color) {
  const on = value(rating);
  return `<span class="rate" data-rate="${Number(index)}" style="--c:${root.Unread.tint(color)}">${VALUES.map((v) =>
    `<button type="button" class="rate-btn ${v}" data-rating="${v}" aria-label="${LABEL[v]}" title="${LABEL[v]}" aria-pressed="${on === v}">${THUMB}</button>`).join('')}</span>`;
}

// The rating the thumbs show now.
const shown = (el) => value(el?.querySelector('[aria-pressed="true"]')?.dataset.rating);

// Fill the thumbs with `rating`.
function show(el, rating) {
  if (!el) return;
  const on = value(rating);
  for (const b of el.querySelectorAll('[data-rating]')) b.setAttribute('aria-pressed', String(b.dataset.rating === on));
}

root.Ratings = { value, next, shows, html, shown, show, LABEL };
})(typeof globalThis !== 'undefined' ? globalThis : this);
