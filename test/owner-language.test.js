// Everything the owner reads is written in the account's language (ADR 108), also in a run no owner's message
// started: a job, a skill, a bot's memory review, the Chief's look, checkup and memory review, a project's standup.
// The owner's own language in a message, and a language the bot's instructions name, win over it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { languageNote } = require('../lib/prompt-text');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test("the note asks for all the owner reads in the account's language, and lets the owner's and the bot's own language win", () => {
  const pl = languageNote('pl');
  assert.match(pl, /^The owner's screen is in Polish\. Write everything the owner reads in Polish/);
  assert.match(pl, /the report of a scheduled run, a job, a skill or your memory review/);
  assert.match(pl, /your plan's steps and the choices you offer/);
  assert.match(pl, /the language the owner writes to you in, when it is another one, and a language your own instructions or rules name/);
  assert.equal(languageNote('en'), '', 'English is what every prompt already is');
  assert.equal(languageNote(undefined), '');
  assert.equal(languageNote('xx'), '');
});

test("a bot's own rules come after the note in its prompt, so a language they name is read last", () => {
  const src = read('lib/bots.js');
  const i = src.indexOf('REPLY_STYLE, languageNote(settings.get().language), styleNote, VAULT_PROMPT');
  assert.ok(i > 0 && src.indexOf('fillTemplate(bot.systemPrompt, vars)', i) > i);
});

test("the Chief's checkup and memory review are told the account's language (a look has its own rule, below)", () => {
  for (const [lib, extra] of [['checkup', {}], ['chief-review', {}]]) {
    const { systemPrompt } = require(`../lib/${lib}`);
    assert.ok(systemPrompt({ ...extra, lang: 'pl' }).includes(languageNote('pl')), `${lib} in Polish`);
    assert.doesNotMatch(systemPrompt({ ...extra, lang: 'en' }), /The owner's screen is in/, `${lib} in English`);
    assert.doesNotMatch(systemPrompt(extra), /The owner's screen is in/, `${lib} with no language`);
  }
  // The owner's rules still come last: they may name another language.
  const s = require('../lib/checkup').systemPrompt({ lang: 'pl', rules: 'Always English.' });
  assert.ok(s.indexOf(languageNote('pl')) < s.indexOf('Always English.'));
  const chief = read('lib/chief.js');
  assert.match(chief, /lookLib\.systemPrompt\(\{[^}]*lang: s\.language \}\)/);
  assert.match(chief, /checkupLib\.systemPrompt\(\{[^}]*lang: s\.language \}\)/);
  assert.match(read('lib/chief-review.js'), /systemPrompt\(\{ rules: s\.chiefRules, name: s\.chiefName, lang: s\.language \}\)/);
});

test("a project's recorded update is in the account's language", () => {
  const c = require('../lib/company').clean({ id: 'garden', name: 'Garden' });
  const text = require('../lib/project-updates').text(c, { work: [], blockers: [], replies: [] }, { language: 'pl' });
  assert.match(text, /Aktualizacja projektu: Garden/);
  assert.match(text, /Nie zapisano nowych ukończonych zadań/);
  assert.doesNotMatch(text, /No new decisions recorded/);
});

test("a new bot's first message is in the owner's language", () => {
  assert.match(require('../lib/hello').prompt({ bot: { prompt: 'Watch the news.' } }), /in the owner's language \(when you were not told it, the language of your main assignment\)/);
});

// #1588: the Chief's unasked messages switched between Polish and English, because a look was told to write "in the
// language the owner writes in" and guessed it from mixed chats, mail and project names. The server names one language.
test("every kind of look is told one language by the server, English too, and never to guess it from what it reads", () => {
  const look = require('../lib/look');
  for (const kind of look.KINDS) {
    for (const apps of [false, true]) {
      const pl = look.systemPrompt({ kind, apps, lang: 'pl' });
      assert.ok(pl.includes(look.languageRule('pl')), `${kind} in Polish`);
      assert.match(pl, /Language: write the whole message in Polish: its text, its headings, the answers of a \[\[choices/, kind);
      assert.doesNotMatch(pl, /in the language the owner writes in/, `${kind} is not left to guess`);
      assert.doesNotMatch(pl, /in the owner's language/, kind);
      for (const lang of ['en', undefined, 'xx']) {
        const en = look.systemPrompt({ kind, apps, lang });
        assert.match(en, /Language: write the whole message in English: /, `${kind} in ${lang}`);
        assert.doesNotMatch(en, /Polish/, `${kind} in ${lang} names no other language`);
      }
    }
  }
  assert.match(look.systemPrompt({ lang: 'pl' }), /not what you read: chats, mail, events, project and bot names and notes may be in another language/);
  // The owner's own rules still come last: a language they name is theirs to name.
  const s = look.systemPrompt({ lang: 'pl', rules: 'Always English.' });
  assert.ok(s.indexOf(look.languageRule('pl')) < s.indexOf('Always English.'));
  // Chief.js hands the account's language to every look it starts.
  assert.match(read('lib/chief.js'), /lookLib\.systemPrompt\(\{[^}]*kind, lang: s\.language \}\)/);
});
