# The interface's language

English, or Polish when the account chose it in Settings ([ADR 108](../../docs/adr/108-the-interface-speaks-english-or-polish-from-one-dictionary-the-server-hands-out.md)).

## Adding a string

- Write it in English, wrapped: `tr('Saved')`, `tr('Ran {name}', { name })`, `trn(n, '{n} bot', '{n} bots')` (web: `public/i18n.js`; Android: `dev.botdot.app.data.tr`; server: `require('./i18n').tr(language, …)`). The text must be a literal: no `${…}` (JavaScript) or `$x` (Kotlin) inside it, a `{placeholder}` instead.
- Add its Polish to the area's file: `pl/web.json`, `pl/android.json` or `pl/server.json`. A count is `{ "one": "{n} bot", "few": "{n} boty", "many": "{n} botów" }` under its English plural.
- `node lib/i18n/keys.js web` prints what has no Polish yet; `test/i18n.test.js` fails on it.
- Never pass what a bot or the Chief of Staff wrote through `tr()`.

## Polish words

The same words as the What's new notes in `whats-new/pl/`. Informal "ty", lowercase ("twoje", "ciebie"). Names stay as they are: botdot, Claude, Gmail, Composio, boat.dev, Haiku.

| English | Polish |
| --- | --- |
| bot | bot |
| Chief of Staff / the Chief | Szef sztabu / Szef |
| main assignment | główne zadanie |
| task (a run's request) | zlecenie |
| job / scheduled job | zadanie / zaplanowane zadanie |
| script job | zadanie-skrypt |
| run | przebieg |
| Needs you | Czeka na ciebie |
| card | karta |
| Board / tile | Tablica / kafelek |
| keypad / key | klawiatura / klawisz |
| page / Pages | strona / Strony |
| interactive page | strona interaktywna |
| Vault | Sejf |
| Settings / Updates / Activity / Usage | Ustawienia / Aktualizacje / Aktywność / Użycie |
| What's new | Co nowego |
| Connectors / connected apps | Konektory / połączone aplikacje |
| Files / Workspace / Keep in mind | Pliki / Obszar roboczy / Pamiętaj |
| group / shared room / Rooms | grupa / wspólny pokój / Pokoje |
| skill / helpers | umiejętność / pomocnicy |
| note / pinned | notatka / przypięte |
| teammate | kolega z zespołu |
| External Virtual PC | Zewnętrzny wirtualny PC |
| Always allow / Allow once / Decline | Zezwalaj zawsze / Zezwól raz / Odrzuć |
| Always approved / Revoke | Zawsze zatwierdzone / Cofnij |
| Update now / Update automatically | Aktualizuj teraz / Aktualizuj automatycznie |
| Keep up to date | Aktualizuj na bieżąco |
| Open as document / Export | Otwórz jako dokument / Eksportuj |
| Reconnect / Disconnect | Połącz ponownie / Rozłącz |
| Working / Done / Idle / Asks | Pracuje / Gotowe / Bezczynny / Pyta |
| Saved | Zapisano |
| the web page | przeglądarka ("w przeglądarce"), so that "strona" stays a Page |
