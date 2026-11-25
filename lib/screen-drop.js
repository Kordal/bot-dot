// What the screen viewer needs to take a file dropped onto it (#1736, ADR 279): the words of it in the account's
// language, the size and number the upload route takes (lib/uploads.js), and whether the bot's computer takes one at
// all. botdot writes it into the page it serves (lib/screen-page.js), as it does the words of the states.
const { tr } = require('./i18n');
const uploads = require('./uploads');

// By name (the names screen/viewer/drop.js asks for), with {placeholders} the page fills.
const words = (lang) => ({
  hint: tr(lang, "Drop the file to put it in the bot's folder"),
  watching: tr(lang, 'Take control to drop a file onto the screen.'),
  boat: tr(lang, "A file can't be dropped onto an External Virtual PC yet."),
  sending: tr(lang, 'Sending {name}…'),
  done: tr(lang, "{name} is in the bot's folder."),
  many: tr(lang, "{count} files are in the bot's folder."),
  failed: tr(lang, "{name} didn't go to the bot's folder."),
  big: tr(lang, "{name} is over {mb} MB: it wasn't sent."),
  folder: tr(lang, '{name} is a folder: drop files, not folders.'),
  tooMany: tr(lang, 'Drop at most {count} files at once.'),
});

// The viewer's `data-drop`: JSON. `boat`: the bot's computer is an External Virtual PC, whose files the upload route
// of the account's computer doesn't reach.
const data = (lang, botId, { boat = false } = {}) => JSON.stringify({
  bot: botId, boat, maxBytes: uploads.MAX_BYTES, maxFiles: uploads.MAX_FILES, words: words(lang),
});

module.exports = { data, words };
