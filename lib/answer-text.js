// Answer views as text on the server (#1624, ADR 264): a push, a room's notice and the like read a reply's ```ui fence as its
// `alt`. The rules are the web page's (public/answer-text.js, run on the same validator and the catalog the server hands out).
const AnswerView = require('../public/answer-view');
const AnswerText = require('../public/answer-text');

module.exports = AnswerText.of(AnswerView.of(require('./ui-catalog.json')));
