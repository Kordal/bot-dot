// Every bot learns all it can and replies in plain words (#305 and after): a bot's settings on the web page have
// no "Learns from its work" row, nor its history and undo line, and no "Human-friendly replies" or "While
// learning, it may propose changes…" option; saving a bot sends neither. The page's own code, cut out of
// public/app.js (test/web-page.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, cut } = require('./web-page');

const settings = cut('function renderBotSettings(', '// The bits of the settings page that follow');

test('web: a bot\'s settings have no "Learns from its work" row, no history and undo line, and no other way to turn learning off', () => {
  assert.doesNotMatch(settings, /Learns from its work|name="learns"|🧠/);
  assert.doesNotMatch(settings, /bs-learning|bs-history|loadSelfChanges/);
  assert.doesNotMatch(app, /`\/bots\/\$\{[^}]+\}\/learning`/, 'the page asks for no history');
  // Its one undo is of the change a card made to its main assignment or rules, by the server's `undo` (#596, ADR 103).
  assert.deepEqual(app.match(/\/learning\/undo[^`]*`[^)]*\)/g), ['/learning/undo`, { method: \'POST\', body: { changeId: bot.undo } })']);
  assert.doesNotMatch(app, /learning: [^\n]*'off'/);
});

test('web: a bot\'s settings have no "Human-friendly replies" and no "While learning, it may propose changes…", and saving sends neither', () => {
  assert.doesNotMatch(settings, /Human-friendly replies|While learning, it may propose|name="friendly"|name="learnsSelf"/);
  assert.doesNotMatch(app, /form\.friendly|form\.learnsSelf|b\.friendly|b\.learning/);

  const ctx = vm.createContext({ readDisabledSkills: () => [], readLlmFields: () => ({}) });
  vm.runInContext(`${cut('function readBotForm(', '// Switched-off machine/built-in skills')}\nthis.readBotForm = readBotForm;`, ctx);
  const field = (value) => ({ value, checked: false });
  const form = {
    name: field('Mail Watcher'), color: field('#1d9e75'), description: field(''), group: field(''), prompt: field(''), systemPrompt: field(''),
    computer: field(''), computerAlwaysOn: field(''), othersMayAsk: field(''), tools: field(''), permissionMode: field('dontAsk'),
  };
  const sent = ctx.readBotForm(form, { skills: [], connectors: [], others: [], mayMessage: new Set() });
  assert.equal(sent.name, 'Mail Watcher');
  assert.equal('friendly' in sent, false);
  assert.equal('learning' in sent, false);
});
