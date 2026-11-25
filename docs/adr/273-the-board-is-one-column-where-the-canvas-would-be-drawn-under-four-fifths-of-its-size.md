# ADR-273: The board is one column where the canvas would be drawn under four fifths of its size

- **Status:** Accepted (2026-11-25, the owner: the overview tiles were unreadable at laptop width with the chat open)
- **Amends:** [ADR 147](147-on-a-phone-the-board-is-one-column.md), where the column began under a fixed 600 pixels (600 dp on Android)

## Context

A project's board is a canvas 1200 units wide (ADR 124), scaled to the width it is drawn in. ADR 147 turned it into one column under 600, but between 600 and 1200 everything is shrunk: with the Manager chat open the board area is about 850 pixels wide, a scale of 0.7, and text is drawn at about 10 pixels. The overview tiles (Current work, Blockers, Latest replies) are also fixed in height (ADR 245), so their rows scrolled inside the tile and, with a hidden scrollbar, the last row showed sliced in half.

## Decision

- The rule is a scale, not a width: `BoardCanvas.MIN_SCALE` is 0.8, and `BoardCanvas.column(width)` is true where the canvas would be drawn under it, that is under 960 pixels (960 dp on Android). There the board is drawn as ADR 147 says: one column, every tile full width at its own height, in the canvas's reading order, tiles not moved. At 960 and wider the canvas is drawn, at 0.8 of its size at the smallest. `BoardCanvas.NARROW` is gone: the web page and Android share `MIN_SCALE` and `column`, checked against the same cases (test/board-canvas.test.js, BoardCanvasTest).
- On an arranged board an overview tile shows the whole rows that fit its height, one at least, and a muted "+N more" for the rest, as a card does (`ProjectCards.fit`). It no longer scrolls. Made taller, it shows more. In the column every row is shown.
- The layout, the API and the server's rules are unchanged.

## Alternatives

- **A two-column middle layout** (the canvas's left and right halves, one under the other, between one column and the canvas): keeps the arrangement closer than one column, but is a layout of its own to design and test on both apps; left for when it is asked for.
- **A lower minimum scale (0.7):** at about 850 pixels the text would still be about 10 pixels.
- **Tiles that scroll inside, with a visible scrollbar:** a scrolled tile on a board is easy to miss, and the rows would still be cut by the tile's edge.

## Consequences

- A window with the chat open, a tablet in portrait and a phone in landscape show the owner's arrangement as an order, as a phone does. Tiles are moved and resized only where the canvas is drawn at 0.8 or more.
- A board a little under 960 wide no longer shows the owner's places and sizes; widening the window or closing the chat does.
- An overview tile may show fewer rows than the snapshot holds; its height is the owner's to change.
