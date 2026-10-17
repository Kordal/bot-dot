# Feature test: any saved login in the login request

Test document of the feature "any saved login" ([its record](milestone4.md#added-features)), written by its last task, VAULT-003. The tasks: VAULT-001 (server and web page), VAULT-004 (the search, from the first look), VAULT-002 (Android), VAULT-003 (the Mac).

## Review

The whole feature, the diff from main, was reviewed by the `kordal-reviewer` agent (Opus 5.5), once per axis, on `1cf12cd`. No high finding. The medium findings, all fixed on VAULT-003's branch and gated again:

1. **A host a login gained could go unlogged** (Standards, run by the reviewer). The audit line's host shape was narrower than what a login accepts: for a host like `a~b.example.org` the login got the host and the bot, the answer was 400 and no line was written. Fixed: the audit line takes every host a login can hold; a test pins it.
2. **The Mac's confirmation could be answered unread or twice** (both axes). A double click on a row could land on the confirming button, and a second click during the answer gave an error after a success. Fixed: the button takes a click 600 ms after the question appears, as on Android, and is off while the answer is on its way.
3. **The Mac showed the server's refusal behind the sheet** (both axes). Fixed: the sentence is shown in the confirmation, as on the web page.
4. **Return in the Mac's search could save a new login** (low on both axes, fixed with the above). The new-login fields and their button are not in the sheet while the list is open (see below).

The walk found one more, fixed:

5. **On the Mac the open list left no room for the new-login fields**, which were squeezed to a line. The open list now takes their place; closing it (the same line) brings them back.

### What cannot be relied on

- **The confirmation is the only guard.** A web page can trick a bot into asking for a login for the page's own host. The question names the login, its website and the requested host; nothing else stops a wrong pick.
- **A subdomain of an added host, for a moment.** botdot asks the browser where it is and then has it type. A page that moves to a subdomain of the added host between the two is accepted by the browser. Closing that needs a change of the desktop image.
- **An app from before this feature** shows no other logins. Nothing else changes for it.

### Follow-up

Low findings, for the owner to decide; none is fixed.

- The wording of the confirmation, the search rule and the threshold of 6 are written three times (web page, Android, Mac), where the tool card's text comes from the server.
- Android: with other logins and none for this site the card shows the vault note where web and Mac say "or save a new one:"; a row is tapped as a whole and has no "Use it" button.
- The Mac: after Back, and after closing and opening the list again, the search field is not focused; the typed text stays.
- Bitwarden logins that ask for the master password again are left out of the other logins, but still offered among the logins of this site.
- An IPv6 additional host cannot be saved again from the Vault form.
- Escape in a filled search field of the web dialog closes the dialog.
- In the local desktop image of this Mac (`bot-dot/desktop:latest`, built 2026-09-29) `camoufox-browser` and `botdot-type-secret` have no execute bit, so a bot's browser could not be started the product's way. Older than this feature; the image wants a rebuild.

## How to start it

It is running on this Mac, from branch `task/vault-003`:

- **The botdot server:** the test server of `.claude/launch.json` (`bot-dot-test`), data in the ignored `.test-data/`: http://localhost:4801. One bot, Shopper, and 15 made-up logins, one of them "Full (20 hosts)" with 20 additional hosts. Claude is not signed in there, so no bot runs.
- **Android:** the emulator (Medium_Phone) with the debug app built from this branch, on that server.
- **Mac:** a Debug build with its own bundle identifier (`dev.botdot.mac.vaulttest`), on that server. The installed botdot app is untouched.

A login request lasts 15 minutes. To open one, for any host:

```bash
curl -s -H 'X-Bot-Dot: 1' -H 'Content-Type: application/json' -X POST http://127.0.0.1:4801/api/vault/requests -d "{\"site\":\"shop.example.com\",\"reason\":\"To order the groceries.\",\"forBot\":\"$(curl -s http://127.0.0.1:4801/api/bots | node -pe 'JSON.parse(require("fs").readFileSync(0))[0].id')\"}"
```

To start it again: `bot-dot-test` from `.claude/launch.json`; `~/Library/Android/sdk/emulator/emulator -avd Medium_Phone`, then `adb reverse tcp:4801 tcp:4801`; `open -n macos/build/vaulttest/Build/Products/Debug/botdot.app --args -botdot.server http://localhost:4801`.

## What was walked before handing over

- **Gates:** see [Acceptance](#acceptance).
- **The web page:** the line, the list of 14 other logins with its search, "full" leaving one row, the confirmation of "Full (20 hosts)" refused with the server's sentence in the confirmation and the request still open, Back, then "prox" and the Proxmox login confirmed: the host and the bot were on the login, the request closed, and the audit log had the line.
- **Android**, on the emulator, read from the screen's text (Needs you cannot be captured): the line, the list with its search, "No saved login matches.", the confirmation with both websites and the warning, the refusal leaving the card and the request, Back, and the GitHub login confirmed: "All done.", the host and the bot on the login.
- **The Mac**, in the Debug build: the line, the list in the place of the new-login fields, the search focused when the list opens, "No saved login matches.", the confirmation with its button off for a moment, the refusal in red in the confirmation, Back, and a login confirmed: the sheet closed, the host and the bot on the login, the audit line.
- **A real bot's browser** (the desktop image, Camoufox), for a login saved for `example.org` with the additional host `example.com`: on `example.com` and on `example.org` the site check passed (the browser then asked for the password box, which those pages do not have); on `www.example.com` and on `example.net` it refused with "The browser is on …, not example.org". The helper was called through its interpreter, because of the image's missing execute bit (Follow-up).
- **Not walked:** a bot asking by itself, signing in and calling an API with the picked login. The test server has no Claude sign-in. The server's tests cover the lookup, the API call's host check and the site handed to the browser; steps 7 and 8 of the checklist are that walk.

## Checklist

On the web page (http://localhost:4801), then the same on Android and the Mac. Open a request first, with the command above.

1. [ ] The dialog "Shopper needs a login" has the line "Use another saved login". It opens "Saved for another website" with a search field and a list that scrolls by itself.
2. [ ] Typing part of a name, username or website leaves the matching rows; two words both have to match; nonsense shows "No saved login matches."
3. [ ] "Use it" on a row asks once more: the login, the website it is saved for, the requested host, and the warning. Back returns without answering.
4. [ ] The confirming button closes the request. In the Vault, the login has the requested host among its additional hosts and Shopper among its bots.
5. [ ] With "Full (20 hosts)": the confirmation shows that it already has 20 additional hosts, and the request stays open.
6. [ ] A request whose host has a saved login of its own (`shop.example.com`: "Shop (old account)") still shows it under "Already in your Vault", above the line.
7. [ ] On your own botdot, with a real bot: a bot asks for a login for a host, you pick a login saved for another website, and the bot signs in there in its browser.
8. [ ] The same bot calls that host's API with the login (`api_request`). On a subdomain of that host both are refused.

Failure cases to try: a double click on a row (the confirmation must not be answered by it); Return in the search (nothing is saved or answered); a request left for 15 minutes (the dialog closes).

## Changes from the owner's test

None yet.

## Acceptance

On 2026-10-04 the owner said the feature passes, tested on commit `b7a3eb8` (the test server, the emulator and the Mac's Debug build above). Which checklist steps the owner ran was not recorded; steps 7 and 8 need a real bot on the owner's own botdot.

Gates on `b7a3eb8`: task-check passed in 1:53, pr-check in 0:27, premerge-check in 1:29.
