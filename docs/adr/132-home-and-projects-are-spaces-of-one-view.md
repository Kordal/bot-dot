# ADR-132: Home and projects are spaces of one view

- **Status:** Accepted (2026-11-02)
- **Owning task:** [#837](https://github.com/Kordal/bot-dot/issues/837), [#838](https://github.com/Kordal/bot-dot/issues/838), [#839](https://github.com/Kordal/bot-dot/issues/839), spec [#836](https://github.com/Kordal/bot-dot/issues/836)

## Context

Bots and Projects are two places behind the switch "Bots | Projects" ([ADR 110](110-a-company-is-a-place-of-its-own-with-teams-that-each-have-one-lead.md)). Each has its own layout: the Bots home is the keypad with one chat on the right ([ADR 029](029-a-wide-window-opens-on-the-keypad-with-one-chat-on-the-right.md)), a project is a tree, a board and its own chat column. A team bot shows up in both, and the switch is the only thing that joins them. The owner approved option C of the mockups: one view made of spaces, moved between by a rail.

## Decision

- **Home and every project are spaces of one view.** This replaces ADR 110's "a place, not a mode of the list". Home is what Bots showed; a project is what Projects showed for it.
- **A wide window (from 1001 px on the web) on a botdot with projects has a rail of spaces on the left, 76 px wide,** in place of the switch: Home (the logo), one square per project in its colour with its first letter and the number of its team bots' asks, archived projects dimmed after them, "+" for a new project, and the top bar's search, admin, feedback and Settings buttons at its foot. The space on screen has a short bar at the rail's left edge.
- **There is no switch, with or without projects** ([#853](https://github.com/Kordal/bot-dot/issues/853), 2026-11-02). With no project yet the rail holds Home and "+", and below 1001 px the title's sheet holds Home, New bot and New project: that is how the first project is started. "+" is generic: it asks New bot or New project. New bot opens Home with a new chat with the Chief, its box started ("A new bot that "), since the Chief makes bots. Until #853 the switch and the old project tree stayed for this case, and the owner saw the old view again.
- **The chat column stands at the same place in every space:** the owner's width or the default, at most the window less 560 px. Home opens on the Chief's chat, a project on its team chat (the Chief's while it has none, ADR 119). Between #837 and #838 a project kept its tree beside the rail.
- **The space is remembered per device** in `botdot.place`: `home` or a project's id. The old values `bots` and `company` are still read. A remembered project that is gone opens Home, and so does deleting the project on screen.
- **Search finds bots and chats on Home:** pressed in a project, it goes to Home first.
- **Below 1001 px there is no switch and no rail either** ([#839](https://github.com/Kordal/bot-dot/issues/839), 2026-11-02). The space's title switches spaces: on Home the logo with a chevron in the top bar, in a project its square, name and chevron, with the project's gear beside it and Search and Settings at the top right. It opens the spaces: Home, each project with its asks, and New project, as a sheet from the bottom on a phone and a menu under the title on a wider screen. Search and Settings pressed in a project go to Home first, where their pages stand.
- **The bottom field is the space's default chat:** the Chief's on Home, as before; in a project its team chat ("Message the team…", with the team's faces), or the Chief's while it has none. A tap opens that chat.
- **One chat at a time below 1001 px:** a chat opened in a project, from the field, a key, a team's name or Esc, is full screen, and its Back is the project again. The row of docked chats at the bottom of the narrow Projects screen, the phone's chat sheet and the chats expanded beside it (#691, #714) are gone.
- **Each bot is in one space** ([#838](https://github.com/Kordal/bot-dot/issues/838), 2026-11-02). Home's keys and list leave out every bot in a project's team and every team's chat (`Keypad.home`); a bot that leaves its team is Home's again, in its own category. A search still finds every bot. Since 2026-11-02 Home has a filter over its keys, All (the start) or No project, remembered per device (`botdot.homeBots` on the web, `home_all` on Android): on All, Home shows every bot and chat again, team ones included, and a project's page still shows its own; on No project, Home is as described here. The owner missed the team bots on Home.
- **A project's page is its header, its own Needs you (only its bots' asks, `Keypad.asksOf`), its board, then one row per team:** the team's name with its stacked faces opens the team chat, ⋯ opens the team beside the board (its lead, its report), then its bots' keys, the lead first with a crown. The key or name whose chat is in the column is highlighted. These rows replace the floor's rooms, desks and Chief desk and the wide page's tree; the Chief is reached from Home or with Esc, and 1-9 open the page's keys in reading order. On Home an ask from a project's bot carries that project's small square.
- **The teams are no board piece on the web:** they are always drawn as rows, so a project's settings and the new-card picks no longer offer Teams.
- **No server change.** Which project a bot is in comes from the projects' teams the apps already load; each ask names its bot.

## Alternatives

- **A: Home's keypad with a section per project.** Smallest change, but a long scroll with several projects, and a project's board would open somewhere else.
- **B: One tree in a 300 px column for everything.** Loses the keypad's keys for a list, and takes four times the rail's width from the board.
- **No rail with no project, the switch kept to start the first one.** Built first, then dropped in #853: it brought back the old view (the switch, the project tree beside the New project screen) and squeezed Home's keypad into the switch's 300 px column. The rail with Home and "+" keeps Home where it stands once a project exists.

## Consequences

- The top bar of a wide window with projects is gone: its notices ("Can't reach botdot", "Claude is signed out") stand over the keypad on Home and above the message box in a project.
- The logo is a button there (Home), and its dot still pulses while the Chief or a bot works.
- Android draws the same spaces on its own ([#840](https://github.com/Kordal/bot-dot/issues/840)).
- With no tree beside the rail, a project's chat column is as wide as Home's at every width again.
- Below 1001 px a project's page has no left column: Home's list stands only on Home. The project tree is drawn nowhere once a project exists.
