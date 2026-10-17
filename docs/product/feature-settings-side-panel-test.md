# Feature test: the settings panel beside the chat

Test document of the feature "settings side panel" ([its record](milestone4.md#added-features)), written by its last task, PANEL-002. The tasks: PANEL-001 (the web page), PANEL-002 (Android's wide screens and this acceptance).

## Review

The whole feature, the diff from main, was reviewed by the `kordal-reviewer` agent (Claude Opus 5.5), once per axis, on `305bff8`; PANEL-002's own diff by the `kordal-task-reviewer` agent on the same commit. Fixes in `6b9c4e5`; they were not reviewed again, both gates cover them.

1. **High, fixed: on Android a chat under the panel still counted as on screen** (Standards, both reviewers). On a phone with a bot's settings open, a reply that arrived was read at once: no dots, no "New" line, no notification. Now the chat under the panel says nothing, as when the settings were a screen of their own.
2. **Medium, fixed: a covering panel stayed up when its own chat was chosen** (Spec and Standards), on Android: the bot's row in the list, a tapped notification, a share. It makes way now, as on the web page.
3. **Medium, fixed: a "what it learned" label closed the open panel** on Android, where it should show the settings.
4. **Medium, fixed: on the web page, back from jobs opened from the chat went to the settings** the owner never opened (PANEL-001's deviation). Back returns to the settings only when the jobs were opened from them, on the web page as in the app.
5. **Medium, accepted by the owner as a known limit: text typed in the panel is lost when the device is turned, folded or unfolded** on Android. The panel itself comes back. Showing or hiding the list keeps the text. The same happened on the settings screen before this feature.
6. **Low, fixed:** the list's width was written in two places; tapping the jobs button twice forgot they came from the settings.
7. **Low, kept:** while the panel covers the chat on Android the list's button is under it, so the list is hidden before the panel is opened, or after it is closed. On a 720 to 760dp window with a cutout the chat beside the panel can be a little under 360dp. Deleting a bot on a phone returns to the list, as before. `MainActivity.kt` keeps its flat indentation.

### What cannot be relied on

- **The browser check runs by hand.** No gate runs `test/browser/settings-panel.cjs`; it passed on `6b9c4e5`.
- **The Android panel's layout is checked by hand** on the emulator; the unit tests hold its decisions, not its picture.
- **No reply was seen arriving beside the open panel on Android:** the test server has no Claude sign-in. The web browser check sees it with the stand-in Claude.

## How to start it

It is running on this Mac, from branch `task/panel-002`:

- **The botdot server:** the test server of `.claude/launch.json` (`bot-dot-test`), data in the ignored `.test-data/`: http://localhost:4801. Two bots: Dutch Tutor (one job, "Morning phrases") and Home Assistant. Claude is not signed in there, so a bot does not answer.
- **Android:** the emulator (Medium_Phone) with the debug app built from this branch, connected to that server. It is a phone; a tablet's width is set by hand, below.

To start it again: `bot-dot-test` from `.claude/launch.json`; `~/Library/Android/sdk/emulator/emulator -avd Medium_Phone`, then `adb reverse tcp:4801 tcp:4801` and the address `http://localhost:4801` in the app.

The emulator's size, with `adb` from `~/Library/Android/sdk/platform-tools`:

| Screen | Commands |
| --- | --- |
| Tablet, 1280dp wide: room also with the list shown | `adb shell wm size 2560x1600` and `adb shell wm density 320` |
| Small tablet, 840dp wide: room only with the list hidden | `adb shell wm size 1680x2000` and `adb shell wm density 320` |
| Phone | `adb shell wm size reset` and `adb shell wm density reset` |

## The owner's checklist

The web page, in your own browser, in a wide window (1300px or more):

- [ ] Open Dutch Tutor, click its figure and name: the settings open right of the chat. The chat keeps its thread and its composer.
- [ ] Click the figure and name again: the panel closes. Open it, use its close button: it closes.
- [ ] In the panel, "Scheduled jobs": the jobs open in the panel. Back: the settings again.
- [ ] With the panel open, choose Home Assistant, then the Chief of Staff: the panel stays, on that chat's settings.
- [ ] The Chief's gear opens and closes the Chief's settings beside its chat.
- [ ] Reload with the panel open: the same chat with the panel open.
- [ ] Narrow the window (under about 1080px): the panel covers the chat, with a back button. Widen it: side by side again.
- [ ] Narrow, panel open: choose another bot in the list. Its chat shows, not its settings (your change of the first look).

Android, on the emulator:

- [ ] Tablet size: tap a bot, then its figure and name: the settings stand right of the chat, with a close button. Another bot in the list: the panel stays, on its settings. Back closes it.
- [ ] Small tablet size, the list shown: the settings cover the chat, with a back arrow, the list still beside them. Tap a bot in the list: its chat.
- [ ] Small tablet size: hide the list with the chat's first button, tap the figure and name: beside the chat. Show the list: the panel covers the chat.
- [ ] Phone size: settings, jobs and the Chief's settings open full screen with the back arrow, as before.

Failure cases to try:

- [ ] Delete a bot from the panel (make one first by asking the Chief, or use Home Assistant): the panel closes, the Chief's chat shows.
- [ ] Web, panel covering the chat: a reply that arrives stays new (dots in the list) until you go back to the chat. Needs a Claude sign-in on the test server.
- [ ] Android: type a new name in the panel and turn the device: the text is lost (finding 5). Say whether that is acceptable.

## What was walked before handing over

- **Gates:** see [Acceptance](#acceptance).
- **The web page:** `test/browser/settings-panel.cjs` on `6b9c4e5`, in Chrome for Testing, passed: at 1440px the settings, the jobs and the Chief's settings beside the chat, a message answered beside the open panel, a saved name shown in the chat's header, another chat keeping the panel, a reload keeping it; at 900px and 390px the panel over the chat with its back button, another bot chosen there showing its chat; widened and narrowed without a reload; a deleted bot. By hand at 1440px on the test server: the panel right of Dutch Tutor's chat.
- **Android**, on the emulator with the app built from `6b9c4e5`. At 1280dp, on the build of `305bff8`: the panel right of Dutch Tutor's chat with Save and a close button, the list still shown; Home Assistant chosen, the panel on its settings; Back closed it. At 840dp with the list shown: the settings over the chat with the back arrow, the list beside them; the same bot's row, then another bot's, each showed the chat. At 840dp with the list hidden: the panel beside the chat with the close button and the composer; the list shown again moved it over the chat. At phone size: the settings full screen with the back arrow, Back to the chat.
- **Not walked:** the jobs and the Chief's settings in the Android panel (the unit tests hold their decisions); a reply arriving with the panel open on Android; a real tablet or a foldable.

## Acceptance

On `6b9c4e5`, on 2026-10-04:

- `task-check` passed in 2:31 (lint, the structure check, 680 server and web tests).
- `pr-check` passed in 0:11 (`tools-real`).
- `premerge-check` passed in 0:54 (`android-build`, `android-test` with 166 tests, `android-lint`).

The owner tested the feature on 2026-10-04, on `9c6e2cb` (its runtime files are those of `6b9c4e5`), and said it passes. Finding 5 of the review, text typed in the Android panel lost on a turn or a fold, the owner accepted as a known limit.
