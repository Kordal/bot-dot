# Milestone 4 test: the Chief of Staff installs tools on the botdot server

Test document of [Milestone 4](milestone4.md), written by the acceptance task TOOL-006.

## Review

The milestone review ran on the whole diff from main, by the `kordal-reviewer` agent (Opus 5.5), once per axis each time.

| Pass | Reviewed | Result |
| --- | --- | --- |
| 1 | `main...e0e675c`, TOOL-001 to TOOL-005 and TOOL-007 | No high. Four medium, twelve low. The walk of the Flows found two more medium |
| 2 | `24e3daf..033f637`, the fix tasks TOOL-008 and TOOL-009 only | No high or medium in the diff. Ten low, and one medium that is older than this milestone (see Follow-up). Two medium doubts of the Spec pass (the Mac-hosted install was proven with one tool by hand only; botdot's own line might not come with the real Claude) were settled by the walk below: `jq` and `httpie` installed through the product on the Mac-hosted test server, and the line appeared there with the real Claude not signed in |

High and medium findings, all fixed:

1. **A tool whose reinstall failed at start could not be asked for again** (both axes; A8). The notice said "Ask me to install it again" and the ask answered "already installed". Fixed in TOOL-008: such a tool is marked missing, the bot's instructions leave it out, and a new ask leads to a card. Before saying "already installed" botdot now runs the tool with `--version` as that bot.
2. **On a Mac-hosted botdot nothing could be installed** (found by walking A1 on a test server from `compose.mac.yaml`). micromamba's copy onto the Mac's disk is refused. Fixed in TOOL-008: after that refusal the install is tried again with hard links from a cache on the data folder, which is removed when the install ends. ADR 007 records it. Checked afterwards on that test server with `jq` and with `httpie` (a tool that needs python): both install and run.
3. **The installer's user counted as the owner** on a Linux server (Standards). No way to run code as that user was found. Fixed in TOOL-008: a connection from the tools user gets what a stranger gets.
4. **The owner did not learn how an install ended when the Chief's turn failed** (found by walking: Claude not signed in). Fixed in TOOL-008: botdot writes the result itself in one line in the chat that asked.
5. **A tool from a link could be approved from its notification**, without the warning, whose link it is, the address or the checksum (Spec). Decided by the owner on 2026-10-03 and fixed in TOOL-009: such a notification says "from a link", has Decline only, and opens the card. A registry tool keeps Install.
6. **A failed install could have the Chief start the bot again** (Spec, a suspicion). Fixed in TOOL-008: after a failure the Chief is told to start no bot.
7. **SECURITY.md said the Mac-hosted case was not measured.** Measured on 2026-10-03 and written there by TOOL-008: see "What cannot be relied on" below.

### What cannot be relied on

- **On a Mac-hosted botdot a tool is "only that bot's" by `PATH` alone.** The Mac's disk, as Docker shows it to the container, enforces no owner and no mode: on the test server another bot's user could list and write a bot's tools folder. Another bot does not find the command, but could run it by its full path and change it. Bots' workspaces already behave that way there. On a Linux botdot server (a Docker volume) the test showed "Permission denied" for both.
- **An app from before this milestone** shows a tool ask as a skill card titled `Install the skill ""?`, with no warning and no address for a tool from a link, and its Install installs. Its notification for a tool from a link still has Install.
- **A tool from a link is checked for sameness only.** botdot installs the file the owner approved and refuses a changed one; it does not know what the program does.

### Follow-up

Low findings, for the owner to decide; none is fixed.

Security and files:

- In the image micromamba belongs to the tools user, which could replace it; root as owner with the tools user's group would not allow that.
- `data/tools` is open to listing (0755; homes and workspaces are 0711), so any bot can see which bots have tools. The data folder belongs to the server's user, which could rename `tools` away.
- The tools user fetches any https address the Chief names, addresses in the server's own network included. The installer's network is not limited to the registry, and package signatures are not checked.
- `BOT_DOT_TOOL_REGISTRY_URL` is read in production too; it feeds the card's summary. Only the owner sets the environment.
- The File row of a link's card shows decoded spaces, so a crafted file name can read like a second row.
- The size limit of a link is 200 MiB while the card counts decimal MB: a 209 MB file passes "200 MB".
- A no is kept per bot and command name: the same file under another command name gets a card.
- Declining the card of a tool that went missing leaves it on the bot's list, so the next start installs it again without a new OK.

Behaviour:

- A program from a link that needs another C library installs and then does not start; it is marked missing only when somebody asks for it again.
- A first install that fails leaves the bot's empty tools folder behind.
- A bot that lost a tool within an hour of asking for it is told "asked already" and gets no card.
- An install's result that waits behind another Chief reply is lost on a restart, its turn and botdot's own line.
- The check before "already installed" runs outside the install queue: an install for the same bot at that moment could mark a working tool missing.
- A new ask reaches an open chat one refresh late (older than this milestone).
- On the Mac, a link tool announced while the live feed is down has Decline only but does not say "from a link" until the feed's line arrives. Android's summary line still reads "Coder asks to install stripe" for a link.
- Android builds its summary line "Coder asks to install gh" itself; a `text` on each ask of `GET /api/asks` would let both apps stop composing or waiting.
- One ask with a field of an unexpected kind makes the Android and Mac apps lose every ask (older than this milestone).
- `yesOn` is honoured by the apps on an ask of any kind, though the server sends it for a link tool only.

Documentation and tests:

- `docs/api.md` lacks `installing`, `missing` and `problem` on `GET /api/tools`, `note` on `/api/tools/find` and `tool.replaces`; `hello.asks` is a plain list, not "as in the `asks` event"; `tool` is a string in the `asks` event and an object in `GET /api/asks`.
- Three texts say a missing tool "could not be installed again when botdot started", which is wrong for a tool marked missing because it did not start.
- ADR 007 was amended in place by TOOL-002, TOOL-007 and TOOL-008 instead of superseded.
- The audit line of an install has no `way`, though TOOL-008's notes say it has.
- The browser test `test/browser/tool-card.cjs` runs in no gate: the repository does not carry Playwright. It passed by hand.
- No test uses an app built before this milestone (A14 rests on running the old code against a tool ask), and none covers a tool marked missing while botdot runs followed by a start that cannot reinstall it.
- What the Chief says and does (asking which tool is meant, naming the risk of a link, starting the bot again) is tested as instruction text against a stand-in Claude; the owner's checklist is its proof.
- The registry stand-in is written three times (`test/tools.test.js`, `ToolTests.swift`, `test/tool-notification.test.js`); what a tool from a link is, is decided in three places (`server.js`, `lib/asks.js`, `lib/tools.js`).
- The Mac's ratings test of Milestone 3 failed once under load and passed on the rerun.
- The root-only tests (the broker's folder owner and mode, the tools user's 403, the link download as the tools user) are skipped on this Mac; the hosted workflow runs them on the pull request. `tools-real` covers the same ground in a container here.

From the second pass:

- **Older than this milestone, and worth its own task:** with `HOST=::` a connection from a link-local IPv6 address of this machine is taken for the owner without a look at its user (`isThisMachine` in `lib/identity.js`), for bots and the tools user alike. The defaults (`127.0.0.1`, `0.0.0.0`) are IPv4 and not affected. It belongs with issue 9.
- Only the queue in `lib/tools.js` keeps installs one at a time; the worker removes the cache on the data folder without checking for another install.
- A link install does not remove a cache left by a stopped registry install; the next registry install, a removal or a start does.
- The pending Chief reply carries a field `otherwise` that clients receive and `docs/api.md` does not name.
- A bot's request for a tool it already has starts a process of up to ten seconds each time, with no limit.

## How to start it

It is running on this Mac, from branch `task/tool-006` at the commit of this document:

- **The botdot server:** a test server in Docker, from an image built from this branch (`botdot-m4-test:d`), with a Docker volume as its data folder, as on a Linux server: http://localhost:4801. Two bots: Coder (may run commands) and Cook. It has no owner key, so the web page and the apps open it directly; the real product on a Mac sets one.
- **Claude:** the container has its own Claude sign-in and it is empty. Open Setup on the web page and sign in once; until then the Chief answers "Not logged in" and botdot writes the results of installs itself.
- **Android:** the emulator (Medium_Phone) with the debug app built from this branch, on that server.
- **Mac:** the Debug build with its own bundle identifier (`dev.botdot.mac.m4test`), on that server. The installed botdot app is untouched.
- **A second test server, as the Mac app hosts botdot** (`compose.mac.yaml`, the data folder on the Mac's disk): http://localhost:4804, with an owner key; ask me for a link to open it. `jq` and `httpie` are installed there for its Coder.

To start it again: `docker compose -p botdot-m4test up -d` in the scratch folder of this session (`m4test`), `adb reverse tcp:4801 tcp:4801`, and `open -n <worktree>/macos/build/m4test/Build/Products/Debug/botdot.app --args -botdot.server http://localhost:4801`.

## What was walked before handing over

On 2026-10-03, on the test servers, with the real micromamba and the real conda-forge. The Chief's own tools were called directly (its ask, list and remove routes), because the container's Claude is not signed in; what the Chief says is the owner's part of the checklist.

- **A1, A13:** asking for `gh` gave one card with version 2.102.0 and 13 MB; after Install the folder belonged to the tools user with the Coder's group, mode 0750, and the audit log had the line. A script job of the Coder found no key, token or login in its environment.
- **A2, A3, A9:** the Coder's script job ran `gh` and could not write its tools folder or the tool's file; Cook's script job got "command not found", "Permission denied" for the full path and for listing the folder, and could not run micromamba.
- **A4:** a name that is not in the registry gave the reason and no card. **A5:** after Decline the same ask was refused "for a week". The same ask twice gave one card.
- **A7:** after a restart both tools ran. A second image on the same data folder, with `gh`'s folder removed, reinstalled `gh` by itself (audit actor `botdot`) and both ran.
- **A10, A11:** removing `jq` removed its command and wrote the audit line; deleting the Coder removed its tools and its list.
- **A16, A17:** a link to jq's own release file gave a card "from a link the Chief proposed" with the one-line warning, the address, the file, its checksum and 2 MB; Install from the web page installed it and `jq` ran. An address that is not https gave the reason and no card.
- **Android**, on the emulator: the banner shows two waiting asks; Needs you shows both cards with the server's texts; the opened card of a tool from a link has the warning on one line and the facts in two columns, the long address wrapped inside the card. The notifications read "Asks to install gh" with Decline and Install, and "Asks to install jq from a link". The Needs you screen cannot be captured (the app marks it secure), so this was read from the screen's text.
- **The Mac**: the Debug build opens on the test server and shows the banner with the waiting asks. Its card was not seen before the hand-over: step 2 of the checklist is its first look.
- **Mac-hosted** (the second test server): after TOOL-008, `jq` and `httpie` installed (`"way":"links"` in the tool's marker), no cache was left on the data folder, its Coder ran both and its other bot found neither. With Claude not signed in, botdot wrote "jq 1.8.2 is installed for Coder." itself.
- **The web card** at 375 px on the test server: the warning is one line with the amber border and nothing scrolls sideways. The browser test `test/browser/tool-card.cjs` passed when run by hand (it is in no gate: the repository does not carry Playwright).
- **A12** (a botdot server without Docker), **A6** (registry down, wrong checksum), **A8** (backup and restore) and **A18** (a changed file) rest on the unit tests; `tools-real` in the full gate installs `jq` with the real micromamba both ways and refuses a wrong sha256.
- **Gates:** `pr-check` passed on `5177654` in 2:24 and `premerge-check` in 1:50 (before the fix tasks, on `e0e675c`: 2:37 and 3:32). `tools-real` installed `jq` with the real micromamba both ways, as the tools user.

## Checklist

Do each step where it says; look at the other apps where it says so.

1. **Sign in.** On the web page open Setup and sign in to Claude.
2. **Ask for a tool (A1).** Tell the Chief "the Coder needs gh". It says in one line that the install waits in Needs you. On the web page, Android and the Mac: Needs you has a card under the Coder's head, "Install gh for Coder?", with what it is, why, and after a tap the facts (version, source, size, "Coder only", "across botdot updates"). The phone and the Mac notify "Asks to install gh" with Install and Decline.
3. **Install.** Tap Install on one app. The card fades and says "Installing" there and goes on the others. The Chief reports in one line that `gh` is installed.
4. **Use it (A1, A2).** Ask the Coder to run `gh --version`: it answers with the version. Ask Cook the same: it has no `gh`.
5. **A bot asks (A15).** Ask the Coder to run `make --version`. It says `make` is missing and that it asked the Chief; a card "Install make for Coder?" appears with "Coder asked the Chief". Install it: the Chief reports it and starts the Coder again, which answers with the version.
6. **Not in the registry (A4, A16).** Tell the Chief "the Coder needs the Stripe CLI". It says the registry does not have it, asks you for a link or proposes one, and names the risk. Give it a link to the release file for this server's processor. The card has the amber line "Not from the approved list. Make sure you trust the source.", "from a link you gave", the address, the file, the checksum and the size. On the phone the warning takes two lines, whole. The notification on the phone and the Mac says "from a link" and has Decline only; a tap opens the card.
7. **The Chief's own link (A17).** Ask for another tool outside the registry and let the Chief propose the link: the card says "from a link the Chief proposed".
8. **Decline (A5).** Decline one card. Ask the Chief for the same tool again: it tells you that you declined it and that botdot does not ask again for a week.
9. **List and remove (A10).** Ask the Chief what the Coder has installed, then to remove one. The command is gone for the Coder.
10. **Restart and update (A7).** Ask me to restart the test server, and to start it from a second image: the Coder's tools still run.
11. **Mac-hosted (finding 2).** Ask me for the link to http://localhost:4804: its Coder has `jq` and `httpie`, installed on the Mac's disk.
12. **Real use (A19).** On your own botdot server, after the merge and the update: the Coder gets `gh` and `make` from conda-forge, and both still work after the next botdot update.

Failure cases to try: ask for a tool with a made-up name (the Chief asks which one you mean, or says it is not in the registry); give a link that is not https or does not exist (no card, and the Chief says why); ask for a tool for Cook after taking away its "run commands" (the Chief says the bot needs that permission first); turn the Wi-Fi off on the phone and tap Install (the card stays and says why).

What cannot be tested by hand here: the registry being unreachable and a wrong checksum (covered by `test/tools.test.js` and `tools-real`); a file behind a link that changes (covered by `test/tools-link.test.js`); backup and restore (covered by `test/tools.test.js` and `test/backup.test.js`); a botdot server on `linux/amd64` (the stage 4 trial installed there under emulation; no gate runs it); the root-only tests of the broker (they run in the hosted workflow on the pull request, not on this Mac).

## Changes from the owner's test

- 2026-10-03, on the web page: the owner asked for the warning to read "Not from the approved list. Make sure you trust the source". Delivered as TOOL-010 (the full stop is added), which also limits a closed card by lines instead of a height. Both gates passed again on `a762046` (`pr-check` 2:01, `premerge-check` 1:44), and both test servers run the new image.

## Real use (A19)

A19 needs the owner's own botdot server on this milestone, so it follows the merge and the update: the Coder gets `gh` and `make` from conda-forge there, and both still work after the next botdot update. The owner accepted the milestone on the test servers.

## Acceptance

The owner tested on the test servers and accepted the milestone on 2026-10-03 ("All ok, the milestone passes"), on commit `4812e70` of `task/tool-006` (runtime as gated on `a762046`). Real use (A19) follows after the merge.
