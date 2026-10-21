# What's new

One note per release a person would notice, shown once after an update on the web page and in the Android app ([#219](https://github.com/Kordal/bot-dot/issues/219), `lib/whats-new.js`).

- The file's name is its id and sorts by date: `YYYY-MM-DD-short-name.md`, lowercase letters, digits and dashes.
- First line: the title (at most 80 characters). Then 2 to 4 points, each a line starting with `- ` (at most 200 characters).
- Plain words, the product's words (`CONTEXT.md`). No markup: the apps draw the text as text.
- `make test` fails on a note that breaks these rules (`test/whats-new.test.js`).
