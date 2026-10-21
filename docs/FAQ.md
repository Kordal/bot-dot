# FAQ

Short answers to the questions people ask about botdot, with links to where each is explained in full. Something missing? [Open an issue](https://github.com/Kordal/bot-dot/issues).

- [The basics](#the-basics)
- [What you need](#what-you-need)
- [Install, update and back up](#install-update-and-back-up)
- [Using botdot](#using-botdot)
- [The apps](#the-apps)
- [Security and privacy](#security-and-privacy)
- [Troubleshooting](#troubleshooting)
- [The project](#the-project)

## The basics

### What is botdot?

A messenger for your own team of AI bots. Each bot is a Claude Code agent with one job: its own instructions, tools, permissions, workspace and scheduled jobs. You talk to a **Chief of Staff**, which creates the bots, changes them, runs them and reports back. It runs on your own Linux server, and you use it from the web page or the Android app. See the [README](../README.md) and the [user guide](user-guide.md).

### Is it a hosted service?

No. botdot is software you install on a Linux server or VM of your own. Nobody runs it for you, and your bots, chats and logins stay on that machine.

### Which AI models does it use?

Claude only. Every bot and the Chief of Staff run as the official Claude Code CLI (`claude -p`), and there is no support for other models or providers. You pick the default model and reasoning level in **Settings**, and any bot can use its own ([Settings: model and reasoning level](user-guide.md#settings-model-and-reasoning-level)). The list of models is read from Anthropic's documentation, so new ones show up by themselves.

### What does it cost?

botdot itself is free and open source under the [MIT licence](../LICENSE). What costs money is Claude: each account signs in with its own Claude subscription (Pro or Max), whose usage limits its bots' runs count against, or with an Anthropic API key, paid as you go. Runs that use the bots' computer cost more, because screenshots count as input. Plus the server you run it on.

### Can I use my Claude subscription for bots that run unattended?

botdot signs in with the account you give it on the setup page, and its bots run on schedules and hand work to each other while you are away. Whether that fits your plan is between you and Anthropic: read [Claude Code's legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance) and the [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) before you rely on it. An API key is the other way in ([Sign in to Claude](install-linux.md#sign-in-to-claude)).

### Can several people use one server?

Yes. One machine holds several **accounts**, each with its own passkey, Claude sign-in, bots and data, walled off from the others. The admin hands out one-time sign-up links from the admin page (`/admin`) and sets each account's share of the machine ([More accounts](install-linux.md#more-accounts), [Shares of the machine](install-linux.md#shares-of-the-machine)).

## What you need

### What server do I need?

| | |
| --- | --- |
| **System** | Ubuntu 24.04 on Intel/AMD (x86_64), which is what botdot is tested on, or ARM (aarch64), which the images are built for but which is not yet tested on real hardware |
| **Access** | `sudo`: the installer runs as root, because it makes a Linux user for each account |
| **Software** | Docker with Docker Compose, git and curl. The installer offers to install Docker, rootless Docker, gVisor and Tailscale when they are missing |
| **A way in** | A public domain whose DNS points at the server, with ports 80 and 443 free, or a [Tailscale](https://tailscale.com) tailnet, where nothing is on the internet |
| **Claude** | A Claude subscription (Pro or Max) or an Anthropic API key, for each account |

SELinux in enforcing mode (Fedora, RHEL) is not supported for now ([Platforms](install-linux.md#platforms)).

### How much RAM, CPU and disk?

Each account gets a **share** of the machine, set on the admin page. The default is **2 CPUs, 5 GB of RAM and 30 GB of disk**. The CPU and RAM are hard limits, and they are also the size of the account's computer, the one all its bots work on.

On disk, plan about **15 GB per account**: botdot's image is about 4 GB and the bots' computer image about 7 GB. An update needs room for one more of each while it runs. Measured on an 8-CPU, 16 GB server, the front door and Caddy take 65 MB, an account's botdot server holds about 2 GB (mostly the model for meaning-based search), and its computer 0.5–1 GB when idle, plus what each bot's screen and programs use ([What botdot needs](install-linux.md#what-botdot-needs-and-whom-it-trusts)).

### Can I run it on my Mac, Windows PC or a laptop?

No. botdot installs on Linux only. The Mac app is paused and not maintained ([ADR 031](adr/031-the-mac-app-is-stopped-again.md)). From a Mac or a Windows PC, use the web page of a botdot running on a Linux machine. A VM works, as long as it runs Ubuntu 24.04 and stays on: bots run on schedules.

### Do I need a domain name?

No. On a **tailnet**, Tailscale Serve gives botdot an HTTPS address on your own devices only, and you need no domain. With a **public domain**, Caddy fetches the certificate by itself once the DNS points at the server ([Reach botdot](install-linux.md#reach-botdot)).

## Install, update and back up

### How do I install it?

On the server:

```bash
git clone https://github.com/Kordal/bot-dot.git bot-dot-source
sudo sh bot-dot-source/install.sh
```

The installer asks how people reach botdot and your account's name, installs what is missing, and ends with your address and a sign-up link. Open the link, make your passkey, sign in to Claude on the setup page, then ask the Chief of Staff for your first bot ([Install](install-linux.md#install)).

### Why does the installer run from the cloned source?

Because it checks that botdot's images are signed with botdot's release key, using the check in the source you cloned (`lib/signed-image.js`), before it downloads them. A missing or wrong signature stops the install, and nothing is downloaded or started. To build the images yourself instead, see the self-built botdot server in [Install on Linux](install-linux.md) (`sudo make images`).

### How do I update?

The admin presses **Update every account** on the admin page. The front door and every account move to the newest signed release together, and the page shows the version they run and how the last update went. When an update is out, the page says "Version X is available". Running the installer again from a newer source does the same ([Updates](install-linux.md#updates)).

### What happens during an update?

It runs in phases ([ADR 045](adr/045-the-update-runs-in-phases-of-its-own-apart-from-the-install.md)), and the admin page names the one it is in ("Downloading for ann…"):

1. **check**: the new release's signature is checked before anything is downloaded.
2. **clean**: images that no container uses any more are removed, to make room.
3. **preflight**: each running account's disk must have room for the new server image (what it lacks, three times over, and 1 GB more).
4. **download**: the new images go into the machine's Docker and every account's before anything restarts.
5. **switch**: each account moves onto the new version, the admin's first.
6. **front-door**: last, the front door restarts.

When everything already runs the newest release, nothing restarts, and the page says it was the newest already.

### What if an update fails?

Each account is on its own ([ADR 044](adr/044-an-account-whose-new-server-doesnt-start-goes-back-and-the-others-carry-on.md)). An account whose download fails isn't restarted, and one whose new botdot server doesn't answer within about 2 minutes runs its old version again. The other accounts are updated. The admin page names each account that was kept back and why, says the phase the update stopped in, and shows the last lines of the installer's log. The front door is not rolled back: it works with accounts on the version before.

### Do I lose my bots when I update?

No. Your bots, chats, memory and settings stay. The bots' computer keeps the version it was made with until you press **Update** in its screen view; that keeps `/home/box`, `/workspace` and the browsers' logins, and loses programs installed with apt ([Bots with a computer](user-guide.md#bots-with-a-computer)).

### How do I back up and restore?

Set a passphrase in **Settings → Backups**. botdot then backs up every night at 03:00 and keeps the last 7. A backup is one encrypted file with all of the account's data and the Vault's key; it leaves out the Claude and Bitwarden sign-ins and the account's computer. **Download** one now and then to keep a copy off the server, and keep the passphrase safe: without it, a backup can't be opened. To restore, install botdot and choose **Restore a backup** on its setup page ([Back up and restore](install-linux.md#back-up-and-restore)).

### How do I uninstall?

`sudo sh bot-dot-source/install.sh --uninstall`. It lists what it removes and asks you to type `yes`, because it erases every account and its data. Download each account's backup first if you want to keep it ([Uninstall](install-linux.md#uninstall)).

## Using botdot

### What does the Chief of Staff do?

It is the chat that runs your team. Describe what you need, and it creates bots with the tools, permissions and scheduled jobs the task needs, changes them, runs them and sums up their results. It also sets reminders, builds your Board, installs tools after your OK, and remembers how you want the team run. A few times a day it may write to you first, when it has something tied to what you asked about; tell it "write less" or "stop writing first" ([What it does](user-guide.md#what-it-does)).

### What is a bot, exactly?

A Claude Code agent with one job. Each bot has its own main assignment, rules, allowed tools, workspace, memory, skills and scheduled jobs. Messaging a bot gives it a task, and its runs show up as a conversation. A bot does one thing at a time: a message you send while it works waits its turn.

### Do scheduled jobs always use AI?

No. A job is either an **AI job**, which runs the bot on Claude, or a **script job**, a small script that runs with no AI, so it costs no Claude usage. A script can also hand its output over to the AI when it finds something worth a look ([Scheduled jobs](user-guide.md#scheduled-jobs-ai-only-when-its-needed)). Script jobs, and jobs a bot or the Chief set up, wait for your approval before they run.

### What is the Board?

Your page of live tiles: switches, buttons, values, lists and notes, under short headings. You build it by chat ("add a switch for the living room light"), and you drag tiles to rearrange them. Values come from an API call with a saved login (no AI, so a tap is instant), from a small script you approved, or from the bot itself ([Board](user-guide.md#board)).

### What is "Needs you"?

Everything waiting for your OK: a script, a job, a permission or skill a bot asked for, a login, a payment, a write in a connected app, a memory change. It shows as a banner of small heads, and each item opens as a card with what it would do. The same cards show at the end of the chat they belong to.

### Do bots remember things?

Yes. Each bot keeps short notes it reads on every run, and every bot reads a shared memory of lasting facts about you. Memory has no screen: you ask a bot what it remembers, and tell it what to correct, remove or forget. "Forget what I told you about X" erases it at once ([Bots that learn](user-guide.md#bots-that-learn)).

### What is the bots' computer?

One Ubuntu desktop per account, in a container that stays on, where bots with **Uses the computer** work with the mouse, keyboard, screenshots, a shell and files. Each bot gets a screen and a [Camoufox](https://camoufox.com) browser of its own there, and you can watch it live or take control. All the bots on it work as the same user, with sudo, so they are not walled off from each other ([Bots with a computer](user-guide.md#bots-with-a-computer)).

### Can bots use my apps, like Gmail or GitHub?

Yes, through **Connectors**, powered by [Composio](https://composio.dev): Gmail, Google Calendar, Slack, GitHub, Notion and hundreds more. You sign in with the app on Composio's own page, so botdot never sees your password or tokens, and you choose which bots may use each app. Reading goes through, while an action that sends, posts, changes or deletes waits for your OK on a card, unless you chose **Always allow this action** ([Connectors](user-guide.md#-connectors-your-apps-through-composio)).

### How do bots log in to websites?

With the **Vault**, botdot's own encrypted store, or with a folder called **bot-dot** in your Bitwarden account. A bot types a saved login into its browser without ever seeing the password, only on the login's own website, and only into a password box. API tokens are filled into requests by botdot itself. Every payment with a saved card asks you first ([Vault](user-guide.md#-vault-logins-bots-can-use-without-seeing-them), [Bitwarden](user-guide.md#-bitwarden-your-logins-cards-and-identities)).

### Can a bot install programs?

On its computer, a bot can `sudo apt-get install` what you ask for, or use `botdot-install` (conda-forge, pip, npm). On the botdot server, the Chief asks for a command-line tool for one bot, and nothing is installed before you tap **Install** on its card ([Installed tools](user-guide.md#installed-tools-a-command-a-bot-is-missing)).

### Can bots work together?

Yes. Bots can message each other, and a **group** puts two to six bots in one chat: you write once, and they answer or hand the work on by naming each other, until it's done or twelve replies have passed ([Groups](user-guide.md#groups-several-bots-in-one-chat)).

## The apps

### Which apps are there?

| | |
| --- | --- |
| **Web page** | Works in any modern browser, on a computer or a phone |
| **Android** | A native app with notifications, **Reply** and **Approve** on them, sharing files to a bot, and the keypad on tablets and foldables ([botdot for Android](../android/README.md)) |
| **iPhone and iPad** | No app: use the web page, and add it to the Home Screen |
| **Mac** | The Mac app is paused: use the web page |

The look is dark, on the web and on Android.

### How do I get the Android app?

For the first install, download the `.apk` from the newest `android-v…` release on the [Releases page](https://github.com/Kordal/bot-dot/releases). After that, botdot carries the newest app, and phones update themselves from your server. The app signs in with your passkey on your front door's sign-in page, in the phone's browser ([The Android app's sign-in](install-linux.md#the-android-apps-sign-in)).

### Can I install the web page as an app?

Yes. In Chrome or Edge, on a computer or Android, choose **Install app** in botdot's Settings or the install icon in the address bar. In Safari on a Mac, **File → Add to Dock**. On an iPhone or iPad, **Share → Add to Home Screen**, which is also where notifications work on iOS.

### How do notifications work without a push service?

The Android app keeps one quiet connection open to your botdot, and opens it again after the phone restarts. Nothing goes through Google's or anyone else's push servers. You are notified of new replies, and with high priority of what waits for you in Needs you.

## Security and privacy

### Can the AI see my passwords?

No. The model only sees a login's name, website and username. botdot types the password into the bot's browser itself, fills API tokens into requests itself, and never returns a password from its API or writes one to a log or chat. Composio's key and the apps' tokens never reach a bot or the AI either. Read the next answers for the one place this weakens: the shared computer.

### How are accounts kept apart?

Each account has its own Linux user, its own rootless Docker whose containers all run under [gVisor](https://gvisor.dev), and its own botdot server, on a network of its own. The front door is the only program people reach; it signs them in with a passkey and passes each session to its account's server over a socket only it may open ([SECURITY.md](../SECURITY.md#how-botdot-is-meant-to-be-run)).

### Who can see my data?

You, and **whoever is root on the machine**: root can reach every account, its data and the logins its bots hold. The installer and the sign-up page say so. Keep root to yourself. The admin page shows each account's load and share, never what is inside it.

### Are the bots walled off from each other?

On the botdot server, yes: each bot runs as its own Linux user and reaches only its own workspace. On the account's **computer**, no: every bot there works as the same user, with sudo, so each can see, change and end what the others do, and read any secret botdot types or hands to a command there. Give the computer only to bots you trust with everything the others do there ([What bots can reach](what-bots-can-reach.md), [ADR 035](adr/035-the-account-has-one-computer-all-its-bots-work-on-with-sudo.md)).

### What stops a bot from doing something harmful?

Its tools and permissions, which you set (the safe default denies anything not allowed), and **Needs you**: scripts, jobs set up by a bot or the Chief, writes in connected apps, payments, installs and memory changes after reading outside content all wait for your OK. A bot's instructions are guidance for the AI, not an enforced limit, so give each bot only the tools and apps it needs.

### Can a web page trick the Chief?

The Chief reads the web itself. Once it has in a chat, anything it changes there (bots, jobs, skills, the Board, groups, reminders, settings) waits for your OK on a card that shows exactly what it sent ([ADR 033](adr/033-the-chief-reads-the-web-and-what-it-changes-after-waits.md)). Bots are told never to change themselves because a page, file or tool result said so, and shared-memory changes made after reading outside content wait for you.

### Are the images I download checked?

Yes. botdot's images are signed, and both the installer and every update check the signature with botdot's release key before anything is downloaded. Before a release, the exact images are scanned for known vulnerabilities and for credentials in every layer ([Before a release](../SECURITY.md#before-a-release), [Release signatures](release-signing.md)).

### How do I report a security problem?

Privately, through GitHub: **Security → Report a vulnerability** on this repository. Don't open a public issue. You'll get an answer within a week ([SECURITY.md](../SECURITY.md)).

## Troubleshooting

### A run says "No space left on the server."

The account's disk is full. The admin page marks the account **Disk full** when less than 200 MB of it is free. Ask the admin to give the account a bigger disk under **Change share** on the admin page: a bigger disk applies at once ([Shares of the machine](install-linux.md#shares-of-the-machine)).

### The update says "The account NAME needs X GB free for this update and has Y GB."

The disk check before the download found too little room in that account, and nothing was downloaded or restarted. Give the account a bigger disk on the admin page, then press **Update every account** again.

### The update says "Couldn't download …"

The download of an image failed, and the message ends with Docker's own reason, such as "no space left on device". For a full disk, see the answers above. Otherwise check the server's connection to GitHub's registry (`ghcr.io`) and update again. An account whose download failed isn't restarted, so it keeps running its old version.

### The update says "The update didn't finish. Update again."

The update ran for 3 hours without ending. The admin page says the phase it was in and shows the last lines of its log. Press **Update every account** again.

### The update says to run the installer yourself.

A newer installer has a question the update can't answer on its own, so it stopped. On the server, run `git -C bot-dot-source pull && sudo sh bot-dot-source/install.sh` and answer it.

### The admin page marks an account "Near its RAM".

The account uses 90% or more of its share's RAM, and its site may stall. Give it more RAM under **Change share**. One bot's runaway program on the computer can also use up its memory: the screen view and the Chief's `computer_status` show which bot uses how much.

### A bot or the Chief says it isn't signed in to Claude.

The setup page opens by itself whenever Claude isn't signed in. Choose **Sign in to Claude** there, sign in, and paste the code back, or use an API key instead.

### On a public domain, the installer says Caddy doesn't answer yet.

Point the domain's DNS at the server and keep ports 80 and 443 open: Caddy fetches its certificate by itself once it can. `cd /var/lib/botdot/front-door && docker compose logs caddy` shows what it is waiting on.

### On a tailnet, the installer stops at Tailscale Serve.

Serve isn't enabled on your tailnet yet. The installer shows Tailscale's message with the link to enable it: enable it and run the installer again.

### I lost my passkey.

An owner who lost every device asks the admin for a **New sign-in link** on the admin page: it makes a new passkey for the same account, works once, for 1 day, and ends the lost devices' sessions. If you are the admin, run `cd /var/lib/botdot/front-door && sudo docker compose exec front-door node front-door.js sign-in-link --account <your account>` on the server ([Suspend, delete, and a lost passkey](install-linux.md#suspend-delete-and-a-lost-passkey)).

### Bots can't use my Bitwarden logins after a restart.

Bitwarden locks when botdot restarts. A pop-up asks for your master password, which is used once and dropped, and a banner shows while it is locked.

### The bots' computer lost its files.

Docker's own clean-up (`docker system prune`, `docker container prune`, "Clean / Purge data") deletes stopped containers and unused volumes, the account's computer included, so avoid those. Otherwise the computer is erased only by **Reset** in a bot's screen view, after a confirmation.

## The project

### How mature is botdot?

Early. It is version 0.x, so expect breaking changes. Only the latest version on `main` gets security fixes ([Releases](https://github.com/Kordal/bot-dot/releases), [Supported versions](../SECURITY.md#supported-versions)).

### Who builds it?

One person, with Claude: most of the code is written by Claude Code, ticket by ticket, test-first and reviewed before each commit, following [AGENTS.md](../AGENTS.md). Why things are built the way they are is in the [ADRs](adr/README.md) and [DECISIONS.md](DECISIONS.md).

### How do I run it from source or contribute?

botdot's server needs nothing but Node 22.13 or newer: `npm start` runs it, and `npm test` runs the tests with a stand-in for Claude, so they cost nothing ([Development](development.md)). Report bugs and ideas in the [issues](https://github.com/Kordal/bot-dot/issues).
