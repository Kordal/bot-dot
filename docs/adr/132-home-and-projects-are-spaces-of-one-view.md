# ADR-132: Home and projects are spaces of one view

- **Status:** Accepted (2026-11-02)
- **Owning task:** [#837](https://github.com/Kordal/bot-dot/issues/837), spec [#836](https://github.com/Kordal/bot-dot/issues/836)

## Context

Bots and Projects are two places behind the switch "Bots | Projects" ([ADR 110](110-a-company-is-a-place-of-its-own-with-teams-that-each-have-one-lead.md)). Each has its own layout: the Bots home is the keypad with one chat on the right ([ADR 029](029-a-wide-window-opens-on-the-keypad-with-one-chat-on-the-right.md)), a project is a tree, a board and its own chat column. A team bot shows up in both, and the switch is the only thing that joins them. The owner approved option C of the mockups: one view made of spaces, moved between by a rail.

## Decision

- **Home and every project are spaces of one view.** This replaces ADR 110's "a place, not a mode of the list". Home is what Bots showed; a project is what Projects showed for it.
- **A wide window (from 1001 px on the web) with at least one project has a rail of spaces on the left, 76 px wide,** in place of the switch: Home (the logo), one square per project in its colour with its first letter and the number of its team bots' asks, archived projects dimmed after them, "+" for a new project, and the top bar's search, admin, feedback and Settings buttons at its foot. The space on screen has a short bar at the rail's left edge.
- **With no project there is no rail,** and Home is the Bots home as it was, switch included: that is how the first project is started.
- **The chat column stands at the same place in every space:** the owner's width or the default, at most the window less 560 px. Home opens on the Chief's chat, a project on its team chat (the Chief's while it has none, ADR 119). Until each space draws its own keys (#838), a project keeps its tree beside the rail and its board keeps 360 px, so below about 1180 px its column can be a little narrower than Home's.
- **The space is remembered per device** in `botdot.place`: `home` or a project's id. The old values `bots` and `company` are still read. A remembered project that is gone opens Home, and so does deleting the project on screen.
- **Search finds bots and chats on Home:** pressed in a project, it goes to Home first.
- **Narrower windows and phones keep the switch** until their own ticket ([#839](https://github.com/Kordal/bot-dot/issues/839)). What each space draws is [#838](https://github.com/Kordal/bot-dot/issues/838).
- **No server change.** Which project a bot is in comes from the projects' teams the apps already load; each ask names its bot.

## Alternatives

- **A: Home's keypad with a section per project.** Smallest change, but a long scroll with several projects, and a project's board would open somewhere else.
- **B: One tree in a 300 px column for everything.** Loses the keypad's keys for a list, and takes four times the rail's width from the board.
- **A rail also with no project.** Rejected: one square for Home alone is a control that does nothing, and the owner asked for today's home when there is nothing to switch between.

## Consequences

- The top bar of a wide window with projects is gone: its notices ("Can't reach botdot", "Claude is signed out") stand over the keypad on Home and above the message box in a project.
- The logo is a button there (Home), and its dot still pulses while the Chief or a bot works.
- Android draws the same spaces on its own ([#840](https://github.com/Kordal/bot-dot/issues/840)).
