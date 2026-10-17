# The Dashboard becomes the Board, and shows while empty

4 Oct 2026. An improvement report from `/kordal-improve`; no code was changed.

## Question

The owner, by voice: bots can put things on a page for him, but while it is empty he cannot see it anywhere. He wants to see it, tap it, and read a short message on what to do to get something onto it. He also wants it renamed: not "Dashboard". Asked which word he meant, he chose **Board**, open to a better proposal.

## Criteria

The owner confirmed four:

- **Visible when empty.** With zero tiles the owner still sees an entry for it in the list on web and Android, and one tap opens it.
- **Empty page teaches.** The empty page says in a few short lines what it is for and gives one example sentence to say to a bot.
- **Name explains itself.** One name, used the same on web, Android, the Chief's skill and the docs, from which a new owner can guess what is inside.
- **Stays minimal.** The empty entry adds no button or control beyond the one row that opens it (AGENTS.md rule 5).

## Observed

A fresh test server, web page, zero bots:

| Step | Seen |
| --- | --- |
| Zero tiles | The list shows only "Chief of Staff". The word "dashboard" is nowhere on screen; nothing opens the page |
| `/#dashboard` typed in the address | Lands on Setup (the server was not signed in to Claude); changing the address later does nothing |
| One note tile "Shopping" added through the API | A strip appears above the Chief: "● Shopping ›". It carries no name; "Dashboard" is its hover title only. A tap opens a page headed "Dashboard" |
| That tile removed while on the page | The strip goes; the page shows three paragraphs: what tiles are, "Ask the Chief or any bot to add one, for example: “Add a switch for the living room light.”…", and that bots suggest tiles |

Android was not run; it was read from code.

## Findings

Investigated by the `kordal-investigator` agent; every cited line was opened and confirmed.

1. **The entry is hidden at zero tiles, on web and Android alike**, and also while the only tile waits for an OK: `public/app.js:4491-4492`, `android/app/src/main/java/dev/botdot/app/ui/HomeScreen.kt:383-384`.
2. **Hiding was decided in a commit only.** 7b26b52 (28 Sep 2026): "The Dashboard row looked like one more bot. Now it's one line under Search… Hidden while searching or when empty." No ADR or milestone document says so.
3. **The README promises otherwise**: "While it's empty, the page says what it's for" (`README.md:63`).
4. **Bots say a suggestion "waits on their dashboard"** (`lib/bots.js:1583`, `lib/self-mcp.js:362`), a page that cannot be opened at zero tiles.
5. **The empty text is the same on both apps and unreachable**: `public/app.js:4654-4658`, `ui/DashboardScreen.kt:270` and `:313-326`. Three paragraphs; it never names the page; its example needs a smart-home light.
6. **The list never shows the name**: a hover title on web (`public/app.js:4499`), nothing on Android (`HomeScreen.kt:385`).
7. **"Dashboard" has three meanings for the Chief**: botdot itself (`lib/chief.js:19`, `CONTEXT.md:3`), the web page (`lib/mcp-server.js:197`, `README.md:209`) and the tile page (`lib/chief.js:78-79`).
8. **`CONTEXT.md` defines neither the page nor "tile".**
9. **Stale**: the Chief is told to move "the Dashboard row" with `place` (`chief-skills/skills/dashboard/SKILL.md:139`; also `README.md:63`, `data/Api.kt:152`); `arrange` takes no `place` (`lib/dashboard.js:312`).

### Where the word is read

