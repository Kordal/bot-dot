// The words of the screen viewer (screen/viewer.html, ADR 279) in the account's language (ADR 108): the viewer is a page
// of its own, with no dictionary, so botdot writes its words into the page it serves, and the notes it shows in the
// frame while the computer is off. The language is the account's (Settings), as for every other page.
const { tr } = require('./i18n');
const screenDrop = require('./screen-drop');

// By state (the names the page tells its frame): the words the viewer says.
const words = (lang) => ({
  starting: tr(lang, 'Starting the computer…'),
  watching: tr(lang, 'Viewing'),
  control: tr(lang, 'You have control'),
  reconnecting: tr(lang, 'Reconnecting…'),
  off: tr(lang, 'Turned off'),
});

// The notes of a frame whose computer is off or whose screen failed.
const notes = (lang) => ({
  start: tr(lang, "This bot's screen starts when it first uses its computer."),
  off: tr(lang, "This bot's computer is turned off."),
  failed: tr(lang, "This bot's screen couldn't be shown. Try again in a moment."),
});

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The viewer's page for `lang`, for the bot `botId` ({ boat }: its computer is on boat.dev): its {lang}, {title},
// {words} and {drop} filled.
function page(html, lang, botId, { boat = false } = {}) {
  return html
    .replace('{lang}', () => escape(lang))
    .replace('{title}', () => escape(tr(lang, 'Screen')))
    .replace('{words}', () => escape(JSON.stringify(words(lang))))
    .replace('{drop}', () => escape(screenDrop.data(lang, botId, { boat })));
}

module.exports = { page, notes, words };
