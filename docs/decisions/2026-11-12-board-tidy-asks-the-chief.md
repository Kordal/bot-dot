# Tidy up asks the Chief, not a fixed algorithm

The board's Tidy up button sends the owner's "Tidy up the board." to the project's Chief chat, and the Chief lays out every tile at once with `arrange_project_board` (`layout`). The owner asked for the AI to do it: a fixed packing (snap to a grid, close the gaps) cannot tell a card with a long list from a single number, nor which tiles belong together, and the Chief reads both in `get_company`.

- The board as it stood is kept first (`layoutBack`), so "Put it back" (`back: true`) always works, whatever the Chief did. A never-arranged board is sent as the app measured it, so the Chief reads every tile shown.
- The turn is the owner's own, in the project's chat, which opens beside the board: the owner sees it work and can say "make the calendar bigger" in the same place.
- Rejected: a server-side packing with no Claude (instant, but blind to what tiles hold), and a hidden Chief run (nowhere to correct it).
