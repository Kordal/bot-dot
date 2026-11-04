# ADR-147: On a phone the board is one column

- **Status:** Accepted (2026-11-04, the owner: "Dashboard on mobile is not really readable")
- **Amends:** [ADR 124](124-a-projects-board-is-a-free-canvas-the-owner-arranges.md), where a phone drew the canvas small and was read by zooming; [ADR 130](130-a-projects-tiles-move-without-an-arrange-mode.md), where a long press moved a tile on any screen

## Context

A project's board is a canvas 1200 units wide (ADR 124), scaled to the screen's width. On a phone about 400 wide that is a third: a card's text is drawn at 4 to 5 points, a tile placed far down on a laptop leaves a screen of empty canvas above it, and moving a tile that small is hard to aim. The owner found it unreadable.

## Decision

- Narrower than `BoardCanvas.NARROW` (600 pixels on the web page, 600 dp on Android) an arranged board is drawn as one column: every tile full width, at its own height, in the canvas's reading order (`BoardCanvas.order`: from the top, left to right where two start level). A card shows the lines of the flow, not as many as its tile's height holds.
- On that width tiles are not moved or resized, and a long press on a board never arranged does not start the canvas: the board is arranged on a wider screen, and the phone follows its order.
- The layout, the API and the server's rules are unchanged. Wider than `NARROW` nothing changes.

## Alternatives

- **The canvas scaled down, read by zooming** (ADR 124): what the owner found unreadable.
- **A layout kept per screen width:** an arrangement made on the phone would not be the one on the laptop; ADR 124 rejected it for the same reason.
- **Reordering in the column by a long press, written back to the canvas:** a move in one column has no single place on a canvas of several; left for when it is asked for.

## Consequences

- The phone shows the owner's arrangement as an order, not as places and sizes.
- A tablet or a wide window still draws the canvas, and moves tiles there.
- The web page and Android share the width and the order, checked against the same case (test/board-canvas.test.js, BoardCanvasTest).
