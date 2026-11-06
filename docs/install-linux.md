# Install on Linux

The full install reference: what botdot needs, the installer, accounts, shares of the machine, updates, backups, uninstalling and the platforms it runs on. The short version is in the [README](../README.md#install).

**On a Linux server,** one machine serves several accounts, each signing in with a passkey and walled off from the others. Below is what it needs and the two commands that install it.

botdot installs on Linux only. From a Mac, use the web page of a botdot on a Linux machine.

## What botdot needs, and whom it trusts

One machine serves several **accounts**, each walled off from the others ([ADR 028](adr/028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md)). Before you start, you need:

- **Accounts, with passkeys.** Everyone signs in at botdot's front door with a passkey; there are no passwords. Your own account, the admin's, is made with the link the installer prints, and a new account needs a sign-up link from you. Each account has its own Linux user, its own rootless Docker whose containers run under gVisor, and its own botdot server: its bots, data and logins are its own, and no other account can reach them.
- **Root is trusted.** **Whoever is root on the machine can reach every account on it**: its data, its bots and the logins they hold (the Vault, Bitwarden, connected apps). Keep root to yourself.
- **A Linux server or VM**, Ubuntu 24.04, on Intel/AMD (x86_64) or ARM (aarch64), where you can use `sudo`. The installer runs as root, because it makes a Linux user for each account.
- **Docker**, with Docker Compose (`docker compose`). The installer offers to install Docker when it's missing, and rootless Docker, gVisor's `runsc` and `setfacl` with `apt-get`.
- **git** and **curl**, and **make** for a self-built botdot server.
- **A way in**, one of the two, chosen when you install:
  - **a public domain** whose DNS points at the machine, with ports 80, 443 and 8443 free (8443 is the sandbox's address for interactive pages): Caddy answers there over HTTPS and fetches its own certificate;
  - **a tailnet only**, with a Tailscale account (free for personal use): Tailscale Serve gives botdot an HTTPS name on your tailnet, and nothing is on the internet.
- **A Claude subscription** (Pro or Max), or an Anthropic API key, for each account. The Chief of Staff and the bots run as Claude Code, signed in with it or on the key.
- **Disk space:** about 15 GB for each account: botdot's image is about 4 GB and the bots' computer image about 7 GB. An update downloads only botdot's image (it removes the ones no longer used first); the computer's newer image is downloaded when the computer is updated or reset (the screen view's **Update**), and the old one goes then, so leave room for one more of each.

## Install

On the server:

```bash
git clone https://github.com/Kordal/bot-dot.git bot-dot-source
sudo sh bot-dot-source/install.sh
```

The installer asks before it installs anything. It asks how people reach botdot (a public domain or a tailnet) and your own account's name, then:

1. installs what is missing (Docker, rootless Docker, gVisor, Tailscale for a tailnet) and gets botdot's images;
2. starts the **front door** in `/var/lib/botdot/front-door`, with Caddy in front of it on a public domain, or Tailscale Serve on a tailnet;
3. makes your account: the Linux user `botdot-<name>`, its rootless Docker, and its botdot server in `/var/lib/botdot/accounts/<name>`;
4. ends with the address and **your sign-up link**. Open it and make your passkey: that account is the admin's. Until the link is used, botdot shows only "Open the link from your server's install".

**The last line, for a program.** Every install and every update, on a public domain, a tailnet or a botdot on one computer, ends with one line that a program such as a fleet console reads instead of the prose above it: `BOTDOT_READY` and a JSON object on the same line.

```
BOTDOT_READY {"origin":"https://botdot.example.com","version":"1a2b3c4","reach":"public","accounts":["ann"],"signUp":"https://botdot.example.com/sign-up/…"}
```

- `origin`: the address people open.
- `version`: the version the front door and the accounts now run, as the admin page shows it.
- `reach`: `public`, `tailnet` or `local`.
- `variant`: `one` or `several`, on a managed machine only (below); absent elsewhere.
- `accounts`: the names of the accounts this machine runs.
- `signUp`: the admin's sign-up link, while that account doesn't exist yet; absent afterwards. An update makes no link, so its line has none; a botdot on one computer keeps its setup key in its own `BOTDOT_LOCAL` line, the one before, which the desktop app reads ([ADR 136](adr/136-a-local-botdot-runs-the-linux-installer-in-a-vm-of-its-own.md)). On a managed machine it is the setup key's link to the first account, printed nowhere else.

A run that fails prints no such line.

## More accounts

Open **`https://<your address>/admin`**, the admin page, signed in as yourself, and choose **New sign-up link**. Hand the link to one person: it works once, for 7 days, and you can revoke it there. The page lists every link: open, used (by which account) or ended. No other account reaches the admin page, and it never shows what is inside an account.

When the link is opened, the sign-up page first says that you, the admin, can technically reach everything in the account. The person picks the account's name and makes a passkey, and the machine makes their account as the installer made yours: its own Linux user, rootless Docker under gVisor, botdot server and docker-helper. That takes a few minutes, while their page says that the account is being made; then they get their own setup page (their own Claude sign-in and time zone) and an empty list with their own Chief of Staff.

**Shared rooms**, on the admin page, lets the people of different accounts chat with each other's bots in shared rooms. It is off by default; turned off, every shared room is closed ([ADR 060](adr/060-a-shared-room-lets-bots-of-several-accounts-talk-through-the-front-door.md)).

The front door never runs as root. It asks for the new account with an empty file named as it in `/var/lib/botdot/front-door/requests`, and systemd (`botdot-accounts.path`) starts root's one step for it: a copy of the installer in `/var/lib/botdot/bin`, as `install.sh --requested`, which makes the machine match what the front door's data says of that account, and nothing else. What it did is in `journalctl -u botdot-accounts`.

## Suspend, delete, and a lost passkey

The admin page lists every account: its name, when it was made, when it was last seen, and whether it runs or is suspended. It never shows what is inside an account. **Change share** sits on each account's card; the rest is under its **⋯**.

- **Suspend** stops the account's botdot server and its computer (its whole rootless Docker), and keeps its data. Its owner sees only "Your account is paused by the admin". **Resume** starts it again as it was.
- **Delete** asks you to type the account's name, then erases its data, containers and Linux user for good. Its owner can't delete it themselves: they ask you. Download a backup first if they want one (Settings → Backups, in their account).
- **New sign-in link** is for an owner who lost every device: the link makes a new passkey for the same account, works once, for 1 day, and ends the sessions of the lost devices. If you lost yours, run `cd /var/lib/botdot/front-door && sudo docker compose exec front-door node front-door.js sign-in-link --account <your account>` on the server.

## Shares of the machine

Every account gets a share of the machine: CPUs, GB of RAM and GB of disk. Set the **default share** at the top of the admin page (at first 2 CPUs, half the machine's RAM but at least 5 GB, and 30 GB of disk), and **Change share** on one account to give it its own; **Back to the default share** undoes that. A change applies at once, through root's step:

- CPU and RAM are hard limits on the account's rootless Docker: its work slows down, and nothing in the account says why.
- They are also the limits of the account's one computer, which all its bots work on: a changed share sizes it from its next start.
- Its disk is its own (`/var/lib/botdot/disks/<name>.img`, mounted as its home): a run that fills it fails with "No space left on the server", and the admin page marks the account **Disk full**. A bigger disk applies at once; a smaller one only to accounts made after the change. An account made before shares has no disk of its own.

The admin page shows the machine's load (CPU, RAM and disk) and what each account uses of its share, measured every minute from outside the accounts (`botdot-load.timer`).

Your own account, the admin's, can't be suspended or deleted on the admin page. Suspend, resume and delete go through root's step as a new account does; an update of the install leaves a suspended account stopped.

It is safe to run again: a second run updates the front door and every account, keeps their bots and data, and asks nothing again. The address can't change after the first run, because a passkey belongs to one address.

**A botdot from before accounts** (one owner, in `~/bot-dot`) is not updated by this version. The installer finds it, says so, and offers to stop it; botdot is then installed again beside it, and the old data folder stays as it is. Delete it yourself once you're sure you don't need it.

botdot's **signed images** are on GitHub's registry, for Intel/AMD and ARM:

| Image | What it is |
|---|---|
| `ghcr.io/kordal/bot-dot` | botdot and its front door, with Claude Code, the Bitwarden CLI, and llama.cpp with the model for meaning-based search |
| `ghcr.io/kordal/bot-dot-desktop` | The bots' computer (an Ubuntu desktop with Camoufox) |

Before it downloads either, the installer checks that it is signed with botdot's release key, using the check in the source you cloned (`lib/signed-image.js`), the same one every update from Settings uses. A missing or wrong signature stops the install with what was refused and why, and nothing is downloaded or started. That's why the installer runs from the cloned source and not on its own.

A **self-built botdot server** instead builds both images from the source on the server itself, and the installer uses them with no download and no signature check (an image named without a registry is one you built), and hands them to each account's Docker:

```bash
cd bot-dot-source && sudo make images && sudo BOT_DOT_IMAGE=bot-dot/server:latest BOT_DOT_COMPUTER_IMAGE=bot-dot/desktop:latest sh install.sh
```

To answer the questions beforehand, set `BOT_DOT_REACH` (`public` or `tailnet`), `BOT_DOT_DOMAIN` and `BOT_DOT_ADMIN`; for the Android app, `FRONT_DOOR_ANDROID_KEYS` (below); for terms of service, `FRONT_DOOR_TERMS_URL`, `FRONT_DOOR_PRIVACY_URL` and `FRONT_DOOR_TERMS_VERSION` (below).

A first install also asks whether to use Jev as the decision model (with an OpenRouter key, made at https://openrouter.ai/settings/keys), boat.dev for the External Virtual PC (with a boat.dev API key, made at https://boat.dev/dashboard?tab=api-keys) and Composio for the admin's own account's connectors (with a Composio API key, made at https://platform.composio.dev). Each key is checked before it is kept; one that is refused is asked again, and one that can't be checked is set later: the OpenRouter and boat.dev keys on the admin page, where both can be changed, the Composio key on the admin's Connectors page. The Composio key goes to the admin's account only, once it is made, and only while it has no key of its own: every other account pastes its own ([ADR 160](adr/160-the-installer-gives-the-admins-account-its-composio-key.md)). Set `BOT_DOT_OPENROUTER_KEY`, `BOT_DOT_BOAT_KEY` and `BOT_DOT_COMPOSIO_KEY` to answer beforehand, or set any to nothing to skip it without a question.

`BOT_DOT_REACH=local` is for the desktop app alone, which installs botdot in a VM on your own computer: one account on `http://localhost:4700` ([ADR 136](adr/136-a-local-botdot-runs-the-linux-installer-in-a-vm-of-its-own.md)).

`BOT_DOT_MANAGED=1` makes a managed machine, which the fleet console runs ([ADR 154](adr/154-one-vps-per-customer-a-managed-machine-run-from-a-fleet-console.md)). It is chosen at the first install, never asked, and kept: a machine installed without it stays as it is. It needs `BOT_DOT_REACH` `public` or `tailnet`, and asks nothing: the first account is `BOT_DOT_ADMIN` (default `owner`), the Jev, boat.dev and Composio keys come only from `BOT_DOT_OPENROUTER_KEY`, `BOT_DOT_BOAT_KEY` and `BOT_DOT_COMPOSIO_KEY` (the Composio key for the first account). A managed machine has no admin page and no admin. `BOT_DOT_VARIANT` says how many accounts it holds, and is kept:

- `one` (the default): one account. Its passkey is made with the setup key: `signUp` in the install's `BOTDOT_READY` line is `https://<name>/sign-up/<setup key>` until the account exists.
- `several`: the first account is made the same way; later accounts come only from sign-up links root's step makes.

Each account has a guaranteed share of 4 CPUs, 8 GB of RAM and 40 GB of disk, never overcommitted: the machine holds as many accounts as it has CPUs for and, after 2 GB of RAM for the system, RAM for. A Contabo Cloud VPS 6 (6 CPUs, 12 GB) holds one account, a Cloud VPS 8 (8 CPUs, 24 GB) two. An install on a machine without room for one share stops before it installs anything, and a sign-up link makes no account that wouldn't fit. A rerun with `BOT_DOT_VARIANT=several` turns a machine of one account into one of several without a reinstall, keeping the account and its passkeys; going back to `one` is refused while the machine has another account.

### Sign-in and sign-up links without the admin page

On a managed machine root's step makes the links the admin page makes elsewhere, each asked with a file of root's in the front door's requests folder:

```sh
# a sign-in link that gives the account ann a new passkey, for an owner who lost every device (1 day, works once)
sudo touch /var/lib/botdot/front-door/requests/SIGN-IN-ann
# a sign-up link for another account, on a machine of several (7 days, works once); a name on its first line keeps it for that account
sudo touch /var/lib/botdot/front-door/requests/SIGN-UP
echo bob | sudo tee /var/lib/botdot/front-door/requests/SIGN-UP
```

The front door makes the link as the admin page does, and root's step writes it in `/var/lib/botdot/front-door/status/sign-in-ann.json`, `sign-up.json` or `sign-up-bob.json`, which only root and the front door read: `state` (`made`, `refused` or `failed`), `at`, `kind` (`sign-in` or `sign-up`), `account`, and `url` and `expires` once made, or `error`. A sign-up on a machine of one account, a sign-in for an account that doesn't exist, a sign-up for a name that is taken and a request the front door made, not root, are refused. An account made from a sign-up link must fit beside the others' shares, as any other. Every link made or refused is in the audit log, by `console`, without the link; the link is in no log. They work on a machine with an admin page too.

### The console's keys

On a managed machine root's step also takes the fleet console's keys after the install ([ADR 162](adr/162-the-fleet-console-gives-a-managed-machine-its-operators-keys.md)): a file `KEYS` of root's (600) in the requests folder, with a line `openrouter <key>` (Jev, the decision model), `composio <key>` (the first account's Composio key, as the installer's) or both. Root's step removes it as soon as it is read and hands the keys to the front door in `data/install-keys.json`, which it takes within a minute, as it takes the installer's. `status/keys.json` says `state` (`handed` or `refused`), `at`, and `openrouter` and `composio`, each `true` when handed, or `error`; never a key. A key is letters, digits, dashes and underscores (8 to 300); a line that isn't one is not handed. A request the front door made, not root, is refused.

A managed machine's computers can't reach its network ([ADR 156](adr/156-a-managed-machines-computers-reach-no-private-address-metadata-or-smtp.md)): root's firewall, `botdot-egress`, refuses the accounts' Linux users every new connection to a private range, a link-local address (the cloud's metadata at `169.254.169.254`) and TCP 25 and 465, over IPv4 and IPv6, before any account's Docker starts. DNS to the machine's resolvers, the machine itself and every answer stay open; the front door and Caddy aren't touched. Its rules: `sudo iptables -S BOTDOT-GUARD`.

A managed machine whose Docker is Docker's own packages (get.docker.com) gets their security updates with Ubuntu's, by unattended-upgrades: every install and update writes `/etc/apt/apt.conf.d/51botdot-docker`, which adds Docker's origin, and `/etc/apt/preferences.d/botdot-docker`, which keeps each of Docker's packages on the major version it has, so a new major comes only with botdot ([decision](decisions/2026-11-06-a-managed-machines-docker-takes-its-security-updates-within-its-major.md)). The uninstaller removes both.

## Terms and privacy policy

A machine you sell as hosting can ask each owner to agree to your terms of service and privacy policy. Give the installer three settings, once; it keeps them in `/var/lib/botdot/front-door/.env`:

- `FRONT_DOOR_TERMS_URL`: the address of your terms of service.
- `FRONT_DOOR_PRIVACY_URL`: the address of your privacy policy.
- `FRONT_DOOR_TERMS_VERSION`: their version, 1 to 40 letters, digits, dots, dashes and underscores (`1` when not set).

```bash
sudo FRONT_DOOR_TERMS_URL=https://example.com/terms FRONT_DOOR_PRIVACY_URL=https://example.com/privacy FRONT_DOOR_TERMS_VERSION=2026-11 sh bot-dot-source/install.sh
```

With both addresses set, the sign-up page, from a sign-up link or from the setup key, shows one box, "I agree to the Terms and the Privacy policy", each word a link that opens in a new tab, and makes no passkey until it is ticked. The front door keeps the version and the time in the account's record (`front-door.json`) and writes a `terms-agreed` entry to the audit log. When you change the version, every owner is asked once more at their next sign-in, before the account opens. Without both addresses nothing is asked.

## The Android app's sign-in

The Android app signs in on your front door's own sign-in page, in the phone's browser: **Sign in with your passkey** opens the page, your password manager there (Proton Pass, Bitwarden, Google Password Manager) offers the passkey, and the browser comes back to the app signed in. It works with any domain and any build of the app, the releases' or your own, with nothing to set on the server.

- The passkey comes from the browser's password manager. In Chrome on Android 14 and later, a password manager of another maker answers once it is on in Android's settings (Passwords, passkeys and accounts) and Chrome uses it (Chrome's Settings, Autofill services, "Autofill using another service"); or use a browser whose password manager holds it.
- When the browser stays on the page after the passkey, tap **Back to the app** there.
- An app from before this signed in through Android's Credential Manager, which needed the front door's `/.well-known/assetlinks.json` to name the key that signed the app. The front door still names botdot's release key and the keys in `FRONT_DOOR_ANDROID_KEYS` (`sudo FRONT_DOOR_ANDROID_KEYS=AA:BB:…,CC:DD:… sh bot-dot-source/install.sh`) for those installs; update the app and they are not needed.

## Sign in to Claude

After your passkey, botdot opens on its **setup page**. Choose **Sign in to Claude**, sign in with your Claude subscription on the page it opens, and paste the code back. Each account signs in with its own subscription.

No subscription? Choose **Use an API key instead** and paste an Anthropic API key from the [Claude Console](https://console.anthropic.com) (API keys): bots and the Chief of Staff then run on it, paid as you go to Anthropic. botdot checks the key with Anthropic, keeps it encrypted, and never shows it again. With both set up, Settings → Claude says which one bots run on and switches between them.

Your bots run unattended under that sign-in: scheduled jobs run while you sleep, and bots hand work to each other. Before you rely on that, read what Anthropic's terms say about automated use of a subscription: [Claude Code's legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance) and the [Consumer Terms](https://www.anthropic.com/legal/consumer-terms).

## Reach botdot

- **On a public domain,** Caddy fetches the certificate by itself once the domain's DNS points at the machine and ports 80, 443 and 8443 are open. Until then the installer says that Caddy doesn't answer yet.
- **On a tailnet,** the installer offers to install Tailscale and sign the server in (open the link it shows), then publishes the front door with Tailscale Serve, over HTTPS and on your tailnet only. When Serve isn't enabled on your tailnet yet, the installer shows Tailscale's message with the link to enable it; enable it and run the installer again.
- **The front door listens only on the machine's own `127.0.0.1:4700`,** and each account's botdot server only on a Unix socket that the front door alone may open. Don't publish either some other way.
- **On your phone,** open the address in the browser and choose **Add to Home Screen**, or install botdot for Android ([android/](../android/README.md)).

## Updates

The admin updates botdot for every account at once: **Update every account** on the admin page. The front door and every account move to the newest signed release, and the page says the version each runs and how the last update went. An owner, the admin included, can turn off **Update automatically** in **Settings → Updates**: the update then downloads the new version into that account but leaves its bots on the version they run, marked waiting on the admin page, until the owner (or the admin, on the account's card) taps **Update now**, or until the deadline the admin sets on the admin page (7 days unless set otherwise, 1 to 60) ([ADR 053](adr/053-each-account-owner-chooses-when-their-account-switches-to-a-new-version.md)). Running the installer by hand still moves every account. A step that would need an answer (a new question of a newer installer) stops the update, and the page says to run the installer yourself.

**A named version, a snapshot and a rollback** ([ADR 155](adr/155-an-update-can-name-its-version-and-keeps-a-snapshot-of-each-accounts-data.md)). Root's step takes the same requests from whatever writes them as root, such as a fleet console, as files in `/var/lib/botdot/front-door/requests`:

```bash
# Update every account to exactly this signed release: the server image's digest, on the file's first line.
echo sha256:<64 hex digits> | sudo tee /var/lib/botdot/front-door/requests/UPDATE
# Take one account back to its snapshot and the version it ran before its last switch.
sudo touch /var/lib/botdot/front-door/requests/ROLLBACK-<account>
```

An empty `UPDATE` takes the newest release, as the admin page's button does. A digest that isn't one of botdot's signed releases, or one older than the release the front door runs, is refused at `check`, and nothing is downloaded or restarted; `update.json` in `/var/lib/botdot/front-door/status` says the version asked for (`named`) and how it went. The bots' computer goes to the release built from the same source. Releases signed before 5 November 2026 can't be named. Before an account switches to another version, its data folder, with the compose file and `.env` it ran, is copied to `snapshot/` in its home, on its own disk: with rsync while its botdot server runs, then again with it stopped for what changed. An account whose disk wouldn't keep a fifth free after the copy switches without one. A new server that doesn't answer gets its data back from it along with its version; one that answers removes it at once, so no copy of the data stays on the account's disk. A rollback request finds a snapshot only after a switch that didn't finish; it restores the snapshot, starts the version it ran then and uses the snapshot up; `status/account-<account>.json` says `rolledback`, or `kept` or `failed` with why. What the account did since its switch is gone after a rollback.

Running the installer again from a newer source does the same, and also updates the installer that the admin page's Update runs:

```bash
git -C bot-dot-source pull && sudo sh bot-dot-source/install.sh
```

A self-built botdot server is updated from its source: rebuild, then press Update on the admin page, which moves every account to what you built. Or run the installer again; it keeps using your images:

```bash
cd bot-dot-source && git pull && sudo make images && sudo sh install.sh
```

**A staging server on another branch.** On a self-built botdot server used for staging, one command moves it to a branch of the source, the same way as the update above:

```bash
cd bot-dot-source && sudo make staging REF=<branch>
```

It stops when the Docker data folder or `/var/lib/botdot` has less than 15 GB free (`STAGING_MIN_GB`) and warns below 25 GB (`STAGING_WARN_GB`), stops when the checkout has changes of its own, then fetches, checks out and pulls the branch, runs `make images` and the installer with `BOT_DOT_IMAGE=bot-dot/server:latest BOT_DOT_COMPUTER_IMAGE=bot-dot/desktop:latest`. Accounts, data and passkeys stay. After the installer ended well it cleans up after itself, so free disk stays the same from one deploy to the next: in the machine's Docker it keeps the image that runs (`latest`) and the one that ran before (`previous`) of `bot-dot/server` and `bot-dot/desktop`, removes every other image of these two and every nameless one `make images` built (never forced: an image a container still uses, such as a stopped bot's computer, stays), and trims the build cache to 15 GB (`STAGING_CACHE_GB`). It ends with one line on what it removed and how much disk that freed. A failed build or install removes nothing and keeps the image that ran under the tag `before-deploy`, which the next deploy then keeps as `previous`. Each account's Docker keeps only the image it runs. To go back one deploy: `sudo docker tag bot-dot/server:previous bot-dot/server:latest`, the same for `bot-dot/desktop`, then `sudo sh install.sh`. Nothing that is not botdot's own image is removed, except that the build cache is the machine's. `make staging REF=main` goes back to `main`, still self-built. To go back to botdot's signed images, name them once; later reruns keep them:

```bash
cd bot-dot-source && git checkout main && git pull && sudo BOT_DOT_IMAGE=ghcr.io/kordal/bot-dot:latest BOT_DOT_COMPUTER_IMAGE=ghcr.io/kordal/bot-dot-desktop:latest sh install.sh
```

Your bots, data and settings stay. Backups are per account: in Settings → Backups each owner downloads a backup of their own account only, which restores into their account. After an update that ended well, botdot removes the images of its own that it no longer uses, in the machine's Docker and in every account's, and keeps every image a container still has, running or stopped (so a bot's computer keeps the desktop it was made with). On a self-built server this holds in every account's Docker; in the machine's Docker only `make staging` removes the images it built (above), and after a plain `make images` and `install.sh` the older ones stay until you remove them.

## Settings

The installer fills them in. The front door's are in `/var/lib/botdot/front-door/.env`; an account's in `/var/lib/botdot/accounts/<name>/.env`. After a change, run the installer again.

- `TZ`: the time zone schedules use. The installer takes the server's, or UTC when it has none; the setup page can switch it to your device's.
- `CLAUDE_CODE_OAUTH_TOKEN` (an account's): optional, instead of signing in on the setup page, with a token from `claude setup-token`.
- **Meaning-based search** is on by itself, with the model in the image; ask the Chief to switch it off.

## Your data

An account's bots, chats, runs, memory and encrypted vault are in `/var/lib/botdot/accounts/<name>/data`, and its Docker volumes (the vault's key, the Claude and Bitwarden sign-ins) in its own rootless Docker. The front door's accounts and passkeys are in `/var/lib/botdot/front-door/data`.

**The data folder belongs to botdot's own user in that account's containers**, not to you, and only that user can read what's in it. Use `sudo`, and don't change its owner.

## Back up and restore

Each account is backed up with the machine every night when the machine has an [off-site](#off-site) backup, and keeps no backups of its own on the machine ([ADR 158](adr/158-an-account-is-backed-up-off-site-and-downloaded-on-request.md)). In **Settings → Backups** its owner sees when the account's data last went off-site (or **Off**, on a machine without an off-site backup), and **Download** makes a backup of the account at that moment: one file, encrypted with a passphrase chosen for it, holding everything in `data`, the vault's key and the computer's `/workspace` (without `node_modules`). It leaves out the Claude and Bitwarden sign-ins and downloaded models. The file is made while it downloads and is never kept on the server. Keep the passphrase safe (in Bitwarden, for example): without it the file can't be opened. Backups an account made every night before this (in `data/backups`) are removed once its data is off-site, or once its owner downloads one; they still restore.

To restore, on the same server or a new one: install botdot, open it, and choose **Restore a backup** on its setup page. botdot restarts with your data, and you sign in to Claude again.

### The whole machine

A backup set is a copy of the whole machine, to rebuild a lost server: root asks root's step for one, and it needs no passphrase. Ask for one with an empty file named `BACKUP` in the front door's requests folder:

```sh
sudo touch /var/lib/botdot/front-door/requests/BACKUP
```

Root's step writes the set into `/var/lib/botdot/backup`, which only root reads. It holds the front door's data (accounts, passkeys, sign-up links, the audit log) and, for each account, suspended ones too, its data folder (without its own backups in `data/backups`), its `.env`, its server's `/config` volume with the Vault's key, and its computer's volumes: `workspace` (the bots' files and project folders), `home` and `browser` (the browser profiles, without their lock files). Each part is a plain tar file, and `manifest.json` lists the version, the machine's instance id, the admin's name, the accounts and a sha256 of each part. A computer that runs keeps running while it is copied. The set is made beside the last one, which it replaces only once it is complete: a set that fails leaves the last one as it was. It is on the machine's own disk, so copy the folder off the machine: it holds every account's data and the Vault keys, unencrypted. [Off-site](#off-site) backs the same parts up without that copy.

To put a set back, install the same version on a clean machine, with the same domain and admin's name, put the set in `/var/lib/botdot/backup`, and ask with a file named `RESTORE`:

```sh
sudo touch /var/lib/botdot/front-door/requests/RESTORE
```

Root's step checks the whole set first: a set of another version or another admin, or one whose checksum doesn't match, is refused and nothing changes. Then it stops the front door, puts its data back and starts it, and makes each account, puts its data, `.env`, Vault key and computer's volumes back, and starts it again. Owners sign in with their passkeys as before. A request the front door made, not root, is refused.

How each went is in `/var/lib/botdot/front-door/status/backup.json` and `restore.json`: `state` (`backing-up`, `done`, `failed` or `refused`; `restoring`, `restored`, `failed` or `refused`), `at`, the `phase` (and `account`) it is in or stopped in, and `error`. Root's step's log, `journalctl -u botdot-accounts` (or `/var/lib/botdot/requests.log` without systemd), says more.

### Off-site

A machine can back itself up every night to a restic repository off the machine, such as a sub-account of a Hetzner Storage Box ([ADR 157](adr/157-the-machine-backs-itself-up-off-site-with-restic.md)). Each part of a backup set goes straight into the repository, encrypted on the machine with a password the repository never holds, and nothing is kept on the machine's disk.

The quickest way is the admin page ([ADR 161](adr/161-the-admin-page-connects-a-hetzner-storage-box-for-the-off-site-backup.md)): in Settings → Off-site backup, paste an API token (read and write) of the Hetzner Console project that holds your Storage Box and press Connect. The front door makes a sub-account named after the machine (`botdot-hq` for `hq.example.com`) with SSH on, root's step puts the machine's key on it and makes the repository, and the first backup starts. The page then shows the repository's password once: save it (in Bitwarden, for example) and press Saved. The token and the sub-account's password are kept nowhere. Every account of the machine goes into that one sub-account, each tagged with its name.

Or give the repository's address once, as root, and run the first backup:

```sh
sudo BOT_DOT_OFFSITE_REPO=sftp://u123456-sub1@u123456-sub1.your-storagebox.de:23/botdot sh /var/lib/botdot/bin/install.sh --offsite
```

The first run downloads restic 0.19.1 (checked by its sha256) into `/var/lib/botdot/bin`, and makes what it needs in `/var/lib/botdot/offsite`, which only root reads: a random password for the repository (`password`; `BOT_DOT_OFFSITE_PASSWORD` gives your own instead) and an SSH key (`ssh_key`). It prints the key's public half and, for a Storage Box, the line that adds it there (`cat … | ssh -p 23 u123456-sub1@… install-ssh-key`, which asks for the sub-account's password once). Run it again once the key is in, and it makes the repository and backs up. **Keep a copy of the password off the machine** (in Bitwarden, for example): without it the backups can't be read. Use one sub-account for each machine, and turn on the Storage Box's automatic snapshots, which the machine can't delete.

From then on `botdot-offsite.timer` runs it every night between 02:00 and 04:00, at a minute of the machine's own, and an empty file named `OFFSITE` in the requests folder (or the admin page's Back up now) runs it at once:

```sh
sudo touch /var/lib/botdot/front-door/requests/OFFSITE
```

It backs up the front door's data, then for each account its data folder (without `data/backups`, `node_modules` and unfinished `.part` files, and with a consistent copy of `memory.db`, as in a set), its `.env`, its `/config` volume and its computer's volumes, and a `manifest.json`, each as a snapshot tagged `instance=`, `account=` and `part=`. A part that fails doesn't stop the others. It keeps 7 daily, 4 weekly and 3 monthly snapshots, or the number of latest ones picked on the admin page (`offsite-keep.json` in the front door's data, `{"last":N}`), and prunes once a week and after that number changes. To get a part back: `restic dump --tag part=data,account=ann latest /accounts/ann/data.tar > data.tar` with `RESTIC_REPOSITORY` and `RESTIC_PASSWORD_FILE` set.

How the last run went is in `/var/lib/botdot/front-door/status/offsite.json`: `state` (`setting-up` while the admin page's setup runs, `backing-up`, `done`, `failed` or `refused`; `off` when `OFFSITE` was asked on a machine without a repository, or with `setup: true` when the admin page's setup failed), `instance` (the machine's id, which its snapshots carry as their host: line 2 of an `OFFSITE-RESTORE` on another machine), `started`, `finished`, `lastSuccess`, `bytesAdded`, `snapshots` (each part's id), `failed` (the parts that failed), `part` (where it stopped), `error` and `check` (the last weekly check, below). `journalctl -u botdot-offsite` says more. Without `BOT_DOT_OFFSITE_REPO` none of this runs. The admin page shows it under the version, and tells the admin's account once when it is late (the last run failed, or the last good one is older than 26 hours) and once when it works again.

**Drills** ([#1018](https://github.com/Kordal/bot-dot/issues/1018)). Once a week the night's run also reads back and checks one twentieth of what the repository holds (`restic check --read-data-subset=n/20`, the next twentieth each week, so every blob is read within 20 weeks); a check that fails fails the run. To test a restore of one account at real size:

```sh
sudo sh /var/lib/botdot/bin/install.sh --restore-test ann
```

It restores that account's parts of the latest backup into `/var/lib/botdot/restore-test`, checks each part's size against what restic recorded and that each tar reads to its end, opens `memory.db` (its SQLite header, and with `sqlite3` installed its quick check), counts the bots, and removes the folder. It is refused, before anything is restored, when the disk would keep less than 512 MB free, and says how much it needs. How it went is in `status/restore-test.json` (`state` `testing`, `passed`, `failed` or `refused`, `at`, `account`, `snapshot`, `bytes`, `bots`, `error`); a failed test counts as a late backup on the admin page until one passes. It runs one at a time with the off-site backup, and one asked while a backup runs is `refused` ("An off-site backup runs now"). Root (the fleet console's agent) asks for the same test with a file `RESTORE-TEST` in the requests folder whose first line is the account; root's step removes it as it reads it, and refuses one the front door made:

```sh
echo ann | sudo tee /var/lib/botdot/front-door/requests/RESTORE-TEST
```

**Restore a machine from it** ([ADR 159](adr/159-the-console-turns-a-machines-off-site-backup-on-and-restores-a-machine-from-it.md)). Install the same version on a clean machine, with the same domain and admin's name, give it the repository (root's `OFFSITE-SET` in the requests folder: the repository's address, the repository's password and, for a Storage Box sub-account that hasn't got this machine's key yet, the sub-account's password, one a line), and once its first run is over ask with a file `OFFSITE-RESTORE` of root's: its first line `latest` or the id of a backup's `manifest.json` snapshot (8 to 64 hex digits), and, to read another machine's backups (the one this one replaces), its instance id on the second line:

```sh
printf 'latest\n1a2b3c4d\n' | sudo tee /var/lib/botdot/front-door/requests/OFFSITE-RESTORE
```

Root's step finds the backup among that instance's snapshots, restores its manifest and every part into `/var/lib/botdot/offsite-restore` with `restic restore --verify`, checks each part's size against what restic recorded, and puts it back as a backup set ([The whole machine](#the-whole-machine)): checked whole first, of the same version and admin, then the front door's data and each account; the machine takes the backup's instance id. The folder is removed however it ends. It needs twice the backup's size and 512 MB free on `/var/lib/botdot`, and stops before anything is restored when it hasn't, as it does when an off-site backup runs, when the machine has no repository, or when the backup has a part that failed. How it went is in `status/restore.json` as for `RESTORE`, with `from` (`offsite`), `snapshot` (as asked until the backup is found, then its whole id) and `instance` (when asked); what stops it before the set is whole is `failed`, in the `phase` `download`.

**Erased accounts** ([#1019](https://github.com/Kordal/bot-dot/issues/1019)). When the machine erases an account the admin deleted, its part of the backup set in `/var/lib/botdot/backup` goes at once, and its off-site snapshots 14 days later: the erase is written down in `/var/lib/botdot/offsite/erased`, and the first night's run after the 14 days forgets that account's snapshots and prunes what they held. Each account's snapshots are tagged with its born stamp (`born=…`, kept in `/var/lib/botdot/born`), so a new account made under the same name is never touched. Each forget is in `status/offsite-forgotten.json` and in the audit log (`offsite-forgotten`). Within the 14 days an account erased by mistake can still be restored from the repository.

If your machine sets `FRONT_DOOR_PRIVACY_URL`, the policy can say this of backups: an account's data is backed up every night to encrypted off-site storage and kept there for at most 3 months (7 daily, 4 weekly and 3 monthly snapshots); when an account is deleted, its data leaves the machine at once and its backups are deleted within 15 days. The Storage Box's own snapshots, if you turn them on, keep the repository as it was for as long as you set there: count them in the 3 months.

## Uninstall

On the server, from the source you installed with:

```bash
sudo sh bot-dot-source/install.sh --uninstall
```

It lists what it removes and asks you to type `yes`, as this can't be undone: the front door, every account (its botdot server, its computer, its rootless Docker, its Linux user `botdot-<name>`, its disk and its data, backups included), the front door's user `botdot-door`, botdot's systemd units, the AppArmor profile `botdot-rootlesskit`, Tailscale Serve's setting for botdot and `/var/lib/botdot` with the passkeys and the backup set. Download each account's backup first if you want to keep it. Then it asks once more whether to remove the packages the installer may have installed (`runsc`, `docker-ce-rootless-extras` and gVisor's apt source); Docker itself and Tailscale always stay. botdot's images stay in Docker too: `sudo docker image ls` lists them, and `sudo docker image rm` removes one. `BOT_DOT_YES=1` answers the first question and asks nothing, and keeps the packages. Anything it couldn't remove is listed at the end, and running it again finishes what it can.

The source you cloned goes with `rm -rf ~/bot-dot-source`, and on a tailnet the server leaves it in Tailscale's admin console.

### By hand

If the uninstaller can't run, the same steps by hand. For each account (here `ann`), stop its botdot server and its Docker, then the front door and the Tailscale Serve setting:

```bash
cd /var/lib/botdot/accounts/ann && sudo DOCKER_HOST=unix:///run/botdot-accounts/ann/docker.sock docker compose down
sudo systemctl disable --now botdot-account@ann
sudo umount /var/lib/botdot/accounts/ann
sudo systemctl disable --now botdot-accounts.path botdot-load.timer
cd /var/lib/botdot/front-door && sudo docker compose down -v
sudo tailscale serve --https=443 off
sudo tailscale serve --https=8443 off
```

That keeps your data. To remove it too (every account's bots, chats, memory, vault and backups, and the passkeys, for good): `sudo rm -rf /var/lib/botdot`, then `sudo userdel botdot-ann` for each account (and its lines in `/etc/subuid` and `/etc/subgid`), `sudo userdel botdot-door`, `sudo rm -r /etc/systemd/system/botdot-account@.service /etc/systemd/system/botdot-accounts.path /etc/systemd/system/botdot-accounts.service /etc/systemd/system/botdot-load.timer /etc/systemd/system/botdot-load.service /etc/systemd/system/botdot-offsite.timer /etc/systemd/system/botdot-offsite.service /etc/systemd/system.control/botdot-account@*.service.d` (the last are the accounts' CPU and RAM shares), and on Ubuntu 24.04 `sudo apparmor_parser -R /etc/apparmor.d/botdot-rootlesskit && sudo rm /etc/apparmor.d/botdot-rootlesskit`.

## Platforms

- **Intel/AMD (x86_64)** on Ubuntu 24.04 is what botdot is tested on.
- **ARM (aarch64):** the images are built for it, but botdot is not yet tested on real ARM hardware.
- **Not supported for now:** SELinux (enforcing, as on Fedora or RHEL).
