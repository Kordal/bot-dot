# Security

botdot runs AI agents on your own machine, so its security boundaries matter. Thank you for
helping keep them sound.

## Reporting a vulnerability

Please report it privately through GitHub: **Security → Report a vulnerability** on this
repository. Don't open a public issue. Include what you found, how to reproduce it, and which version
(commit) you used. You'll get an answer within a week.

## Supported versions

Only the latest version on `main` (and the images, apps and releases built from it) gets security
fixes. botdot updates itself from Settings → Updates.

## How botdot is meant to be run

- Behind the front door (`front-door.js`, ADR 028), the only program people reach: it signs them in
  with a passkey and passes each session to its account's botdot server over that server's socket.
  A botdot server takes its owner only on that socket; its own port, bound to `127.0.0.1`, is for the
  Chief's and the bots' tools. Don't expose that port on a public network or a LAN.
- Each account in its own walls (`install.sh`): its own Linux user, its own rootless Docker whose
  containers all run under gVisor, and its own botdot server, on a network of its own. The socket is
  `0666` inside a folder that its server's user owns (`0700`), with an ACL that lets only the front
  door's group (`botdot-door`) pass through it. Another user of the machine, another account, and the
  account's own bots (other users in its containers) can't open it.
- The front door never runs as root, yet a sign-up link makes a new account. It asks for the account
  with an empty file named as it in `front-door/requests` (root's folder, which only the front door's
  group may write in), and systemd starts root's one step for it: `install.sh --requested`, a copy of
  the installer that only root can change (`/var/lib/botdot/bin`), with a fixed command line. It reads
  the file names, makes only an account whose name is an account's name and that the front door's
  data has as an account, and installs or starts nothing else on the machine. A front door taken
  over could make accounts, and nothing more. The admin page, which makes and revokes the links, is the
  admin's session alone.
- **Root on the machine reaches every account**: its data, its bots and the logins they hold. The
  installer says so, and so does the sign-up page, before the passkey is made. Keep root to yourself, and don't let an account's owner be root on the machine
  unless they are its admin.
- A job's call (ADR 026) needs no session: the front door passes `/call/<account>/<bot>/<job>` to that
  account's botdot server, and the job's key alone lets it in, from the internet too when the front door
  is public. The front door slows down repeated wrong keys. Treat a call key like a password.
