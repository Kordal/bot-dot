# ADR-107: The interface speaks English or Polish, from one dictionary the server hands out

- **Status:** Accepted
- **Owning task:** #645 (spec #644)

## Context

Every word of the web page and the Android app was English, written straight into the code: some 15,000 lines of JavaScript and 240 Kotlin files, with no string table on either side, and the server writes sentences the apps show as they are (cards, errors, notifications). The owner wants an account to switch the whole interface to Polish in Settings, What's new included, with English as the default.

## Decision

- **One setting per account, on the server:** `language` in the account's settings, `"en"` or `"pl"`. Both apps read it, so the web page and the phone agree, and the server can write its own sentences in it. A change is announced on the feed.
- **A string is keyed by its English text.** The code keeps its English and wraps it: `tr('Saved')`, `trn(n, '{n} bot', '{n} bots')` on the web and in Android, `tr(language, …)` on the server. A string without a translation stays English, so a screen not translated yet still works and older dictionaries never break a newer app. The names are `tr`/`trn`, not `t`, which some hundred local variables of the web page already use.
- **One Polish dictionary, data the server hands out** (the architecture principle, ADR 003): `lib/i18n/pl/*.json`, one file per area (`web.json`, `android.json`, `server.json`) so that work on one area does not touch another, merged and served at `GET /api/i18n/pl`. A value has the English text's `{placeholders}`; a count's value is `{ one, few, many }`, picked by the Polish plural rules.
- **The apps keep the dictionary.** The web page reads it from its storage before its first script runs, so strings made when a file loads are Polish too; it fetches it again at each start and loads once more when the language or the dictionary changed. Android keeps it in its preferences and recomposes when it changes.
- **A test holds it together:** `test/i18n.test.js` collects every literal passed to `tr()`/`trn()` in `public/`, `android/app/src/main/` and `lib/` (`lib/i18n/keys.js`), and fails on a string without Polish, a translation that drops or adds a placeholder, a call whose string is not a literal, and a Polish string of the apps that no code uses.
- **What is never translated:** what a bot or the Chief of Staff writes, names, and what the Chief and the bots read (their tools' answers, their instructions). The admin page and the front door's sign-in stay English: they belong to the machine, not to an account.

## Alternatives

- **Android string resources (`values-pl/strings.xml`) and a separate web table.** Idiomatic on Android and checked by its lint, but two dictionaries for one product drift apart, each Kotlin string needs an invented id, and the server's sentences would need a third. Rejected for one dictionary.
- **The device's language instead of a setting.** No setting to add, but the web page and the phone could disagree, and the server could not know which language to write a notification in. Rejected; the setting is what the owner asked for.
- **Translating the page's text nodes as they are drawn (a DOM walk).** No change to the code, but it would also translate a bot's reply that happens to read "Done", and it cannot see strings with values in them. Rejected.

## Consequences

- Every new user-visible string is written as `tr('…')` with its Polish in the same change; the test fails otherwise. `node lib/i18n/keys.js <area>` lists what is missing.
- The rest of the interface moves over in its own tickets (#647 web, #648 Android, #649 server); until then those screens stay English.
- More languages need only a folder of dictionaries and the language in `LANGUAGES`.
