# What's new

One note per release a person would notice, shown once after an update on the web page and in the Android app ([#219](https://github.com/Kordal/bot-dot/issues/219), `lib/whats-new.js`).

- The file's name is its id and sorts by date: `YYYY-MM-DD-short-name.md`, lowercase letters, digits and dashes. Notes are told apart by their names alone: a second note on the same day needs a name that sorts after the first.
- First line: the title (at most 80 characters). Then 2 to 4 points, each a line starting with `- ` (at most 200 characters).
- Plain words, the product's words (`CONTEXT.md`). No markup: the apps draw the text as text.
- Every note is written in English and in Polish, in the same pull request: its Polish twin is `pl/<same id>.md`, by the same rules, in natural Polish with the product's words; names (botdot, Claude, Gmail) stay as they are ([#646](https://github.com/Kordal/bot-dot/issues/646)). An account whose language is Polish is sent the twin, any other the English note.
- `make test` fails on a note that breaks these rules, and on a note without its Polish twin or a twin without its note (`test/whats-new.test.js`).
