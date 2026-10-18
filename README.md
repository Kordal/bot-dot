# botdot

A messenger-style app for a team of **bots**. Each bot is a Claude Code agent that works for you, and a **Chief of Staff** creates and runs them when you ask it in a chat.

![botdot on the web in a wide window: the Board's values and the team as keys (the Chief of Staff and pinned bots, then the Daily, Home and Tech categories, each bot a coloured head with a hat and dots for new replies) on the left, and News Monitor's chat with its morning headlines on the right](docs/screenshots/web-home.png)

## What it does

- **Bots with their own job.** Each bot has its own instructions, tools, permissions and scheduled jobs.
- **A Chief of Staff.** Tell it what you need, and it makes the bots, changes them, runs them and reports back.
- **Scheduled jobs.** A job runs on a schedule, and a small script runs without AI when no AI is needed.
- **The Board.** One page of tiles for the things you use most: a light switch, a value, a list.
- **Groups.** Put two to six bots in one chat, and they hand the work on to each other.
- **Memory.** Bots remember what you tell them, and you correct or erase it by chat.
- **Bots' own computers.** A bot can get a private desktop with a browser, which you can watch live.
- **Vault and connectors.** Bots use your logins without seeing them, and your apps (Gmail, Slack, GitHub and more) through Composio.
- **Your OK first.** Anything risky waits for you in **Needs you**.
- **Web and Android apps.** The web page works everywhere; Android has its own app.

The [user guide](docs/user-guide.md) explains each of these.

## What you need

- A **Linux server or VM** of its own (Ubuntu 24.04, Intel/AMD or ARM) where you can use `sudo`.
- **Docker.** The installer offers to install it when it's missing.
- A **Claude subscription** (Pro or Max) for each account.
- A way to reach it: **Tailscale** (a private tailnet) or a **public domain** that points at the server.

The full list, and whom botdot trusts, is in [Install on Linux](docs/install-linux.md#what-botdot-needs-and-whom-it-trusts).

## Install

On the Linux server:

```bash
git clone https://github.com/Kordal/bot-dot.git bot-dot-source
sudo sh bot-dot-source/install.sh
```

The installer asks a few questions and ends with your address and a sign-up link. Open the link, make your passkey, and sign in to Claude on the setup page. Then ask the Chief of Staff for your first bot.

More accounts, updates, backups and uninstalling are in [Install on Linux](docs/install-linux.md).

**On a Docker host with its own proxy** (Dokploy, Coolify, Portainer), run one account as a Compose app instead: see [Install with Docker Compose](docs/install-docker.md).

## Development

botdot's server needs nothing but Node 22.13 or newer.

```bash
npm start            # → http://localhost:4747
npm test             # the tests, with a stand-in for Claude
```

[Development](docs/development.md) has the setup notes, the tests and the code layout.

## More

- [User guide](docs/user-guide.md): the app and every feature
- [Install on Linux](docs/install-linux.md): accounts, shares, updates, backups, uninstall, platforms
- [Install with Docker Compose](docs/install-docker.md): one account on Dokploy or another Docker host
- [What bots can reach](docs/what-bots-can-reach.md): what each bot, the Chief and botdot may see on a Docker install
- [Development](docs/development.md): running from source, tests, code layout
- [The API](docs/api.md), for the apps
- [botdot for Android](android/README.md)
- [Security](SECURITY.md): what botdot protects, and how to report a problem
- [Licence](LICENSE)
