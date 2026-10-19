# Feature test: Vault item types

Test document of the feature "Vault item types" ([its record](../../product/milestone4.md#added-features)), written by its last task, VAULT-006. The tasks: VAULT-005 (server and web page), VAULT-006 (Android, and the owner's decision at the first look).

## Review

The whole feature, the diff from main, was reviewed by the `kordal-reviewer` agent (Claude Opus 5.5), once per axis, on `793fadf`. The fixes are in `7f9c36d`, gated again and not reviewed again.

High, fixed:

1. **Saving a secret without a username could replace another secret of that host** (Standards; reproduced). A save from a login request finds the saved item by website and username. Other has no username, so it found any item of that host without one: a key saved for a host replaced that host's API token, its name and its type. Fixed: without a username, a save that names a type changes only an item of that type; the key becomes a second item. Tests pin it in both stores and through the server.

Medium, fixed:

2. **The Android card forgot the chosen type after a save that failed** (both axes, and the task review). The card is taken down while its save runs; a wrong Bitwarden master password brought it back with the request's type, and the next try saved a login. Fixed: the screen keeps the chosen type and the typed username; walked on the emulator.

Low, fixed with the above:

3. On Android an item of a type the app does not know was saved back as a login by any edit. It now keeps its type until the owner picks another.
4. On Android a refused save left the secret in the field. It is cleared, as `docs/api.md` asks.
5. The words of the three types were written twice and tested apart. They are one table now, `test/fixtures/vault-types.json`, and the web page and the Android app are both tested against it.
6. The bots' and the Chief's tool processes loaded the vault's key handling for the list of types. The list is a module of its own, `lib/vault-item-types.js`.
7. The Android card's save was built where no test reached it. It is `VaultTypes.requestSave`, with tests.

### What cannot be relied on

- **The type is a label.** Nothing stops a bot from typing an API token into a browser, or calling an API with a login.
- **A login changed to Other keeps its username**, unseen, and `{{username}}` still fills it in. Changing it back shows it again.
- **With Bitwarden the type lives in botdot**, in `data/bitwarden-access.json`. It does not show in Bitwarden, and an item deleted there and restored from its trash is a login again.
- **Two secrets of one type without a username on one host are one item.** Saving the second from a login request corrects the first.
- **An app from before this feature** shows every item as a login, with the old form. What it saves keeps the item's type.

### Follow-up

Low findings, for the owner to decide; none is fixed.

- A login request opens with the type the bot named, a login when it named none. Correcting the secret of a saved API token through such a request makes it a login, unless the owner sets Type in the dialog.
- A second ask of a bot for a website while its first is open returns the first request, with the first one's type. Older than this feature.
- A save from a login request renames the item it changes to the request's name. Older than this feature.
- On Android "＋ Add", "Add to the Vault" and "Save" also show with a server from before the types; the fields and the list are as before there.
- The server answers "Password is required" when the secret of an API token or of Other is missing. The forms ask for the secret themselves, so the sentence does not show.
- With Bitwarden, a change that sends an address without a name names the item after the address. Older than this feature.

## How to start it

It is running on this Mac, from branch `task/vault-006`:

- **The botdot server:** the test server of `.claude/launch.json` (`bot-dot-test`), data in the ignored `.test-data/`: http://localhost:4801. One bot, Coder, and four made-up items: "Recipes" (login), "Proxmox API token" (saved as a login, like yours), "Home Assistant" (API token) and "NAS key" (other). No Bitwarden. Claude is not signed in there, so no bot runs.
- **Android:** the emulator (Medium_Phone) with the debug app built from this branch, on that server. Its screen is set to 360 dp wide.

A login request lasts 15 minutes. To open one that asks for an API token:

```bash
curl -s -H 'X-Bot-Dot: 1' -H 'Content-Type: application/json' -X POST http://127.0.0.1:4801/api/vault/requests -d "{\"site\":\"git.example.org\",\"name\":\"Gitea API token\",\"reason\":\"To open the pull request.\",\"type\":\"api-token\",\"forBot\":\"$(curl -s http://127.0.0.1:4801/api/bots | node -pe 'JSON.parse(require("fs").readFileSync(0))[0].id')\"}"
```

And one for a second secret of a host that already has an API token:

```bash
curl -s -H 'X-Bot-Dot: 1' -H 'Content-Type: application/json' -X POST http://127.0.0.1:4801/api/vault/requests -d "{\"site\":\"ha.example.net\",\"name\":\"Home Assistant webhook\",\"reason\":\"To receive events.\",\"forBot\":\"$(curl -s http://127.0.0.1:4801/api/bots | node -pe 'JSON.parse(require("fs").readFileSync(0))[0].id')\"}"
```

To start it again: `bot-dot-test` from `.claude/launch.json`; then the emulator and its way to the server:

```bash
~/Library/Android/sdk/emulator/emulator -avd Medium_Phone
```

```bash
~/Library/Android/sdk/platform-tools/adb reverse tcp:4801 tcp:4801
```

The emulator's screen goes back to its own size with:

```bash
~/Library/Android/sdk/platform-tools/adb shell wm density reset
```

## What was walked before handing over

- **Gates** on `7f9c36d`: task-check passed in 1:50, pr-check in 0:11, premerge-check in 0:34.
- **The web page:** the list with each item's type before its address; "Add to the Vault" with Type and the fields of each type; "Recipes" changed to Other (no username field) and back (its username again); a save refused by the server, its sentence in the form, the form still open; the "needs a login" dialog opened with Type on API token. No console error but the refused save's own.
- **Android**, on the emulator at 360 dp, read from the screen's text: the same list; "Add to the Vault" with Type and the fields of each type, no label cut off; "Proxmox API token" changed to API token and saved, its address, token ID, certificate note and bot unchanged on the server; the request's card with Type on API token, changed to Other and back, a made-up token saved as an API token; a refused save with the server's sentence; and a save that failed (the server stopped), after which the card came back with the chosen type.
- **The server**, with `curl`: an unknown type refused with its sentence; a request saved without a type left a saved API token an API token; a key saved as Other for a host with an API token became a second item and left the token as it was.
- **Not walked:** Bitwarden (the test server has none; the tests run both stores, Bitwarden against a stand-in). A bot or the Chief asking by itself (Claude is not signed in there). The Android app on a server from before the types (unit tests). Step 12 of the checklist.

## Checklist

On the web page (http://localhost:4801, ⚙ Settings → Vault):

1. [ ] Each item shows its type before its address: "Login · food.example.org", "API token · ha.example.net", "Other · nas.example.net".
2. [ ] **＋ Add** opens "Add to the Vault". Changing **Type** changes the fields at once: Login has "Username or email" and "Password"; API token has "Token ID" (optional) and "Token"; Other has "Secret" alone.
3. [ ] Edit "Proxmox API token", set Type to API token, Save. It reads "API token · pve.example.ts.net", and its token ID, its certificate note and its bot are as they were.
4. [ ] Edit "Recipes", set Type to Other: the username field is gone. Set it back to Login: the username is there again. Cancel.
5. [ ] Open a request with the first command. The dialog opens with Type on API token and asks for a token ID and a token. Save a made-up token: "Gitea API token" is in the Vault as an API token.
6. [ ] Open a request with the second command, set Type to Other and save a made-up secret. The Vault has "Home Assistant webhook" as Other, and "Home Assistant" is still an API token.

In the Android app on the emulator (Settings → Vault):

7. [ ] The list reads as on the web page.
8. [ ] **＋ Add**: the same Type control, and the same fields for each type. Nothing is cut off.
9. [ ] Edit an item, change its Type, Save: the list shows the new type.
10. [ ] Open a request with the first command (decline or answer an open one first). In **Needs you** its card has Type on API token; changing it changes the fields. Save: the card is gone, and the item is in the Vault.

Failure cases to try:

11. [ ] In either editor, type `bad/host` under "Additional exact hosts" and save: the form shows "Give exact hostnames, without paths or wildcards", stays open, and its secret field is empty.
12. [ ] On your own botdot, once it runs this branch: set your "Proxmox API token" to API token; a bot's API call with it works as before.

## Changes from the owner's test

None yet.

## Acceptance

On 2026-10-04 the owner said the feature passes, tested on commit `7f9c36d` (the test server and the emulator above). Which checklist steps the owner ran was not recorded; step 12 needs this branch on the owner's own botdot.

Gates on `7f9c36d`: task-check passed in 1:50, pr-check in 0:11, premerge-check in 0:34.