- In the Docker image (Linux), with separate users on (the default there): the Chief and each bot run
  as their own Linux user on the botdot server, and botdot refuses owner controls to them. On the
  account's computer they are not separate: see [The account's computer](#the-accounts-computer). On the paused Mac app's server,
  or with `BOT_DOT_SEPARATE_USERS=0`, everything runs as you, and a bot with shell access can do what
  you can.
- Giving a bot a connector gives it all of that app's actions, writing ones included. Instructions in
  a bot's task are guidance for the AI, not an enforced limit.
- The Chief can use every connected app in a chat you started ([ADR 047](docs/adr/047-the-chief-uses-connected-apps-in-the-owners-turns-and-every-write-waits-for-an-ok.md)):
  its writes wait for your OK on a card unless you always allowed that action for it, and an app's answer
  is outside content, after which what it changes in botdot waits for a card. A turn botdot started (a
  checkup, a reminder, a bot's result) has no connected apps, except the one a late yes on its card
  starts. A look (the Chief writing first) reads your mail and calendar (Gmail, Google Calendar, Outlook)
  when connected, and only reads: botdot refuses anything else in it, without a card
  ([ADR 070](docs/adr/070-a-look-reads-the-owners-mail-and-calendar-read-only.md)). A Gmail draft the Chief
  makes in a chat you started needs no card; sending it does
  ([ADR 074](docs/adr/074-the-chief-drafts-replies-the-owner-owes-and-a-gmail-draft-needs-no-card.md)). Composio's key and the
  apps' tokens never reach the Chief.
- Script jobs, and jobs the Chief or a bot set up, wait for your approval before they run, except a one-time check a bot offered and you said yes to ([ADR 064](docs/adr/064-a-check-a-bot-offers-runs-on-the-owners-yes.md)),
  an AI job the Chief sets up for a bot (after it read the web in that chat, only one you asked for, [ADR 075](docs/adr/075-a-job-the-owner-asks-the-chief-for-after-the-web-needs-no-card.md)),
  and the Chief's own jobs, which only read ([ADR 073](docs/adr/073-the-chiefs-own-jobs-only-read.md)).
- An interactive page, a static site a bot built, is served by the front door on a second address (port 8443)
  and sandboxed twice (the frame's `sandbox` and a `Content-Security-Policy: sandbox`): it has no cookies,
  storage or access to the app, loads only its own files and reaches nothing on the internet
  ([ADR 072](docs/adr/072-an-interactive-page-is-a-bots-static-site-sandboxed-on-an-address-of-its-own.md)).
- Shared rooms are off until the admin turns them on. A bot mentioned in one by anyone but its owner gets a
  talk-only turn, with no tools, notes, files or private chats; mentioned by its owner, every tool call and
  every post waits on the owner's card
  ([ADR 060](docs/adr/060-a-shared-room-lets-bots-of-several-accounts-talk-through-the-front-door.md),
  [ADR 067](docs/adr/067-the-owners-mention-in-a-room-runs-the-bot-with-every-step-on-a-card.md)).

## The docker-helper

botdot's server does not hold the Docker socket. A second container, the docker-helper
(`lib/docker-helper.js`), holds it: it starts, updates and erases the account's computer and runs botdot's
updates, when the server asks over a Unix socket that only root and the server's own user can open.

- **The helper is as powerful as its Docker.** Whoever can use the Docker socket can start a
  container that mounts what that Docker can reach. In an account (`install.sh`) that is the account's
  rootless Docker, so the account's own Linux user and its files; in a single Docker of the machine
  (`compose.mac.yaml` of the paused Mac app, ADR 031, or a botdot started by hand) it is the machine's
  whole disk. A flaw that lets someone run a Docker command of their own through the helper gives them that.
- **Only its list of allowed operations limits it.** It accepts a fixed set of named operations on a
  bot's id or the account's computer (start or erase it, ask its state, check and apply an update, and the like),
  checks every argument, and never takes a Docker command, a mount, an image or a Compose project name.
  That list is the boundary, and nothing else is.
- **It sets each computer's firewall as root inside that computer**, with a privileged `docker exec` of botdot's
  own fixed script, before anything of the desktop runs. A computer starts with nothing but `sleep`, also after a
  stop, so no restart skips it. The bots there have root through sudo, but the computer has Docker's
  default capabilities only, without `NET_ADMIN` and never `--privileged`, so root there cannot change it.
- **It runs without any capability and with no-new-privileges** (`cap_drop: [ALL]`,
  `no-new-privileges:true`), and is in the server's group only to hand the server its socket. That takes
  away what root would otherwise have inside its own container, such as reading other users' files or
  signalling their programs; it does not make the Docker socket less powerful.

## The account's computer

([ADR 035](docs/adr/035-the-account-has-one-computer-all-its-bots-work-on-with-sudo.md))

Every bot with a computer works on the account's one computer, a container that stays on, as the same
Linux user (`box`) with passwordless sudo. The owner chose this knowing what it costs:

- **No walls between the bots there.** Each bot has a screen and a browser of its own and a folder in
  `/workspace`, but those are separate work surfaces, not security boundaries. Every bot can read,
  change and end every other bot's files and programs, watch its screen and use its browser's logins.
- **Every bot is root on it.** It can install anything with apt and change anything installed there,
  botdot's helper scripts included, until botdot copies its own back at the next start.
- **Secrets used there are readable by every bot there.** A password, code, card or identity botdot
  types into a browser, a login handed to `run_with_login`, an SSH key lent through
  `run_with_ssh_key` while its agent lives and a file of the Vault handed to `run_with_file` while its
  command runs can be read by any bot on the computer, through sudo. botdot never puts a secret on a
  command line. It puts one in a file only for `run_with_file` ([ADR 039](docs/adr/039-a-saved-file-is-in-the-computer-for-one-command.md)):
  a 0600 file in a 0700 folder of the bot user's, for that one command, removed when it ends, fails or
  runs out of time, and at most 64 KB. A secret the owner allowed on a card to be kept in a file
  (`place_secret_file`, [ADR 051](docs/adr/051-the-owner-may-keep-a-vault-secret-in-a-file.md)) stays on
  disk where botdot wrote it, readable by every bot on the computer, until the owner removes it on the
  Vault page; the bot never sees its value. The Vault's "Usable in its computer" card and its file dialog
  say that every bot on the account's computer can read it. Saved logins used through
  `api_request` never reach the computer, and a GitHub App's private key never leaves botdot: a bot
  gets only the installation tokens botdot makes from it, which expire within the hour (ADR 037).
- **A script job calls APIs with saved logins but never holds one.** A script job lists the logins its
  script may use, and the owner approves them with the script; a login added later waits for their OK
  again. Its `botdot-request` asks botdot to send the request, as `api_request` does: the values go in
  headers only, to the login's own address, and are blanked out of the answer. The key it asks with
  lasts one run of that job, is that bot's alone and lets it use only that job's logins. No value of a
  login is put in the script's environment or a file. A script can still send what an API answered
  elsewhere: that is why the owner reads the script before approving it
  ([ADR 085](docs/adr/085-a-script-job-calls-apis-with-the-logins-its-job-lists.md)).
  An SSH key the job lists is used through an ssh-agent that botdot serves itself for that run
  ([ADR 087](docs/adr/087-a-script-job-signs-with-ssh-keys-through-botdots-own-agent.md)): it signs in
  botdot's own process, so the key never reaches the script, a file or the bot's user.
- **A bot's git signs in without holding a key.** In a bot's AI run on the server, `SSH_AUTH_SOCK` points
  to an ssh-agent botdot serves for that run with the Vault SSH keys shared with the bot, which signs in
  botdot's own process as a script job's does. git's credential helper there asks botdot, with a key of
  that run alone, for the token of a GitHub App login shared with the bot, for that app's GitHub only:
  the run can read that token, which expires within the hour and opens no more than `api_request` with
  that login already does; the app's private key never leaves botdot. No other login is handed to git,
  and nothing is written in a repository's `.git/config`
  ([ADR 090](docs/adr/090-a-bots-ai-run-signs-git-in-through-botdot.md)).
- **The Chief makes an SSH key but never reads it.** When the owner asks in its chat, the Chief has
  botdot make a new ed25519 key in the Vault and share it with the bots the owner names (#181), and it
  can share a key with more bots, take bots off it and rename it (#182). It can ask to remove an entry,
  which only the owner's Allow on a card moves to Bitwarden's Trash (#183). botdot generates the key and
  hands it to Bitwarden on stdin; the Chief gets back its name, public key, fingerprint and bots, never
  the private key, and it cannot send a key of its own or change any other item of the Vault. It does
  this only in a turn the owner started, and after it read the web in that chat only on the owner's OK
  on a card.
- **One Tailscale device, run as root, in userspace.** Every bot uses it. Its shields are up and the
  computer's firewall keeps botdot's control and screen ports from the tailnet; a bot with sudo could
  still open a port of its own to the tailnet, so limit the device with a tag.
- **One bot can starve the others.** The computer's memory and CPUs are the account's share; a bot
  that uses up the memory can end another's programs.
- **Still walled off from the rest.** It runs under the account's gVisor, on a network of its own,
  with no `NET_ADMIN`; other accounts, the botdot server, the Docker socket and the machine are out
  of its reach.

## What a bot is told, and what it can read

([ADR 014](docs/adr/014-botdots-memory-is-the-only-memory-a-bot-keeps.md))

- **The prompt is not on the command line.** What botdot tells a bot or the Chief on top of Claude
  Code's own prompt (its instructions, its pinned notes, the shared notes, its recent chat) is written
  to a file only the user of that run can read, handed to Claude Code as a file, and removed when the
  run has ended. No argument of the process holds that text, so the process list shows none of it. A
  file that botdot left because it was stopped or died in the middle of a run is removed when botdot
  starts again. A Claude Code too old to take the prompt from a file is not started at all: botdot says
  so at start and in Setup, and the run fails with that sentence.
- **Claude Code's own memory is off** for bots and the Chief: it loads no `CLAUDE.md` or `AGENTS.md`
  and reads and writes no auto-memory files, and a bot's run gets only the MCP servers botdot gives
  it. What a bot knows from one run to the next is what botdot's memory holds, which you can read,
  change and forget. A bot working in a cloned repository is told to read that repository's
  instruction file itself; it is that project's text, not yours.
- **Text from memory is never markup.** A note, a topic, a chat message or a past run printed into a
  prompt cannot close its block or open another: every `<` that could start a tag is written `&lt;`
  there.
- **A bot's own rules can be lifted only by you.** A bot whose rule stops what you asked asks on a
  card (`ask_override`, [ADR 052](docs/adr/052-the-owner-may-lift-a-bot-rule-on-a-card.md)). Only your
  yes on that card lifts it, once or for that bot and that action until you revoke it in its
  settings; no request body, the Chief or a bot can add one. A card cannot lift what code enforces: a
  secret value in a chat or in the model's context, a bot answering its own card, another account's
  data.
- **Without separate users, a bot that can read files can read the others'.** On the paused Mac
  app's server, or with `BOT_DOT_SEPARATE_USERS=0`, the Chief and every bot run as you. A bot with **Read** can then open
  any file you can, and a bot with shell access can run any command you can. That includes
  `data/memory.db` (every bot's notes, the shared notes and the index of past runs), the other bots'
  folders in `data/workspaces/`, the run records and the Chief's chats in `data/`, and for as long as
  a run goes its prompt file in `data/run-config/`. botdot's own tools keep each bot to its own notes,
  but the files are yours, and a bot that runs as you reads what you can read. In the Docker image
  each bot has its own Linux user, and Linux refuses all of these: a bot reaches its own folders only.

## Installed tools

The Chief of Staff can ask for a command-line tool to be installed on the botdot server for one bot;
nothing is installed before you tap Install on its card in Needs you
([ADR 007](docs/adr/007-installed-tools-are-pinned-lists-placed-by-a-tools-user.md)).

- **What botdot checks about a tool from the registry (conda-forge).** When the Chief asks, botdot pins
  the exact files: one address and one sha256 per package. On Install it downloads exactly those, and a
  file whose sha256 differs installs nothing. No install script of a package is run. That proves you got
  the files the registry listed when you approved. It does not prove who built them, and botdot does not
  look at what the program does: that is the registry's word and your decision. Package signatures are
  not checked.
- **A tool from a link is trusted on your OK alone.** For a tool the registry does not have, the Chief
  asks you for a link to its release file, or proposes one, and botdot downloads that one file over
  https to note its sha256. The card carries a warning ("Not from the approved list. Make sure you
  trust the source."), says that botdot has not checked what the program does, says whose link it is
  ("a link you gave" only when the address stands in one of your own messages in that Chief chat;
  otherwise "a link the Chief proposed", also when a bot named it), and shows the address, the file's
  name and its checksum. On
  Install botdot downloads the file again and installs it only when the sha256 is the same; later
  (after a restore) a file that changed is not installed and you are told once. Decline, and that tool
  is not asked for that bot again for a week, from the registry or from any link, also one you give
  yourself after your no: the Chief tells you so, and no card appears.
  - **What botdot does not check:** what the program does, who made it, whether the address is the
    tool's real home, and whether the version and the description on the card (the Chief's words) are
    true. No signature, no virus scan. An address the Chief proposed may be one a model made up or took
    from a bot's message or a web page: read it before you tap Install. The checksum proves only that
    the file installed is the file that was there when the card was made.
  - **What botdot refuses:** an address that is not https or redirects away from https, or carries a
    login, a `?…` part the card would not show, or a file name that would not show as it is; a file over 200 MB; an installer script, a `.deb` or
    an `.rpm`; a program for another processor or system; an archive without the named command. An
    archive (`.tar.gz`, `.zip`) is read by botdot's own code, as the tools user: a link, a device or
    other special file, an absolute path, a path with `..`, one path twice, more than 20,000 files and
    folders or more than 1 GB unpacked refuses the whole file, and no mode of the archive is kept but whether a
    file may be run. Nothing from the file is run by the ask or the install; the bot runs it later,
    with the bot's rights.
- **Who can touch the files.** A separate user (`botdot-tools`, with no secrets in its environment)
  downloads and owns them. A bot's folder is given to that bot's group, read and run only: the bot runs
  its tools and cannot change them, another bot cannot enter, and the server's own user cannot write
  there. The only root code involved makes that folder; it accepts a bot, a tool's name and a list of
  registry addresses with checksums, or one https address with its checksum and the command's name,
  never a command or a path.
  That user is nobody to botdot: a request to the server from it is refused like one from a user
  botdot cannot tell, never taken for yours.
- **What a tool can do.** It runs as the bot that has it, with that bot's rights: its folder, its
  network, the logins it may use. A tool that brings a command the server already has (`git`) stands in
  for it, for that bot; the Chief says so when it reports the install. At each start botdot runs one
  command of every installed tool as its bot, to see that it still starts, and it does the same when a
  tool the bot already has is asked for again.
- **A bot can still fetch programs into its own folder.** A bot that may run commands can download a
  program with `curl` or `npx` and run it from its workspace, without asking and without a record.
  Installed tools do not close that; they make it unnecessary and tell bots not to. Give "run commands"
  only to bots you would let do that.
- **The installer reaches the network freely.** It is not limited to the registry's servers, and for a
  tool from a link it asks whatever https address it is given, addresses inside your own network
  included. Nothing of the answer reaches the Chief but its size, its checksum, what kind of file it
  is and, for an archive without the named command, the names of the programs in it.
- **A local botdot server on a Mac** (the paused Mac app, ADR 031; not a supported way to run
  botdot). There the data folder is a folder of the Mac shared into Docker.
  Measured on 3 October 2026 on a Mac-hosted test server (`compose.mac.yaml`): that mount shows every
  file as owned by whoever looks at it and enforces neither owner nor mode. A bot's user and another
  bot's user could both list and write `data/tools/<bot>`. So on a Mac-hosted botdot "only that bot"
  holds by `PATH` alone: another bot does not find the command by its name, but can run it by its full
  path and can change it, and a bot can change its own tools. This is how the bots' workspaces behave
  there already. Treat an installed tool as reachable and changeable by every bot that may run commands.
  Installing works differently there too: the mount refuses the installer's copy, so botdot installs
  the same checked list with hard links from a cache it keeps on the data folder (`data/tools/.cache`)
  for the length of that install and removes when it ends; no file of a tool stays linked to another
  bot's. On a Linux botdot server the separation holds and is tested.
- **Without Docker** (or with `BOT_DOT_SEPARATE_USERS=0`) botdot installs no tools at all.

## Before a release

1. `npm test`, and the Tests workflow (including the separate-users and secret-scan jobs), pass on
   the final commit.
2. Scan the exact images that will be published (each platform's digest), their layers included,
   for known vulnerabilities and for credentials. The Images workflow does both with Trivy before it
   signs or publishes anything; its secret scan reads every layer, so a file a later layer deleted is
   found too (`deploy/trivy-secret.yaml`, checked by `deploy/test-layer-secret-scan.sh`). Record the
   shipped versions of Claude Code, the Bitwarden CLI, Camoufox and the base images.
3. Check the apps' release files the same way before they're attached to a release.
4. Rotate any credential that ever appeared in a published or shared artifact.
