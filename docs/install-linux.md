# Install on Linux

The full install reference: what botdot needs, the installer, accounts, shares of the machine, updates, backups, uninstalling and the platforms it runs on. The short version is in the [README](../README.md#install).

**On a Linux server,** one machine serves several accounts, each signing in with a passkey and walled off from the others. Below is what it needs and the two commands that install it.

botdot installs on Linux only. The Mac app, which could set botdot up on a Mac, is paused and not maintained ([ADR 031](adr/031-the-mac-app-is-stopped-again.md)): from a Mac, use the web page of a botdot on a Linux machine.

## What botdot needs, and whom it trusts

One machine serves several **accounts**, each walled off from the others ([ADR 028](adr/028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md)). Before you start, you need:

- **Accounts, with passkeys.** Everyone signs in at botdot's front door with a passkey; there are no passwords. Your own account, the admin's, is made with the link the installer prints, and a new account needs a sign-up link from you. Each account has its own Linux user, its own rootless Docker whose containers run under gVisor, and its own botdot server: its bots, data and logins are its own, and no other account can reach them.
- **Root is trusted.** **Whoever is root on the machine can reach every account on it**: its data, its bots and the logins they hold (the Vault, Bitwarden, connected apps). Keep root to yourself.
- **A Linux server or VM**, Ubuntu 24.04, on Intel/AMD (x86_64) or ARM (aarch64), where you can use `sudo`. The installer runs as root, because it makes a Linux user for each account.
- **Docker**, with Docker Compose (`docker compose`). The installer offers to install Docker when it's missing, and rootless Docker, gVisor's `runsc` and `setfacl` with `apt-get`.
- **git** and **curl**, and **make** for a self-built botdot server.
- **A way in**, one of the two, chosen when you install:
  - **a public domain** whose DNS points at the machine, with ports 80 and 443 free: Caddy answers there over HTTPS and fetches its own certificate;
  - **a tailnet only**, with a Tailscale account (free for personal use): Tailscale Serve gives botdot an HTTPS name on your tailnet, and nothing is on the internet.
- **A Claude subscription** (Pro or Max), or an Anthropic API key, for each account. The Chief of Staff and the bots run as Claude Code, signed in with it or on the key.
- **Disk space:** about 15 GB for each account: botdot's image is about 4 GB and the bots' computer image about 7 GB; older computer images stay after an update, so leave room for two or three.

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

## More accounts

Open **`https://<your address>/admin`**, the admin page, signed in as yourself, and choose **New sign-up link**. Hand the link to one person: it works once, for 7 days, and you can revoke it there. The page lists every link: open, used (by which account) or ended. No other account reaches the admin page, and it never shows what is inside an account.

When the link is opened, the sign-up page first says that you, the admin, can technically reach everything in the account. The person picks the account's name and makes a passkey, and the machine makes their account as the installer made yours: its own Linux user, rootless Docker under gVisor, botdot server and docker-helper. That takes a few minutes, while their page says that the account is being made; then they get their own setup page (their own Claude sign-in and time zone) and an empty list with their own Chief of Staff.

The front door never runs as root. It asks for the new account with an empty file named as it in `/var/lib/botdot/front-door/requests`, and systemd (`botdot-accounts.path`) starts root's one step for it: a copy of the installer in `/var/lib/botdot/bin`, as `install.sh --requested`, which makes the machine match what the front door's data says of that account, and nothing else. What it did is in `journalctl -u botdot-accounts`.

## Suspend, delete, and a lost passkey

The admin page lists every account: its name, when it was made, when it was last seen, and whether it runs or is suspended. It never shows what is inside an account.

- **Suspend** stops the account's botdot server and its computer (its whole rootless Docker), and keeps its data. Its owner sees only "Your account is paused by the admin". **Resume** starts it again as it was.
- **Delete** asks you to type the account's name, then erases its data, containers and Linux user for good. Its owner can't delete it themselves: they ask you. Download a backup first if they want one (Settings → Backups, in their account).
- **New sign-in link** is for an owner who lost every device: the link makes a new passkey for the same account, works once, for 1 day, and ends the sessions of the lost devices. If you lost yours, run `cd /var/lib/botdot/front-door && sudo docker compose exec front-door node front-door.js sign-in-link --account <your account>` on the server.

## Shares of the machine

Every account gets a share of the machine: CPUs, GB of RAM and GB of disk. Set the **default share** at the top of the admin page (at first 2 CPUs, 5 GB of RAM and 30 GB of disk), and **Change share** on one account to give it its own; **Back to the default share** undoes that. A change applies at once, through root's step:

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

To answer the questions beforehand, set `BOT_DOT_REACH` (`public` or `tailnet`), `BOT_DOT_DOMAIN` and `BOT_DOT_ADMIN`; for the Android app, `FRONT_DOOR_ANDROID_KEYS` (below).

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

- **On a public domain,** Caddy fetches the certificate by itself once the domain's DNS points at the machine and ports 80 and 443 are open. Until then the installer says that Caddy doesn't answer yet.
- **On a tailnet,** the installer offers to install Tailscale and sign the server in (open the link it shows), then publishes the front door with Tailscale Serve, over HTTPS and on your tailnet only. When Serve isn't enabled on your tailnet yet, the installer shows Tailscale's message with the link to enable it; enable it and run the installer again.
- **The front door listens only on the machine's own `127.0.0.1:4700`,** and each account's botdot server only on a Unix socket that the front door alone may open. Don't publish either some other way.
- **On your phone,** open the address in the browser and choose **Add to Home Screen**, or install botdot for Android ([android/](../android/README.md)).

## Updates

The admin updates botdot for every account at once: **Update every account** on the admin page. The front door and every account move to the newest signed release together, so no account runs another version; the page says the version they run and how the last update went. An account's own Settings has no update of botdot. A step that would need an answer (a new question of a newer installer) stops the update, and the page says to run the installer yourself.

Running the installer again from a newer source does the same, and also updates the installer that the admin page's Update runs:

```bash
git -C bot-dot-source pull && sudo sh bot-dot-source/install.sh
```

A self-built botdot server is updated from its source: rebuild, then press Update on the admin page, which moves every account to what you built. Or run the installer again; it keeps using your images:

```bash
cd bot-dot-source && git pull && sudo make images && sudo sh install.sh
```

Your bots, data and settings stay. Backups are per account: in Settings → Backups each owner downloads a backup of their own account only, which restores into their account. After an update that ended well, botdot removes the images of its own that it no longer uses, in the machine's Docker and in every account's, and keeps every image a container still has, running or stopped (so a bot's computer keeps the desktop it was made with).

## Settings

The installer fills them in. The front door's are in `/var/lib/botdot/front-door/.env`; an account's in `/var/lib/botdot/accounts/<name>/.env`. After a change, run the installer again.

- `TZ`: the time zone schedules use. The installer takes the server's, or UTC when it has none; the setup page can switch it to your device's.
- `CLAUDE_CODE_OAUTH_TOKEN` (an account's): optional, instead of signing in on the setup page, with a token from `claude setup-token`.
- **Meaning-based search** is on by itself, with the model in the image; ask the Chief to switch it off.

## Your data

An account's bots, chats, runs, memory and encrypted vault are in `/var/lib/botdot/accounts/<name>/data`, and its Docker volumes (the vault's key, the Claude and Bitwarden sign-ins) in its own rootless Docker. The front door's accounts and passkeys are in `/var/lib/botdot/front-door/data`.

**The data folder belongs to botdot's own user in that account's containers**, not to you, and only that user can read what's in it. Use `sudo`, and don't change its owner.

## Back up and restore

Set a passphrase in **Settings → Backups**, and botdot backs up every night at 03:00 into `data/backups`, keeping the last 7. A backup is one file, encrypted with your passphrase, holding everything in `data` and the vault's key. It leaves out the Claude and Bitwarden sign-ins, the account's computer (its files, `/workspace` included) and downloaded models. **Download** one now and then to keep a copy off the server, and keep the passphrase safe (in Bitwarden, for example): without it a backup can't be opened.

To restore, on the same server or a new one: install botdot, open it, and choose **Restore a backup** on its setup page. botdot restarts with your data, and you sign in to Claude again.

## Uninstall

On the server, from the source you installed with:

```bash
sudo sh bot-dot-source/install.sh --uninstall
```

It lists what it removes and asks you to type `yes`, as this can't be undone: the front door, every account (its botdot server, its computer, its rootless Docker, its Linux user `botdot-<name>`, its disk and its data, backups included), the front door's user `botdot-door`, botdot's systemd units, the AppArmor profile `botdot-rootlesskit`, Tailscale Serve's setting for botdot and `/var/lib/botdot` with the passkeys. Download each account's backup first if you want to keep it. Then it asks once more whether to remove the packages the installer may have installed (`runsc`, `docker-ce-rootless-extras` and gVisor's apt source); Docker itself and Tailscale always stay. botdot's images stay in Docker too: `sudo docker image ls` lists them, and `sudo docker image rm` removes one. `BOT_DOT_YES=1` answers the first question and asks nothing, and keeps the packages. Anything it couldn't remove is listed at the end, and running it again finishes what it can.

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
```

That keeps your data. To remove it too (every account's bots, chats, memory, vault and backups, and the passkeys, for good): `sudo rm -rf /var/lib/botdot`, then `sudo userdel botdot-ann` for each account (and its lines in `/etc/subuid` and `/etc/subgid`), `sudo userdel botdot-door`, `sudo rm -r /etc/systemd/system/botdot-account@.service /etc/systemd/system/botdot-accounts.path /etc/systemd/system/botdot-accounts.service /etc/systemd/system/botdot-load.timer /etc/systemd/system/botdot-load.service /etc/systemd/system.control/botdot-account@*.service.d` (the last are the accounts' CPU and RAM shares), and on Ubuntu 24.04 `sudo apparmor_parser -R /etc/apparmor.d/botdot-rootlesskit && sudo rm /etc/apparmor.d/botdot-rootlesskit`.

## Platforms

- **Intel/AMD (x86_64)** on Ubuntu 24.04 is what botdot is tested on.
- **ARM (aarch64):** the images are built for it, but botdot is not yet tested on real ARM hardware.
- **Not supported for now:** SELinux (enforcing, as on Fedora or RHEL).
