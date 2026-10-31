# ADR-130: A project's tiles move without an Arrange mode

- **Status:** Accepted (2026-10-31)
- **Owning task:** [#821](https://github.com/Kordal/bot-dot/issues/821)
- **Supersedes:** "Arrange is a mode" and "the first Arrange measures where the tiles stand" in [ADR 124](124-a-projects-board-is-a-free-canvas-the-owner-arranges.md)

## Context

ADR 124 made a project's board a free canvas, arranged in a mode turned on by a button beside the gear: in it the tiles dragged and resized, out of it they worked. The owner asked to drag any tile at any time, with no button: plain drag and drop with a mouse, a long press then a drag with a finger. Clicks, scrolling on a phone, text fields and the controls inside a tile must keep working.

## Decision

- **No mode, no button.** A tile is always movable; the canvas rules of ADR 124 (no overlap, the one in the way slides down, the server settles every layout) are unchanged.
- **Web, a mouse:** a press on a tile becomes a drag once the pointer has moved 6 pixels; a press that does not move is a click, and the click that ends a drag clicks nothing. Within 10 pixels of a side or corner the drag resizes, and the cursor says so. A press in a field (input, select, text area) never drags. The focused tile moves with the arrows and resizes with Shift and the arrows.
- **Web, a finger:** a long press (450 ms) without moving picks the tile up; then the finger drags it and the page does not scroll. A finger that moves first scrolls, as before. Within 24 pixels of a side the drag resizes.
- **Web, a project never arranged:** keeps botdot's flow until the first drag, which stands every tile on the canvas where it stood, moves the one dragged, and saves the layout at the drop.
- **Android:** a long press on a tile, seen before the tile's own buttons, picks it up; then a drag moves it, from near an edge or corner resizes it. A tap or a swipe goes on to the buttons and the page. A project never arranged keeps its flow; a long press on it puts the tiles on the canvas and saves that, and a long press there moves a tile. Android cannot carry the flow's places over, because its flow does not draw one box per tile.

## Alternatives

- **Keep the mode and only drop the button** (a long press anywhere enters it): still a mode, and the owner asked for none.
- **Drag handles on every tile:** a control for each tile, against the minimal UI rule.
- **Long press on the web with a mouse too:** slower than the drag the owner asked for.

## Consequences

- With a mouse, text inside a tile (not in a field) can no longer be selected by dragging: the drag moves the tile.
- Each canvas tile is a keyboard stop, so the arrows reach it without a mode.
