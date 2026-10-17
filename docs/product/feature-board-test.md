# Feature "Board": the owner's test

The feature: the owner can find their page of tiles under one name, the Board, and open it while it is empty, on the web page and in the Android app. Tasks BOARD-001 and BOARD-002, from the improvement report [The Dashboard becomes the Board, and shows while empty](improvements/2026-10-04-board-name-and-empty-entry.md).

## Review

The whole feature, the diff from `main` at `9b28776`, by the `kordal-reviewer` agent (Claude Opus 5.5), once per axis. No high or medium finding. Fixes in `ac189ee`, gated again; the fixes were not reviewed again.

Standards:

- **Low, fixed.** `docs/product/milestone4.md` still said "dashboard tile scripts" in four places of the current scope. They say "Board tile scripts" now. `docs/product/milestone1.md`, `docs/architecture-improvement-plan.md` and `docs/security-issue-90.md` keep the word: records of earlier work.
- **Low, kept; the owner knows.** The strip counts approved top-level tiles, the page counts every tile. With only a tile whose script waits, the strip says "Nothing on it yet" and the page shows that tile. Planned so: Needs you shows the card.
- **Low, rejected.** `BoardWords` holds the strip's and the page's words only; the cards' and the dialog's strings stay inline where they are drawn, as the app's other strings do.

Spec:

- **Low, recorded.** The completed plan of BOARD-001 names the strip's class `empty`; BOARD-002 renamed it `none`. The completed plan stays as written; BOARD-002's notes say so.
- **Low, recorded.** The web fix (the class rename) is outside BOARD-002's Scope, which is Android. It is the defect found at the first look, fixed on this branch as A standalone feature allows.
- **Low, fixed.** The notification's test sat in `ui/BoardWordsTest.kt`; it is in `feed/NotifierTextTest.kt`, where the plan names it.

## How to start it

It is running on this Mac, from branch `task/board-002`:

- **The botdot server:** the test server of `.claude/launch.json` (`bot-dot-test`), data in the ignored `.test-data/`: http://localhost:4801. One bot, Coder, and zero tiles. Claude is not signed in there: **Sign in to Claude** on its Setup page first, or the Chief and Coder cannot answer.
- **Android:** the emulator (Medium_Phone) at phone size, with the debug app built from this branch, on that server.

To start it again: `bot-dot-test` from `.claude/launch.json`; then the emulator and its way to the server:

```bash
~/Library/Android/sdk/emulator/emulator -avd Medium_Phone
```

```bash
~/Library/Android/sdk/platform-tools/adb reverse tcp:4801 tcp:4801
```

A tile without the Chief (replace nothing; it returns the tile's id):

```bash
curl -s -H 'X-Bot-Dot: 1' -H 'Content-Type: application/json' -X POST http://127.0.0.1:4801/api/dashboard/tiles -d '{"kind":"note","title":"Shopping","value":"Milk"}'
```

## What was walked before handing over

- **Gates** on `ac189ee`: task-check passed in 2:05, pr-check in 0:07, premerge-check in 0:49.
- **The web page**, in the Browser pane: the strip "Board · Nothing on it yet ›" at zero tiles, 36px high; whole on one line in the 200px list (144px of text in 161px); a tap opens the page headed "Board" with its two lines.
- **Android**, on the emulator at phone size, read from the screen's text: the same strip; a tap opens the screen titled "Board" with the two lines; a note tile added through the API shows as "Shopping ›" in the list and on the Board; removed, the list says "Board · Nothing on it yet" again.
- **Not walked:**
  - `test/browser/board.cjs` did not run: the only Playwright on this Mac has no browser installed. The web page was checked by hand instead.
  - The Chief and a bot asked for a tile: Claude is not signed in on the test server. Steps 3 to 6 below are the first run of those.
  - A tile whose script waits for an OK, on a device: only the Chief can create one. The unit tests of both apps cover it.
  - Search hiding the strip, on Android: the code returns before the strip while searching; not tapped.
  - The Android app from before this feature on the new server: the API is unchanged; not installed.

## Checklist

On the web page (http://localhost:4801) and in the Android app, from zero tiles:

1. [ ] The list shows "Board · Nothing on it yet ›" above the Chief of Staff. Typing in Search hides it.
2. [ ] A tap opens a page headed "Board" with two lines and the example “Put a shopping list on my board.”
3. [ ] Tell the Chief "Put a shopping list on my board". It builds the tile and says "Board" in its answer; the strip shows the tile.
4. [ ] Tell the Chief "What's on my dashboard?". It understands and answers about the Board.
5. [ ] Ask Coder to put something on your board. A card "Put “…” on your Board?" shows in Needs you and in Coder's chat. **Add** shows "On your Board" and the tile in the strip.
6. [ ] Remove the tiles (right-click on the web page, hold on Android). The question names "your Board", and after the last one the strip says "Nothing on it yet" again.

Failure cases to try:

7. [ ] Make the web window 480 to 760px wide: the strip's text stays whole on one line.
8. [ ] Ask the Chief for a tile that runs a script ("show the server's free disk space with a script"). While its card waits in Needs you, the strip still says "Nothing on it yet"; the notification on Android reads "Waiting for your OK: “…” on your Board (a script)".

## Changes from the owner's test

None yet.

## Acceptance

On 2026-10-04 the owner said the feature passes, tested on commit `2847f5f` (the test server and the emulator above). Which checklist steps the owner ran was not recorded.