| | Where |
| --- | --- |
| The owner reads it | `public/app.js:4499`, `:4653`, `:4348`, `:4354`, `:4457`, `:4931`. Android: `ui/DashboardScreen.kt:192`, `:201`; `ui/NeedsYouScreen.kt:353`, `:355`, `:574`; `data/Store.kt:224` (pinned by `WaitingTest.kt:30`); `feed/Notifier.kt:258` |
| The Chief and the bots read it | `lib/chief.js:78-79`; `chief-skills/skills/dashboard/SKILL.md`; `lib/mcp-server.js` (the tile tools' descriptions); `lib/self-mcp.js:362` and its tile tools; `lib/bots.js:1582-1583`; messages in `lib/dashboard.js` and `server.js:1152`, `:1290` |
| Docs | `README.md:61-70`; `docs/api.md:43`, `:154-171`; `android/README.md` |
| Identifiers | `/api/dashboard…` (`server.js:1270-1304`, `data/Api.kt`); the feed event `dashboard` (`lib/dashboard.js:156`, `Store.kt:159`, `public/app.js:5403`); `data/dashboard.json` (`lib/dashboard.js:129`); the view and its address `#dashboard`; file and class names; the skill `chief:dashboard` and the tools `get_dashboard`, `arrange_dashboard` (`lib/mcp-server.js:475`; pinned by `test/chief-instructions.test.js:65`) |

`features` has no entry for the page (`server.js:1550`) and the Android app calls the path without asking (`Store.kt:99`): a renamed path or feed event breaks an installed app against a newer server, and the reverse (AGENTS.md, architecture principle). The data file needs a migration. The skill and the tools ship with the server, so they can change without the apps.

### The name

"Board" works in a spoken sentence ("put it on my board") and collides with nothing: the word does not stand alone anywhere in `public/`, `lib/`, the Android app or the docs. Alone it leans on Trello's meaning (lists of tasks), so the empty row and page must say what it is. No alternative is clearly better: "Home" collides with the bot group and Home Assistant (`lib/chief.js:24`), "Panel" with a tile's pop-up and the settings panel, "Tiles" fails "put X on my ___". The things on it stay **tiles**; "card" belongs to Needs you (`CONTEXT.md:30`).

## Proposals and verdicts

| # | Proposal | Size | Verdict |
| --- | --- | --- | --- |
| 1 | Rename the Dashboard to Board in everything the owner, the Chief and the bots read; keep its strip in the list on web and Android at zero tiles, reading "Board · Nothing on it yet"; cut the empty page to two lines with one example; add Board and Tile to `CONTEXT.md`. | Feature, 3 tasks: the server's words and the docs, the web page, Android | **Now** |
| 2 | Rename the Chief's skill and tools: `chief:board`, `get_board`, `arrange_board`. | Small, server only | **Now, inside 1** |
| 3 | Remove the stale "Dashboard row / `place`" instructions. | Small | **Now, inside 1** |
| 4 | Show the word "Board" at the start of the strip when it has tiles too. | Small | **Later**: first see how the empty row and the page heading carry the name; the label costs room for tiles in the 200px list and partly undoes the nameless strip of 28 Sep |
| 5 | Rename the API paths, the feed event, the data file and the address from "dashboard" to "board". | Milestone: old and new paths side by side, a `features` entry, a data migration, an ADR | **Now.** The recommendation was No (nothing the owner sees changes; it risks installed apps against a newer server); the owner chose Now |

Recommended and chosen: proposal 1 with 2 and 3 in its server task. It meets all four criteria with no new control.

For the plan of proposal 1:

- The row at zero tiles: `Board`, a muted `Nothing on it yet`, `›`. It stays the strip (`.dash-strip`), not a contact row: `test/browser/figure.cjs:78` and `:233` count contact rows, and a contact-like row is what 28 Sep removed.
- The empty page, two lines: "Tiles for the things you use most: a light switch, the temperature, a shopping list, a morning summary." and "Nothing is on it yet. Tell the Chief or any bot, for example: “Put a shopping list on my board.”"
- The Chief's prompt says the Board was called the dashboard, so an owner who says "dashboard" is still understood.
- The Chief's prompt and the docs stop calling botdot itself, or the web page, a dashboard (finding 7).
- The strip stays hidden while searching.
- An Android app that is not updated keeps saying "Dashboard" until it is.

For the plan of proposal 5:

- An app older than its server and a server older than its app both keep working: the old paths and the old feed event stay answered until no supported app uses them, and the new ones are announced in `features`.
- `data/dashboard.json` is moved once, with the old file read when the new one is missing; backups made before the move still restore.
- After proposal 1 lands, so the wording is settled and this is a rename of identifiers only.

## Already fine

- The web page and Android behave the same today: one strip rule, one empty text, the same card titles.
- "Tiles": used the same in the UI and the tools (`add_tile`, `set_tile`).
- The empty page has one example and no add button.
- The strip hides while searching (`public/app.js:574`, `HomeScreen.kt:265-275`).
- The start on Setup and the address not followed after loading are general behaviour, not part of this.
- `macos/` stays as it is (ADR 008).
