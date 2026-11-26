# The interface's language

English, or another language the account chose in Settings ([ADR 108](../../docs/adr/108-the-interface-speaks-english-or-polish-from-one-dictionary-the-server-hands-out.md), [ADR 280](../../docs/adr/280-a-language-is-a-folder-of-lib-i18n-and-the-registry-lists-every-one.md)).

- **The registry**, [languages.json](languages.json), lists every language botdot may speak, all of them up front: its code, its own name, its English name (what a bot or the Chief is told to write in), the locale of a bot's browser, of dates, and the phones' date patterns.
- **A language is offered** (in the Settings picker, accepted as the account's language, served by `GET /api/i18n/<code>`) when its folder `lib/i18n/<code>/` exists. English always is: its words are the keys, and it has no folder.
- **A folder holds:** `web.json`, `android.json`, `server.json` (the dictionary, one file per area), `phrases.json` (the words botdot reads in what people write, below), `cron-words.js` (a job's schedule in words, optional), `GLOSSARY.md` (the language's words for botdot's things). Nothing else: `test/i18n.test.js` says so.

## Adding a string

- Write it in English, wrapped: `tr('Saved')`, `tr('Ran {name}', { name })`, `trn(n, '{n} bot', '{n} bots')` (web: `public/i18n.js`; Android and iOS: `dev.botdot.app.data.tr`; server: `require('./i18n').tr(language, …)`). The text must be a literal: no `${…}` (JavaScript) or `$x` (Kotlin) inside it, a `{placeholder}` instead.
- Add its text in every offered language, to the area's file of each folder: `<code>/web.json`, `<code>/android.json` or `<code>/server.json`, translated for where it stands and with that language's `GLOSSARY.md`. A count is an object keyed by the language's plural categories under its English plural: `{ "one": "{n} bot", "few": "{n} boty", "many": "{n} botów" }` in Polish, `{ "one": "{n} Bot", "other": "{n} Bots" }` in German, `{ "other": "{n}個のボット" }` in Japanese.
- `node lib/i18n/keys.js missing <code> <area> --where` prints what has no text yet in a language, with where the code draws it; `test/i18n.test.js` fails on it.
- A sentence made elsewhere and passed on as it is (an error's message, a constant, a table's value) goes through `said(language, text)` on the server. Its English is a literal of the code that makes it, not of the call, so give it its text in `pl/server.json` first: every key of Polish's `server.json` that the server writes as a literal is a string of the server area, which every other language must have too ([keys.js](keys.js) `passedOn`). The server's calls count in every form: `tr(`, `i18n.tr(`, `i18n.trn(`, `i18n.said(`, and a bare `said(` where the file took it from `./i18n`.
- Never pass what a bot or the Chief of Staff wrote through `tr()`.

## Adding a language

Everything a language needs is in its own files: no shared code and no shared list changes, so several languages can be added at once without touching each other. Use the code the registry gives it (`de`, `pt-BR`, `zh-Hans`…).

1. **Read** [GLOSSARY.md](GLOSSARY.md) (botdot's words and what each one is), [CONTEXT.md](../../CONTEXT.md), and [Polish's glossary](pl/GLOSSARY.md) as an example of the result.
2. **Write the glossary,** `lib/i18n/<code>/GLOSSARY.md`: every term of [GLOSSARY.md](GLOSSARY.md) with the one word your language uses for it, how the owner is addressed (formal or informal "you"), the form of a button (imperative, infinitive, noun), and the names that stay as they are. Every string after this uses these words.
3. **Translate the dictionary**, one area at a time and in chunks: `node lib/i18n/keys.js missing <code> web --where --limit 150 --offset 0`, then `--offset 150`, and so on, until it prints none; then `android`, then `server`. Each string comes with every place the code draws it, `file:line` and the lines around it: read them, and translate what the string means there, not word for word.
   - Put each text into `lib/i18n/<code>/<area>.json` (the line after the string names the file). Without `--where` the command prints a JSON table of the chunk to fill in, plurals with your language's categories.
   - A button or a menu item is short and says what it does. A heading is a noun. A sentence to the owner reads as a person would say it.
   - Keep every `{placeholder}`, as it is, wherever your grammar puts it. Keep `**bold**`, `\n` and the names (botdot, Claude, Gmail…).
   - A plural has exactly the categories the header of `--where` lists (and may add `other` for fractions where it is not one of them).
   - A string used in two areas is in both lists: give it the same text in both files (the test fails on two texts).
4. **Write `lib/i18n/<code>/phrases.json`**: the words botdot reads in what the owner or a bot wrote, in your language. Each kind is a list, and every kind is optional; [phrases.js](phrases.js) says what reads each, and [pl/phrases.json](pl/phrases.json) is an example.

   | kind | What it is |
   | --- | --- |
   | `stopWords` | filler words a note search leaves out ("the", "and", "of") |
   | `corrections` | how a message starts that tells a bot it got it wrong ("no", "wrong", "try again") |
   | `never` | a word that makes a line of a main assignment one about what the bot never does ("never", "not") |
   | `schedule` | words that say when a bot wakes ("daily", "every morning", "every # minutes") |
   | `yes`, `no` | the first word of an answer button that says yes or no |
   | `nothingNew` | a whole report that says there is nothing to report ("nothing new", "no changes") |
   | `because` | the word between a decision and its reason ("Launch in Poland first because…") |
   | `noSource` | a figure's source that says there is none ("none", "unknown", "no source") |
   | `nameEndings` | an ending your grammar puts on a name ("Alfred" → "Alfredowi"), so a bot's declined name is still a link |
   | `password` | a word for "password" |

   `phrases.json` may also declare **`elision`** for a language that writes "d'Anna" for "de Anna" (French): `{ "words": { "de": "d'", "que": "qu'", "le": "l'", "la": "l'" }, "silentH": ["hélène", "henri"] }`. After a placeholder is filled, the word right before it becomes its elided form when the value's first word is plain letters starting with a vowel or one of the mute-h words (and keeps its form otherwise: "de Bob", "de Hugo"); a text that is not in the dictionary, a value like `app.js` or an address, and a string with no placeholder are never touched. [elision.js](elision.js) is the rule; the server hands the data out with the dictionary (`elision` of `GET /api/i18n/<code>`), and the web page and Android apply it in their own `tr()` (the web page's values may be HTML, as a bot's name is with its mark in front, so it looks at the text the value shows: tags are skipped). So write "de {name}", never "d'{name}".

   A phrase is matched as whole words, case aside; a `*` at its end stands for the rest of a word (`popraw*`), a `#` for a number (`co # minut*`). Keep each one specific: a short word that is common in your language with another sense (Polish "nie" is fine for `corrections`, which looks only at a message's start) makes false matches, and the lists of every offered language are read together.
5. **Say a job's schedule in words** (optional; English without it): `lib/i18n/<code>/cron-words.js` exports an object of the shape of `EN` in [lib/cron-words.js](../cron-words.js) ([Polish's](pl/cron-words.js) shows a language whose days and months change after a preposition). It may set how its words are joined, `listSep`, `lastSep(word)` and `partSep` (English's ", " and " and " where it sets none; [ja](ja/cron-words.js) and [zh-Hans](zh-Hans/cron-words.js) use "、"). Check a few with `node -e "console.log(require('./lib/cron-words').describe('*/15 8-18 * * 1-5', '<code>'))"` against the rows of `test/fixtures/cron-words.json`.
6. **What's new:** this pull request's own note in English, in Polish (`whats-new/pl/`) and in your language (`whats-new/<code>/<same id>.md`, [whats-new/README.md](../../whats-new/README.md)). A note without a twin in your language comes in English; translate the newest ones as well if you like.
7. **The Play listing:** `docs/google-play/listing-<code>.md` (the same three blocks and headings as [listing-en.md](../../docs/google-play/listing-en.md), each heading with its count) and `docs/google-play/captions/<code>.json` (the feature graphic's line and one caption per screenshot, as [en.json](../../docs/google-play/captions/en.json)). The Play screenshots workflow then draws your language's pictures; you need not commit them.
8. **Check what can't be data** (ADR 280 lists them): a page's file name from a title without Latin letters is "page"; a note search finds words between spaces, so in Chinese and Japanese it leans on the meaning search; `because` needs a space on each side; English's "n't" is code. Say in the pull request if your language needs more than these, as a follow-up issue.
9. **Test:** `make test` and `make lint` (`test/i18n.test.js` checks that every string has its text, the placeholders and the plural categories, that no string of your folder is one the code doesn't use, and that your phrases read). Start botdot (`npm start`), pick your language in Settings, and look at Home, a chat, Needs you, the Board and Settings on the web page, on a narrow window too: a word too long for its button is a word to shorten.
10. **Before merging,** rebase on `main` and run `node lib/i18n/keys.js missing <code>` again: a string added meanwhile needs your language too.
