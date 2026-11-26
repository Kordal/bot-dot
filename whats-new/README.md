# What's new

One note per release a person would notice, shown once after an update on the web page and in the Android app ([#219](https://github.com/ladrok/bot-dot/issues/219), `lib/whats-new.js`).

- The file's name is its id and sorts by date: `YYYY-MM-DD-short-name.md`, lowercase letters, digits and dashes. Notes are told apart by their names alone: a second note on the same day needs a name that sorts after the first.
- First line: the title (at most 80 characters). Then 2 to 4 points, each a line starting with `- ` (at most 200 characters).
- Plain words, the product's words (`CONTEXT.md`). No markup: the apps draw the text as text.
- Every note is written in English and in every language the interface offers, in the same pull request ([#646](https://github.com/ladrok/bot-dot/issues/646), [ADR 280](../docs/adr/280-a-language-is-a-folder-of-lib-i18n-and-the-registry-lists-every-one.md)): its twin is `<code>/<same id>.md` (`pl/`, and the folder of each language of `lib/i18n/` with a folder there), by the same rules, translated naturally with the product's words and that language's `lib/i18n/<code>/GLOSSARY.md`; names (botdot, Claude, Gmail) stay as they are. An account in a language is sent its twin, and the English note where the twin is missing.
- `make test` fails on a note that breaks these rules, on a note without its Polish twin, and on a twin of any language without its English note (`test/whats-new.test.js`).
