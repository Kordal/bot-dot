# botdot for Mac

> **The Mac app is not maintained.** It is stopped since 18 October 2026 ([ADR 031](../docs/adr/031-the-mac-app-is-stopped-again.md)): this folder stays as it is, no workflow builds or tests it, and new features reach only the web page and the Android app. To run botdot, install it on a Linux machine ([Install on Linux](../docs/install-linux.md)) and use the web page or the Android app.

A native Mac app (SwiftUI) that does everything the web page does and is drawn as the web page is: the same font (Geist, in the app), buttons, cards and panel beside a chat. It can connect to a botdot server you already run, or set one up on this Mac. It talks to botdot through the API in [../docs/api.md](../docs/api.md), like the web page and the Android app.

## Two ways to start

The first time it opens, it offers two equal choices:

- **Connect to a botdot server.** Enter its address: its tailnet address (with Tailscale on), or `localhost:4747`.
- **Run botdot on this Mac.** The app sets up a **local botdot server** in Docker, with the same images `install.sh` uses on Linux (see [ADR 0002](../docs/adr/0002-mac-hosting-in-docker.md)):
  1. It finds Docker Desktop, OrbStack or Colima. If there's none, it says where to get Docker Desktop and goes on by itself once Docker runs.
  2. It downloads the images without signing in. Only when the registry refuses the pull (a private fork or a mirror, for example) does it ask, once, for a GitHub token that can only read packages.
  3. It writes its folder in `~/Library/Application Support/botdot`: `compose.yaml` (from the image), `.env` (this Mac's time zone) and `data/`.
  4. It downloads the images and starts botdot behind its front door on `http://localhost:4747` (published on `127.0.0.1` only), showing its progress.
  5. It asks you to make your passkey.

  After that, botdot's Setup page asks you to sign in to Claude. botdot keeps running when the app quits, as long as Docker runs.

## Signing in

Every botdot server is reached through its front door, which signs you in with your passkey ([ADR 028](../docs/adr/028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md)). The app signs in on the front door's own page, in a sheet, and keeps its session until it is signed out: a restart doesn't ask again. The session is kept in `~/Library/Application Support/dev.botdot.mac/sessions.json`, readable only by you.

A local botdot server is one account, yours: no sign-up links and no admin page. The first time, the sheet makes its passkey with a setup key that only the app holds; after that it signs in with the passkey. **Settings → This Mac → Open in browser** opens it at `http://localhost:4747`, where a browser on this Mac signs in with the same passkey. The phone can't reach a local botdot server for now: its front door answers only as `localhost`.

**Settings → This Mac** also has these settings:

- **Sign out everywhere…** ends every session of your account, in every app and browser, this Mac too. Your passkey signs you in again.
- Switch to another botdot server. botdot on this Mac keeps running, and switching back reconnects.
- Keep this Mac awake while botdot runs here (off by default).
- Open at login, with only the menu-bar dot showing (on by default when botdot runs here).
- **Remove botdot from this Mac…** This keeps your bots and their data unless you tick the box.

## What it does

- **Every bot is a head** in its colour with its hat, as on the web page: its face and a small movement show its state. The app draws it from the figure definition, `lib/figure.json`: the copy it was built with at once, and your botdot server's own once connected ([ADR 003](../docs/adr/003-one-figure-definition-for-all-apps.md)). With Reduce Motion on, nothing moves and each state keeps its face.
- **New replies:** a bot with new replies shows a dot per reply (at most three) in its colour after its time, and its chat opens at a "New" line above the first of them. A chat is read while it is on screen and the window is in front, and then its dots go in every app ([ADR 005](../docs/adr/005-read-positions-on-the-server.md)).
- **Your bots** on the left: the dashboard strip, the Chief of Staff, pinned bots, then your groups (fold, rename, drag to reorder, pin or move). **⌘K** searches every bot and message.
- **The keypad** in a window about 1000 pt wide or more, in place of the list: the Board's values and Needs you on top, then every page one under the other in one scrolling view (the pinned bots and groups, each category and Other), each its heading over its bots and groups as keys in rows of three, in the list's order. A key opens its chat on the right and stays lit; the Chief's chat is there until you open one. The Board, Needs you and the other pages open with the list beside them, as in a narrower window.
- **Chats** with the Chief and each bot:
  - while it works, one line saying what it is about to do, and **Stop**
  - Markdown replies, quick answers and copy
  - notes, and folded messages between bots
  - **Details** for every run
  - files by 📎, dropping them on the chat, or pasting
- **Needs you:** the small heads above the page (one per thing waiting, in its bot's colour and hat), a page with everything waiting, and the same cards at the end of the chat they belong to. Login and payment pop-ups use real secure fields.
- **Every page of the web app:**
  - the dashboard's tiles
  - a bot's settings (saved as you go), its jobs, and its computer's live screen (also in a corner while it works)
  - the Chief's settings
  - Activity, Skills, Connectors, the Vault and Bitwarden
  - Settings (models, appearance, backups, this Mac) and Setup; the app menu's Check for Updates… updates this app and botdot on this Mac (an account elsewhere is updated by its admin)
  - Memory has no screen: what a bot holds is asked, corrected and forgotten by chat. A chip under a reply says what was kept and where, and a change that must wait (one to what you said, a "Forget for good") is a card, both in the botdot server's words.
- **Mac touches:**
  - Notifications: one for a new reply, which goes when its chat is read in any app, and one for what needs you, with Approve and Decline. A tool from a link says so and has only Decline there: you install it on its card, which shows the warning, the address and the checksum. The Dock icon shows a dot while something waits for your OK; a new reply makes no badge.
  - A menu-bar item: the logo's dot, or one small head per waiting thing.
  - botdot keeps running when you close its window.
- **Keys:**
  - ⌘N new chat with the Chief, ⌘K find, ⌘0 the Chief
  - on the keypad: ⌘1–9 the first nine keys, counted across the pages
  - ⇧⌘Y Needs you, ⇧⌘1–4 Activity, Skills, Connectors, Vault
  - ⌘, Settings, ⌘R refresh

## No release

The app is built from this repository for the owner's own Mac ([ADR 022](../docs/adr/022-the-mac-app-is-developed-again.md)): there is no release to download and GitHub publishes none (its Tests workflow builds and tests it when `macos/` changes, [ADR 030](../docs/adr/030-the-mac-app-is-checked-on-githubs-machines.md)). The app can still update itself from a botdot image that carries a Mac app, but no published image carries one. A newer app is a new build: see **Put a new build in Applications** below.

## Build and run

It needs Xcode 26 or newer, and runs on macOS 26 or later.

```bash
cd macos
./run.sh
```

`run.sh` regenerates the Xcode project if [XcodeGen](https://github.com/yonaskolb/XcodeGen) is installed (`brew install xcodegen`), builds the app into `build/`, and opens it. Or open `BotDot.xcodeproj` in Xcode and press Run. **botdot → Check for Updates…** shows **This Mac: Up to date**: a build of your own has build number 0.

## Put a new build in Applications

```bash
make mac-install
```

From the repository's root, this builds the app (Release, into `macos/build/`), asks a running botdot app to quit, puts the new one in `/Applications` in place of the one there, and opens it. It starts connected to the same botdot server: the address is a preference of `dev.botdot.mac`, and the session is in its folder of Application Support, so neither is in the app that was replaced.

- It needs the full Xcode. When none is selected (`xcode-select`) and `DEVELOPER_DIR` is not set, it uses `/Applications/Xcode.app`; without that it stops and says so.
- `make mac-install APPLICATIONS=~/Applications` puts it in another folder.
- A botdot app that does not quit within 15 seconds stops the install, and the app in Applications stays as it was.

To run botdot on this Mac from an image you built here, not a downloaded one, name it before **Run botdot on this Mac**, as `BOT_DOT_IMAGE` does for `install.sh`:

```bash
defaults write dev.botdot.mac botdot.image bot-dot:dev
defaults write dev.botdot.mac botdot.computerImage bot-dot-desktop:dev   # optional
```

An image named without a registry is not downloaded; setup stops with "The image bot-dot:dev isn't on this Mac." when it is missing. `defaults delete dev.botdot.mac botdot.image` goes back to the published image.

In a Debug build, `BOTDOT_DOCKER`, `BOTDOT_DIR` and `BOTDOT_PORT` point **Run botdot on this Mac** at stand-ins. That way you can try the setup without Docker, for example with the repo's `test/fixtures/fake-docker.js`. `BOTDOT_STILL=1` draws the heads as with Reduce Motion, without changing the Mac's settings. `BOTDOT_PAGE=bot:<id>` (or `needs`) opens the window on that bot's chat (or on Needs you) instead of the Chief's.

## Tests

```bash
cd macos/BotDotKit
swift test
```

These tests start real botdot test servers (`test/fixtures/test-server.js`, with the stand-in Claude) and test BotDotKit, the app's data layer, against them. That covers chats, the live feed, Needs you, jobs, settings, skills, the vault, the dashboard, updates, and setting botdot up on this Mac with a stand-in docker. They need Node 22.13 or newer.

`BOTDOT_LIVE_DOCKER=1 swift test` also sets botdot up for real in Docker (several GB). When the registry refuses the pull (a private fork or a mirror), it needs `BOTDOT_REGISTRY_TOKEN` too.

## Layout

```
project.yml            the Xcode project, for XcodeGen
BotDot/App/            the app: windows, menus, notifications, the menu-bar dot, this Mac (login, awake)
BotDot/UI/             the screens
BotDotKit/             the data layer, without AppKit (also for an iOS app later): the API, live
                       streams, the Store, LocalServer (botdot in Docker on this Mac), and the head
                       (Figure.swift reads the definition, FigureLayers.swift builds its layers)
../lib/figure.json     the figure definition, bundled into the app as a resource
```
