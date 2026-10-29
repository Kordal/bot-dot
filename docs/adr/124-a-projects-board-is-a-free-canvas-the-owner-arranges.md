# ADR-124: A project's board is a free canvas the owner arranges

- **Status:** Accepted (2026-10-29)
- **Owning task:** [#783](https://github.com/Kordal/bot-dot/issues/783), spec [#782](https://github.com/Kordal/bot-dot/issues/782)
- **Builds on:** [ADR 003](003-one-figure-definition-for-all-apps.md) (what looks the same everywhere is data from the server), [#780](https://github.com/Kordal/bot-dot/issues/780) (a new project starts with an empty board)

## Context

The owner wants to move and resize every tile on a project's home: the 90-day line, each objective, each team room, the Chief, the bots in no team, New team, the Calendar, the To-do and the cards made by Claude. Three ways were mocked: a 12-column grid, widths in steps, and a free canvas. The owner picked the free canvas, with two rules: tiles never overlap, and any size is allowed.

## Decision

- **A layout per project:** `{ tile: [x, y, w, h] }` on a canvas 1200 units wide, y growing down. Each app scales it to its width, so one arrangement serves every screen; a phone pinch-zooms.
- **No overlap, by one set of rules** in `public/board-canvas.js`, loaded by the page and required by the server: the tile moved or resized stays, and whatever it would cover slides down below it with a 16-unit gap, cascading. Nothing is pulled up. Each kind has a smallest size so its content fits.
- **The server settles every layout it keeps.** The page sends the whole layout after each drop; the Chief places one tile (`arrange_project_board`), and the server settles the rest the same way. A tile of an objective or team that is gone is dropped.
- **A project never arranged keeps botdot's flow.** The first Arrange measures where the tiles stand and saves that, so nothing jumps. A tile with no place yet (a new team, a new card) takes the first free spot in its kind's first size.
- **Arrange is a mode:** in it a tile's body drags and its edges and corners resize; out of it the tiles work as before.

## Alternatives

- **A 12-column grid with steps** (the recommended mockup): tidier and readable on a phone, but not what the owner wants.
- **Overlapping tiles with a z-order:** a free canvas in the strict sense; the owner ruled it out.
- **Sizes and places kept per screen width:** an arrangement made on a laptop would not be the one on a phone; the owner asked for one board.

## Consequences

- On a phone the canvas is drawn small and is read by zooming.
- Android draws the same layout with a Kotlin port of the rules (#784), checked against the same cases.
