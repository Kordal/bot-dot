<h1 align="center">botdot</h1>

<p align="center">
  <a href="https://github.com/Kordal/bot-dot/actions/workflows/tests.yml"><img alt="Tests" src="https://github.com/Kordal/bot-dot/actions/workflows/tests.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="Licence: MIT" src="https://img.shields.io/badge/licence-MIT-blue.svg"></a>
  <img alt="Node 22.13 or newer" src="https://img.shields.io/badge/node-%E2%89%A522.13-339933?logo=node.js&logoColor=white">
  <img alt="Self-hosted with Docker" src="https://img.shields.io/badge/self--hosted-Docker-2496ED?logo=docker&logoColor=white">
  <img alt="Web and Android" src="https://img.shields.io/badge/apps-web%20%C2%B7%20Android-3DDC84?logo=android&logoColor=white">
  <img alt="Built on Claude Code" src="https://img.shields.io/badge/built%20on-Claude%20Code-D97757">
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#the-board">The Board</a> ·
  <a href="#on-your-phone">Android</a> ·
  <a href="#install">Install</a> ·
  <a href="docs/user-guide.md">User guide</a>
</p>

A messenger-style app for a team of **bots**. Each bot is a Claude Code agent with its own job, and a **Chief of Staff** creates and runs them when you ask it in a chat. botdot runs on your own server, and you use it on the web and on Android.

![botdot on the web in a wide window: the Board's values and the team as keys (the Chief of Staff and pinned bots, then the Daily, Home and Tech categories, each bot a coloured head with a hat and dots for new replies) on the left, and News Monitor's chat with its morning headlines on the right, in dark mode](docs/screenshots/web-home.png)

## Features

| | |
| --- | --- |
| 🎩 **Chief of Staff** | Tell it what you need. It makes the bots, changes them, runs them and reports back. It can write to you first when it finds something worth saying. |
| 🤖 **Bots with one job each** | Every bot has its own instructions, tools, permissions, workspace and scheduled jobs. Its face shows what it is doing. |
| 📋 **The Board** | One page of live tiles for the things you use most: switches, values, lists and notes. [More below](#the-board). |
| ⏰ **Scheduled jobs** | A job runs on a schedule. When no AI is needed, a small script runs instead. |
| 👥 **Groups** | Put two to six bots in one chat, and they hand the work on to each other. |
| 🧠 **Memory** | Bots remember what you tell them, and you correct or erase it by chat. |
| 🖥 **Bots' own computers** | A bot can get a private desktop with a browser, which you can watch live. |
| 🔐 **Vault and connectors** | Bots use your logins without seeing them, and your apps (Gmail, Slack, GitHub and more) through Composio. |
| ✋ **Your OK first** | Anything risky waits for you in **Needs you**. |
| 📱 **Web and Android** | The web page works everywhere, and Android has its own app with notifications and no push service. |

## The Board

The Board is your page of tiles: the temperature, a light switch, a shopping list, your next meeting, a server's disk, a morning summary. Its values sit at the top of the keypad, so the numbers you check every day are the first thing you see.

![The Board on the web: tiles under the headings Home, Today and Server, with the living room temperature, the heating, a shopping list, a wide morning summary, unread mail, the next meeting, backups, disk use and updates, in dark mode](docs/screenshots/web-board.png)

**You build it by chat.** There are no edit buttons: ask the Chief to "add a switch for the living room light", "move Server to the top" or "make the summary wide", and it does. You drag tiles to rearrange them.

| Tile | What it shows | A tap |
| --- | --- | --- |
| **Switch** | On or off | switches it |
| **Button** | One action | does it |
| **Value** | A number or a few words, with a green, amber or red dot when it has limits | refreshes it |
| **List** | Up to 8 lines | opens all of it |
| **Note** | A few short lines, in Markdown | opens all of it |
| **Group** | Related tiles, one dot each | folds them open |

**Where the values come from:**

- **An API call with a saved login.** botdot makes it itself, with no AI, so a tap is instant. Home Assistant works this way.
- **A small script** in the bot's workspace. It waits for your OK in **Needs you** first, and again whenever it changes.
- **The bot itself**, for example from its morning job.

Every tile belongs to a bot, uses that bot's saved logins and wears its colour. Bots also **suggest** tiles when they notice you keep asking for the same thing: one tap adds it. Values refresh only while the Board is open.

The [user guide](docs/user-guide.md#board) has the details.

## Your team, run by chat

<table>
<tr>
<td width="50%"><img src="docs/screenshots/web-chief.png" alt="The Chief of Staff's empty chat on the right of the keypad: 'What should the team work on?' with four example requests"></td>
<td width="50%"><img src="docs/screenshots/web-needs-you.png" alt="Needs you on the right of the keypad: Server Watch asks to put 'Router uptime' on the Board, with its script and the buttons Decline and remove, and Approve"></td>
</tr>
<tr>
<td><b>Ask the Chief.</b> It hands the task to the right bot, or builds a new one with the tools, permissions and jobs it needs.</td>
<td><b>Your OK first.</b> A script, a login or anything risky waits in <b>Needs you</b>, with what it would run.</td>
</tr>
</table>

botdot has one look, dark, on the web and on Android. A bot's head shows its state: it blinks when idle, looks around while it works, bobs when it needs you and closes its eyes when paused. Dots after its name count new replies. A wide window shows the keypad: <kbd>1</kbd>–<kbd>9</kbd> open a bot, <kbd>Esc</kbd> brings back the Chief, <kbd>Ctrl</kbd>+<kbd>K</kbd> searches every chat.

## On your phone

<table>
<tr>
<td width="25%"><img src="docs/screenshots/phone-list.png" alt="The list on a phone: the Board's values on top, then pinned bots and the Daily, Home and Tech categories"></td>
<td width="25%"><img src="docs/screenshots/phone-chat.png" alt="News Monitor's chat on a phone, with a 'Waiting for your OK' banner on top"></td>
<td width="25%"><img src="docs/screenshots/phone-board.png" alt="The Board on a phone"></td>
<td width="25%"><img src="docs/screenshots/phone-needs-you.png" alt="Needs you on a phone: Server Watch asks to put 'Router uptime' on the Board, with its script and the buttons Decline and remove, and Approve"></td>
</tr>
<tr>
<td align="center">Your team</td>
<td align="center">A chat</td>
<td align="center">The Board</td>
<td align="center">Needs you</td>
</tr>
</table>

The web page works on any phone. The [Android app](android/README.md) adds notifications with **Reply** and **Approve**, sharing files to a bot from any app, and the keypad on tablets and foldables. botdot carries the newest app, so phones update themselves from your server.

## How it works

- **One server holds the truth.** The botdot server (Node.js, no dependencies) keeps the bots, their jobs, the Board and the chats. The web page and the Android app are windows onto its [API](docs/api.md).
- **Each bot is Claude Code.** A run is `claude -p` in the bot's own workspace, with only the tools and permissions you gave it.
- **Accounts are walled off.** One machine can hold several people's botdot, and nothing in one account can be seen or reached from another.
- **Nothing a bot writes is trusted as markup.** Text and drawings from Claude are checked on the server and drawn by the apps' own code.

[What bots can reach](docs/what-bots-can-reach.md) and [Security](SECURITY.md) have the full picture.

## What you need

| | |
| --- | --- |
| **A server** | A Linux server or VM of its own (Ubuntu 24.04, Intel/AMD or ARM) where you can use `sudo`, or any Docker host |
| **Docker** | The installer offers to install it when it's missing |
| **Claude** | A Claude subscription (Pro or Max) for each account |
| **A way in** | [Tailscale](https://tailscale.com) (a private tailnet) or a public domain that points at the server |

The full list, and whom botdot trusts, is in [Install on Linux](docs/install-linux.md#what-botdot-needs-and-whom-it-trusts).

## Install

On the Linux server:

```bash
git clone https://github.com/Kordal/bot-dot.git bot-dot-source
sudo sh bot-dot-source/install.sh
```

The installer asks a few questions and ends with your address and a sign-up link. Open the link, make your passkey, and sign in to Claude on the setup page. Then ask the Chief of Staff for your first bot.

| Where | Guide |
| --- | --- |
| A Linux server or VM, one or more accounts | [Install on Linux](docs/install-linux.md): accounts, updates, backups, uninstalling |
| Any Docker host (plain Docker, Dokploy, Coolify, Portainer) | [Install with Docker Compose](docs/install-docker.md): one account as a Compose app |

## Development

botdot's server needs nothing but Node 22.13 or newer.

```bash
npm start            # → http://localhost:4747
npm test             # the tests, with a stand-in for Claude
make lint            # the documentation links
```

[Development](docs/development.md) has the setup notes, the tests and the code layout. [AGENTS.md](AGENTS.md) is how work is done in this repository.

## Documentation

| | |
| --- | --- |
| [User guide](docs/user-guide.md) | The app and every feature |
| [Install on Linux](docs/install-linux.md) | Accounts, shares, updates, backups, uninstall, platforms |
| [Install with Docker Compose](docs/install-docker.md) | One account on plain Docker, Dokploy, Coolify or Portainer |
| [What bots can reach](docs/what-bots-can-reach.md) | What each bot, the Chief and botdot may see on a Docker install |
| [Development](docs/development.md) | Running from source, tests, code layout |
| [The API](docs/api.md) | The contract the apps use |
| [botdot for Android](android/README.md) | The Android app |
| [Security](SECURITY.md) | What botdot protects, and how to report a problem |

## Licence

[MIT](LICENSE)
