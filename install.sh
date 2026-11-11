#!/bin/sh
# Install or update botdot on a Linux machine (a VPS, a VM, a mini PC…), all in Docker. Run it as root:
#
#   sudo sh install.sh        (from botdot's source: it checks the images with it)
#
# It asks before it installs anything, and is safe to run again: a second run updates botdot to the newest images,
# removes the ones botdot no longer uses and keeps every account's data, passkeys and settings.
#
# What it makes (ADR 028):
#   1. checks the machine (Linux, Intel or ARM), Docker, rootless Docker and gVisor, and offers to install them
#   2. checks that botdot's images are signed with botdot's release key, and downloads them (anonymously;
#      a read-only GitHub token is asked once only when the registry refuses the pull, as for a private fork or a
#      mirror); images built on this machine are used as they are
#   3. asks once how people reach botdot: a public domain, with Caddy for HTTPS, or a tailnet only, with
#      Tailscale Serve, and the name of the admin's own account (a botdot on this computer only, for the desktop app,
#      is the answer BOT_DOT_REACH=local alone, never asked: below)
#   4. starts the front door, the one program people reach, in this machine's Docker (BOT_DOT_DIR/front-door)
#   5. makes the admin's account: a Linux user of its own (botdot-<name>), its own rootless Docker whose every
#      container runs under gVisor, and its botdot server (BOT_DOT_DIR/accounts/<name>)
#   6. prints the sign-up link that makes the admin's account
#   7. sets up root's one step for the front door (below), which makes the accounts later sign-up links make
#
# The front door never runs as root. When a sign-up link the admin made on the admin page is used, it asks for the
# new account with an empty file named as the account in BOT_DOT_DIR/front-door/requests, and root's step, a copy of
# this installer in BOT_DOT_DIR/bin that systemd starts (botdot-accounts.path) whenever that folder isn't empty, makes
# it as step 5 made the admin's:
#
#   sh BOT_DOT_DIR/bin/install.sh --requested
#
# It takes no other input: only file names that are account names, and what the front door's data says of each. The
# same request, after the admin suspended, resumed or deleted an account on the admin page, stops it, starts it again
# or erases it (data, containers and Linux user), never the admin's own. It asks nothing, and installs and starts
# nothing on the machine but those accounts.
#
# The admin page's Update asks with an empty file named UPDATE, which no account can be named (and which, unlike a
# hidden file, wakes systemd's DirectoryNotEmpty): root's step then runs its copy of this installer as an update,
# which hands over to the installer in the image it installs (ADR 036), asks nothing and stops at anything it would
# have to ask, and says how it went in BOT_DOT_DIR/front-door/status (update.json: its phase, and after a failure the
# last lines of its output, all of which is in BOT_DOT_DIR/update.log):
#
#   sh BOT_DOT_DIR/bin/install.sh --update
#
# A backup set of the whole machine (#986) is asked by root alone, with an empty file named BACKUP, and put back on a
# fresh install of the same version with one named RESTORE (below, "A backup set"): BOT_DOT_DIR/backup holds it, and
# status/backup.json and status/restore.json say how it went. OFFSITE-RESTORE puts the machine back from its off-site
# repository the same way (ADR 159), and RESTORE-TEST runs the restore test below (#1018), both root's alone.
#
# A machine whose .env names an off-site repository (BOT_DOT_OFFSITE_REPO, #1016, ADR 157) backs itself up there every
# night with restic, and at once on root's empty file named OFFSITE ("Off-site backup", below), saying how it went in
# status/offsite.json:
#
#   sh BOT_DOT_DIR/bin/install.sh --offsite
#
# A link for a machine without an admin page (#985), root's alone too: SIGN-IN-<account> asks for a sign-in link that
# makes that account a new passkey, and SIGN-UP for a sign-up link (for the account named on its first line, if any; a
# machine of one account takes none). The link is in status/sign-in-<account>.json or status/sign-up[-<account>].json
# ("A link asked by root alone", below), which only root and the front door read, and nowhere else.
#
# The fleet console pauses the whole machine with SUSPEND and starts it again with RESUME, root's alone too: every
# account suspended or resumed in the front door's data, then made to match, as status/suspend.json says.
#
# An account whose owner turned "Update automatically" off is left waiting on the version it runs, with the new one in
# its Docker (ADR 053). "Update now", from its owner's Settings or the admin page, or the deadline the admin set, asks
# with an empty file named SWITCH-<account>, which no account can be named either: root's step then switches that
# account alone to the version the front door pins, and says how it went in status/account-<account>.json.
#
# It is not the install again but phases of its own (ADR 045): check the newest signed release of the repositories
# .env pins (or the images built on this machine), clean, preflight, download into the machine's Docker and every
# account's, switch each account to it, then the front door, and clean what it replaced. It never installs Docker,
# gVisor or Tailscale, never asks how botdot is reached, and makes no sign-up link.
#
# Each account has a share of the machine that the admin sets on the admin page (ADR 028, #471): CPUs and RAM are hard
# limits on its unit (systemctl set-property) and the limits of its one computer, which its docker-helper reads (a file
# only root writes, share/share.json in its home), and its disk is an ext4 image of that size, mounted as its home (disks/).
# Root's step applies a share the front door asked for as it makes the account match. Every minute root's step also
# writes the machine's load and each account's use of its share for the admin page (front-door/load), from outside the
# account:
#
#   sh BOT_DOT_DIR/bin/install.sh --load
#
# Once an hour at most it also looks for the newest signed release, for the admin page's "Version X is available"
# (status/latest.json). An update that finds the images the front door and every account run already restarts nothing.
#
# Settings you can pass in: BOT_DOT_DIR (default /var/lib/botdot), BOT_DOT_IMAGE, BOT_DOT_COMPUTER_IMAGE, and the
# answers: BOT_DOT_REACH (public or tailnet), BOT_DOT_DOMAIN and BOT_DOT_ADMIN (the admin's account's name).
# FRONT_DOOR_TERMS_URL, FRONT_DOOR_PRIVACY_URL and FRONT_DOOR_TERMS_VERSION (default 1), kept once given: with both
# addresses, sign-up asks the owner to agree to the terms and the privacy policy (docs/install-linux.md).
# A first install also asks whether to use Jev, the decision model, and boat.dev, the External Virtual PC, and for
# each one's key, and for the Composio key of the admin's own account's connectors; BOT_DOT_OPENROUTER_KEY,
# BOT_DOT_BOAT_KEY and BOT_DOT_COMPOSIO_KEY answer beforehand (empty: no). The first two are set later on the admin page
# too, the Composio key on the Connectors page.
#
# BOT_DOT_REACH=local is the desktop app's botdot, in a Linux VM of its own on the owner's computer (ADR 136): one
# account (BOT_DOT_ADMIN, default owner) at http://localhost:<port> (BOT_DOT_PORT, default 4700), and nothing else
# reaches it: no Caddy, no Tailscale, no admin page, no sign-up link. Its passkey is made with a setup key the
# installer makes and keeps in .env, which only root reads; the install's last line, for the app, is the one line
#   BOTDOT_LOCAL {"origin":"http://localhost:4700","signUp":"http://localhost:4700/sign-up/<setup key>"}
# without signUp once the account exists.
# BOT_DOT_LOCAL_HOST=1, beside local, is the desktop app's botdot on a Linux computer itself, with no VM (ADR 170):
# chosen at the first install and kept. The VM's chain that keeps all of it from the computer's network isn't written,
# as that would cut the owner's own computer off; the accounts' Linux users get a managed machine's guard instead.
# BOT_DOT_MANAGED=1 makes a managed machine (ADR 154), which the fleet console runs through root's step: on a public or
# tailnet reach, chosen at the first install and, like local, never offered in a question. Its front door has no admin
# page and no admin; each account has a guaranteed share of 4 CPUs, 8 GB of RAM and 40 GB of disk, and the machine
# holds only as many as it has CPUs and, after 2 GB for the system, RAM for. BOT_DOT_VARIANT (kept, default one):
#   one      one account (BOT_DOT_ADMIN, default owner), as on local: its passkey is made with the setup key
#   several  the first account is made so too, and later ones only from sign-up links root's step makes
# A rerun with BOT_DOT_VARIANT=several turns one into several and keeps the account; back to one is refused while the
# machine has another account. Until the first account exists, the setup key's sign-up link is in BOTDOT_READY alone.
# Every install and update, on every reach, ends with one line for a program such as the fleet console (#981):
#   BOTDOT_READY {"origin":"https://botdot.example.com","version":"1a2b3c4","reach":"public","accounts":["ann"],
#                 "signUp":"https://botdot.example.com/sign-up/<token>"}
# signUp is the admin's sign-up link while that account doesn't exist yet, and only an install's: an update makes no
# link, and a local install keeps its setup key in BOTDOT_LOCAL alone. A managed machine's line also has its variant
# ("variant":"one" or "several"), and its signUp is the setup key's link, printed nowhere else.
# BOT_DOT_TLS=internal gives Caddy its own certificate authority in place of Let's Encrypt, for a test machine
# whose domain is not on the internet.
#
# Self-built: images named without a registry (`make images` in the source builds bot-dot/server:latest
# and bot-dot/desktop:latest) are used as they are on this machine: no token, no sign-in, no download.
#   sudo BOT_DOT_IMAGE=bot-dot/server:latest BOT_DOT_COMPUTER_IMAGE=bot-dot/desktop:latest sh install.sh
# A rerun keeps them, so after a rebuild `sudo sh install.sh` updates the install in place.
#
# Uninstall (#76): everything the installer made goes, after it says what and a typed "yes" (BOT_DOT_YES=1 answers it):
#   sudo sh install.sh --uninstall
set -eu

IMAGES="ghcr.io/kordal"
DIR="${BOT_DOT_DIR:-/var/lib/botdot}"
DOOR="$DIR/front-door"
ENV="$DOOR/.env"
SOCKETS="$DIR/sockets"
ACCOUNTS="$DIR/accounts"
# Where each account's rootless Docker keeps its socket: $RUN/<account>/docker.sock.
RUN="${BOT_DOT_RUN:-/run/botdot-accounts}"
# The machine's settings the installer changes: subordinate IDs, the systemd unit and the AppArmor profile (the
# installer's tests point it elsewhere).
ETC="${BOT_DOT_ETC:-/etc}"
# Where gVisor's runsc goes on a machine whose packages don't have it (install_runsc; the installer's tests point it
# elsewhere).
LOCAL_BIN="${BOT_DOT_LOCAL_BIN:-/usr/local/bin}"
# What install_runsc put there, for the uninstaller.
GVISOR_MARK="$ETC/botdot-gvisor"
# Where the machine's processes and mounts are read (the installer's tests point it elsewhere).
PROC="${BOT_DOT_PROC:-/proc}"
# Where the accounts' cgroups are read (the installer's tests point it elsewhere).
CGROUP="${BOT_DOT_CGROUP:-/sys/fs/cgroup}"
# The front door's own user of the machine; its group alone is let into each account's socket folder.
DOOR_USER=botdot-door
DOOR_PORT=4700
# The sandbox's own address for bots' interactive pages (#399, ADR 072): the front door's second port, reached as the
# same name on HTTPS port 8443, which is another origin than the front door's.
SITES_PORT=4701
SITES_HTTPS=8443
# botdot's source, which this installer is part of.
SOURCE="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)"
# runsc's flags in a rootless Docker (ADR 028, "Spike result"): it cannot make cgroups there, and a computer's
# firewall needs gVisor's iptables, which need raw sockets.
# --overlay2=none: what a container writes goes to its own layer on the account's disk. runsc's default
# (root:self) keeps it in an overlay of the sandbox, dropped when the container stops, so a bot's computer lost its
# home, its SSH keys, its Tailscale login and what it installed on every stop (#68).
# Without cgroups runsc sizes a sandbox by the machine: each account runs it through runsc_share, which sizes it by
# the account's share (ADR 152).
RUNSC_FLAGS='"--ignore-cgroups", "--net-raw", "--overlay2=none"'
# runsc-uds, the runtime of botdot's server and its Docker helper alone (compose.yaml): they meet through Unix sockets
# in their mounts, which gVisor lets a container reach only with --host-uds. Every other container, a bot's computer
# first of all, runs under the default runsc, without it (#72).
RUNSC_UDS_FLAGS="$RUNSC_FLAGS, \"--host-uds=all\""
# The runtimes an account's Docker knows (its daemon.json, below, and Docker's own runc). A compose.yaml that names
# another is from a newer version than this installer (#142).
RUNTIMES='runc runsc runsc-uds'
# Every container's log, in the machine's Docker and in each account's: json-file, rotated at 20 MB and kept to five files,
# 100 MB at most, about a day of a busy server (#980). Docker applies it to a container when it is made.
LOG_OPTS='"log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" }'
# Where the front door asks for new accounts, and root's copy of this installer that makes them.
REQUESTS="$DOOR/requests"
BIN="$DIR/bin"
# Each account's disk, an ext4 image of its share's size, and where root's step writes the load for the admin page.
DISKS="$DIR/disks"
LOAD="$DOOR/load"
# The share an account has while the front door names none (as DEFAULT_SHARE in lib/front-door/store.js): CPUs, GB of
# RAM, GB of disk. Its RAM is half the machine's, at least 5 GB (store.js defaultRam): under gVisor a sandbox keeps its
# file cache in its own memory, so an account held to 4 GB on a 16 GB machine filled it and thrashed its disk (#126).
DEFAULT_RAM="$(awk '/^MemTotal:/ { g = int(int($2 / 1048576 + 0.5) / 2); print (g < 5 ? 5 : g) }' "$PROC/meminfo" 2>/dev/null || true)"
DEFAULT_SHARE="2 ${DEFAULT_RAM:-5} 30"
# An account's disk is full below this many bytes free: the admin page marks it.
FULL_BELOW=209715200

# ---------------------------------------------------------------------------------------------
# Talking to the person

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
say() { printf '%s\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
# An account the update runs on its own (each_account) ends with its reason in ACCOUNT_WHY, and the others go on.
die() {
  [ -z "${ACCOUNT_WHY:-}" ] || { printf '%s\t%s\n' "${ACCOUNT_RESULT:-kept}" "$*" > "$ACCOUNT_WHY"; exit 1; }
  printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2
  exit 1
}

# Answers come from the terminal even when the script itself is piped in (curl … | sh). Commands
# that don't need input get </dev/null, so they can't swallow answers (or the piped-in script).
if [ -r /dev/tty ] && (: < /dev/tty) 2>/dev/null; then TTY=/dev/tty; else TTY=/dev/stdin; fi
# Without a terminal the answers are on standard input itself, which is read as it is: on Linux /dev/stdin can't be
# opened again when it is a socket.
read_line() { if [ "$TTY" = /dev/tty ]; then IFS= read -r REPLY < /dev/tty || REPLY=''; else IFS= read -r REPLY || REPLY=''; fi; }

# An update from the admin page (--update) has nobody to answer: a question ends it.
UNATTENDED=''
unanswered() { [ -z "$UNATTENDED" ] || die "The update needs an answer to \"$1\", so it stopped. Run the installer yourself: sudo sh install.sh"; }

# ask "Question" y|n  -> returns 0 for yes
ask() {
  unanswered "$1"
  if [ "$2" = y ]; then hint='[Y/n]'; else hint='[y/N]'; fi
  printf '%s %s ' "$1" "$hint"
  read_line
  # Without a terminal nothing echoed the answer: it ends the question's line, as a person's Enter would.
  [ "$TTY" = /dev/tty ] || printf '%s\n' "$REPLY"
  case "$REPLY" in
    [Yy]*) return 0 ;;
    [Nn]*) return 1 ;;
    *) [ "$2" = y ] ;;
  esac
}

# ask_secret "Prompt" -> $REPLY, not shown on screen
ask_secret() {
  unanswered "$1"
  printf '%s ' "$1"
  if [ "$TTY" = /dev/tty ]; then stty -echo < /dev/tty 2>/dev/null || true; fi
  read_line
  if [ "$TTY" = /dev/tty ]; then stty echo < /dev/tty 2>/dev/null || true; fi
  printf '\n'
}

# set_env FILE KEY VALUE: add or replace one line in FILE. get_env FILE KEY: its value.
set_env() {
  { grep -v "^$2=" "$1" 2>/dev/null || true; printf '%s=%s\n' "$2" "$3"; } > "$1.tmp"
  mv "$1.tmp" "$1"
  chmod 600 "$1"
}
get_env() { sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -n 1; }

# The machine's packages: apt-get on Debian and Ubuntu, dnf on Fedora and the RHEL family (RHEL, Rocky, AlmaLinux,
# CentOS Stream, Oracle Linux). A machine with neither installs what botdot needs itself, and is told what.
pkg_manager() { if command -v apt-get >/dev/null 2>&1; then echo apt; elif command -v dnf >/dev/null 2>&1; then echo dnf; fi; }
# os_field NAME: a field of /etc/os-release (ID, ID_LIKE, VERSION_ID, PRETTY_NAME), read, not run.
os_field() { sed -n "s/^$1=//p" "$ETC/os-release" 2>/dev/null | head -n 1 | sed 's/^["'\'']//; s/["'\'']$//'; }
# install_hint APT_PACKAGE DNF_PACKAGE: the command that installs it on this machine.
install_hint() {
  case "$(pkg_manager)" in
    apt) printf 'sudo apt-get install %s' "$1" ;;
    dnf) printf 'sudo dnf install %s' "$2" ;;
    *) printf "your system's package for %s" "$1" ;;
  esac
}
# pkg_add APT_PACKAGES -- DNF_PACKAGES: installs them quietly with the machine's packages; fails without them.
pkg_add() {
  pa_apt='' pa_dnf='' pa_in=apt
  for pa_p; do
    if [ "$pa_p" = -- ]; then pa_in=dnf; elif [ "$pa_in" = apt ]; then pa_apt="$pa_apt $pa_p"; else pa_dnf="$pa_dnf $pa_p"; fi
  done
  # shellcheck disable=SC2086 # one package per word
  case "$(pkg_manager)" in
    apt) DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $pa_apt </dev/null >/dev/null 2>&1 \
      || { apt-get update -qq </dev/null >/dev/null 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $pa_apt </dev/null >/dev/null 2>&1; } ;;
    dnf) dnf install -y -q $pa_dnf </dev/null >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}
# A managed machine (ADR 154), as its install chose: 1 or nothing. Its accounts' default share is 4 CPUs, 8 GB of RAM and
# 40 GB of disk (MANAGED_SHARE in lib/front-door/capacity.js), guaranteed, so not half the machine's RAM.
MANAGED="$(get_env "$ENV" BOT_DOT_MANAGED 2>/dev/null || true)"
[ "$MANAGED" = 1 ] || MANAGED=''
MANAGED_SHARE="4 8 40"
[ -z "$MANAGED" ] || DEFAULT_SHARE="$MANAGED_SHARE"
# A local botdot on the owner's Linux computer itself, with no VM (ADR 170), as its install chose: 1 or nothing.
LOCAL_HOST="$(get_env "$ENV" BOT_DOT_LOCAL_HOST 2>/dev/null || true)"
[ "$LOCAL_HOST" = 1 ] || LOCAL_HOST=''
# The accounts' Linux users are kept from private addresses and SMTP (#984): on a managed machine, and on the owner's
# own computer, where no VM does it.
GUARD="$MANAGED$LOCAL_HOST"
# registry_of IMAGE: the registry an image is named on, none for one built on this machine. owner_of IMAGE: its owner there.
registry_of() { case "$1" in */*) h="${1%%/*}"; case "$h" in *.*) printf '%s' "$h" ;; esac ;; esac; }
owner_of() { r="${1#*/}"; printf '%s' "${r%%/*}"; }

# write_status FILE JSON: what the admin page reads of this install and of its last update (#473), in a folder that
# only root writes and the front door reads (FRONT_DOOR_STATUS).
write_status() {
  mkdir -p "$DOOR/status"
  chmod 755 "$DOOR/status"
  printf '%s\n' "$2" > "$DOOR/status/$1.new"
  chmod 644 "$DOOR/status/$1.new"
  mv "$DOOR/status/$1.new" "$DOOR/status/$1"
}
# say_newest VERSION [REVISION DIGEST]: status/latest.json, for the admin page's "Version X is available" (#193):
# VERSION, a source revision of 7 characters, is the newest signed release, found now. An image's id (an image without a
# revision) isn't one. The release check also gives its whole REVISION and its signed DIGEST, which the fleet console
# reads from the heartbeat to offer that release to every machine it runs.
say_newest() {
  case "$1" in *[!0-9a-f]* | '') return 0 ;; esac
  [ "${#1}" = 7 ] || return 0
  sn_more=''
  if printf '%s' "${2:-}" | grep -Eqx '[0-9a-f]{40}' && printf '%s' "${3:-}" | grep -Eqx 'sha256:[0-9a-f]{64}'; then
    sn_more=",\"revision\":\"$2\",\"digest\":\"$3\""
  fi
  write_status latest.json "{\"version\":\"$1\"$sn_more,\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
}
# account_said NAME STATE [FIELDS]: what became of the account NAME's version (ADR 053), for its owner's Settings and
# the admin page, in status/account-NAME.json: STATE (waiting, switching, updated, kept or failed), when, and FIELDS,
# more of the JSON after a comma. account_was NAME: the state it says now.
account_said() { write_status "account-$1.json" "{\"state\":\"$2\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"${3:+,$3}}"; }
account_was() { sed -n 's/.*"state":"\([a-z]*\)".*/\1/p' "$DOOR/status/account-$1.json" 2>/dev/null || true; }
# version_now: the version root's step last said the front door and every account run.
version_now() { sed -n 's/.*"version":"\([0-9a-f]*\)".*/\1/p' "$DOOR/status/version.json" 2>/dev/null || true; }

# phase NAME [ACCOUNT]: the update is in its phase NAME (check, clean, preflight, download, switch, front-door, done),
# for the account ACCOUNT when it is one account's. Said in its log, and written to update.json as it starts, so the
# admin page shows it while the update runs and names it when it stops (#195). Only an update root's step started for
# the admin page (BOT_DOT_UPDATE_AT: when it started, BOT_DOT_UPDATE_FROM: the version before) writes update.json.
phase() {
  if [ "$MODE" = install ]; then say "== $1${2:+ ($2)}"; return 0; fi
  [ "$MODE" = update ] || return 0
  say "== $1${2:+ ($2)}"
  [ -n "${BOT_DOT_UPDATE_AT:-}" ] || return 0
  write_status update.json "{\"state\":\"updating\",\"at\":\"$BOT_DOT_UPDATE_AT\",\"from\":\"${BOT_DOT_UPDATE_FROM:-}\"$(named_field "${BOT_DOT_UPDATE_TO:-}"),\"phase\":\"$1\"${2:+,\"account\":\"$2\"}}"
}
# named_field TO: update.json's "named", the version the update was asked for (#979), after a comma; nothing for the
# newest, and nothing for a name that isn't a digest.
named_field() { if printf '%s' "$1" | grep -Eqx 'sha256:[0-9a-f]{64}'; then printf ',"named":"%s"' "$1"; fi; }

# install: install or update (the default). requested: root's step that makes the accounts the front door asked for.
# update (--update): the update the admin asked for on the admin page, which root's step runs: phases of its own, not
# the install again, that ask nothing (#473, #195, ADR 045).
MODE=install
RESTORE_TEST=''
case "${1:-}" in
  '') ;;
  --requested) MODE=requested ;;
  --update) MODE=update UNATTENDED=1 ;;
  --prerequisites) MODE=install PREREQUISITES=1 ;;
  --load) MODE=load ;;
  --offsite) MODE=offsite ;;
  # --restore-test ACCOUNT (#1018): one account's parts of the latest off-site backup restored into a scratch folder,
  # checked and removed.
  --restore-test) MODE=restore-test RESTORE_TEST="${2:-}" ;;
  --uninstall) MODE=uninstall ;;
  *) die "Unknown option $1. Run it as: sudo sh install.sh" ;;
esac
ACCOUNT_RULE="2 to 24 lowercase letters, digits and dashes, starting with a letter"
# valid_account NAME: one line of 2 to 24 of those characters (a case, not grep, which would take any one line of many).
valid_account() {
  case "$1" in '' | [!a-z]* | *[!a-z0-9-]*) return 1 ;; esac
  [ "${#1}" -ge 2 ] && [ "${#1}" -le 24 ]
}

# valid_share CPU RAM DISK: three whole numbers, as the front door checks them.
valid_share() {
  [ "$#" = 3 ] || return 1
  for v_ in "$@"; do case "$v_" in '' | *[!0-9]*) return 1 ;; esac; done
  [ "$1" -ge 1 ] && [ "$2" -ge 2 ] && [ "$3" -ge 12 ]
}

# new_setup_key: a secret the front door takes as a setup key (32 to 100 base64url characters), which makes the first
# account's passkey (ADR 136, ADR 154).
new_setup_key() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n' | head -c 64; }

# managed_accounts: the accounts of this machine, one name a line: those made on it and those the front door asked for.
managed_accounts() {
  {
    for ma in "$ACCOUNTS"/*/; do ma="$(basename "$ma")"; ! valid_account "$ma" || [ ! -f "$ACCOUNTS/$ma/compose.yaml" ] || printf '%s\n' "$ma"; done
    for ma in "$REQUESTS"/*; do ma="$(basename "$ma")"; ! valid_account "$ma" || printf '%s\n' "$ma"; done
  } | sort -u
}

# room_for_shares N: stops the install unless the machine holds N shares of DEFAULT_SHARE, never overcommitted, beside
# 2 GB of RAM for the system (ADR 154), as lib/front-door/capacity.js counts: CPUs against the shares' CPUs, RAM less
# the reserve against theirs. What can't be read refuses nothing.
room_for_shares() {
  # shellcheck disable=SC2086 # three numbers
  set -- "$1" $DEFAULT_SHARE
  rs_cpus="$(getconf _NPROCESSORS_ONLN 2>/dev/null || grep -c '^processor' "$PROC/cpuinfo" 2>/dev/null || true)"
  rs_kb="$(awk '/^MemTotal:/ { print $2 }' "$PROC/meminfo" 2>/dev/null || true)"
  case "$rs_cpus" in '' | *[!0-9]*) rs_cpus='' ;; esac
  case "$rs_kb" in '' | *[!0-9]*) rs_kb='' ;; esac
  { [ -n "$rs_cpus" ] && [ "$rs_cpus" -lt $(($1 * $2)) ]; } || { [ -n "$rs_kb" ] && [ "$rs_kb" -lt $((($1 * $3 + 2) * 1048576)) ]; } || return 0
  rs_gb='?'
  [ -z "$rs_kb" ] || rs_gb="$(awk -v k="$rs_kb" 'BEGIN { printf "%.1f", k / 1048576 }')"
  die "This machine has ${rs_cpus:-?} CPUs and $rs_gb GB of RAM: a managed machine needs $2 CPUs and $3 GB of RAM for each of its $1 account$([ "$1" = 1 ] || echo s), and 2 GB more for the system. Nothing was changed."
}
# A managed machine without room for one share is refused before anything is installed.
if [ "$MODE" = install ] && { [ -n "$MANAGED" ] || [ "${BOT_DOT_MANAGED:-}" = 1 ]; }; then
  ( DEFAULT_SHARE="$MANAGED_SHARE"; room_for_shares 1 ) || exit 1
fi

# The systemd that runs this machine, if one does.
SYSTEMD=''
systemctl show --property=Version </dev/null >/dev/null 2>&1 && SYSTEMD=1

# put FILE TEXT: FILE holds TEXT, written whole, root's and readable by the front door's group alone.
put() {
  printf '%s\n' "$2" > "$1.new"
  chown "0:$(id -g "$DOOR_USER" 2>/dev/null || echo 0)" "$1.new"
  chmod 640 "$1.new"
  mv "$1.new" "$1"
}
# A number, or null when what was measured isn't one.
num() { case "$1" in '' | *[!0-9.]* | *.*.*) printf 'null' ;; *) printf '%s' "$1" ;; esac; }

# trim_disk NAME: the account NAME's disk gives the machine back the blocks its files no longer hold. Its image is a
# sparse file that only grows: what is deleted inside (a snapshot of its data, a bot's files, Docker's images) stays
# taken on the machine's disk until the disk is trimmed. Once a day (write_load) and as soon as its snapshot goes.
# Not mounted with discard, which slows every write. Without fstrim, or a disk that isn't mounted, nothing.
trim_disk() {
  command -v fstrim >/dev/null 2>&1 && mountpoint -q "$ACCOUNTS/$1" 2>/dev/null || return 0
  fstrim "$ACCOUNTS/$1" </dev/null >/dev/null 2>&1 || warn "Couldn't give this machine back the free space of the account $1's disk."
  mkdir -p "$RUN/load" && touch "$RUN/load/$1.trimmed"
}

# write_load: the machine's load, and each account's use of its share, measured from outside the accounts, for the
# admin page: LOAD/machine.json and LOAD/account-<account>.json (lib/front-door/load.js reads them). CPU is how many CPUs the
# account used since the last time (from its unit's CPU time), RAM what its unit holds less its file cache, computers whether its one
# computer runs (1 or 0, in its own Docker), and its disk the image's size and use; `full` when less than FULL_BELOW is free.
write_load() {
  [ -d "$DOOR" ] || return 0
  mkdir -p "$LOAD" "$RUN/load"
  chown "0:$(id -g "$DOOR_USER" 2>/dev/null || echo 0)" "$LOAD"
  chmod 750 "$LOAD"
  at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  now="$(date +%s)"
  cpus="$(getconf _NPROCESSORS_ONLN 2>/dev/null || grep -c '^processor' "$PROC/cpuinfo" 2>/dev/null || true)"
  load1="$(cut -d' ' -f1 "$PROC/loadavg" 2>/dev/null || true)"
  # shellcheck disable=SC2046 # two numbers
  set -- $(awk '/^MemTotal:/ { t = $2 } /^MemAvailable:/ { a = $2 } END { if (t) printf "%.0f %.0f", t * 1024, (t - a) * 1024 }' "$PROC/meminfo" 2>/dev/null || true)
  ram_total="${1:-}" ram_used="${2:-}"
  # shellcheck disable=SC2046
  set -- $(df -Pk "$DIR" 2>/dev/null | awk 'NR == 2 { printf "%.0f %.0f", $2 * 1024, $3 * 1024 }' || true)
  put "$LOAD/machine.json" "{\"at\":\"$at\",\"cpus\":$(num "$cpus"),\"load\":$(num "$load1"),\"ramTotal\":$(num "$ram_total"),\"ramUsed\":$(num "$ram_used"),\"diskTotal\":$(num "${1:-}"),\"diskUsed\":$(num "${2:-}")}"
  for home in "$ACCOUNTS"/*/; do
    n="$(basename "$home")"
    valid_account "$n" && [ -f "$ACCOUNTS/$n/compose.yaml" ] || continue
    cpu='' ram=''
    if [ -n "$SYSTEMD" ]; then
      # One property at a time: systemctl prints several in its own order, not the order asked.
      ns="$(systemctl show -p CPUUsageNSec --value "botdot-account@$n.service" </dev/null 2>/dev/null || true)"
      ram="$(systemctl show -p MemoryCurrent --value "botdot-account@$n.service" </dev/null 2>/dev/null || true)"
      case "$ram" in '' | *[!0-9]*) ram='' ;; esac
      # Its file cache, which the kernel takes back when memory is short, is left out, as the machine's RAM leaves it
      # out (MemAvailable): else an account showed more than the whole machine used (#126). Its shared memory stays
      # in: under gVisor that is the sandboxes' own memory, which can't be taken back without swap.
      cg="$(systemctl show -p ControlGroup --value "botdot-account@$n.service" </dev/null 2>/dev/null || true)"
      if [ -n "$ram" ] && [ -n "$cg" ] && [ -r "$CGROUP$cg/memory.stat" ]; then
        ram="$(awk -v r="$ram" '$1 == "file" { f = $2 } $1 == "shmem" { s = $2 } END { c = f - s; printf "%.0f", (c > 0 && c < r) ? r - c : r }' "$CGROUP$cg/memory.stat")"
      fi
      case "$ns" in '' | *[!0-9]*) ns='' ;; esac
      if [ -n "$ns" ] && [ -f "$RUN/load/$n" ]; then
        cpu="$(awk -v n="$ns" -v t="$now" '{ if (t > $1 && n >= $2) printf "%.2f", (n - $2) / ((t - $1) * 1e9) }' "$RUN/load/$n")"
      fi
      [ -z "$ns" ] || printf '%s %s\n' "$now" "$ns" > "$RUN/load/$n"
    fi
    # How long it has held more than 85% of its share, which the admin page marks after ten minutes (#831).
    high=0
    share_gb="$(sed -n 's/.*"ram":\([0-9]*\).*/\1/p' "$ACCOUNTS/$n/share/share.json" 2>/dev/null || true)"
    if [ -n "$ram" ] && [ -n "$share_gb" ] && [ "$ram" -gt $((share_gb * 912680550)) ]; then
      [ -f "$RUN/load/$n.high" ] || printf '%s\n' "$now" > "$RUN/load/$n.high"
      high=$((now - $(cat "$RUN/load/$n.high")))
    else
      rm -f "$RUN/load/$n.high"
    fi
    computers=''
    [ ! -S "$RUN/$n/docker.sock" ] || computers="$(env DOCKER_HOST="unix://$RUN/$n/docker.sock" docker ps -q --filter label=botdot.computer=account --filter status=running </dev/null 2>/dev/null | wc -l | tr -d ' ' || true)"
    size='' used='' full=false
    if mountpoint -q "$ACCOUNTS/$n" 2>/dev/null; then
      [ -n "$(find "$RUN/load/$n.trimmed" -mmin -1440 2>/dev/null)" ] || trim_disk "$n"
      # shellcheck disable=SC2046
      set -- $(df -Pk "$ACCOUNTS/$n" 2>/dev/null | awk 'NR == 2 { printf "%.0f %.0f %.0f", $2 * 1024, $3 * 1024, $4 * 1024 }' || true)
      size="${1:-}" used="${2:-}"
      [ -z "${3:-}" ] || [ "$3" -ge "$FULL_BELOW" ] || full=true
    fi
    put "$LOAD/account-$n.json" "{\"at\":\"$at\",\"cpu\":$(num "$cpu"),\"ram\":$(num "$ram"),\"computers\":$(num "$computers"),\"diskSize\":$(num "$size"),\"diskUsed\":$(num "$used"),\"ramHighSeconds\":$high,\"full\":$full}"
  done
  # The files of accounts that are gone.
  for f in "$LOAD"/account-*.json; do
    [ -e "$f" ] || continue
    n="$(basename "$f" .json)"
    n="${n#account-}"
    [ -f "$ACCOUNTS/$n/compose.yaml" ] || rm -f "$f" "$RUN/load/$n" "$RUN/load/$n.high" "$RUN/load/$n.trimmed"
  done
}
# An image from a registry is installed only once its signature is botdot's, checked before anything is
# downloaded by the updater's own check (lib/signed-image.js, the release key pinned in lib/release-trust.js)
# from the source this installer is in. It runs on the Node of botdot's image, pinned by its digest (the
# Dockerfile's NODE_IMAGE), as nobody, read-only and with nothing but the network, trusting the certificates
# this machine trusts, as Docker does. A registry token goes to it on its input.
CHECK_NODE="node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9"
# isolated OPTION… IMAGE COMMAND…: docker run, as nobody, read-only and with nothing but the network, trusting the
# certificates this machine trusts, with the registry token on its input.
isolated() {
  CA=''
  [ -r /etc/ssl/certs/ca-certificates.crt ] && CA="-v /etc/ssl/certs/ca-certificates.crt:/check/ca.crt:ro -e NODE_EXTRA_CA_CERTS=/check/ca.crt"
  # shellcheck disable=SC2086 # CA is two options or none
  printf '%s' "$TOKEN" | $D run --rm -i --pull never --network host --read-only --cap-drop ALL --security-opt no-new-privileges --user 65534:65534 $CA "$@"
}
# check_node FILE ARG…: lib/FILE of this installer's source, run with ARGs on that Node, isolated.
check_node() {
  cn_file="$1"
  shift
  isolated -v "$SOURCE/lib:/check/lib:ro" "$CHECK_NODE" node "/check/lib/$cn_file" "$@"
}
# signed NAME server|desktop [--revision]: prints the signed release of NAME's repository, pinned by digest (and the
# source revision it was built from after it), or why it was refused (status 1; 2 when the registry wants a token).
signed() { check_node signed-image.js "$@"; }

# look_for_newest: once an hour at most, the newest signed release of the repository the install pinned, for the admin
# page's "Version X is available" (#193): status/latest.json, its source revision and when it was found. Asked with the
# same check as an update (signed), from root's copy of the installer and the release check beside it. Images built on
# this machine have none. A check that fails waits its hour too, and the last one found stays.
look_for_newest() {
  wl_image="$(get_env "$ENV" BOT_DOT_IMAGE)"
  [ -n "$(registry_of "$wl_image")" ] && [ -f "$SOURCE/lib/signed-image.js" ] || return 0
  mkdir -p "$RUN/load"
  # Named so that no account's CPU reading beside it can be (an account's name is lowercase).
  [ -z "$(find "$RUN/load/LATEST" -mmin -60 2>/dev/null)" ] || return 0
  touch "$RUN/load/LATEST"
  wl_image="${wl_image%@sha256:*}"
  case "${wl_image##*/}" in *:*) wl_image="${wl_image%:*}" ;; esac
  TOKEN="$(get_env "$ENV" BOT_DOT_REGISTRY_TOKEN)"
  wl_found="$(signed "$wl_image:latest" server --revision </dev/null 2>/dev/null)" || return 0
  wl_rev="${wl_found##* }"
  [ "${#wl_rev}" = 40 ] || return 0
  wl_digest="${wl_found%% *}"
  wl_digest="${wl_digest##*@}"
  say_newest "$(printf '%s' "$wl_rev" | cut -c1-7)" "$wl_rev" "$wl_digest"
}
if [ "$MODE" = load ]; then
  [ "$(id -u)" = 0 ] || die "Root's step measures the accounts, so it runs as root."
  write_load
  # The machine's Docker, as below: this step ends before it.
  D=docker
  look_for_newest || true
  exit 0
fi

# ---------------------------------------------------------------------------------------------
# Off-site backup (#1016, ADR 157)
#
# A machine whose .env names an off-site repository, BOT_DOT_OFFSITE_REPO (a restic repository's address: for a Hetzner
# Storage Box's sub-account sftp://u1-sub1@u1-sub1.your-storagebox.de:23/botdot), streams a backup set's parts into it
# every night, encrypted on this machine, and keeps no copy here. Its secrets are in OFFSITE, root's alone: the
# repository's password (password), which the repository never holds and a copy of which is kept off the machine, and
# the SSH key it signs in with (ssh_key, its known_hosts beside it), both made once when they aren't there. Root's step
# runs it every night (botdot-offsite.timer) between 02:00 and 04:00 on the machine's clock, at a minute its instance
# id picks, and at once when root asks with an empty file named OFFSITE in REQUESTS:
#
#   sh BOT_DOT_DIR/bin/install.sh --offsite
#
# Each part is one `restic backup --stdin-from-command` of the tar a set makes (owner maps kept), tagged with the
# instance, the account and the part; one that fails doesn't stop the others. Snapshots are kept 7 days, 4 weeks and 3
# months, and what they no longer hold is pruned once a week. How it went is in status/offsite.json: state
# (backing-up, done or failed), started, finished, lastSuccess, bytesAdded, snapshots (each part's), failed (the parts
# that failed), part (the one it stopped in) and error. A machine without the setting does none of it; asked for one
# (OFFSITE), it says state off, which no admin is warned of (#1017).
#
# An erased account's snapshots (#1019) are forgotten OFFSITE_GRACE_DAYS after the erase, and pruned in the same run:
# the erase writes the account, its born stamp and the time in OFFSITE/erased. Each account's parts are tagged with
# born=<its stamp> (BOT_DOT_DIR/born/<name>, made at its first off-site backup), so that a forget never touches an account
# made again under the same name; the snapshots of a part made before the stamp, which have none, are of the account
# that had the name then, and go with it. What was forgotten is in status/offsite-forgotten.json, for the audit log.
OFFSITE="$DIR/offsite"
OFFSITE_REQUEST=OFFSITE
RESTIC_VERSION=0.19.1
# The sha256 of each restic release file this installer takes (restic's SHA256SUMS of v0.19.1).
RESTIC_SUMS='linux_amd64 f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c
linux_arm64 a5f64aaab53d51e311fa3829124c5b703f2d14cf187d8640b6be3b2b49376465'
OFFSITE_KEEP='--keep-daily 7 --keep-weekly 4 --keep-monthly 3'
# offsite_keep: what forget keeps: the admin page's number of latest backups (ADR 161), from offsite-keep.json in the
# front door's data ({"last":N}, 1 to 99), or OFFSITE_KEEP.
offsite_keep() {
  ok_last="$(sed -n 's/^{"last":\([1-9][0-9]\{0,1\}\)}$/\1/p' "$DOOR/data/offsite-keep.json" 2>/dev/null | head -n 1)"
  if [ -n "$ok_last" ]; then printf -- '--keep-last %s' "$ok_last"; else printf '%s' "$OFFSITE_KEEP"; fi
}
# The weekly check reads one of this many parts of the repository's data, the next each week (#1018).
OFFSITE_SUBSETS=20
# An erased account's off-site snapshots stay this many days (#1019): an erase made by mistake can still be restored.
OFFSITE_GRACE_DAYS=14
BORN="$DIR/born"
# The scratch folders of an off-site restore (ADR 159) and of a restore test (#1018), on the machine's disk, each in use
# only under the off-site lock. One a run that was cut off left (the machine restarted, root's step was stopped) holds
# accounts' data, so the next off-site backup removes it once it holds that lock.
OFFSITE_SCRATCH="$DIR/offsite-restore"
RESTORE_TEST_SCRATCH="$DIR/restore-test"
# What of an account's data stays out: its own backups, what a project installs again and what a backup cut off left.
# Its memory database is the consistent copy its server makes (#1015) when it can, as in a set (offsite_run).
OFFSITE_DATA_SKIP='--exclude=./backups --no-anchored --exclude=node_modules --exclude=*.part --anchored'
# A tar's exit 1 (a file changed while it was read) is no failure; restic counts any other exit as one.
OFFSITE_TAR='tar "$@"; s=$?; [ "$s" -le 1 ] || exit "$s"'

# The parts of a set, its computer's volumes and their lock files (A backup set, below). tailscale holds the computer's
# tailnet identity (#1021), so a restored computer stays on the tailnet without a new approval; a restore puts it back
# only with the account's containers stopped, so no other copy of that computer runs with it.
SET_VOLUMES='workspace home browser tailscale'
SET_LOCKS='lock .parentlock parent.lock SingletonLock SingletonSocket SingletonCookie'
# plain_line N: its input as one line of plain text of at most N characters, for update.json.
plain_line() { tr -d '"\\' | tr -c "A-Za-z0-9 .,:;()/_@+='-" ' ' | sed 's/ *$//' | cut -c1-"$1"; }
# account_volume NAME VOLUME: the folder of the account NAME's Docker volume VOLUME (config, workspace, home, browser,
# tailscale).
account_volume() {
  case "$2" in config) av="$1_bot-dot-config" ;; *) av="botdot-$1.account.computer-$2" ;; esac
  printf '%s/%s/.local/share/docker/volumes/%s/_data' "$ACCOUNTS" "$1" "$av"
}
# ns_maps NAME FOLDER: tar's owner and group maps from the machine's IDs of the account NAME to its Docker's own: its
# Linux user is that Docker's root, and its sub-IDs from the first are 1 to 65536 there.
ns_maps() {
  for nm in u g; do
    nm_id="$(id -"$nm" "botdot-$1")"
    nm_sub="$(awk -F: -v u="botdot-$1" '$1 == u { print $2; exit }' "$ETC/sub${nm}id" 2>/dev/null)"
    [ -n "$nm_sub" ] || die "The account $1 has no sub-IDs in $ETC/sub${nm}id."
    awk -v h="$nm_id" -v s="$nm_sub" 'BEGIN { print "+" h " root:0"; for (i = 0; i < 65536; i++) print "+" (s + i) " n:" (i + 1) }' > "$2/${nm}ids"
  done
}

# memory_copy NAME: the account NAME's botdot server asked, on the front door's socket, for a consistent copy of its
# memory.db (#1015) in data/.snapshot/memory.db. The live file can't be copied as it is while the server writes it (its
# WAL changes between the two reads), and under gVisor no lock taken from here holds the server off. Fails when the
# server doesn't run (its memory then stands still, and the file is copied as it is) or is of a version without it.
memory_copy() {
  mc_file="$ACCOUNTS/$1/data/.snapshot/memory.db"
  rm -f -- "$mc_file"
  [ -S "$SOCKETS/$1/botdot.sock" ] || return 1
  curl -fsS -o /dev/null --max-time 600 -X POST -H "X-Botdot-Account: $1" -H 'X-Botdot-Room: 1' -H 'X-Bot-Dot: 1' \
    --unix-socket "$SOCKETS/$1/botdot.sock" http://botdot/api/backups/snapshot </dev/null 2>/dev/null || return 1
  [ -f "$mc_file" ] && [ ! -L "$mc_file" ]
}

# offsite_repo: the off-site repository's address, or nothing. One given as BOT_DOT_OFFSITE_REPO is kept in .env.
offsite_repo() {
  if [ -n "${BOT_DOT_OFFSITE_REPO:-}" ] && [ -f "$ENV" ]; then
    case "$BOT_DOT_OFFSITE_REPO" in *[[:space:]]* | -*) die "BOT_DOT_OFFSITE_REPO isn't a restic repository's address: $BOT_DOT_OFFSITE_REPO" ;; esac
    [ "$(get_env "$ENV" BOT_DOT_OFFSITE_REPO)" = "$BOT_DOT_OFFSITE_REPO" ] || set_env "$ENV" BOT_DOT_OFFSITE_REPO "$BOT_DOT_OFFSITE_REPO"
  fi
  get_env "$ENV" BOT_DOT_OFFSITE_REPO
}
# offsite_said STATE [FIELDS]: status/offsite.json, with the machine's instance, the host its snapshots carry, so that
# whoever restores the machine elsewhere (the console's OFFSITE-RESTORE line 2) knows which ones are its. Read from .env
# each time: a run that stops before offsite_prepare has none in INSTANCE yet, and a restore changes it.
offsite_said() {
  osd_instance="$(get_env "$ENV" BOT_DOT_INSTANCE)"
  case "$osd_instance" in *[!a-z0-9]*) osd_instance='' ;; esac
  write_status offsite.json "{\"state\":\"$1\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"${osd_instance:+,\"instance\":\"$osd_instance\"}${2:+,$2}}"
}
# offsite_last: the last success offsite.json names, as its field after a comma, or nothing.
offsite_last() { sed -n 's/.*\("lastSuccess":"[0-9TZ:-]*"\).*/,\1/p' "$DOOR/status/offsite.json" 2>/dev/null || true; }

# offsite_check: the last weekly check (#1018) as offsite.json's "check" after a comma, or nothing before one.
offsite_check() { [ -s "$OFFSITE/check.json" ] && printf ',"check":%s' "$(cat "$OFFSITE/check.json")" || true; }

# restic_ok FILE: FILE is restic 0.17 or newer, the first with --stdin-from-command.
restic_ok() {
  ro_v="$("$1" version </dev/null 2>/dev/null | sed -n 's/^restic \([0-9][0-9]*\)\.\([0-9][0-9]*\)\..*/\1 \2/p')"
  [ -n "$ro_v" ] || return 1
  # shellcheck disable=SC2086 # two numbers
  set -- $ro_v
  [ "$1" -gt 0 ] || [ "$2" -ge 17 ]
}
# offsite_restic: the restic in RESTIC: the pinned one in BIN, downloaded from restic's releases and checked by its
# sha256 when it isn't there yet; when that can't be, one this machine has, of 0.17 or newer. bunzip2 comes from the system's packages
# when a minimal image has none, and a download that fails is tried again over IPv4, as a fresh VPS's IPv6 route to
# GitHub can be what fails. When neither restic can be had, the error says which step stopped the download.
offsite_restic() {
  RESTIC="$BIN/restic"
  if [ -x "$RESTIC" ] && "$RESTIC" version </dev/null 2>/dev/null | grep -q "^restic $RESTIC_VERSION "; then return 0; fi
  case "$(uname -m)" in x86_64 | amd64) or_arch=linux_amd64 ;; aarch64 | arm64) or_arch=linux_arm64 ;; *) or_arch='' ;; esac
  or_sum="$(printf '%s\n' "$RESTIC_SUMS" | awk -v a="$or_arch" '$1 == a { print $2 }')"
  or_why="there is no restic release for $(uname -m)"
  if [ -n "$or_sum" ] && ! command -v bunzip2 >/dev/null 2>&1; then pkg_add bzip2 -- bzip2 || true; fi
  if [ -n "$or_sum" ] && ! command -v bunzip2 >/dev/null 2>&1; then
    or_why="bunzip2 is missing and the system's packages could not install bzip2 ($(install_hint bzip2 bzip2))"
  elif [ -n "$or_sum" ]; then
    mkdir -p "$BIN"
    chmod 700 "$BIN"
    or_file="$BIN/restic.bz2.new"
    rm -f "$or_file" "$BIN/restic.new"
    or_url="https://github.com/restic/restic/releases/download/v$RESTIC_VERSION/restic_${RESTIC_VERSION}_$or_arch.bz2"
    say "Downloading restic $RESTIC_VERSION…"
    if curl -fsSL --retry 2 --retry-delay 5 --max-time 600 -o "$or_file" "$or_url" </dev/null 2>/dev/null \
      || curl -4 -fsSL --retry 2 --retry-delay 5 --max-time 600 -o "$or_file" "$or_url" </dev/null 2>/dev/null; then
      if [ "$(sha256sum "$or_file" 2>/dev/null | cut -d' ' -f1)" != "$or_sum" ]; then
        or_why="its download did not match its sha256"
      elif bunzip2 -c "$or_file" > "$BIN/restic.new" 2>/dev/null; then
        rm -f "$or_file"
        chmod 700 "$BIN/restic.new"
        mv "$BIN/restic.new" "$RESTIC"
        return 0
      else
        or_why='bunzip2 could not unpack it'
      fi
    else
      or_why='github.com could not be reached, over IPv6 or IPv4'
    fi
    rm -f "$or_file" "$BIN/restic.new"
  fi
  or_own="$(command -v restic 2>/dev/null || true)"
  if [ -n "$or_own" ] && restic_ok "$or_own"; then
    RESTIC="$or_own"
    return 0
  fi
  die "Couldn't download restic $RESTIC_VERSION with its checksum ($or_why), and this machine has no restic of 0.17 or newer."
}
# r ARG…: restic on the off-site repository, signing in with OFFSITE's key, and never asking.
r() {
  RESTIC_REPOSITORY="$OFFSITE_REPO" RESTIC_PASSWORD_FILE="$OFFSITE/password" RESTIC_CACHE_DIR="$OFFSITE/cache" \
    "$RESTIC" -o "sftp.args=-i $OFFSITE/ssh_key -o IdentitiesOnly=yes -o UserKnownHostsFile=$OFFSITE/known_hosts -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ServerAliveInterval=60" "$@" </dev/null
}
# offsite_why FILE…: the last thing restic or tar said of a failure in FILE…, as plain text.
offsite_why() {
  ow_="$(cat "$@" 2>/dev/null | sed -n 's/.*"message_type":"exit_error".*"message":"\([^"]*\)".*/\1/p' | tail -n 1)"
  [ -n "$ow_" ] || ow_="$(cat "$@" 2>/dev/null | grep -v '^{' | grep -v '^[[:space:]]*$' | tail -n 1)"
  printf '%s' "${ow_:-restic stopped without saying why}" | sed "s/$(printf '\033')\[[0-9;]*m//g" | plain_line 200 | sed 's/^ *//'
}

# offsite_prepare [open]: OFFSITE with its password and SSH key, each made once, restic, and the repository, made on its
# first use (format 2). A new password is made at random unless BOT_DOT_OFFSITE_PASSWORD gives one, and is shown once to
# a person who runs this, for a copy off the machine; without that copy the backup can't be read. With open (a restore,
# ADR 159), neither the password nor the repository is made: a machine without them has nothing to restore from.
offsite_prepare() {
  OFFSITE_REPO="$(offsite_repo)"
  [ -n "$OFFSITE_REPO" ] || die "This machine has no off-site repository: name one with BOT_DOT_OFFSITE_REPO (docs/install-linux.md)."
  INSTANCE="$(get_env "$ENV" BOT_DOT_INSTANCE)"
  case "$INSTANCE" in '' | *[!0-9a-f]*) die "This machine has no instance id: run the installer again." ;; esac
  mkdir -p "$OFFSITE/cache"
  chown 0:0 "$OFFSITE" "$OFFSITE/cache"
  chmod 700 "$OFFSITE" "$OFFSITE/cache"
  op_new=''
  [ "${1:-}" != open ] || [ -s "$OFFSITE/password" ] || die "This machine has no password of the off-site repository $OFFSITE_REPO: give it with OFFSITE-SET."
  if [ ! -s "$OFFSITE/password" ]; then
    if [ -n "${BOT_DOT_OFFSITE_PASSWORD:-}" ]; then printf '%s\n' "$BOT_DOT_OFFSITE_PASSWORD" > "$OFFSITE/password.new"
    else od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > "$OFFSITE/password.new"; op_new=1; fi
    chmod 600 "$OFFSITE/password.new"
    mv "$OFFSITE/password.new" "$OFFSITE/password"
  fi
  chmod 600 "$OFFSITE/password"
  offsite_key
  if [ -n "$op_new" ]; then
    if [ -t 1 ]; then
      bold "The off-site repository's password, shown this once: keep a copy off this machine, as without it the backup can't be read"
      say "  $(cat "$OFFSITE/password")"
    else
      warn "A new password for the off-site repository is in $OFFSITE/password: keep a copy off this machine, as without it the backup can't be read."
    fi
  fi
  offsite_restic
  set +e
  r cat config > /dev/null 2> "$OFFSITE/err"
  op_done=$?
  set -e
  case "$op_done" in
    0) ;;
    # 10: there is no repository there yet.
    10) [ "${1:-}" != open ] || die "There is no off-site repository at $OFFSITE_REPO."
      r init --repository-version 2 > /dev/null 2> "$OFFSITE/err" || die "Couldn't make the off-site repository $OFFSITE_REPO: $(offsite_why "$OFFSITE/err")"
      ok "The off-site repository $OFFSITE_REPO is made" ;;
    *) die "Couldn't open the off-site repository $OFFSITE_REPO: $(offsite_why "$OFFSITE/err")" ;;
  esac
  rm -f "$OFFSITE/err"
}
# offsite_key: for an SFTP repository, the SSH key this machine signs in with, made once, its public half said.
offsite_key() {
  case "$OFFSITE_REPO" in sftp:*)
    command -v ssh >/dev/null 2>&1 || die "The off-site backup signs in with SSH, which this machine lacks: $(install_hint openssh-client openssh-clients)"
    if [ ! -s "$OFFSITE/ssh_key" ]; then
      command -v ssh-keygen >/dev/null 2>&1 || die "The off-site backup needs ssh-keygen to make its key: $(install_hint openssh-client openssh-clients)"
      rm -f "$OFFSITE/ssh_key" "$OFFSITE/ssh_key.pub"
      ssh-keygen -q -t ed25519 -N '' -C "botdot-$INSTANCE" -f "$OFFSITE/ssh_key" </dev/null >/dev/null || die "Couldn't make the off-site backup's SSH key."
      op_at="$(printf '%s' "$OFFSITE_REPO" | sed -n 's#^sftp:\(//\)\{0,1\}\([^@/:]*@[^/:]*\).*#\2#p')"
      say "This machine signs in to the off-site repository with a new SSH key, $OFFSITE/ssh_key.pub:"
      say "  $(cat "$OFFSITE/ssh_key.pub")"
      case "$op_at" in *.your-storagebox.de) say "Add it to the Storage Box: cat $OFFSITE/ssh_key.pub | ssh -p 23 $op_at install-ssh-key" ;; esac
    fi
    chmod 600 "$OFFSITE/ssh_key" ;;
  esac
}

# offsite_part PATH PART ACCOUNT COMMAND…: COMMAND's output as the part PATH of the off-site backup, tagged with PART
# and ACCOUNT (none for the machine's own). One that fails is named in OS_FAILED, and the run goes on.
offsite_part() {
  op_path="$1" op_part="$2" op_account="$3"
  shift 3
  offsite_said backing-up "\"started\":\"$OS_STARTED\",\"part\":\"$op_path\"$OS_LAST"
  set +e
  op_born=''
  [ -z "$op_account" ] || op_born=",born=$(account_born "$op_account")"
  r backup --json --quiet --host "$INSTANCE" --tag "instance=$INSTANCE,part=$op_part${op_account:+,account=$op_account}$op_born" \
    --stdin-filename "$op_path" --stdin-from-command -- "$@" > "$OFFSITE/out" 2> "$OFFSITE/err"
  op_done=$?
  set -e
  op_line="$(grep '"message_type":"summary"' "$OFFSITE/out" 2>/dev/null | tail -n 1 || true)"
  op_id="$(printf '%s' "$op_line" | sed -n 's/.*"snapshot_id":"\([0-9a-f]*\)".*/\1/p')"
  op_bytes="$(printf '%s' "$op_line" | sed -n 's/.*"data_added_packed":\([0-9]*\).*/\1/p')"
  if [ "$op_done" = 0 ] && [ -n "$op_id" ]; then
    OS_BYTES=$((OS_BYTES + ${op_bytes:-0}))
    OS_SNAPSHOTS="$OS_SNAPSHOTS${OS_SNAPSHOTS:+,}\"$op_path\":\"$op_id\""
    rm -f "$OFFSITE/out" "$OFFSITE/err"
    return 0
  fi
  op_why="$(offsite_why "$OFFSITE/out" "$OFFSITE/err")"
  rm -f "$OFFSITE/out" "$OFFSITE/err"
  warn "The off-site backup of $op_path failed: $op_why"
  OS_FAILED="$OS_FAILED${OS_FAILED:+,}\"$op_path\""
  [ -n "$OS_ERROR" ] || { OS_ERROR="$op_path: $op_why"; OS_STOPPED="$op_path"; }
}
# account_born NAME: the account NAME's born stamp (UTC, as 20261105T030000Z), made now when it has none.
account_born() {
  [ -s "$BORN/$1" ] || { mkdir -p "$BORN"; chmod 700 "$BORN"; date -u +%Y%m%dT%H%M%SZ > "$BORN/$1"; }
  cat "$BORN/$1"
}
# offsite_erase NAME: the account NAME, erased now, written down for its off-site snapshots' forget, and its born stamp
# gone, so that an account made again under its name gets one of its own. Nothing on a machine without the backup.
offsite_erase() {
  oe_born="$(cat "$BORN/$1" 2>/dev/null || true)"
  rm -f -- "$BORN/$1"
  [ -n "$(get_env "$ENV" BOT_DOT_OFFSITE_REPO)" ] || return 0
  mkdir -p "$OFFSITE"
  chmod 700 "$OFFSITE"
  printf '%s %s %s %s\n' "$1" "${oe_born:--}" "$(date +%s)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OFFSITE/erased"
}
# offsite_ids FILE BORN: the ids in FILE (restic snapshots --json) of the snapshots tagged born=BORN, or with no born
# tag at all (made before born stamps); with BORN -, only those.
offsite_ids() {
  tr -d '\n' < "$1" | grep -o '"tags":\[[^]]*\]\|"id":"[0-9a-f]\{64\}"' | awk -v born="\"born=$2\"" '
    /^"tags"/ { t = $0; next }
    { if (!index(t, "\"born=") || (born != "\"born=-\"" && index(t, born))) print substr($0, 7, 64); t = "" }' || true
}
# offsite_forget_erased: the snapshots of each account erased more than OFFSITE_GRACE_DAYS ago forgotten, and the
# account written in status/offsite-forgotten.json (its last 50); one that fails stays for the next run, and fails this
# one. OS_FORGOT is set when any was forgotten, for the prune that follows.
offsite_forget_erased() {
  [ -s "$OFFSITE/erased" ] || return 0
  of_now="$(date +%s)"
  : > "$OFFSITE/erased.left"
  while read -r of_name of_born of_epoch of_at; do
    valid_account "$of_name" || continue
    case "$of_epoch" in '' | *[!0-9]*) continue ;; esac
    if [ $((of_now - of_epoch)) -lt $((OFFSITE_GRACE_DAYS * 86400)) ]; then
      echo "$of_name $of_born $of_epoch $of_at" >> "$OFFSITE/erased.left"
      continue
    fi
    set +e
    r snapshots --json --host "$INSTANCE" --tag "instance=$INSTANCE,account=$of_name" > "$OFFSITE/out" 2> "$OFFSITE/err"
    of_done=$?
    of_ids=''
    if [ "$of_done" = 0 ]; then
      of_ids="$(offsite_ids "$OFFSITE/out" "$of_born")"
      # shellcheck disable=SC2086 # one id per word
      [ -z "$of_ids" ] || r forget --quiet $of_ids > "$OFFSITE/out" 2> "$OFFSITE/err"
      of_done=$?
    fi
    set -e
    if [ "$of_done" != 0 ]; then
      of_why="$(offsite_why "$OFFSITE/out" "$OFFSITE/err")"
      warn "The off-site snapshots of the erased account $of_name weren't forgotten: $of_why"
      [ -n "$OS_ERROR" ] || { OS_ERROR="forget $of_name: $of_why"; OS_STOPPED=forget; }
      echo "$of_name $of_born $of_epoch $of_at" >> "$OFFSITE/erased.left"
      continue
    fi
    of_count="$(printf '%s' "$of_ids" | grep -c . || true)"
    [ "$of_count" = 0 ] || OS_FORGOT=1
    echo "$of_name $of_born $of_at $(date -u +%Y-%m-%dT%H:%M:%SZ) $of_count" >> "$OFFSITE/forgotten"
    ok "The off-site snapshots of the account $of_name, erased $of_at, are forgotten: $of_count"
  done < "$OFFSITE/erased"
  mv "$OFFSITE/erased.left" "$OFFSITE/erased"
  rm -f "$OFFSITE/out" "$OFFSITE/err"
  [ -s "$OFFSITE/forgotten" ] || return 0
  tail -n 50 "$OFFSITE/forgotten" > "$OFFSITE/forgotten.new"
  mv "$OFFSITE/forgotten.new" "$OFFSITE/forgotten"
  write_status offsite-forgotten.json "{\"forgotten\":[$(awk '{ printf "%s{\"account\":\"%s\",\"erased\":\"%s\",\"at\":\"%s\",\"snapshots\":%d}", (NR > 1 ? "," : ""), $1, $3, $4, $5 }' "$OFFSITE/forgotten")]}"
}
# offsite_tar PATH PART ACCOUNT FOLDER [TAR OPTION…]: FOLDER's contents as the part PATH, a tar as a set's.
offsite_tar() {
  ot_path="$1" ot_part="$2" ot_account="$3" ot_from="$4"
  shift 4
  offsite_part "$ot_path" "$ot_part" "$ot_account" sh -c "$OFFSITE_TAR" tar -C "$ot_from" --numeric-owner "$@" -cf - .
}

# offsite_run: every part, then the manifest, then the snapshots kept, in status/offsite.json as it goes.
offsite_run() {
  OS_STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)" OS_LAST="$(offsite_last)"
  OS_BYTES=0 OS_SNAPSHOTS='' OS_FAILED='' OS_ERROR='' OS_STOPPED='' OS_FORGOT=''
  offsite_said backing-up "\"started\":\"$OS_STARTED\",\"part\":\"check\"$OS_LAST"
  offsite_prepare
  # What a run cut off left: its lock, which restic removes only when it is stale.
  r unlock > /dev/null 2>&1 || true
  say "Backing up this machine to $OFFSITE_REPO"
  offsite_tar front-door/data.tar front-door '' "$DOOR/data"
  os_accounts=''
  for home in "$ACCOUNTS"/*/; do
    n="$(basename "$home")"
    valid_account "$n" && [ -f "$ACCOUNTS/$n/compose.yaml" ] || continue
    os_accounts="$os_accounts${os_accounts:+,}\"$n\""
    maps="$OFFSITE/maps"
    rm -rf -- "$maps"
    mkdir -p "$maps"
    chmod 700 "$maps"
    if ! ( ACCOUNT_WHY=''; ns_maps "$n" "$maps" ) > "$OFFSITE/err" 2>&1; then
      os_why="$(offsite_why "$OFFSITE/err")"
      warn "The account $n wasn't backed up off-site: $os_why"
      OS_FAILED="$OS_FAILED${OS_FAILED:+,}\"accounts/$n\""
      [ -n "$OS_ERROR" ] || { OS_ERROR="accounts/$n: $os_why"; OS_STOPPED="accounts/$n"; }
      continue
    fi
    # Its memory as the set has it: the server's consistent copy in the live file's place, or, when it can't make one,
    # the file as it is.
    if memory_copy "$n"; then os_memory="--exclude=./memory.db --exclude=./memory.db-wal --exclude=./memory.db-shm --transform=s,^\./\.snapshot/memory\.db$,./memory.db,"
    else os_memory='--exclude=./.snapshot'; fi
    # shellcheck disable=SC2086 # options
    offsite_tar "accounts/$n/data.tar" data "$n" "$home/data" "--owner-map=$maps/uids" "--group-map=$maps/gids" --anchored $OFFSITE_DATA_SKIP $os_memory
    rm -f -- "$home/data/.snapshot/memory.db"
    offsite_part "accounts/$n/env" env "$n" cat "$ACCOUNTS/$n/.env"
    for v in config $SET_VOLUMES; do
      [ -d "$(account_volume "$n" "$v")" ] || continue
      skip=''
      [ "$v" != browser ] || for l in $SET_LOCKS; do skip="$skip --exclude=$l"; done
      # shellcheck disable=SC2086 # options
      offsite_tar "accounts/$n/$v.tar" "$v" "$n" "$(account_volume "$n" "$v")" "--owner-map=$maps/uids" "--group-map=$maps/gids" $skip
    done
    rm -rf -- "$maps"
  done
  # The manifest: what a restore from here needs to know of the run, and each part's snapshot.
  printf '{"kind":"botdot-offsite","format":1,"version":"%s","instance":"%s","admin":"%s","at":"%s","accounts":[%s],"snapshots":{%s},"failed":[%s]}\n' \
    "$(version_now)" "$INSTANCE" "$(get_env "$ENV" FRONT_DOOR_ADMIN)" "$OS_STARTED" "$os_accounts" "$OS_SNAPSHOTS" "$OS_FAILED" > "$OFFSITE/manifest.json"
  offsite_part manifest.json manifest '' cat "$OFFSITE/manifest.json"
  rm -f "$OFFSITE/manifest.json"

  # The erased accounts' snapshots forgotten, the snapshots kept, and once a week, or when an erased account's went,
  # what they no longer hold pruned.
  offsite_said backing-up "\"started\":\"$OS_STARTED\",\"part\":\"forget\"$OS_LAST"
  offsite_forget_erased
  os_prune=''
  os_keep="$(offsite_keep)"
  # A new number of backups kept frees its room now, not within the week.
  [ -z "$OS_FORGOT" ] && [ -n "$(find "$OFFSITE/pruned" -mtime -7 2>/dev/null)" ] && [ "$(cat "$OFFSITE/keep" 2>/dev/null || true)" = "$os_keep" ] || os_prune=--prune
  set +e
  # shellcheck disable=SC2086 # options
  r forget --quiet --host "$INSTANCE" $os_keep $os_prune > "$OFFSITE/err" 2>&1
  os_done=$?
  set -e
  if [ "$os_done" = 0 ]; then
    [ -z "$os_prune" ] || { touch "$OFFSITE/pruned"; printf '%s\n' "$os_keep" > "$OFFSITE/keep"; }
  else
    os_why="$(offsite_why "$OFFSITE/err")"
    warn "The off-site backup's old snapshots weren't removed: $os_why"
    [ -n "$OS_ERROR" ] || { OS_ERROR="forget: $os_why"; OS_STOPPED=forget; }
  fi
  rm -f "$OFFSITE/err"

  # Once a week a twentieth of what the repository holds read back and checked (#1018), the next twentieth each week,
  # so that every blob is read within 20 weeks. A check that fails fails the run, as a part does.
  if [ -z "$(find "$OFFSITE/checked" -mtime -7 2>/dev/null)" ]; then
    os_n="$(cat "$OFFSITE/check-next" 2>/dev/null || true)"
    case "$os_n" in '' | *[!0-9]*) os_n=1 ;; esac
    { [ "$os_n" -ge 1 ] && [ "$os_n" -le $OFFSITE_SUBSETS ]; } || os_n=1
    offsite_said backing-up "\"started\":\"$OS_STARTED\",\"part\":\"integrity\"$OS_LAST"
    set +e
    r check --read-data-subset="$os_n/$OFFSITE_SUBSETS" > "$OFFSITE/err" 2>&1
    os_done=$?
    set -e
    os_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    if [ "$os_done" = 0 ]; then
      touch "$OFFSITE/checked"
      echo $((os_n % OFFSITE_SUBSETS + 1)) > "$OFFSITE/check-next"
      printf '{"at":"%s","subset":"%s/%s","ok":true}' "$os_at" "$os_n" "$OFFSITE_SUBSETS" > "$OFFSITE/check.json"
    else
      os_why="$(offsite_why "$OFFSITE/err")"
      warn "The off-site repository's check of $os_n/$OFFSITE_SUBSETS failed: $os_why"
      printf '{"at":"%s","subset":"%s/%s","ok":false,"error":"%s"}' "$os_at" "$os_n" "$OFFSITE_SUBSETS" "$(printf '%s' "$os_why" | plain_line 200)" > "$OFFSITE/check.json"
      [ -n "$OS_ERROR" ] || { OS_ERROR="check $os_n/$OFFSITE_SUBSETS: $os_why"; OS_STOPPED=integrity; }
    fi
    rm -f "$OFFSITE/err"
  fi

  os_finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  os_fields="\"started\":\"$OS_STARTED\",\"finished\":\"$os_finished\",\"bytesAdded\":$OS_BYTES,\"snapshots\":{$OS_SNAPSHOTS},\"failed\":[$OS_FAILED]$(offsite_check)"
  if [ -z "$OS_ERROR" ]; then
    offsite_said done "$os_fields,\"lastSuccess\":\"$os_finished\""
    ok "This machine is backed up to $OFFSITE_REPO"
  else
    offsite_said failed "$os_fields$OS_LAST,\"part\":\"$OS_STOPPED\",\"error\":\"$(printf '%s' "$OS_ERROR" | plain_line 300)\""
    warn "The off-site backup ended with a failure: $OS_ERROR"
  fi
}

# offsite_backup: the off-site backup, run once at a time. One that couldn't start says why in status/offsite.json.
offsite_backup() {
  ob_why="$RUN/offsite-why"
  mkdir -p "$RUN"
  rm -f "$ob_why"
  set +e
  (
    set -e
    umask 077
    ACCOUNT_WHY="$ob_why"
    if command -v flock >/dev/null 2>&1; then
      exec 8>"$RUN/offsite.lock"
      flock -n 8 || { say "An off-site backup runs already."; exit 0; }
      rm -rf -- "$OFFSITE_SCRATCH" "$RESTORE_TEST_SCRATCH"
    fi
    offsite_run
  )
  ob_done=$?
  set -e
  [ "$ob_done" != 0 ] || return 0
  ob_text="$(cut -f2- "$ob_why" 2>/dev/null || true)"
  rm -f "$ob_why"
  ob_part="$(sed -n 's/.*"part":"\([^"]*\)".*/\1/p' "$DOOR/status/offsite.json" 2>/dev/null || true)"
  offsite_said failed "\"finished\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"$(offsite_last),\"part\":\"${ob_part:-check}\",\"error\":\"$(printf '%s' "${ob_text:-The off-site backup stopped without saying why}" | plain_line 300)\""
  warn "The off-site backup didn't run${ob_text:+: $ob_text}"
  return 1
}

# offsite_units: on a machine with an off-site repository, root's step for it every night, at 02:00 and as many minutes
# after as its instance id picks of 120 (botdot-offsite.timer), and one the timer missed, the machine being off, when it
# is on again. On one without, none.
# ---------- the off-site backup set up from the admin page (ADR 161) ----------
#
# The front door made a sub-account of a Hetzner Storage Box for this machine (lib/front-door/storage-box.js) and asks
# with OFFSITE-SET, whose lines are the repository's address, the repository's password (root's alone: one the front
# door wrote is ignored) and the sub-account's password. This step puts this machine's SSH key on the sub-account with
# that password, once (install-ssh-key), and forgets it; keeps the address in .env; opens or makes the repository; and
# starts a run. A new password of the repository is left for the admin page in the front door's data
# (offsite-password.json), which shows it until the admin says it is kept elsewhere. A front door may only name a
# Storage Box's address. How it went is in status/offsite.json: setting-up, then the run's own states, or off with
# setup and the error, the address taken out of .env again.
OFFSITE_SET=OFFSITE-SET
OFFSITE_STORAGE_BOX='sftp://[a-z0-9-]{1,40}@[a-z0-9.-]{1,200}\.your-storagebox\.de:23/botdot'
# offsite_key_on USER@HOST: this machine's public key on the Storage Box sub-account, put there with the password in
# OFFSITE/subpass; tried again for a while, as Hetzner may not have finished making the sub-account.
offsite_key_on() {
  printf '#!/bin/sh\ncat %s\n' "$OFFSITE/subpass" > "$OFFSITE/askpass"
  chmod 700 "$OFFSITE/askpass"
  ko_try=0
  while :; do
    set +e
    SSH_ASKPASS="$OFFSITE/askpass" SSH_ASKPASS_REQUIRE=force DISPLAY="${DISPLAY:-botdot}" ssh -p 23 \
      -o UserKnownHostsFile="$OFFSITE/known_hosts" -o StrictHostKeyChecking=accept-new -o PubkeyAuthentication=no \
      -o PreferredAuthentications=password,keyboard-interactive -o NumberOfPasswordPrompts=1 -o ConnectTimeout=20 \
      "$1" install-ssh-key < "$OFFSITE/ssh_key.pub" > "$OFFSITE/err" 2>&1
    ko_done=$?
    set -e
    [ "$ko_done" != 0 ] || { rm -f "$OFFSITE/err"; ok "This machine's key is on $1"; return 0; }
    ko_try=$((ko_try + 1))
    [ "$ko_try" -lt "${OFFSITE_KEY_TRIES:-6}" ] || break
    sleep "${OFFSITE_KEY_WAIT:-10}"
  done
  die "Couldn't put this machine's key on $1: $(grep -v '^[[:space:]]*$' "$OFFSITE/err" 2>/dev/null | tail -n 1 | plain_line 200)"
}
# offsite_set REQUEST: the off-site backup set up as the request REQUEST asks, which is removed as it is read.
offsite_set() {
  os_root=''
  ! by_root "$1" || os_root=1
  os_repo="$(sed -n 1p "$1" | tr -d '\r')"
  os_pass="$(sed -n 2p "$1" | tr -d '\r')"
  os_sub="$(sed -n 3p "$1" | tr -d '\r')"
  rm -f -- "$1"
  [ -n "$os_root" ] || os_pass=''
  if [ -z "$os_root" ] && ! printf '%s' "$os_repo" | grep -Eqx "$OFFSITE_STORAGE_BOX"; then
    offsite_said off '"setup":true,"error":"Only a Hetzner Storage Box is set up from the admin page."'
    warn "An off-site setup the front door asked for named no Storage Box, so it was refused."
    return 0
  fi
  case "$os_repo" in '' | *[[:space:]]* | -*)
    offsite_said off '"setup":true,"error":"The request named no repository."'
    return 0 ;;
  esac
  offsite_said setting-up
  os_before="$(get_env "$ENV" BOT_DOT_OFFSITE_REPO)"
  os_had="$( [ -s "$OFFSITE/password" ] && echo 1 || true)"
  os_why="$RUN/offsite-why"
  mkdir -p "$RUN"
  rm -f "$os_why"
  set +e
  (
    set -e
    umask 077
    ACCOUNT_WHY="$os_why"
    mkdir -p "$OFFSITE"
    chmod 700 "$OFFSITE"
    [ -z "$os_pass" ] || [ -n "$os_had" ] || { printf '%s\n' "$os_pass" > "$OFFSITE/password"; chmod 600 "$OFFSITE/password"; }
    set_env "$ENV" BOT_DOT_OFFSITE_REPO "$os_repo"
    OFFSITE_REPO="$os_repo"
    INSTANCE="$(get_env "$ENV" BOT_DOT_INSTANCE)"
    offsite_key
    if [ -n "$os_sub" ]; then
      printf '%s\n' "$os_sub" > "$OFFSITE/subpass"
      chmod 600 "$OFFSITE/subpass"
      offsite_key_on "$(printf '%s' "$os_repo" | sed -n 's#^sftp:\(//\)\{0,1\}\([^@/:]*@[^/:]*\).*#\2#p')"
    fi
    offsite_prepare
    if [ -z "$os_had" ] && [ -z "$os_pass" ]; then
      os_data="$DOOR/data"
      printf '{"password":"%s","at":"%s"}\n' "$(cat "$OFFSITE/password")" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$os_data/offsite-password.json.new"
      chown "$(stat -c %u:%g "$os_data")" "$os_data/offsite-password.json.new"
      chmod 600 "$os_data/offsite-password.json.new"
      mv "$os_data/offsite-password.json.new" "$os_data/offsite-password.json"
    fi
  ) </dev/null
  os_done=$?
  set -e
  rm -f "$OFFSITE/subpass" "$OFFSITE/askpass"
  if [ "$os_done" = 0 ]; then
    ok "The off-site backup is set up: $os_repo"
    offsite_start
    return 0
  fi
  os_text="$(cut -f2- "$os_why" 2>/dev/null || true)"
  rm -f "$os_why"
  if [ -n "$os_before" ]; then set_env "$ENV" BOT_DOT_OFFSITE_REPO "$os_before"
  else { grep -v '^BOT_DOT_OFFSITE_REPO=' "$ENV" || true; } > "$ENV.tmp"; mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"; fi
  # A password made for a repository that was never opened is no one's: the next setup makes and shows its own.
  [ -n "$os_had" ] || rm -f "$OFFSITE/password"
  offsite_said off "\"setup\":true,\"error\":\"$(printf '%s' "${os_text:-The off-site setup stopped without saying why}" | plain_line 300)\""
  warn "The off-site backup wasn't set up${os_text:+: $os_text}"
}
# offsite_start: a run now, of its own, which systemd starts (the timer's own run isn't started twice); without
# systemd, in the background.
offsite_start() {
  if [ -n "$SYSTEMD" ]; then
    offsite_units
    systemctl start --no-block botdot-offsite.service </dev/null || warn "systemd didn't start the off-site backup. See: systemctl status botdot-offsite.service"
    say "The off-site backup started: see status/offsite.json, or journalctl -u botdot-offsite"
  else
    nohup env BOT_DOT_DIR="$DIR" BOT_DOT_RUN="$RUN" BOT_DOT_ETC="$ETC" sh "$BIN/install.sh" --offsite >> "$DIR/offsite.log" 2>&1 </dev/null 9>&- &
    say "The off-site backup started in the background: see status/offsite.json, or $DIR/offsite.log"
  fi
}

offsite_units() {
  [ -n "$SYSTEMD" ] || return 0
  if [ -z "$(offsite_repo)" ]; then
    [ -f "$ETC/systemd/system/botdot-offsite.timer" ] || return 0
    systemctl disable --now botdot-offsite.timer </dev/null >/dev/null 2>&1 || true
    rm -f "$ETC/systemd/system/botdot-offsite.timer" "$ETC/systemd/system/botdot-offsite.service"
    systemctl daemon-reload </dev/null || true
    return 0
  fi
  ou_id="$(get_env "$ENV" BOT_DOT_INSTANCE)"
  case "$ou_id" in '' | *[!0-9a-f]*) ou_id=0 ;; esac
  ou_minute=$((0x$ou_id % 120))
  ou_at="$(printf '%02d:%02d' $((2 + ou_minute / 60)) $((ou_minute % 60)))"
  cat > "$ETC/systemd/system/botdot-offsite.timer.new" <<UNIT
# botdot (install.sh): every night, this machine's backup to its off-site repository (#1016, ADR 157).
[Unit]
Description=botdot: back this machine up off-site

[Timer]
OnCalendar=*-*-* $ou_at:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT
  cat > "$ETC/systemd/system/botdot-offsite.service.new" <<UNIT
# botdot (install.sh): root's step backs this machine up to the off-site repository BOT_DOT_OFFSITE_REPO names in
# $ENV, and says how it went in $DOOR/status/offsite.json.
[Unit]
Description=botdot: back this machine up off-site
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Nice=10
IOSchedulingClass=idle
Environment=BOT_DOT_DIR=$DIR BOT_DOT_RUN=$RUN BOT_DOT_ETC=$ETC
ExecStart=/bin/sh $BIN/install.sh --offsite
UNIT
  for unit in botdot-offsite.timer botdot-offsite.service; do
    mv "$ETC/systemd/system/$unit.new" "$ETC/systemd/system/$unit"
  done
  systemctl daemon-reload </dev/null
  systemctl enable --now botdot-offsite.timer </dev/null >/dev/null 2>&1 || warn "systemd didn't start botdot-offsite.timer, so this machine isn't backed up off-site every night. See: systemctl status botdot-offsite.timer"
}

# A restore drill (#1018): `install.sh --restore-test ACCOUNT` restores the account's parts of the latest off-site
# backup (its newest manifest's snapshots) into a scratch folder in BOT_DOT_DIR, checks each part's size against what
# restic recorded (restic checks every blob's hash as it reads it) and that each tar reads to its end, opens the
# memory database (its SQLite header, and with sqlite3 its quick check) and counts the bots in bots.json, then removes
# the folder. One that would leave the disk with less than OFFSITE_TEST_ROOM free is refused, saying what it needs.
# How it went is in status/restore-test.json: state (testing, passed, failed or refused), at, account, snapshot (the
# manifest's), bytes, bots, and error; a failed one counts as a failed backup for the admin's warning (#1017).
OFFSITE_TEST_ROOM=$((512 * 1024 * 1024))
# rt_gb BYTES: BYTES in GB, with one decimal.
rt_gb() { awk -v b="$1" 'BEGIN { printf "%.1f GB", b / 1073741824 }'; }
restore_test_said() { write_status restore-test.json "{\"state\":\"$1\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"${RESTORE_TEST:+,\"account\":\"$RESTORE_TEST\"}${2:+,$2}}"; }
# json_count_top FILE: how many objects the JSON array in FILE holds at its top (strings with braces in them counted
# right), or nothing for a file that isn't one.
json_count_top() {
  awk '
    { for (i = 1; i <= length($0); i++) { c = substr($0, i, 1)
        if (esc) { esc = 0; continue }
        if (str) { if (c == "\\") esc = 1; else if (c == "\"") str = 0; continue }
        if (c == "\"") str = 1
        else if (c == "[" || c == "{") { if (depth == 1 && c == "{") n++; if (depth == 0 && c == "[") arr = 1; depth++ }
        else if (c == "]" || c == "}") depth--
      } }
    END { if (arr && depth == 0) print n + 0 }' "$1" 2>/dev/null
}
offsite_restore_test() {
  restore_test_said testing
  # open: a test reads the repository, and never makes it or a password nobody is shown (root's step has no one).
  offsite_prepare open
  rt_dir="$RESTORE_TEST_SCRATCH"
  rm -rf -- "$rt_dir"
  mkdir -p "$rt_dir"
  chmod 700 "$rt_dir"
  # shellcheck disable=SC2064 # the folder now
  trap "rm -rf -- '$rt_dir'" EXIT
  # The newest manifest, and the account's parts it names.
  r snapshots --json --host "$INSTANCE" --tag part=manifest --latest 1 > "$rt_dir/snapshots" 2> "$rt_dir/err" \
    || die "Couldn't list the off-site backups: $(offsite_why "$rt_dir/err")"
  rt_manifest="$(grep -o '"id":"[0-9a-f]\{64\}"' "$rt_dir/snapshots" | tail -n 1 | cut -d'"' -f4)"
  [ -n "$rt_manifest" ] || die "The off-site repository holds no finished backup of this machine yet."
  r dump "$rt_manifest" manifest.json > "$rt_dir/manifest.json" 2> "$rt_dir/err" || die "Couldn't read the latest backup's manifest: $(offsite_why "$rt_dir/err")"
  rt_parts="$(grep -o "\"accounts/$RESTORE_TEST/[a-z]*\(\.tar\)\{0,1\}\":\"[0-9a-f]\{64\}\"" "$rt_dir/manifest.json" | tr -d '"' || true)"
  printf '%s\n' "$rt_parts" | grep -q "^accounts/$RESTORE_TEST/data.tar:" || die "The latest off-site backup holds no data of the account $RESTORE_TEST."
  # Its size, before anything is restored.
  rt_need=0
  for rt_p in $rt_parts; do
    r stats --json --mode restore-size "${rt_p#*:}" > "$rt_dir/stats" 2> "$rt_dir/err" || die "Couldn't read the size of ${rt_p%%:*}: $(offsite_why "$rt_dir/err")"
    rt_size="$(sed -n 's/.*"total_size":\([0-9][0-9]*\).*/\1/p' "$rt_dir/stats")"
    # A size it can't read is no size: counted as none, the room would be checked for less than is restored.
    [ -n "$rt_size" ] || die "Couldn't read the size of ${rt_p%%:*}: restic said no total_size."
    rt_need=$((rt_need + rt_size))
    printf '%s %s\n' "${rt_p%%:*}" "$rt_size" >> "$rt_dir/sizes"
  done
  rt_free=$(($(df -Pk "$DIR" | awk 'NR == 2 { print $4 }') * 1024))
  if [ $((rt_need + OFFSITE_TEST_ROOM)) -gt "$rt_free" ]; then
    restore_test_said refused "\"bytes\":$rt_need,\"error\":\"It needs $(rt_gb $((rt_need + OFFSITE_TEST_ROOM))) free in $DIR and has $(rt_gb "$rt_free").\""
    die "The restore test of $RESTORE_TEST needs $(rt_gb $((rt_need + OFFSITE_TEST_ROOM))) free in $DIR (its parts and 512 MB to spare), and it has $(rt_gb "$rt_free")."
  fi
  say "Restoring $RESTORE_TEST from the off-site backup into $rt_dir to test it"
  while read -r rt_path rt_size; do
    rt_id="$(printf '%s\n' "$rt_parts" | grep "^$rt_path:" | cut -d: -f2)"
    mkdir -p "$rt_dir/$(dirname "$rt_path")"
    r dump "$rt_id" "$rt_path" > "$rt_dir/$rt_path" 2> "$rt_dir/err" || die "Couldn't restore $rt_path: $(offsite_why "$rt_dir/err")"
    rt_got="$(wc -c < "$rt_dir/$rt_path" | tr -d ' ')"
    [ "$rt_got" = "$rt_size" ] || die "$rt_path came back with $rt_got bytes, and restic recorded $rt_size."
    case "$rt_path" in *.tar) tar -tf "$rt_dir/$rt_path" > /dev/null 2> "$rt_dir/err" || die "$rt_path doesn't read to its end: $(offsite_why "$rt_dir/err")" ;; esac
  done < "$rt_dir/sizes"
  mkdir -p "$rt_dir/data"
  tar -xf "$rt_dir/accounts/$RESTORE_TEST/data.tar" -C "$rt_dir/data" ./memory.db ./bots.json 2> "$rt_dir/err" || die "The account's data holds no memory.db or bots.json: $(offsite_why "$rt_dir/err")"
  [ "$(head -c 15 "$rt_dir/data/memory.db")" = "SQLite format 3" ] || die "The account's memory.db isn't an SQLite database."
  if command -v sqlite3 >/dev/null 2>&1; then
    rt_q="$(sqlite3 "$rt_dir/data/memory.db" 'PRAGMA quick_check' 2>&1 | head -n 1)"
    [ "$rt_q" = ok ] || die "The account's memory.db failed its check: $rt_q"
  fi
  rt_bots="$(json_count_top "$rt_dir/data/bots.json")"
  [ -n "$rt_bots" ] || die "The account's bots.json isn't a list."
  restore_test_said passed "\"snapshot\":\"$rt_manifest\",\"bytes\":$rt_need,\"bots\":$rt_bots"
  ok "The restore test of $RESTORE_TEST passed: $rt_bots bots, $(awk -v b="$rt_need" 'BEGIN { printf "%.1f GB", b / 1073741824 }') read back"
}

# restore_test: the restore test of the account RESTORE_TEST, run once at a time with the off-site backup, from the
# command line or from root's RESTORE-TEST request. One that fails, or is refused, says why in restore-test.json and
# in RT_TEXT, which is empty after one that passed. It returns 0 either way and is called on its own, never with || or
# in an if: there set -e would be off in its subshell too, and the test would go on past a step that failed.
restore_test() {
  rt_why="$RUN/restore-test-why"
  mkdir -p "$RUN"
  rm -f "$rt_why"
  set +e
  (
    set -e
    umask 077
    ACCOUNT_WHY="$rt_why"
    # One at a time with the nightly backup: both use the repository's lock and the same cache. A test asked while a
    # backup runs is refused, not failed: the backup is not at fault.
    if command -v flock >/dev/null 2>&1; then
      exec 8>"$RUN/offsite.lock"
      if ! flock -n 8; then
        restore_test_said refused '"error":"An off-site backup runs now: test the restore when it is done."'
        die "An off-site backup runs now: test the restore when it is done."
      fi
    fi
    offsite_restore_test
  )
  rt_done=$?
  set -e
  RT_TEXT=''
  [ "$rt_done" != 0 ] || return 0
  RT_TEXT="$(cut -f2- "$rt_why" 2>/dev/null || true)"
  RT_TEXT="${RT_TEXT:-The restore test stopped without saying why}"
  rm -f "$rt_why"
  if ! grep -q '"state":"refused"' "$DOOR/status/restore-test.json" 2>/dev/null; then
    restore_test_said failed "\"error\":\"$(printf '%s' "$RT_TEXT" | plain_line 300)\""
  fi
}

if [ "$MODE" = restore-test ]; then
  [ "$(id -u)" = 0 ] || die "The restore test reads the off-site repository with root's key, so it runs as root. Run it with: sudo sh $BIN/install.sh --restore-test <account>"
  [ -f "$ENV" ] || die "botdot isn't installed here ($ENV is missing)."
  valid_account "$RESTORE_TEST" || die "Name the account to test the restore of: sudo sh $BIN/install.sh --restore-test <account>"
  restore_test
  [ -z "$RT_TEXT" ] || die "$RT_TEXT"
  exit 0
fi

if [ "$MODE" = offsite ]; then
  [ "$(id -u)" = 0 ] || die "The off-site backup reads every account's files, so it runs as root. Run it with: sudo sh $BIN/install.sh --offsite"
  [ -f "$ENV" ] || die "botdot isn't installed here ($ENV is missing)."
  offsite_units
  # On its own, not with ||, which would turn set -e off in the backup's subshell too: one that fails exits 1 here.
  offsite_backup
  exit 0
fi

# account_pids NAME [COMMAND]: the processes of the account NAME's Linux user and of its subordinate users (its
# containers' users), or only those named COMMAND, from /proc (a machine without procps has it too).
account_pids() {
  u="$(id -u "botdot-$1" 2>/dev/null || echo -1)"
  s="$(awk -F: -v u="botdot-$1" '$1 == u { print $2; exit }' "$ETC/subuid" 2>/dev/null || true)"
  cat "$PROC"/[0-9]*/status 2>/dev/null | awk -v u="$u" -v s="${s:--1}" -v c="${2:-}" '
    /^Name:/ { n = $2 } /^State:/ { z = ($2 == "Z") } /^Pid:/ { p = $2 }
    /^Uid:/ { if (!z && (c == "" || n == c) && (($2 == u && u >= 0) || (s >= 0 && $2 >= s && $2 < s + 65536))) print p }'
}

# stop_account NAME: the account NAME's rootless Docker stops, and its botdot server, docker-helper and bots' computers
# with it (Docker stops its containers as it ends, and starts again the ones it should when it starts). Nothing of the
# account runs, and it doesn't start with the machine. Its data, containers and Linux user stay.
stop_account() {
  if [ -n "$SYSTEMD" ]; then systemctl disable --now "botdot-account@$1" </dev/null >/dev/null 2>&1 || true
  else
    # shellcheck disable=SC2046 # one process id per word
    kill -TERM $(account_pids "$1" dockerd) 2>/dev/null || true
  fi
  i=0
  while [ -n "$(account_pids "$1")" ]; do
    i=$((i + 1))
    # shellcheck disable=SC2046
    [ "$i" != 30 ] || kill -TERM $(account_pids "$1") 2>/dev/null || true
    # shellcheck disable=SC2046
    [ "$i" != 60 ] || kill -KILL $(account_pids "$1") 2>/dev/null || true
    [ "$i" -lt 75 ] || die "The account $1 didn't stop; still running: $(account_pids "$1" | tr '\n' ' ')"
    sleep 1
  done
  # As systemd does with the unit's runtime folder: the next start begins clean.
  [ -n "$SYSTEMD" ] || rm -rf -- "${RUN:?}/$1"
}

# remove_account NAME: everything of the account NAME goes from the machine: its processes; its containers, images and
# volumes (in its rootless Docker's folder, in its home) and its data, both in its home, and its disk; its socket
# folder and its Docker's runtime folder; its share on its unit; its Linux user and group, and its subordinate IDs.
remove_account() {
  user="botdot-$1"
  stop_account "$1"
  [ -z "$SYSTEMD" ] || systemctl reset-failed "botdot-account@$1" </dev/null >/dev/null 2>&1 || true
  # Whatever its rootless Docker left mounted in its folders, deepest first.
  for f in "$ACCOUNTS/$1" "$RUN/$1"; do
    awk -v f="$f" '$2 == f || index($2, f "/") == 1 { print $2 }' "$PROC/mounts" 2>/dev/null | sort -r | while IFS= read -r m; do umount -l "$m" 2>/dev/null || true; done
  done
  rm -rf -- "${ACCOUNTS:?}/$1" "${SOCKETS:?}/$1" "${RUN:?}/$1" "${RUN:?}/load/$1" "${DISKS:?}/$1.img" "${LOAD:?}/account-$1.json" "${DOOR:?}/status/account-$1.json"
  rm -rf -- "$ETC/systemd/system.control/botdot-account@$1.service.d"
  [ -z "$SYSTEMD" ] || systemctl daemon-reload </dev/null || true
  if id -u "$user" >/dev/null 2>&1; then userdel "$user" </dev/null || die "Couldn't remove the Linux user $user."; fi
  rm -f "/var/mail/$user" "/var/spool/mail/$user"
  for map in subuid subgid; do
    if grep -q "^$user:" "$ETC/$map" 2>/dev/null; then
      grep -v "^$user:" "$ETC/$map" > "$ETC/$map.new" || true
      cat "$ETC/$map.new" > "$ETC/$map"
      rm -f "$ETC/$map.new"
    fi
  done
  ok "The account $1 is erased: its data, containers and Linux user"
}
# erase_account NAME: the account NAME removed, as the admin deleted it. Never the admin's own account.
erase_account() {
  [ "$1" != "$(get_env "$ENV" FRONT_DOOR_ADMIN)" ] || die "The account $1 is the admin's own, so it wasn't erased."
  remove_account "$1"
  # Its off-site snapshots go after the grace period (#1019), and its part of the backup set at once.
  offsite_erase "$1"
  set_drop "$1"
  # Its user's UID leaves a managed machine's guard of its computers (#984), so that no later user inherits its rules.
  [ -z "$GUARD" ] || [ ! -f "$BIN/egress.sh" ] || sh "$BIN/egress.sh" </dev/null || warn "Couldn't rebuild the firewall of the accounts' computers; the next account made rebuilds it."
}

# ---------------------------------------------------------------------------------------------
# Uninstall (#76)
#
# Everything the installer made goes from the machine, and nothing else: the front door (its containers and volumes in
# the machine's Docker, and its user; its images stay, as the installer removes none by name), every account (remove_account), root's step and the
# accounts' units, the AppArmor profile, Tailscale Serve's setting that passes to the front door, and botdot's own
# files in BOT_DOT_DIR. A Linux user is an account's only when it is botdot-<account> with the account's folder as its
# home. Docker and Tailscale stay; the packages the installer may have installed go only when asked once more.

# The units the installer writes, the files and folders it keeps in BOT_DOT_DIR, and the packages it may have installed
# for the accounts (step 1), beside gVisor's apt source.
UNITS="botdot-computers.service botdot-computers.timer botdot-account@.service botdot-accounts.path botdot-accounts.service botdot-load.timer botdot-load.service botdot-local-firewall.service botdot-egress.service botdot-offsite.timer botdot-offsite.service"
OWN="front-door accounts sockets disks bin backup offsite update.log requests.log computer-preparation computer-preparation.log demo-seeded"
PACKAGES="runsc docker-ce-rootless-extras"

# installed_accounts: each account this machine has: its folder, its socket folder, its disk or its Linux user.
installed_accounts() {
  {
    for f in "$ACCOUNTS"/*/ "$SOCKETS"/*/; do [ ! -d "$f" ] || basename "$f"; done
    for f in "$DISKS"/*.img; do [ ! -f "$f" ] || basename "$f" .img; done
    awk -F: -v h="$ACCOUNTS/" 'index($1, "botdot-") == 1 && $6 == h substr($1, 8) { print substr($1, 8) }' "$ETC/passwd" 2>/dev/null || true
  } | sort -u | while IFS= read -r n; do if valid_account "$n"; then printf '%s\n' "$n"; fi; done
}

if [ "$MODE" = uninstall ]; then
  [ "$(id -u)" = 0 ] || die "The uninstaller removes botdot's Linux users, so it runs as root. Run it with: sudo sh install.sh --uninstall"
  bold "botdot uninstaller"
  say ""

  # What of botdot is on this machine.
  D=''
  if command -v docker >/dev/null 2>&1 && docker info </dev/null >/dev/null 2>&1; then D=docker; fi
  NAMES="$(installed_accounts)"
  door=''
  if [ -f "$DOOR/compose.yaml" ] || id -u "$DOOR_USER" >/dev/null 2>&1; then door=1; fi
  units=''
  for u in $UNITS; do [ ! -f "$ETC/systemd/system/$u" ] || units="$units${units:+, }$u"; done
  shares=''
  for f in "$ETC"/systemd/system.control/botdot-account@*.service.d; do [ ! -e "$f" ] || shares=1; done
  profile=''
  if grep -qs '^# botdot (install.sh)' "$ETC/apparmor.d/botdot-rootlesskit"; then profile=1; fi
  serve=''
  if command -v tailscale >/dev/null 2>&1 && tailscale serve status </dev/null 2>/dev/null | grep -Eq "127\.0\.0\.1:$DOOR_PORT([^0-9]|$)"; then serve=1; fi
  sites_serve=''
  if command -v tailscale >/dev/null 2>&1 && tailscale serve status </dev/null 2>/dev/null | grep -Eq "127\.0\.0\.1:$SITES_PORT([^0-9]|$)"; then sites_serve=1; fi
  here=''
  for f in $OWN; do [ ! -e "$DIR/$f" ] || here=1; done
  pkgs=''
  if [ "$(pkg_manager)" = dnf ]; then
    for p in $PACKAGES; do if rpm -q "$p" </dev/null >/dev/null 2>&1; then pkgs="$pkgs $p"; fi; done
  elif command -v dpkg-query >/dev/null 2>&1; then
    for p in $PACKAGES; do
      # shellcheck disable=SC2016 # dpkg-query's own field
      case "$(dpkg-query -W --showformat='${Status}' "$p" </dev/null 2>/dev/null || true)" in 'install ok installed') pkgs="$pkgs $p" ;; esac
    done
  fi
  gvisor=''
  [ ! -f "$ETC/apt/sources.list.d/gvisor.list" ] || gvisor=1
  # gVisor's files, when install_runsc put them there.
  gvisor_files=''
  [ ! -f "$GVISOR_MARK" ] || gvisor_files="$(grep -E '^/.*/(runsc|gvisor-bin)$' "$GVISOR_MARK" | tr '\n' ' ' | sed 's/ *$//')"
  found="$NAMES$door$units$profile$serve$here"

  # What goes, and a typed yes.
  if [ -z "$found" ]; then ok "Nothing of botdot is on this machine."
  else
    say "This removes botdot from this machine for good:"
    [ -z "$door" ] || say "  - the front door: its containers and volumes in this machine's Docker, and its Linux user $DOOR_USER"
    for n in $NAMES; do say "  - the account $n: its botdot server, its bots' computers, its rootless Docker, its Linux user botdot-$n, its disk and its data"; done
    [ -z "$units" ] || say "  - botdot's systemd units: $units${shares:+, and the accounts' shares}"
    [ -z "$profile" ] || say "  - the AppArmor profile botdot-rootlesskit"
    [ -z "$serve$sites_serve" ] || say "  - Tailscale Serve's setting for botdot"
    [ -z "$here" ] || say "  - $DIR: every account's bots, chats, memory, vault and backups, and the passkeys"
    say "Docker and Tailscale stay. This can't be undone."
    if [ "${BOT_DOT_YES:-}" != 1 ]; then
      say ""
      printf 'Type yes to remove all of it: '
      read_line
      [ "$REPLY" = yes ] || die "Nothing was removed."
    fi
  fi
  # The packages, asked apart: they may have been on the machine before botdot.
  remove_packages=''
  if [ -n "$pkgs$gvisor$gvisor_files" ]; then
    list=''
    for p in $pkgs; do list="$list${list:+, }$p"; done
    [ -z "$gvisor" ] || list="$list${list:+ and }gVisor's apt source"
    [ -z "$gvisor_files" ] || list="$list${list:+ and }gVisor's runsc in $LOCAL_BIN"
    say ""
    say "botdot's installer may have installed these: $list."
    if [ "${BOT_DOT_YES:-}" = 1 ]; then
      if [ "$(pkg_manager)" = dnf ]; then how="${pkgs:+sudo rpm -e$pkgs}"; else how="${pkgs:+sudo apt-get remove$pkgs}"; fi
      [ -z "$gvisor" ] || how="$how${how:+ && }sudo rm $ETC/apt/sources.list.d/gvisor.list $ETC/apt/keyrings/gvisor.gpg"
      [ -z "$gvisor_files" ] || how="$how${how:+ && }sudo rm -r $gvisor_files $GVISOR_MARK"
      say "The packages stay. Remove them yourself with: $how"
    elif ask "Remove them too? Docker itself and Tailscale stay." n; then remove_packages=1
    fi
  fi

  # What couldn't be removed, said at the end.
  LEFT='' failed=''
  left() { LEFT="$LEFT
  - $1"; }
  if [ -n "$found" ]; then
    say ""
    # Root's step first, so that it makes nothing again meanwhile.
    if [ -n "$SYSTEMD" ]; then
      systemctl disable --now botdot-computers.timer botdot-computers.service </dev/null >/dev/null 2>&1 || true
      systemctl disable --now botdot-accounts.path botdot-load.timer botdot-offsite.timer </dev/null >/dev/null 2>&1 || true
      systemctl stop botdot-accounts.service botdot-load.service botdot-offsite.service </dev/null >/dev/null 2>&1 || true
      if [ -f "$ETC/systemd/system/botdot-local-firewall.service" ]; then
        systemctl disable --now botdot-local-firewall </dev/null >/dev/null 2>&1 || true
        iptables -D OUTPUT -j BOTDOT-LOCAL 2>/dev/null || true
      fi
    elif [ -f "$RUN/requests.pid" ]; then
      pid="$(cat "$RUN/requests.pid")"
      case "$(tr '\0' ' ' < "$PROC/$pid/cmdline" 2>/dev/null || true)" in *"$BIN/install.sh"*) kill "$pid" 2>/dev/null || true ;; esac
    fi
    if [ -f "$DOOR/compose.yaml" ] && [ -z "$D" ]; then left "the front door's containers: Docker isn't running"
    elif [ -f "$DOOR/compose.yaml" ]; then
      if $D compose --project-directory "$DOOR" down -v --remove-orphans </dev/null >/dev/null 2>&1; then ok "The front door is removed"
      else left "the front door's containers (see: cd $DOOR && sudo docker compose ps -a)"; fi
    fi
    for n in $NAMES; do
      set +e
      ( set -e; remove_account "$n" )
      gone=$?
      set -e
      [ "$gone" = 0 ] || { left "the account $n (see above)"; failed=1; }
    done
    # A managed machine's guard of its computers (#984), once no account runs: each account's unit requires it.
    if [ -f "$ETC/systemd/system/botdot-egress.service" ] || [ -f "$BIN/egress.sh" ]; then
      [ -z "$SYSTEMD" ] || systemctl disable --now botdot-egress </dev/null >/dev/null 2>&1 || true
      for t in iptables ip6tables; do
        $t -D OUTPUT -j BOTDOT-EGRESS 2>/dev/null || true
        for c in BOTDOT-EGRESS BOTDOT-GUARD; do $t -F "$c" 2>/dev/null || true; done
        for c in BOTDOT-EGRESS BOTDOT-GUARD; do $t -X "$c" 2>/dev/null || true; done
      done
    fi
    if id -u "$DOOR_USER" >/dev/null 2>&1; then userdel "$DOOR_USER" </dev/null || left "the Linux user $DOOR_USER"; fi
    for u in $UNITS; do rm -f -- "$ETC/systemd/system/$u"; done
    rm -rf -- "$ETC"/systemd/system.control/botdot-account@*.service.d "$ETC"/systemd/system/*.wants/botdot-*
    if [ -n "$SYSTEMD" ]; then
      systemctl daemon-reload </dev/null || true
      systemctl reset-failed 'botdot-*' </dev/null >/dev/null 2>&1 || true
    fi
    if [ -n "$profile" ]; then
      if command -v apparmor_parser >/dev/null 2>&1; then apparmor_parser -R "$ETC/apparmor.d/botdot-rootlesskit" </dev/null >/dev/null 2>&1 || true; fi
      rm -f -- "$ETC/apparmor.d/botdot-rootlesskit"
    fi
    # Docker stays, with its updates as the machine had them before (docker_upgrades).
    rm -f -- "$ETC/apt/apt.conf.d/51botdot-docker" "$ETC/apt/preferences.d/botdot-docker"
    if [ -n "$serve" ]; then tailscale serve --https=443 off </dev/null >/dev/null 2>&1 || left "Tailscale Serve's setting for botdot: sudo tailscale serve --https=443 off"; fi
    if [ -n "$sites_serve" ]; then tailscale serve --https=$SITES_HTTPS off </dev/null >/dev/null 2>&1 || left "Tailscale Serve's setting for botdot's interactive pages: sudo tailscale serve --https=$SITES_HTTPS off"; fi
    if [ -n "$failed" ]; then left "$DIR, as an account in it wasn't removed: run the uninstaller again"
    elif [ -n "$here" ]; then
      # Whatever is still mounted in it, deepest first.
      awk -v f="$DIR" 'index($2, f "/") == 1 { print $2 }' "$PROC/mounts" 2>/dev/null | sort -r | while IFS= read -r m; do umount -l "$m" 2>/dev/null || true; done
      for f in $OWN; do rm -rf -- "${DIR:?}/$f"; done
      rest="$(ls -A "$DIR" 2>/dev/null | tr '\n' ' ' | sed 's/ $//')"
      if [ -n "$rest" ]; then left "$DIR, which holds files botdot didn't make: $rest"
      # A disk of its own mounted there stays mounted, and empty.
      elif mountpoint -q "$DIR" 2>/dev/null; then ok "$DIR is empty; the folder stays, as a disk is mounted there"
      elif rmdir -- "$DIR"; then ok "$DIR is removed"
      else left "$DIR"; fi
    fi
    [ -n "$failed" ] || rm -rf -- "${RUN:?}"
  fi
  if [ -n "$remove_packages" ] && [ "$(pkg_manager)" = dnf ]; then
    # rpm -e removes only what was named, and refuses while another package needs it.
    # shellcheck disable=SC2086 # one package per word
    if [ -n "$pkgs" ]; then if rpm -e $pkgs </dev/null; then ok "Removed the packages$pkgs"; else left "the packages$pkgs: other packages need them"; fi; fi
  elif [ -n "$remove_packages" ]; then
    # Only what was named: apt-get would also take what depends on it, and Docker itself never goes.
    # shellcheck disable=SC2086 # one package per word
    more="$( [ -z "$pkgs" ] || apt-get -s remove $pkgs </dev/null 2>/dev/null | sed -n 's/^Remv \([^ ]*\).*/\1/p' | while IFS= read -r p; do case " $pkgs " in *" $p "*) ;; *) printf ' %s' "$p" ;; esac; done)"
    if [ -n "$more" ]; then left "the packages$pkgs: apt-get would remove$more with them"
    elif [ -n "$pkgs" ]; then
      # shellcheck disable=SC2086
      if DEBIAN_FRONTEND=noninteractive apt-get remove -y -qq $pkgs </dev/null; then ok "Removed the packages$pkgs"; else left "the packages$pkgs"; fi
    fi
    if [ -n "$gvisor" ]; then rm -f -- "$ETC/apt/sources.list.d/gvisor.list" "$ETC/apt/keyrings/gvisor.gpg"; ok "Removed gVisor's apt source"; fi
  fi
  if [ -n "$remove_packages" ] && [ -n "$gvisor_files" ]; then
    # shellcheck disable=SC2086 # one path per word
    rm -rf -- $gvisor_files "$GVISOR_MARK"
    ok "Removed gVisor's runsc from $LOCAL_BIN"
  fi

  if [ -n "$LEFT" ]; then
    say ""
    say "These couldn't be removed:$LEFT"
    exit 1
  fi
  [ -z "$found" ] || { say ""; ok "botdot is removed from this machine. Docker and Tailscale stay."; }
  exit 0
fi

# ---------------------------------------------------------------------------------------------
# 1. The machine, Docker, rootless Docker and gVisor

if [ "$MODE" = install ]; then bold "botdot installer"; say ""; fi

[ "$(uname -s)" = Linux ] || die "This installer is for Linux. On a Mac, run botdot directly (see the README)."
OS_NAME="$(os_field PRETTY_NAME 2>/dev/null || true)"
case "$(uname -m)" in
  x86_64 | amd64) [ "$MODE" != install ] || ok "${OS_NAME:-Linux} on Intel/AMD" ;;
  aarch64 | arm64) [ "$MODE" != install ] || ok "${OS_NAME:-Linux} on ARM" ;;
  *) die "botdot's images are for Intel/AMD (x86_64) and ARM (aarch64), not $(uname -m)." ;;
esac
# Each account's rootless Docker keeps its images on overlayfs, which a user without root may mount from Linux 5.11 on.
# An older kernel (Debian 11, RHEL 8) would keep a full copy of every layer for each container.
KERNEL="$(uname -r 2>/dev/null | sed -n 's/^\([0-9][0-9]*\)\.\([0-9][0-9]*\).*/\1 \2/p' 2>/dev/null || true)"
if [ "$MODE" = install ] && [ -n "$KERNEL" ]; then
  [ "${KERNEL% *}" -gt 5 ] || { [ "${KERNEL% *}" -eq 5 ] && [ "${KERNEL#* }" -ge 11 ]; } \
    || die "botdot needs Linux 5.11 or newer for each account's rootless Docker, and this machine runs $(uname -r). Install a newer release (Ubuntu 22.04, Debian 12, Fedora, RHEL 9 or newer) and run this again."
fi
# Everything below needs it, also to see that botdot has started.
command -v curl >/dev/null 2>&1 || die "The installer needs curl. Install it ($(install_hint curl curl)) and run this again."
# Each account gets a Linux user of its own, so the installer makes users and their folders.
[ "$(id -u)" = 0 ] || die "The installer makes a Linux user for each account, so it runs as root. Run it with: sudo sh install.sh"
# One installer at a time: a person's run, root's step and the admin page's update all change the same accounts, and
# two at once left an account half on each version. A run waits for the one before it to finish. The update root's step
# runs for the admin page, and the installer an update hands over to, go on under its hold (BOT_DOT_LOCKED, given to
# them alone).
# What the installer leaves running (an account's Docker, the loop without systemd) is started without the lock's
# descriptor (9>&-), or it would hold the lock after the run ends; an account's Docker also without the off-site lock's
# (8>&-), which an off-site restore holds while it makes accounts.
if [ -z "${BOT_DOT_LOCKED:-}" ] && command -v flock >/dev/null 2>&1; then
  mkdir -p "$RUN"
  exec 9>"$RUN/install.lock"
  if ! flock -n 9; then
    [ "$MODE" = requested ] || say "Another botdot installer is running here: this one waits for it to finish…"
    flock 9
  fi
  BOT_DOT_LOCKED=1
fi

# install_docker: Docker Engine from Docker's own packages, with rootless Docker. On Debian and Ubuntu through Docker's
# install script (get.docker.com); on Fedora and the RHEL family from Docker's dnf repository, which that script
# doesn't set up on Rocky, AlmaLinux or Oracle Linux. Started now and at every boot.
install_docker() {
  case "$(pkg_manager)" in
    apt)
      ask "Install Docker now, with Docker's official install script (get.docker.com)?" y \
        || die "botdot needs Docker. Install it (https://docs.docker.com/engine/install/) and run this again."
      say "Installing Docker…"
      curl -fsSL https://get.docker.com | sh ;;
    dnf)
      case "$(os_field ID)" in fedora) id_repo=fedora ;; rhel) id_repo=rhel ;; *) id_repo=centos ;; esac
      ask "Install Docker now, from Docker's repository (download.docker.com/linux/$id_repo)?" y \
        || die "botdot needs Docker. Install it (https://docs.docker.com/engine/install/) and run this again."
      say "Installing Docker…"
      mkdir -p "$ETC/yum.repos.d"
      curl -fsSL "https://download.docker.com/linux/$id_repo/docker-ce.repo" -o "$ETC/yum.repos.d/docker-ce.repo" </dev/null \
        || die "Couldn't reach download.docker.com. Install Docker (https://docs.docker.com/engine/install/) and run this again."
      dnf install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin docker-buildx-plugin docker-ce-rootless-extras </dev/null || {
        rm -f "$ETC/yum.repos.d/docker-ce.repo"
        die "dnf couldn't install Docker from download.docker.com/linux/$id_repo. Install Docker Engine yourself (https://docs.docker.com/engine/install/) and run this again."
      } ;;
    *) die "Docker isn't installed, and this installer installs it only with apt-get or dnf. Install Docker Engine with rootless Docker (https://docs.docker.com/engine/install/) and run this again." ;;
  esac
  [ -z "$SYSTEMD" ] || systemctl enable --now docker </dev/null >/dev/null 2>&1 || true
}
[ "$MODE" = install ] || command -v docker >/dev/null 2>&1 || die "Docker isn't installed: run the installer again."
if ! command -v docker >/dev/null 2>&1; then
  warn "Docker isn't installed."
  install_docker
fi
# Podman's docker command (podman-docker, on Fedora and RHEL) answers as Docker, but has no rootless Docker to give
# each account.
case "$(docker --version </dev/null 2>/dev/null)" in
  *[Pp]odman*) die "This machine's docker command is Podman's. botdot needs Docker Engine: remove podman-docker ($( [ "$(pkg_manager)" = dnf ] && echo 'sudo dnf remove podman-docker' || echo "with your system's packages")) and run this again." ;;
esac
# The machine's own Docker: the front door, and Caddy for a public domain.
D="docker"
# Offline image customization can install/check packages, but has no booted systemd or Docker daemon.
# Only the prerequisites-only path may skip daemon checks; normal installs always require a running daemon.
if [ "${PREREQUISITES:-}" != 1 ] || [ "${BOT_DOT_IMAGE_BUILD:-}" != 1 ]; then
if ! docker info >/dev/null 2>&1; then
  systemctl start docker 2>/dev/null 9>&- || true
  docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start it (sudo systemctl start docker) and run this again."
fi
fi
# machine_logs: the machine's Docker keeps its containers' logs to LOG_OPTS, written once into its daemon.json beside
# what is there, and restarted once to read it. A daemon.json that names a log driver or its options is the admin's,
# and stays as it is. The front door and Caddy come back by their restart policy and get the limits when an update
# makes them again.
machine_logs() {
  [ "${PREREQUISITES:-}:${BOT_DOT_IMAGE_BUILD:-}" != 1:1 ] || return 0
  ml_file="$ETC/docker/daemon.json"
  if [ -s "$ml_file" ] && [ "$(tr -d ' \t\r\n' < "$ml_file")" != '{}' ]; then
    grep -qE '"log-(driver|opts)"' "$ml_file" && return 0
    awk -v add="$LOG_OPTS" '!done && sub(/\{/, "{ " add ",") { done = 1 } { print }' "$ml_file" > "$ml_file.new"
  else
    mkdir -p "$ETC/docker"
    printf '{\n  %s\n}\n' "$LOG_OPTS" > "$ml_file.new"
  fi
  chmod 644 "$ml_file.new"
  mv "$ml_file.new" "$ml_file"
  if [ -z "$SYSTEMD" ]; then
    warn "This machine has no systemd, so its Docker keeps containers' logs to 100 MB each only after it next restarts."
    return 0
  fi
  say "Restarting this machine's Docker once, to keep containers' logs to 100 MB each…"
  systemctl restart docker </dev/null || die "Docker didn't restart with its new settings in $ml_file. See: systemctl status docker"
  ml_i=0
  until $D info </dev/null >/dev/null 2>&1; do
    ml_i=$((ml_i + 1))
    [ "$ml_i" -lt 60 ] || die "Docker didn't start again after its restart. See: systemctl status docker"
    sleep 1
  done
}
case "$MODE" in install | update) machine_logs ;; esac
# docker_upgrades: a managed machine (ADR 154), which no admin patches by hand, gets the security updates of Docker's
# own packages (from download.docker.com, which get.docker.com sets up and Ubuntu's stock origins leave out) with
# Ubuntu's: unattended-upgrades also takes Docker's origin (apt.conf.d/51botdot-docker, written only beside the pin, so
# the fleet console's cloud-init leaves it to this), and apt keeps each of those packages on the major version it has
# (preferences.d/botdot-docker),
# so that a new major comes only with a botdot change and never to the whole fleet on the same morning. A machine
# whose Docker isn't Docker's packages, or that isn't managed, keeps its own policy. Written at every install and
# update, and only when a file changes, once the install's answers are checked (a machine that isn't managed and is
# asked to be, or one reached on this computer only, is refused before), so that a refused run changes nothing.
DOCKER_PACKAGES='docker-ce docker-ce-cli docker-ce-rootless-extras containerd.io docker-compose-plugin docker-buildx-plugin'
DOCKER_ORIGIN='Unattended-Upgrade::Origins-Pattern { "origin=Docker,label=Docker CE"; };'
docker_upgrades() {
  [ -n "$MANAGED" ] && command -v dpkg-query >/dev/null 2>&1 || return 0
  du_pins='' du_ce=''
  for du_p in $DOCKER_PACKAGES; do
    # shellcheck disable=SC2016 # dpkg-query's own fields
    du_v="$(dpkg-query -W --showformat='${Status} ${Version}' "$du_p" </dev/null 2>/dev/null || true)"
    case "$du_v" in 'install ok installed '?*) du_v="${du_v#install ok installed }" ;; *) continue ;; esac
    [ "$du_p" != docker-ce ] || du_ce=1
    du_pins="$du_pins${du_pins:+
}Package: $du_p
Pin: version ${du_v%%.*}.*
Pin-Priority: 990
"
  done
  [ -n "$du_ce" ] || return 0
  mkdir -p "$ETC/apt/apt.conf.d" "$ETC/apt/preferences.d"
  du_changed=''
  for du_f in "apt.conf.d/51botdot-docker" "preferences.d/botdot-docker"; do
    case "$du_f" in apt.conf.d/*) printf '%s\n' "$DOCKER_ORIGIN" ;; *) printf '%s' "$du_pins" ;; esac > "$ETC/apt/$du_f.new"
    chmod 644 "$ETC/apt/$du_f.new"
    if cmp -s "$ETC/apt/$du_f.new" "$ETC/apt/$du_f"; then rm -f "$ETC/apt/$du_f.new"; else mv "$ETC/apt/$du_f.new" "$ETC/apt/$du_f"; du_changed=1; fi
  done
  [ -z "$du_changed" ] || ok "Docker's security updates install by themselves, each package within its major version"
}
# Which package gives `docker compose` depends on where Docker came from. Debian 12's own docker-compose is the old
# Compose 1 (only `docker-compose`), and Debian 12 has no Compose 2 package at all.
$D compose version </dev/null >/dev/null 2>&1 || die "Docker Compose (docker compose) is missing. Install the package for your Docker and run this again:
  Docker's own packages (docker-ce, from Docker's repository): docker-compose-plugin
  Ubuntu's docker.io: docker-compose-v2
  Debian's docker.io: docker-compose on Debian 13. Debian 12 has none (its docker-compose is the old Compose 1, without \"docker compose\"): install Docker from Docker's repository, https://docs.docker.com/engine/install/debian/"
[ "$MODE" != install ] || ok "Docker $($D version --format '{{.Server.Version}}' </dev/null 2>/dev/null)"

# A botdot from before accounts (ADR 027) runs in this machine's Docker as the compose service bot-dot. This version
# is not an update for it: it is installed again, and the old one's data folder is never touched.
OLD="$($D ps -a --filter label=com.docker.compose.service=bot-dot --format '{{.Label "com.docker.compose.project.working_dir"}}' </dev/null 2>/dev/null | sort -u | sed '/^$/d' || true)"
[ ! -f "$DIR/compose.yaml" ] || [ -d "$DOOR" ] || OLD="$(printf '%s\n%s' "$OLD" "$DIR" | sed '/^$/d' | sort -u)"
if [ "$MODE" = install ] && [ -n "$OLD" ] && [ ! -f "$DOOR/.env" ]; then
  say ""
  warn "botdot from before accounts is installed in $(printf '%s' "$OLD" | tr '\n' ',' | sed 's/,$//; s/,/, /g'). This version can't update it: it is installed again, and you sign in with a passkey. Its data folder stays as it is; delete it yourself once you're sure you don't need it."
  printf '%s\n' "$OLD" | grep -qx "$DIR" && die "BOT_DOT_DIR is that old install's folder. Run this again without BOT_DOT_DIR, or with a new folder."
  ask "Stop the old botdot and install this version beside it?" n || die "Nothing was changed."
  printf '%s\n' "$OLD" | while IFS= read -r old; do
    $D compose --project-directory "$old" stop </dev/null >/dev/null 2>&1 || warn "Couldn't stop the old botdot in $old; stop it yourself: cd $old && docker compose stop"
  done
  ok "The old botdot is stopped. Its data is still in its folder."
fi

# What every account needs beside Docker: rootless Docker (dockerd-rootless.sh, newuidmap and a user-mode network),
# gVisor's runsc, and setfacl, which lets the front door into each account's socket folder.
# gVisor is the sandbox of every account, so it comes at one release: its apt source names that release, not the
# moving `release` channel, and apt upgrade never changes it behind botdot's back. A machine without apt-get gets that
# release's own files from gVisor (install_runsc). A new one arrives with this file.
GVISOR_RELEASE=20261102.0
GVISOR_LIST="$ETC/apt/sources.list.d/gvisor.list"
# The sha256 of that release's files (gvisor.tar.zstd), for x86_64 and aarch64.
GVISOR_SHA256_X86_64=a1439ffbba7d212e0fde32ea79fa9bb51cbc4c5f6c16af1f047260290b861d42
GVISOR_SHA256_AARCH64=f702ae92ad7a0c4134be34ca23f52966dbb696db0c0f5b8ec439210ab2cd7c6a
# install_runsc: gVisor's runsc and its helpers (gvisor-bin) of GVISOR_RELEASE in LOCAL_BIN, from gVisor's own
# release files, checked by their sha256.
install_runsc() {
  case "$(uname -m)" in x86_64 | amd64) ir_arch=x86_64 ir_sum="$GVISOR_SHA256_X86_64" ;; *) ir_arch=aarch64 ir_sum="$GVISOR_SHA256_AARCH64" ;; esac
  ir_tmp="$(mktemp -d)"
  curl -fsSL --retry 2 -o "$ir_tmp/gvisor.tar.zstd" "https://storage.googleapis.com/gvisor/releases/release/$GVISOR_RELEASE/$ir_arch/gvisor.tar.zstd" </dev/null \
    || { rm -rf "$ir_tmp"; die "Couldn't download gVisor $GVISOR_RELEASE from storage.googleapis.com. Run this again, or install gVisor yourself (https://gvisor.dev/docs/user_guide/install/)."; }
  [ "$(sha256sum "$ir_tmp/gvisor.tar.zstd" | cut -d' ' -f1)" = "$ir_sum" ] \
    || { rm -rf "$ir_tmp"; die "gVisor's download doesn't match the sha256 botdot pins for $GVISOR_RELEASE. Nothing was installed from it."; }
  zstd -dcq "$ir_tmp/gvisor.tar.zstd" | tar -x -C "$ir_tmp" runsc gvisor-bin \
    || { rm -rf "$ir_tmp"; die "Couldn't unpack gVisor's download (zstd and tar)."; }
  mkdir -p "$LOCAL_BIN"
  install -m 755 "$ir_tmp/runsc" "$LOCAL_BIN/runsc"
  rm -rf "$LOCAL_BIN/gvisor-bin"
  cp -R "$ir_tmp/gvisor-bin" "$LOCAL_BIN/gvisor-bin"
  chmod -R go-w "$LOCAL_BIN/gvisor-bin"
  rm -rf "$ir_tmp"
  # SELinux (Fedora, RHEL) labels them as the programs they are, not as files made in a temporary folder.
  if command -v restorecon >/dev/null 2>&1; then restorecon -R "$LOCAL_BIN/runsc" "$LOCAL_BIN/gvisor-bin" </dev/null >/dev/null 2>&1 || true; fi
  printf '# botdot (install.sh): gVisor %s, installed from its release files.\n%s\n%s\n' "$GVISOR_RELEASE" "$LOCAL_BIN/runsc" "$LOCAL_BIN/gvisor-bin" > "$GVISOR_MARK"
}
MISSING=''
need() { command -v "$1" >/dev/null 2>&1 || MISSING="$MISSING $2"; }
need dockerd-rootless.sh docker-ce-rootless-extras
need newuidmap uidmap
command -v slirp4netns >/dev/null 2>&1 || command -v pasta >/dev/null 2>&1 || command -v vpnkit >/dev/null 2>&1 || MISSING="$MISSING slirp4netns"
need setfacl acl
# dockerd-rootless.sh sets the namespace's sysctls with it; a minimal Debian has none.
need sysctl procps
command -v runsc >/dev/null 2>&1 || [ -x "$LOCAL_BIN/runsc" ] || MISSING="$MISSING runsc"
[ "$MODE" = install ] || [ -z "$MISSING" ] || die "Missing:$MISSING. Run the installer again."
if [ -n "$MISSING" ]; then
  warn "Each account runs in a rootless Docker under gVisor, which needs:$MISSING"
  PKG="$(pkg_manager)"
  [ -n "$PKG" ] || die "Install them with your system's packages (rootless Docker: https://docs.docker.com/engine/security/rootless/, gVisor: https://gvisor.dev/docs/user_guide/install/) and run this again."
  # Rootless Docker comes only with Docker's own packages: a distribution's Docker (docker.io, moby-engine) has none.
  case "$MISSING" in
    *docker-ce-rootless-extras*)
      if [ "$PKG" = apt ]; then
        # shellcheck disable=SC2016 # dpkg-query's own field
        dpkg-query -W --showformat='${Status}' docker-ce </dev/null 2>/dev/null | grep -q 'install ok installed' && dc=1 || dc=''
      else rpm -q docker-ce </dev/null >/dev/null 2>&1 && dc=1 || dc=''; fi
      [ -n "$dc" ] || die "This machine's Docker isn't Docker's own (docker-ce), so it has no rootless Docker. Remove it and install Docker Engine from Docker's repository (https://docs.docker.com/engine/install/), or remove it and run this again to have it installed."
      ;;
  esac
  if [ "$PKG" = apt ]; then
    ask "Install them now with apt-get (gVisor's runsc from gVisor's own repository)?" y || die "botdot needs them. Install them and run this again."
  else
    ask "Install them now with dnf (gVisor's runsc from gVisor's release $GVISOR_RELEASE)?" y || die "botdot needs them. Install them and run this again."
  fi
  say "Installing$MISSING…"
  if [ "$PKG" = apt ]; then
    case "$MISSING" in
      *runsc*)
        mkdir -p "$ETC/apt/keyrings" "$ETC/apt/sources.list.d"
        # A minimal Debian has no gpg to read gVisor's key with.
        [ -f "$ETC/apt/keyrings/gvisor.gpg" ] || command -v gpg >/dev/null 2>&1 || pkg_add gnupg -- gnupg2 || die "apt-get couldn't install gnupg, which reads gVisor's key. Install it (sudo apt-get install gnupg) and run this again."
        [ -f "$ETC/apt/keyrings/gvisor.gpg" ] || curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor -o "$ETC/apt/keyrings/gvisor.gpg"
        printf 'deb [arch=%s signed-by=/etc/apt/keyrings/gvisor.gpg] https://storage.googleapis.com/gvisor/releases %s main\n' "$(dpkg --print-architecture)" "${GVISOR_RELEASE%.*}" > "$GVISOR_LIST"
        ;;
    esac
    # shellcheck disable=SC2046 # one word per package
    apt-get update -qq </dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $(printf '%s\n' $MISSING | sed "s/^runsc\$/runsc=$GVISOR_RELEASE/") </dev/null \
      || die "apt-get couldn't install$MISSING. Install them yourself and run this again."
  else
    # dnf's names: newuidmap is shadow-utils', sysctl procps-ng's; runsc isn't a package, but its download needs zstd and tar.
    DNF_PKGS="$(printf '%s\n' $MISSING | sed 's/^uidmap$/shadow-utils/; s/^procps$/procps-ng/; /^runsc$/d' | tr '\n' ' ')"
    case "$MISSING" in *runsc*)
      command -v zstd >/dev/null 2>&1 || DNF_PKGS="$DNF_PKGS zstd"
      command -v tar >/dev/null 2>&1 || DNF_PKGS="$DNF_PKGS tar" ;;
    esac
    # shellcheck disable=SC2086 # one word per package
    [ -z "$(printf '%s' "$DNF_PKGS" | tr -d ' ')" ] || dnf install -y -q $DNF_PKGS </dev/null \
      || die "dnf couldn't install $(printf '%s' "$DNF_PKGS" | sed 's/^ *//; s/ *$//'). Install them yourself and run this again."
    case "$MISSING" in *runsc*) install_runsc ;; esac
  fi
fi
ROOTLESS="$(command -v dockerd-rootless.sh)"
# newuidmap maps each account's sub-IDs only as root: setuid (Debian, Ubuntu) or by its file capability (Fedora, RHEL),
# which a system made from a container image may have lost. Without either every account's Docker would fail to start.
for nm in newuidmap newgidmap; do
  nm_path="$(command -v "$nm" 2>/dev/null || true)"
  [ -n "$nm_path" ] && [ ! -u "$nm_path" ] && command -v getcap >/dev/null 2>&1 || continue
  getcap "$nm_path" 2>/dev/null | grep -q 'cap_set[ug]id' \
    || die "$nm_path can't map each account's IDs: it is neither setuid nor has its file capability. Reinstall it ($( [ "$(pkg_manager)" = dnf ] && echo 'sudo dnf reinstall shadow-utils' || echo 'sudo apt-get install --reinstall uidmap')) and run this again."
done
# sudo's PATH on RHEL leaves out /usr/local/bin, where install_runsc puts it.
RUNSC="$(command -v runsc || printf '%s' "$LOCAL_BIN/runsc")"
# A machine installed before the pin follows gVisor's `release` channel: its source is moved to the pinned release,
# and a runsc of another release is named with the command that installs the pinned one. It is not replaced here:
# the runsc of the accounts' running sandboxes would change under them.
if [ "$MODE" = install ] || [ "$MODE" = update ]; then
  if [ -f "$GVISOR_LIST" ] && ! grep -q "gvisor/releases ${GVISOR_RELEASE%.*} main" "$GVISOR_LIST"; then
    sed "s#gvisor/releases [^ ]* main#gvisor/releases ${GVISOR_RELEASE%.*} main#" "$GVISOR_LIST" > "$GVISOR_LIST.new" && mv "$GVISOR_LIST.new" "$GVISOR_LIST"
    ok "gVisor's apt source now holds release $GVISOR_RELEASE"
  fi
  HAVE_RUNSC="$("$RUNSC" --version </dev/null 2>/dev/null | head -n 1 | sed 's/^runsc version //; s/^release-//')"
  if [ "$HAVE_RUNSC" != "$GVISOR_RELEASE" ]; then
    if [ "$(pkg_manager)" = apt ]; then rs_fix="sudo apt-get update && sudo apt-get install --allow-downgrades runsc=$GVISOR_RELEASE"
    else rs_fix="sudo rm $RUNSC && sudo sh install.sh"; fi
    warn "gVisor ${HAVE_RUNSC:-of an unknown release} is installed; botdot is tested with $GVISOR_RELEASE. Once no account is busy: $rs_fix"
  fi
fi
# Ubuntu 24.04 lets a program make the user namespace rootless Docker needs only when AppArmor names it, which takes
# AppArmor 4 (abi/4.0). A kernel that restricts them under an older AppArmor (Ubuntu 22.04 or Debian 12 on a newer
# kernel) has no profile that can name it: the restriction itself has to be lifted.
KIT="$(command -v rootlesskit 2>/dev/null || true)"
if { [ "$MODE" = install ] || [ "$MODE" = update ]; } && [ -n "$KIT" ] && command -v apparmor_parser >/dev/null 2>&1 && [ "$(cat "$PROC/sys/kernel/apparmor_restrict_unprivileged_userns" 2>/dev/null || echo 0)" = 1 ] \
  && ! grep -rqs "$KIT" "$ETC/apparmor.d/" 2>/dev/null; then
  [ -f "$ETC/apparmor.d/abi/4.0" ] || die "This kernel lets only programs AppArmor names make user namespaces, and this system's AppArmor is too old to name rootless Docker. Lift the restriction (echo kernel.apparmor_restrict_unprivileged_userns=0 | sudo tee /etc/sysctl.d/60-botdot-userns.conf && sudo sysctl --system) and run this again."
  printf '# botdot (install.sh): rootless Docker for each account needs user namespaces.\nabi <abi/4.0>,\ninclude <tunables/global>\n\nprofile botdot-rootlesskit %s flags=(unconfined) {\n  userns,\n}\n' "$KIT" > "$ETC/apparmor.d/botdot-rootlesskit"
  apparmor_parser -r "$ETC/apparmor.d/botdot-rootlesskit" </dev/null || die "AppArmor didn't take the profile that lets rootless Docker run ($KIT)."
fi
[ "$MODE" != install ] || ok "Rootless Docker and gVisor ($("$RUNSC" --version </dev/null 2>/dev/null | head -n 1 | sed 's/^runsc version //'))"
if [ "$MODE" = install ] && [ "$(getenforce 2>/dev/null || true)" = Enforcing ]; then
  warn "SELinux is enforcing, which botdot isn't tested with yet. If an account doesn't start, see https://github.com/Kordal/bot-dot/blob/main/docs/install-linux.md#platforms"
fi

# ---------------------------------------------------------------------------------------------
# A base-image build stops after the same runtime checks as a real install. No accounts, tokens or images.
if [ "${PREREQUISITES:-}" = 1 ]; then
  ok "The machine prerequisites are ready"
  exit 0
fi

# 2. The images: botdot's signed images from a registry, or ones built on this machine

[ "$MODE" = install ] || [ -f "$ENV" ] || die "botdot isn't installed here ($ENV is missing)."
mkdir -p "$DOOR/data" "$SOCKETS" "$ACCOUNTS"
chmod 755 "$DIR" "$SOCKETS"
chmod 711 "$ACCOUNTS"
touch "$ENV"
chmod 600 "$ENV"

# A self-built botdot server stays one: without a name given now, a rerun takes the local images .env names.
saved_local() { v="$(get_env "$ENV" "$1")"; [ -n "$v" ] && [ -z "$(registry_of "$v")" ] && printf '%s' "$v" || true; }
# The admin page's update (--update) is given no names: it takes the newest release of the repositories .env pins.
saved_latest() {
  [ -n "$UNATTENDED" ] || return 0
  v="$(get_env "$ENV" "$1")"
  [ -n "$(registry_of "$v")" ] || return 0
  printf '%s:latest' "$(repository_of "$v")"
}
# repository_of IMAGE: its repository, without a tag or a digest.
repository_of() {
  ro_v="${1%@sha256:*}"
  case "${ro_v##*/}" in *:*) ro_v="${ro_v%:*}" ;; esac
  printf '%s' "$ro_v"
}
# named_to: the version an update was asked for (#979), BOT_DOT_UPDATE_TO, as sha256: and the 64 hex digits of the
# server image's digest; nothing for the newest; "invalid" for anything else, which the update refuses at check.
named_to() {
  if [ "$MODE" = install ] && [ -n "${BOT_DOT_INSTALL_TO:-}" ]; then
    if printf '%s' "$BOT_DOT_INSTALL_TO" | grep -Eqx 'sha256:[0-9a-f]{64}'; then printf '%s' "$BOT_DOT_INSTALL_TO"; else printf invalid; fi
    return 0
  fi
  [ "$MODE" = update ] && [ -n "${BOT_DOT_UPDATE_TO:-}" ] || return 0
  if printf '%s' "$BOT_DOT_UPDATE_TO" | grep -Eqx 'sha256:[0-9a-f]{64}'; then printf '%s' "$BOT_DOT_UPDATE_TO"; else printf invalid; fi
}
NAMED_TO="$(named_to)"
IMAGE="${BOT_DOT_IMAGE:-$(saved_local BOT_DOT_IMAGE)}"
IMAGE="${IMAGE:-$(saved_latest BOT_DOT_IMAGE)}"
IMAGE="${IMAGE:-$IMAGES/bot-dot:latest}"
if [ -z "$(registry_of "$IMAGE")" ]; then
  COMPUTER_IMAGE="${BOT_DOT_COMPUTER_IMAGE:-$(saved_local BOT_DOT_COMPUTER_IMAGE)}"
  COMPUTER_IMAGE="${COMPUTER_IMAGE:-bot-dot/desktop:latest}"
else
  COMPUTER_IMAGE="${BOT_DOT_COMPUTER_IMAGE:-$(saved_latest BOT_DOT_COMPUTER_IMAGE)}"
  COMPUTER_IMAGE="${COMPUTER_IMAGE:-$IMAGES/bot-dot-desktop:latest}"
fi

# check NAME server|desktop [OPTION…]: $SIGNED is what NAME installs as (with the OPTIONs of signed-image.js, more after
# it). A refusal ends the installer.
check() {
  if SIGNED="$(signed "$@")"; then return 0; else status=$?; fi
  if [ "$status" = 2 ] && [ -z "$TOKEN" ]; then
    say ""
    say "The registry refused to hand over botdot's images without a token (a private fork or a mirror?)."
    say "Paste a GitHub token that can only read packages"
    say "(github.com → Settings → Developer settings → Tokens (classic) → scope: read:packages)."
    ask_secret "Token:"
    TOKEN="$REPLY"
    [ -n "$TOKEN" ] || die "No token, so the images can't be downloaded."
    if SIGNED="$(signed "$@")"; then return 0; else status=$?; fi
  fi
  [ "$status" != 2 ] || die "That token didn't work for $REGISTRY. Check that it has the read:packages scope."
  die "Refused $1: ${SIGNED:-it could not be checked}. Nothing was downloaded or started."
}
# pull NAME [DOCKER]: downloads it into the machine's Docker, or DOCKER (an account's), signing in with the token when
# the registry wants one. A download that fails leaves Docker's last line of error in PULLED, so that what stops the
# update says why ("no space left on device"), not only that it couldn't.
pull() {
  into="${2:-$D}"
  pull_try=1 pull_login=''
  while :; do
    # Each attempt is bounded. Keep progress in the install log instead of swallowing it with -q.
    pull_err="$RUN/pull-$$.log"
    pull_rc_file="$RUN/pull-$$.rc"
    ( set +e; timeout 900 $into pull "$1" </dev/null; echo "$?" > "$pull_rc_file" ) 2>&1 | tee "$pull_err"
    pull_rc="$(cat "$pull_rc_file")"; rm -f "$pull_rc_file"
    if [ "$pull_rc" = 0 ]; then rm -f "$pull_err"; return 0; fi
    PULLED="$(sed '/^[[:space:]]*$/d' "$pull_err" | tail -n 1)"
    if grep -Eiq 'unauthorized|authentication required|denied' "$pull_err" && [ -n "$TOKEN" ] && [ -z "$pull_login" ]; then
      pull_login=1
      printf '%s' "$TOKEN" | $into login "$REGISTRY" -u "$(owner_of "$IMAGE")" --password-stdin >/dev/null 2>&1 \
        || { rm -f "$pull_err"; return 1; }
    elif [ "$pull_try" -ge 3 ] || { [ "$pull_rc" != 124 ] && ! grep -Eiq 'timeout|timed out|connection reset|connection refused|temporary failure|unexpected EOF|TLS handshake|too many requests|429|50[0234]' "$pull_err"; }; then
      rm -f "$pull_err"; return 1
    fi
    rm -f "$pull_err"
    say "Retrying image download (attempt $((pull_try + 1))/3)…"
    sleep "$((pull_try * 5))"
    pull_try=$((pull_try + 1))
  done
}
# because: Docker's reason for the last failed download, after a colon, or nothing.
because() { [ -z "${PULLED:-}" ] || printf ': %s' "$PULLED"; }
# clean_images SOCKET RUNNER REFERENCE…: before a download, the botdot images no container of the Docker at SOCKET uses
# go, by botdot's own rule (lib/image-cleanup.js, run from the image RUNNER in the machine's Docker); the images the
# REFERENCEs name stay (#190). It says what it removed, and a cleanup that fails stops nothing. Its answer is read with
# sed, not json(): before the machine's download, the image json() runs may not be here yet. Only botdot's signed
# images: a self-built install cleans its own way (remove_unnamed).
clean_images() {
  ci_sock="$1" ci_runner="$2"
  shift 2
  [ -n "$REGISTRY" ] && [ -n "$ci_runner" ] && $D image inspect "$ci_runner" </dev/null >/dev/null 2>&1 || return 0
  ci_out="$($D run --rm --pull never --network none --user 0:0 -v "$ci_sock:/var/run/docker.sock" --entrypoint node "$ci_runner" /opt/bot-dot/lib/image-cleanup.js "$@" </dev/null 2>/dev/null || true)"
  ci_n="$(printf '%s' "$ci_out" | sed -n 's/.*"removed":\([0-9]*\).*/\1/p')"
  case "$ci_out" in *'"failed":0'*) ;; *) warn "Couldn't remove the old images first; the download goes on."; return 0 ;; esac
  [ "${ci_n:-0}" -gt 0 ] || return 0
  ci_bytes="$(printf '%s' "$ci_out" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')"
  ok "Made room first: removed $ci_n old image$([ "$ci_n" = 1 ] || printf s)$([ "${ci_bytes:-0}" -lt 50000000 ] || printf ' (%s GB freed)' "$(awk -v b="$ci_bytes" 'BEGIN { printf "%.1f", b / 1e9 }')")"
}
# gb BYTES: in GB, to one decimal.
gb() { awk -v b="$1" 'BEGIN { printf "%.1f", b / 1e9 }'; }
# room_for_accounts: every running account's disk has room for the new server image before it is downloaded there
# (#192), after the images the account no longer uses went (clean_images, by the new version's rule when its image is
# here already, or else the running one's). The room is the layers the account lacks, from the signed image's manifest
# (lib/image-layers.js, from the new image itself once it is here: root's copy of the installer may be older than it,
# ADR 036), three times over (the download, then unpacked at about twice its size) and 1 GB for the account to go on
# working. An account short of it stops the update with what it needs, before any account is changed. When the
# registry's answer gives no sizes, the update goes on without the check.
room_for_accounts() {
  ls "$ACCOUNTS"/*/compose.yaml >/dev/null 2>&1 || return 0
  if $D image inspect "$SERVER_SIGNED" </dev/null >/dev/null 2>&1; then
    rf_runner="$SERVER_SIGNED"
    rf_layers="$(isolated --entrypoint node "$SERVER_SIGNED" /opt/bot-dot/lib/image-layers.js "$SERVER_SIGNED" 2>/dev/null || true)"
  else
    rf_runner="$(get_env "$ENV" BOT_DOT_IMAGE)"
    rf_layers="$(check_node image-layers.js "$SERVER_SIGNED" 2>/dev/null || true)"
  fi
  [ -n "$rf_layers" ] || { warn "Couldn't tell how much room the update needs in each account; it goes on without that check."; return 0; }
  for rf in "$ACCOUNTS"/*/; do
    rf="$(basename "$rf")"
    [ -f "$ACCOUNTS/$rf/compose.yaml" ] || continue
    rf_docker="env DOCKER_HOST=unix://$RUN/$rf/docker.sock docker"
    $rf_docker info </dev/null >/dev/null 2>&1 || continue
    phase clean "$rf"
    clean_images "$RUN/$rf/docker.sock" "$rf_runner" "$(get_env "$ACCOUNTS/$rf/.env" BOT_DOT_IMAGE)" "$(get_env "$ACCOUNTS/$rf/.env" BOT_DOT_COMPUTER_IMAGE)" "$SERVER_SIGNED" "$COMPUTER_SIGNED"
    phase preflight "$rf"
    rf_ids="$($rf_docker image ls -q --no-trunc </dev/null 2>/dev/null | sort -u || true)"
    # shellcheck disable=SC2086 # one id per word
    rf_have="$([ -z "$rf_ids" ] || $rf_docker image inspect --format '{{range .RootFS.Layers}}{{println .}}{{end}}' $rf_ids </dev/null 2>/dev/null || true)"
    # The bytes of the layers it lacks, each counted once, three times over and 1 GB; 0 when it lacks none.
    rf_need="$({ printf '%s\n' "$rf_have" | sed 's/^/have /'; printf '%s\n' "$rf_layers" | sed 's/^/new /'; } \
      | awk '$1 == "have" { h[$2] = 1 } $1 == "new" && !($2 in h) && !($2 in s) { s[$2] = 1; t += $3 } END { printf "%.0f", (t > 0 ? t * 3 + 1e9 : 0) }')"
    # The snapshot of its data isn't counted: one without room is skipped at its switch (take_snapshot).
    rf_free="$(df -Pk "$ACCOUNTS/$rf" 2>/dev/null | awk 'NR == 2 { printf "%.0f", $4 * 1024 }' || true)"
    [ -n "$rf_free" ] && [ "$rf_need" -gt "$rf_free" ] || continue
    die "The account $rf needs $(gb "$rf_need") GB free for this update and has $(gb "$rf_free") GB. Give it a bigger disk share, or update or reset its computer so the old computer image can go, then update again. No account was changed."
  done
}

# runs DOCKER SERVICE…: the Docker DOCKER runs each compose SERVICE on the image $SERVER_SIGNED, pinned by the same digest.
runs() {
  r_ps="$($1 ps --format '{{.Label "com.docker.compose.service"}} {{.Image}}' </dev/null 2>/dev/null)" || return 1
  shift
  for r_s; do printf '%s\n' "$r_ps" | grep -qxF "$r_s $SERVER_SIGNED" || return 1; done
}
# runs_signed: the signed images just checked are the ones the front door and every running account were installed with
# (.env) and run now. An account whose Docker is stopped (suspended) gets them when it is started again.
runs_signed() {
  [ "$(get_env "$ENV" BOT_DOT_IMAGE)" = "$SERVER_SIGNED" ] || return 1
  [ -z "$COMPUTER_SIGNED" ] || [ "$(get_env "$ENV" BOT_DOT_COMPUTER_IMAGE)" = "$COMPUTER_SIGNED" ] || return 1
  runs "$D" front-door || return 1
  for rs_home in "$ACCOUNTS"/*/; do
    rs_name="$(basename "$rs_home")"
    [ -f "$ACCOUNTS/$rs_name/compose.yaml" ] || continue
    rs_d="env DOCKER_HOST=unix://$RUN/$rs_name/docker.sock docker"
    $rs_d info </dev/null >/dev/null 2>&1 || continue
    # One that waits for this very version has nothing new either (ADR 053): the front door pins it already.
    [ "$(account_was "$rs_name")" != waiting ] || [ "$(get_env "$ACCOUNTS/$rs_name/.env" BOT_DOT_IMAGE)" = "$SERVER_SIGNED" ] || continue
    [ "$(get_env "$ACCOUNTS/$rs_name/.env" BOT_DOT_IMAGE)" = "$SERVER_SIGNED" ] || return 1
    [ -z "$COMPUTER_SIGNED" ] || [ "$(get_env "$ACCOUNTS/$rs_name/.env" BOT_DOT_COMPUTER_IMAGE)" = "$COMPUTER_SIGNED" ] || return 1
    runs "$rs_d" bot-dot docker-helper || return 1
  done
}

REGISTRY="$(registry_of "$IMAGE")"
TOKEN=''
COMPUTER_READY=''
if [ "$MODE" = requested ]; then
  # Root's step: the images the last install checked and pinned by digest in .env, and nothing else.
  IMAGE="$(get_env "$ENV" BOT_DOT_IMAGE)"
  IMAGE="${IMAGE:-$IMAGES/bot-dot:latest}"
  COMPUTER_IMAGE="$(get_env "$ENV" BOT_DOT_COMPUTER_IMAGE)"
  REGISTRY="$(registry_of "$IMAGE")"
  TOKEN="$(get_env "$ENV" BOT_DOT_REGISTRY_TOKEN)"
  if [ -n "$REGISTRY" ]; then
    case "$COMPUTER_IMAGE" in "$REGISTRY"/*@sha256:*) COMPUTER_READY=pull ;; esac
  elif [ -n "$COMPUTER_IMAGE" ] && [ -z "$(registry_of "$COMPUTER_IMAGE")" ] && $D image inspect "$COMPUTER_IMAGE" </dev/null >/dev/null 2>&1; then
    COMPUTER_READY=load
  fi
  $D image inspect "$IMAGE" </dev/null >/dev/null 2>&1 || { [ -n "$REGISTRY" ] && pull "$IMAGE"; } || die "The image $IMAGE isn't on this machine$(because): run the installer again."
elif [ -n "$REGISTRY" ]; then
  TOKEN="$(get_env "$ENV" BOT_DOT_REGISTRY_TOKEN)"
  phase check
  [ -f "$SOURCE/lib/signed-image.js" ] || die "The installer checks the signature of botdot's images with botdot's source, and it isn't next to this installer. Get the source and run the install.sh in it."
  $D image inspect "$CHECK_NODE" </dev/null >/dev/null 2>&1 || pull "$CHECK_NODE" \
    || die "Couldn't download $CHECK_NODE, which checks the signature of botdot's images$(because)."
  if [ -n "$NAMED_TO" ]; then
    # An update to the version named (#979): that very release of the repository .env pins, by its own signed tag, and
    # never one older than the release the front door runs (BOT_DOT_RELEASE); the bots' computer of the same source.
    [ "$NAMED_TO" != invalid ] || die "Refused the version asked for: name it as sha256: and the 64 hex digits of the server image's digest. Nothing was downloaded or started."
    IMAGE="$(repository_of "$IMAGE")@$NAMED_TO"
    RUNS_RELEASE="$(get_env "$ENV" BOT_DOT_RELEASE)"
    case "$RUNS_RELEASE" in '' | *[!0-9]*) RUNS_RELEASE=0 ;; esac
    check "$IMAGE" server --release --at "${NAMED_TO#sha256:}" --installed "$RUNS_RELEASE"
  else
    check "$IMAGE" server --release
  fi
  SERVER_SIGNED="$(printf '%s' "$SIGNED" | cut -d' ' -f1)"
  SERVER_REVISION="$(printf '%s' "$SIGNED" | cut -s -d' ' -f2)"
  SERVER_RELEASE="$(printf '%s' "$SIGNED" | cut -s -d' ' -f3)"
  case "$SERVER_RELEASE" in *[!0-9]*) SERVER_RELEASE='' ;; esac
  # The bots' computer is downloaded into each account now, so the first bot that needs one doesn't wait for it.
  # One on another registry is downloaded and checked by botdot when a bot needs it.
  COMPUTER_SIGNED=''
  if [ "$(registry_of "$COMPUTER_IMAGE")" = "$REGISTRY" ]; then
    if [ -n "$NAMED_TO" ]; then
      printf '%s' "$SERVER_REVISION" | grep -Eqx '[0-9a-f]{40}' || die "Refused $IMAGE: its signature names no source revision. Nothing was downloaded or started."
      COMPUTER_IMAGE="$(repository_of "$COMPUTER_IMAGE"):latest"
      check "$COMPUTER_IMAGE" desktop --at "$SERVER_REVISION"
    else
      check "$COMPUTER_IMAGE" desktop
    fi
    COMPUTER_SIGNED="$SIGNED"
  fi
  # The admin page's update finds nothing new: the front door and every running account run these very images, so
  # it changes nothing, restarts nothing and stops no bot's run (#193).
  if [ -n "$UNATTENDED" ] && runs_signed; then
    say_newest "$(version_now)"
    ok "It was the newest already: the front door and every account run it, so nothing was restarted"
    phase done
    exit 0
  fi
  # Room first, in the machine's Docker too, by the rule of the version it runs now (#190).
  phase clean
  clean_images /var/run/docker.sock "$(get_env "$ENV" BOT_DOT_IMAGE)" "$(get_env "$ENV" BOT_DOT_IMAGE)" "$(get_env "$ENV" BOT_DOT_COMPUTER_IMAGE)"
  room_for_accounts
  phase download
  say "Downloading botdot (about 1.5 GB the first time)…"
  pull "$SERVER_SIGNED" || die "Couldn't download $SERVER_SIGNED$(because)."
  # botdot also needs it to download newer computer images by itself.
  [ -n "$TOKEN" ] && set_env "$ENV" BOT_DOT_REGISTRY_TOKEN "$TOKEN"
  # Pinned by digest in .env, as an update pins it: botdot runs what was checked.
  IMAGE="$SERVER_SIGNED"
  ok "botdot image is up to date"
  if [ -n "$COMPUTER_SIGNED" ]; then COMPUTER_IMAGE="$COMPUTER_SIGNED"; COMPUTER_READY=pull; fi
else
  # Self-built: nothing is signed in to or downloaded.
  phase check
  [ -z "$NAMED_TO" ] || die "A version can be named only for botdot's signed images from a registry; this botdot server is self-built. Nothing was changed."
  $D image inspect "$IMAGE" </dev/null >/dev/null 2>&1 || die "The image $IMAGE isn't on this machine. Build it in botdot's source with: make images"
  ok "Using the local image $IMAGE"
  if [ -n "$(registry_of "$COMPUTER_IMAGE")" ]; then :
  elif $D image inspect "$COMPUTER_IMAGE" </dev/null >/dev/null 2>&1; then ok "Using the local image $COMPUTER_IMAGE for the bots' computer"; COMPUTER_READY=load
  else warn "The bots' computer image $COMPUTER_IMAGE isn't on this machine; botdot builds it when a bot first needs one."; fi
fi

# The compose files come from the image itself, so they always match the version you run.
image_file() { $D run --rm --pull never --entrypoint cat "$IMAGE" "/opt/bot-dot/$1" </dev/null; }
# The admin page's update runs root's copy of the installer, which the version before left there. The installer that
# goes with the version being installed is in that version's image, checked above: root's copy becomes it, with the
# release check beside it, and the update goes on in it before anything is changed (ADR 036). An older copy took the
# new version's compose files and set up the accounts' Docker the old way, and the update stopped half done.
if [ -n "$UNATTENDED" ] && [ "$SOURCE" = "$BIN" ] && [ -z "${BOT_DOT_HANDED_OVER:-}" ]; then
  if image_file install.sh > "$BIN/install.sh.new" 2>/dev/null && [ -s "$BIN/install.sh.new" ] && ! cmp -s "$BIN/install.sh.new" "$BIN/install.sh"; then
    for f in signed-image registry release-manifest release-trust; do
      image_file "lib/$f.js" > "$BIN/lib/$f.js.new" 2>/dev/null && [ -s "$BIN/lib/$f.js.new" ] || die "Couldn't read lib/$f.js from the image."
    done
    for f in signed-image registry release-manifest release-trust; do
      chmod 644 "$BIN/lib/$f.js.new"
      mv "$BIN/lib/$f.js.new" "$BIN/lib/$f.js"
    done
    chmod 600 "$BIN/install.sh.new"
    mv "$BIN/install.sh.new" "$BIN/install.sh"
    ok "The installer is the new version's"
    BOT_DOT_HANDED_OVER=1 BOT_DOT_LOCKED="${BOT_DOT_LOCKED:-}" exec sh "$BIN/install.sh" --update
  fi
  # An image from before the installer was in it, or the same installer: this copy goes on.
  rm -f "$BIN/install.sh.new"
fi
phase preflight
ACCOUNT_COMPOSE="$(image_file compose.yaml)" || die "Couldn't read compose.yaml from the image."
# An installer older than the image (a run from a source not pulled, or an image from before it carried its installer)
# would set up the accounts' Docker without a runtime the new compose names: compose would then stop each account half
# done (#142). It stops here instead, before anything of an account is changed.
for r in $(printf '%s\n' "$ACCOUNT_COMPOSE" | sed -n 's/^[[:space:]]*runtime:[[:space:]]*\([A-Za-z0-9._-]*\).*/\1/p' | sort -u); do
  case " $RUNTIMES " in
    *" $r "*) ;;
    *) die "The image's compose.yaml needs the runtime $r, which this installer doesn't set up: it is older than the image. Take the installer of the same version (git pull in botdot's source) and run it again. Nothing was changed." ;;
  esac
done
# door_files: the front door's compose file, from the image, and the images .env pins. An update writes them in its
# phase front-door, after every account moved: until then the front door, and an account a sign-up link makes, stay on
# the version before.
door_files() {
  image_file compose.front-door.yaml > "$DOOR/compose.yaml.new" || die "Couldn't read compose.front-door.yaml from the image."
  mv "$DOOR/compose.yaml.new" "$DOOR/compose.yaml"
  [ "$IMAGE" = "$IMAGES/bot-dot:latest" ] || set_env "$ENV" BOT_DOT_IMAGE "$IMAGE"
  # Only the pin of an earlier run stays when the newer computer could not be downloaded now.
  set_env "$ENV" BOT_DOT_COMPUTER_IMAGE "$COMPUTER_IMAGE"
  # The signed release's version number, so that an update to a named version older than it is refused (#979).
  [ -z "${SERVER_RELEASE:-}" ] || set_env "$ENV" BOT_DOT_RELEASE "$SERVER_RELEASE"
}
[ "$MODE" != install ] || door_files
# From here .env names the images: the names this run was given would beat it in compose, and a tag there
# would be downloaded unchecked.
unset BOT_DOT_IMAGE BOT_DOT_COMPUTER_IMAGE

# Refuse an old image before promising review access it does not implement.
if [ -n "${BOT_DOT_DEMO_CODE_SHA256:-}" ]; then
  image_file front-door.js | grep FRONT_DOOR_DEMO_CODE_SHA256 >/dev/null || die "This release does not support demo access. Install a release with demo support."
fi

# Reading JSON with the image's own Node, so the machine doesn't need jq.
json() { $D run --rm -i --entrypoint node "$IMAGE" -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(String(($1)??''))}catch{}})"; }

# hand_images NAME: botdot's images in the account NAME's own Docker ($A): from the registry, pinned by the digests
# checked above, after the images it no longer uses went (clean_images), or the self-built ones from the machine's
# Docker, when the account's differ.
# same_image IMAGE: the account's Docker ($A) has the machine's IMAGE already, the same build.
same_image() {
  have="$($A image inspect --format '{{.Id}}' "$1" </dev/null 2>/dev/null || true)"
  [ -n "$have" ] && [ "$have" = "$($D image inspect --format '{{.Id}}' "$1" </dev/null 2>/dev/null || true)" ]
}
hand_images() {
  if [ -n "$REGISTRY" ]; then
    # Room first: the images this account's Docker no longer uses go before the new ones come (#190).
    clean_images "$RUN/$1/docker.sock" "$IMAGE" "$(get_env "$ACCOUNTS/$1/.env" BOT_DOT_IMAGE)" "$(get_env "$ACCOUNTS/$1/.env" BOT_DOT_COMPUTER_IMAGE)" "$IMAGE" "$COMPUTER_IMAGE"
    if [ -n "$MANAGED" ] && ! same_image "$IMAGE"; then
      # The machine has already verified and downloaded this digest. Avoid another registry transfer.
      # pipefail is not POSIX: an archive makes failures of save and load independently visible.
      hi_archive="$RUN/server-image.tar"
      $D save -o "$hi_archive" "$IMAGE" </dev/null || die "Couldn't export $IMAGE."
      $A load -q -i "$hi_archive" </dev/null || { rm -f "$hi_archive"; die "Couldn't hand $IMAGE to $1."; }
      rm -f "$hi_archive"
    else
      pull "$IMAGE" "$A" || die "Couldn't download $IMAGE for the account $1$(because)."
    fi
  elif ! same_image "$IMAGE"; then
    $D save "$IMAGE" </dev/null | $A load -q >/dev/null || die "Couldn't hand $IMAGE to the account $1."
  fi
  case "$COMPUTER_READY" in
    # Only into an account without a computer: one that has it is kept on the image it was made from (ADR 035), so a
    # newer one downloaded at every update only filled its disk, about 7 GB each (#191). .env pins it, and botdot
    # downloads it when the computer is updated or reset, then removes the old one.
    pull)
      if [ -n "$($A ps -aq --filter label=botdot.computer=account </dev/null 2>/dev/null || true)" ]; then
        ok "The bots' computer keeps its image; its Update or reset takes the newest"
      else
        if [ -n "$MANAGED" ]; then
          install -d -m 700 "$DIR/computer-preparation"
          rm -f "$DIR/computer-preparation/$1.blocked"
          printf '%s\n' "$COMPUTER_IMAGE" > "$DIR/computer-preparation/$1.new"
          chmod 600 "$DIR/computer-preparation/$1.new"
          mv "$DIR/computer-preparation/$1.new" "$DIR/computer-preparation/$1"
          write_status computer-preparation.json "{\"state\":\"preparing\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
          ok "The bots' computer will download in the background"
        else
          say "Downloading the bots' computer (about 7 GB the first time)…"
          pull "$COMPUTER_IMAGE" "$A" && ok "Bots' computer image is up to date" || warn "Couldn't download the bots' computer now; botdot tries again when a bot needs it."
        fi
      fi ;;
    load)
      if ! same_image "$COMPUTER_IMAGE"; then
        $D save "$COMPUTER_IMAGE" </dev/null | $A load -q >/dev/null || warn "Couldn't hand $COMPUTER_IMAGE to the account $1; botdot builds it when a bot first needs one."
      fi ;;
  esac
}

# remove_unnamed: in the account's Docker ($A) of a self-built install, the images a newer build left without a name
# go, each by its id and never forced: one a container still uses (a stopped bot's computer) stays. Only botdot puts
# images in an account's Docker, and its signed images are cleaned by botdot itself (lib/image-cleanup.js).
remove_unnamed() {
  [ -z "$REGISTRY" ] || return 0
  for was in $($A image ls -q --no-trunc --filter dangling=true </dev/null 2>/dev/null || true); do
    case "$was" in sha256:*) $A image rm "$was" </dev/null >/dev/null 2>&1 || true ;; esac
  done
}

# runtimes_ok NAME: the account NAME's Docker ($A) runs its containers under gVisor, with every runtime the version's
# compose file names (runsc-uds). A Docker without one stops the account's server half updated ("unknown or invalid
# runtime name"), so the installer stops before it writes the new compose file.
runtimes_ok() {
  [ "$($A info --format '{{.DefaultRuntime}}' </dev/null 2>/dev/null)" = runsc ] || die "The account $1's Docker doesn't run its containers under gVisor."
  have=" $($A info --format '{{range $k, $v := .Runtimes}}{{$k}} {{end}}' </dev/null 2>/dev/null) "
  for rt in $(printf '%s\n' "$ACCOUNT_COMPOSE" | sed -n 's/^ *runtime: *\([A-Za-z0-9_.-]*\).*/\1/p' | sort -u); do
    case "$have" in *" $rt "*) ;; *) die "The account $1's Docker has no $rt runtime, which this version's compose file needs.$( [ -n "$SYSTEMD" ] && printf ' Restart it (systemctl restart botdot-account@%s) and run this again.' "$1" || printf ' Restart it and run this again.')" ;; esac
  done
}

# ---------------------------------------------------------------------------------------------
# 3. How people reach botdot, and the admin's account

# host_time_zone [ETC]: the machine's time zone (from timedatectl, ETC/timezone or the link ETC/localtime), or
# UTC when it has none.
host_time_zone() {
  zone="$(timedatectl show -p Timezone --value 2>/dev/null || true)"
  [ -n "$zone" ] || zone="$(cat "${1:-/etc}/timezone" 2>/dev/null || true)"
  [ -n "$zone" ] || zone="$(readlink "${1:-/etc}/localtime" 2>/dev/null | sed 's#.*/zoneinfo/##' || true)"
  case "$zone" in '' | /* | .* | *[!A-Za-z0-9_+/-]*) zone=UTC ;; esac
  printf '%s\n' "$zone"
}
# Schedules use the machine's time zone, which compose hands to each account's botdot server until the account's own
# setup page chooses another.
[ -n "$(get_env "$ENV" TZ)" ] || set_env "$ENV" TZ "$(host_time_zone)"
TZ_NAME="$(get_env "$ENV" TZ)"
# This machine's id (#982), made once and kept: it goes in the names of its accounts' machines on boat.dev, so that
# the same account name on two botdot machines reads apart there.
case "$(get_env "$ENV" BOT_DOT_INSTANCE)" in
  '' | *[!a-z0-9]*) set_env "$ENV" BOT_DOT_INSTANCE "$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')" ;;
esac
INSTANCE="$(get_env "$ENV" BOT_DOT_INSTANCE)"
[ "$MODE" != install ] || ok "Time zone $TZ_NAME (change TZ in $ENV)"

# An update asks nothing, here neither: how people reach botdot and the admin's name are what the install answered.
if [ "$MODE" = update ]; then
  REACH="$(get_env "$ENV" BOT_DOT_REACH)"
  DOMAIN="$(get_env "$ENV" BOT_DOT_DOMAIN)"
  ORIGIN="$(get_env "$ENV" FRONT_DOOR_ORIGIN)"
  NAME="${ORIGIN#https://}"
  ADMIN="$(get_env "$ENV" FRONT_DOOR_ADMIN)"
  if [ "$REACH" = local ]; then
    NAME="${ORIGIN#http://}"
    DOOR_PORT="$(get_env "$ENV" FRONT_DOOR_PORT)" SITES_PORT="$(get_env "$ENV" FRONT_DOOR_SITES_PORT)"
    [ "$NAME" = "localhost:$DOOR_PORT" ] && [ -n "$SITES_PORT" ] || NAME=''
  fi
  { [ "$REACH" = tailnet ] || [ "$REACH" = local ] || { [ "$REACH" = public ] && [ -n "$DOMAIN" ]; }; } && [ -n "$NAME" ] && valid_account "$ADMIN" \
    || die "$ENV doesn't say how people reach botdot or the admin's name, so the update stopped. Run the installer yourself: sudo sh install.sh"
fi

if [ "$MODE" = install ]; then

# A managed machine is chosen at the first install, never asked, and kept: a machine installed without it stays so.
if [ -z "$MANAGED" ] && [ "${BOT_DOT_MANAGED:-}" = 1 ]; then
  [ -z "$(get_env "$ENV" FRONT_DOOR_ADMIN)" ] \
    || die "This machine isn't managed, and that is chosen at its first install, so nothing was changed."
  MANAGED=1
  GUARD=1
  DEFAULT_SHARE="$MANAGED_SHARE"
fi
case "${BOT_DOT_MANAGED:-}" in '' | 0 | 1) ;; *) die "BOT_DOT_MANAGED is 1, or nothing for a machine that isn't managed." ;; esac

# A passkey belongs to one address, so it is chosen once: a rerun keeps it. A botdot on this computer only (local) is
# never offered: only the desktop app, which gives the answer, installs one.
REACH="$(get_env "$ENV" BOT_DOT_REACH)"
if [ -z "$REACH" ]; then
  REACH="${BOT_DOT_REACH:-}"
  while [ "$REACH" != public ] && [ "$REACH" != tailnet ] && [ "$REACH" != local ]; do
    unanswered "How will people reach botdot?"
    say ""
    say "How will people reach botdot?"
    say "  1) a public domain: HTTPS from Caddy, which fetches its own certificate (ports 80, 443 and 8443 must be free)"
    say "  2) a tailnet only: Tailscale Serve gives it an HTTPS name, and nothing is on the internet"
    printf 'Choose 1 or 2: '
    read_line
    case "$REPLY" in 1 | public) REACH=public ;; 2 | tailnet) REACH=tailnet ;; '') die "No answer, so nothing more was changed." ;; esac
  done
fi
# valid_domain NAME: a host name of letters, digits, dashes and dots, with a dot.
valid_domain() { printf '%s' "$1" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$'; }
# public_ip URL: this machine's address as the internet sees it, from Cloudflare's trace (an address, so no DNS);
# empty when it can't be had in 5 seconds.
public_ip() { curl -fsS --max-time 5 "$1" </dev/null 2>/dev/null | sed -n 's/^ip=\([0-9a-fA-F.:]*\)$/\1/p' | head -n 1 || true; }
# resolved FAMILY: the addresses $NAME resolves to now (ahostsv4 or ahostsv6), on one line; loopback and the IPv4 in
# IPv6 left out.
resolved() { getent "$1" "$NAME" </dev/null 2>/dev/null | awk '{print $1}' | grep -Ev '^(127\.|::1$|::ffff:)' | sort -u | tr '\n' ' ' | sed 's/ $//' || true; }
# dns_check: whether $NAME points at this machine; when it doesn't, the exact records to set. Returns 1 then.
dns_check() {
  ip4_="$(public_ip https://1.1.1.1/cdn-cgi/trace)"
  ip6_="$(public_ip 'https://[2606:4700:4700::1111]/cdn-cgi/trace')"
  case "$ip6_" in *:*) ;; *) ip6_='' ;; esac
  case "$ip4_" in *.*.*.*) ;; *) ip4_='' ;; esac
  now4_="$(resolved ahostsv4)" now6_="$(resolved ahostsv6)"
  if [ -n "$ip4_" ] && [ "$now4_" = "$ip4_" ] && { [ -z "$now6_" ] || [ "$now6_" = "$ip6_" ]; }; then
    ok "$NAME points at this machine ($ip4_${now6_:+, $now6_})"
    return 0
  fi
  if [ -z "$ip4_" ] && [ -z "$ip6_" ]; then
    warn "Point $NAME at this machine's public IP address: an A record (and AAAA for IPv6). This machine couldn't find its address."
  else
    warn "Set this DNS for $NAME at your domain's provider:"
    [ -z "$ip4_" ] || printf '      A     %s  %s\n' "$NAME" "$ip4_"
    [ -z "$ip6_" ] || printf '      AAAA  %s  %s\n' "$NAME" "$ip6_"
  fi
  if [ -n "$now4_$now6_" ]; then say "    Now it points at $(printf '%s %s' "$now4_" "$now6_" | sed 's/^ *//; s/ *$//; s/  */, /g')."
  else say "    Now it doesn't resolve."; fi
  [ -z "$now6_" ] || [ -n "$ip6_" ] || say "    Remove its AAAA record: this machine has no IPv6."
  # Cloudflare's proxy (the orange cloud) answers in place of this machine, so Caddy never gets the certificate.
  for a_ in $now4_ $now6_; do
    case "$a_" in 104.1[6-9].* | 104.2[0-7].* | 172.6[4-9].* | 172.7[01].* | 188.114.9[6-9].* | 162.15[89].* | 2606:4700:* | 2a06:98c0:*)
      say "    That is Cloudflare's proxy: set the record to DNS only (grey cloud)."
      break ;;
    esac
  done
  return 1
}
if [ "$REACH" = public ]; then
  DOMAIN="$(get_env "$ENV" BOT_DOT_DOMAIN)"
  DOMAIN="${DOMAIN:-${BOT_DOT_DOMAIN:-}}"
  while ! valid_domain "$DOMAIN"; do
    [ -z "$DOMAIN" ] || warn "$DOMAIN isn't a domain name."
    unanswered "The domain botdot answers on"
    printf 'The domain botdot answers on (its DNS must point at this machine), e.g. botdot.example.com: '
    read_line
    DOMAIN="$(printf '%s' "$REPLY" | tr 'A-Z' 'a-z')"
    [ -n "$DOMAIN" ] || die "No domain, so nothing more was changed."
  done
  NAME="$DOMAIN"
  # Shown before the long downloads, so the record can be set while they run. A test machine's domain isn't on the internet.
  if [ "$MODE" = install ] && [ "${BOT_DOT_TLS:-$(get_env "$ENV" BOT_DOT_TLS)}" != internal ]; then dns_check || true; fi
elif [ "$REACH" = local ]; then
  # On this computer only (ADR 136): localhost, which a passkey can belong to (127.0.0.1 can't), on the port the
  # install chose, and bots' interactive pages on the next one, an origin of its own.
  DOOR_PORT="$(get_env "$ENV" FRONT_DOOR_PORT)"
  DOOR_PORT="${DOOR_PORT:-${BOT_DOT_PORT:-4700}}"
  case "$DOOR_PORT" in '' | 0* | *[!0-9]*) die "BOT_DOT_PORT: a port is a number from 1024 to 65534." ;; esac
  [ "$DOOR_PORT" -ge 1024 ] && [ "$DOOR_PORT" -le 65534 ] || die "BOT_DOT_PORT: a port is a number from 1024 to 65534."
  SITES_PORT=$((DOOR_PORT + 1))
  NAME="localhost:$DOOR_PORT"
  set_env "$ENV" FRONT_DOOR_PORT "$DOOR_PORT"
  # The setup key that makes the one account's passkey: made once, in .env alone, which only root reads.
  [ -n "$(get_env "$ENV" FRONT_DOOR_SETUP_KEY)" ] || set_env "$ENV" FRONT_DOOR_SETUP_KEY "$(new_setup_key)"
else
  if ! command -v tailscale >/dev/null 2>&1; then
    ask "botdot on a tailnet needs Tailscale. Install it now?" y || die "botdot on a tailnet needs Tailscale (https://tailscale.com/download). Install it and run this again."
    say "Installing Tailscale…"
    curl -fsSL https://tailscale.com/install.sh | sh
  fi
  if ! tailscale status >/dev/null 2>&1; then
    unanswered "Sign this machine in to your tailnet"
    say "Sign this machine in to your tailnet (open the link it shows):"
    tailscale up </dev/null
  fi
  NAME="$(tailscale status --json 2>/dev/null | json 'j.Self.DNSName.replace(/\.$/,"")' || true)"
  [ -n "$NAME" ] || die "Couldn't read this machine's Tailscale name. Check \`tailscale status\` and run this again."
  SAVED="$(get_env "$ENV" FRONT_DOOR_ORIGIN)"
  [ -z "$SAVED" ] || [ "$SAVED" = "https://$NAME" ] || warn "This machine's Tailscale name is now $NAME, not ${SAVED#https://}: passkeys made for the old name no longer sign in."
fi
ORIGIN="https://$NAME"
[ "$REACH" != local ] || ORIGIN="http://$NAME"
[ -z "$MANAGED" ] || [ "$REACH" != local ] || die "A managed machine is reached on a public domain or a tailnet, not on this computer only."
# On the owner's Linux computer itself (ADR 170): chosen with local at the first install, never later, and kept.
case "${BOT_DOT_LOCAL_HOST:-}" in '' | 0 | 1) ;; *) die "BOT_DOT_LOCAL_HOST is 1, or nothing for a botdot in a VM of its own." ;; esac
if [ -z "$LOCAL_HOST" ] && [ "${BOT_DOT_LOCAL_HOST:-}" = 1 ]; then
  [ "$REACH" = local ] || die "BOT_DOT_LOCAL_HOST goes with BOT_DOT_REACH=local alone."
  [ -z "$(get_env "$ENV" FRONT_DOOR_ADMIN)" ] \
    || die "This botdot runs in a VM of its own, and that is chosen at its first install, so nothing was changed."
  LOCAL_HOST=1
  GUARD=1
fi
[ -z "$LOCAL_HOST" ] || set_env "$ENV" BOT_DOT_LOCAL_HOST 1
set_env "$ENV" BOT_DOT_REACH "$REACH"
[ "$REACH" != public ] || set_env "$ENV" BOT_DOT_DOMAIN "$DOMAIN"
set_env "$ENV" FRONT_DOOR_ORIGIN "$ORIGIN"

# The admin's own account: an ordinary account, made by the install's sign-up link. On this computer only, and on a
# managed machine, it is the first account, made with the setup key, which is no admin, and its name is never asked.
ADMIN="$(get_env "$ENV" FRONT_DOOR_ADMIN)"
FIRST=''
[ -n "$ADMIN" ] || FIRST=1
ADMIN="${ADMIN:-${BOT_DOT_ADMIN:-}}"
[ "$REACH" != local ] && [ -z "$MANAGED" ] || ADMIN="${ADMIN:-owner}"
if [ -z "$ADMIN" ]; then
  SUGGEST="$(printf '%s' "${SUDO_USER:-}" | tr 'A-Z_.' 'a-z--' | sed 's/[^a-z0-9-]//g; s/^[^a-z]*//' | cut -c1-24)"
  valid_account "$SUGGEST" || SUGGEST=''
  while ! valid_account "$ADMIN"; do
    [ -z "$ADMIN" ] || warn "An account's name is $ACCOUNT_RULE."
    unanswered "Your own account's name, the admin's"
    say ""
    printf "Your own account's name, the admin's (%s)%s: " "$ACCOUNT_RULE" "${SUGGEST:+ [$SUGGEST]}"
    read_line
    ADMIN="${REPLY:-$SUGGEST}"
    [ -n "$ADMIN" ] || die "No name, so nothing more was changed."
  done
fi
valid_account "$ADMIN" || die "BOT_DOT_ADMIN: an account's name is $ACCOUNT_RULE."
set_env "$ENV" FRONT_DOOR_ADMIN "$ADMIN"
[ "$REACH" != local ] || set_env "$ENV" FRONT_DOOR_ONE_ACCOUNT "$ADMIN"

# A managed machine's variant (ADR 154): one account or several, kept; one grows into several without a reinstall, and
# goes back only while it has no account but its first.
if [ -n "$MANAGED" ]; then
  VARIANT_WAS="$(get_env "$ENV" BOT_DOT_VARIANT)"
  VARIANT="${BOT_DOT_VARIANT:-${VARIANT_WAS:-one}}"
  case "$VARIANT" in one | several) ;; *) die "BOT_DOT_VARIANT is one or several." ;; esac
  # The accounts this machine has: those made on it, and those the front door asked for that aren't made yet.
  HELD_ACCOUNTS="$(managed_accounts)"
  if [ "$VARIANT" = one ] && [ "$VARIANT_WAS" = several ]; then
    OTHERS="$(printf '%s\n' "$HELD_ACCOUNTS" | grep -vx "$ADMIN" | grep . | tr '\n' ' ' | sed 's/ $//' || true)"
    [ -z "$OTHERS" ] || die "This machine holds more accounts than $ADMIN ($OTHERS), so it stays a machine of several accounts. Nothing was changed."
  fi
  HELD_COUNT="$(printf '%s\n' "$HELD_ACCOUNTS" | grep -c . || true)"
  [ "${HELD_COUNT:-0}" -gt 0 ] || HELD_COUNT=1
  room_for_shares "$HELD_COUNT"
  set_env "$ENV" BOT_DOT_MANAGED 1
  set_env "$ENV" BOT_DOT_VARIANT "$VARIANT"
  set_env "$ENV" FRONT_DOOR_MANAGED 1
  if [ "$VARIANT" = one ]; then
    set_env "$ENV" FRONT_DOOR_ONE_ACCOUNT "$ADMIN"
    set_env "$ENV" FRONT_DOOR_FIRST_ACCOUNT ''
  else
    set_env "$ENV" FRONT_DOOR_ONE_ACCOUNT ''
    set_env "$ENV" FRONT_DOOR_FIRST_ACCOUNT "$ADMIN"
  fi
  [ -n "$(get_env "$ENV" FRONT_DOOR_SETUP_KEY)" ] || set_env "$ENV" FRONT_DOOR_SETUP_KEY "$(new_setup_key)"
  [ -z "$VARIANT_WAS" ] || [ "$VARIANT_WAS" = "$VARIANT" ] || ok "This machine now holds $([ "$VARIANT" = one ] && echo 'one account' || echo 'several accounts'): its accounts and passkeys are kept"
fi

# Review access is chosen only for a fresh dedicated managed machine. Never convert an existing customer in place.
if [ -n "${BOT_DOT_DEMO_CODE_SHA256:-}" ]; then
  [ -n "$MANAGED" ] && [ "$VARIANT" = one ] || die "Demo requires a managed one-account machine."
  printf '%s' "$BOT_DOT_DEMO_CODE_SHA256" | grep -Eqx '[0-9a-f]{64}' || die "Invalid demo code hash."
  [ -n "$(get_env "$ENV" FRONT_DOOR_DEMO_CODE_SHA256)" ] || [ -z "$VARIANT_WAS" ] || die "Demo must be chosen at the first install."
  set_env "$ENV" FRONT_DOOR_DEMO_CODE_SHA256 "$BOT_DOT_DEMO_CODE_SHA256"
fi

# Jev, the decision model, boat.dev, the External Virtual PC (#513, #529), and Composio for the admin's own account's
# connectors (ADR 161): each asked once, on the first install, never on this computer only, which has no admin page.
# BOT_DOT_OPENROUTER_KEY, BOT_DOT_BOAT_KEY and BOT_DOT_COMPOSIO_KEY answer beforehand (empty: no), on any install. A key
# is checked as the admin page (the Connectors page for Composio) checks it, with the image's own check, and handed to
# the front door in data/install-keys.json, which it takes and removes; one that isn't taken is set on that page.
# check_key LIB KEY: ok, refused, billing or unreachable. The key goes on standard input, never on a command line.
check_key() {
  printf '%s' "$2" | $D run --rm -i --entrypoint node "$IMAGE" -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{require("./lib/"+process.argv[1]).checkKey(s.trim()).then((r)=>process.stdout.write(r),()=>process.stdout.write("unreachable"))})' "$1" 2>/dev/null || true
}
# take_key LIB SERVICE VAR "Question" "Prompt" LINK PAGE -> KEY_TAKEN: the key VAR gives or the person pastes, once
# checked; empty for none. LINK is where the key is made, shown before its prompt; PAGE where it is set later.
take_key() {
  KEY_TAKEN=''
  eval "given_set=\${$3+1} given=\${$3:-}"
  if [ -n "$given_set" ]; then
    [ -n "$given" ] || return 0
    case "$(check_key "$1" "$given")" in
      ok) KEY_TAKEN="$given"; ok "$2 key set" ;;
      refused) warn "$2 refused $3: set the key on the $7." ;;
      billing) warn "boat.dev wants a plan or a payment method on this account first: set the key on the $7 then." ;;
      *) warn "$2 couldn't be reached: set the key on the $7." ;;
    esac
    return 0
  fi
  [ -n "$FIRST" ] && [ -z "$UNATTENDED" ] && [ -z "$MANAGED" ] || return 0
  while ask "$4" n; do
    say "  $6"
    ask_secret "$5"
    [ -n "$REPLY" ] || return 0
    case "$(check_key "$1" "$REPLY")" in
      ok) KEY_TAKEN="$REPLY"; ok "$2 key set"; return 0 ;;
      refused) warn "$2 refused this key." ;;
      billing) warn "boat.dev wants a plan or a payment method on this account first: set the key on the $7 then."; return 0 ;;
      *) warn "$2 couldn't be reached: set the key on the $7."; return 0 ;;
    esac
  done
}
if [ "$REACH" != local ]; then
  # Said once before the three optional keys' questions, on a first install that asks them.
  if [ -n "$FIRST" ] && [ -z "$UNATTENDED" ] && [ -z "$MANAGED" ] \
    && [ -z "${BOT_DOT_OPENROUTER_KEY+1}${BOT_DOT_BOAT_KEY+1}${BOT_DOT_COMPOSIO_KEY+1}" ]; then
    say ""
    say "Three optional services follow. botdot works without them: answer n to skip, and set each later."
    say "  Jev: a small model on OpenRouter that picks which bot answers in a group chat, in place of Claude Haiku."
    say "  boat.dev: a paid cloud computer for the bots, in place of the one on this machine."
    say "  Composio: bots use your apps, such as Gmail, Slack or GitHub."
  fi
  take_key group-router OpenRouter BOT_DOT_OPENROUTER_KEY "Use Jev as the decision model?" "OpenRouter key:" \
    https://openrouter.ai/settings/keys "admin page"
  OPENROUTER_KEY="$KEY_TAKEN"
  take_key boat boat.dev BOT_DOT_BOAT_KEY "Use boat.dev for the External Virtual PC?" "boat.dev API key:" \
    'https://boat.dev/dashboard?tab=api-keys' "admin page"
  BOAT_KEY="$KEY_TAKEN"
  take_key connectors Composio BOT_DOT_COMPOSIO_KEY "Use Composio for connectors?" "Composio API key:" \
    https://platform.composio.dev "Apps page"
  COMPOSIO_KEY="$KEY_TAKEN"
  # A checked key is letters, digits, dashes and underscores alone (KEY in lib/group-router.js, lib/boat.js and
  # lib/connectors.js checkKey).
  if [ -n "$OPENROUTER_KEY$BOAT_KEY$COMPOSIO_KEY" ]; then
    json_key() { if [ -n "$1" ]; then printf '"%s"' "$1"; else printf null; fi; }
    (umask 077; printf '{"openrouter":%s,"boat":%s,"composio":%s}\n' "$(json_key "$OPENROUTER_KEY")" "$(json_key "$BOAT_KEY")" "$(json_key "$COMPOSIO_KEY")" > "$DOOR/data/install-keys.json")
  fi
fi
fi
case "$MODE" in install | update) docker_upgrades ;; esac

# running_accounts: each account whose Docker runs now, one name a line. A stopped (suspended) one gets the new version
# when it is resumed.
running_accounts() {
  for ra in "$ACCOUNTS"/*/; do
    ra="$(basename "$ra")"
    valid_account "$ra" && [ -f "$ACCOUNTS/$ra/compose.yaml" ] || continue
    env DOCKER_HOST="unix://$RUN/$ra/docker.sock" docker info </dev/null >/dev/null 2>&1 || continue
    printf '%s\n' "$ra"
  done
}

if [ "$MODE" = install ] || [ "$MODE" = update ]; then
# The new version goes into every running account's Docker before anything restarts (#473). An account whose download
# fails keeps the version it runs, and the others go on (#194): its reason waits in HELD for each_account. A stopped
# (suspended) account gets it when it is resumed. Each account's room was made and checked before the machine's
# download (room_for_accounts: an update's phases clean and preflight).
HELD="$RUN/update-held"
rm -rf "$HELD"
mkdir -p "$HELD"
for other in $(running_accounts); do
  A="env DOCKER_HOST=unix://$RUN/$other/docker.sock docker"
  phase download "$other"
  set +e
  ( set -e; ACCOUNT_WHY="$HELD/$other"; hand_images "$other" ) || [ -s "$HELD/$other" ] \
    || printf 'kept\tThe new version could not be put in its Docker.\n' > "$HELD/$other"
  set -e
done
fi

if [ "$MODE" = install ] || [ "$MODE" = update ]; then

# ---------------------------------------------------------------------------------------------
# 4. The front door

if ! id -u "$DOOR_USER" >/dev/null 2>&1; then
  useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$DOOR_USER" </dev/null \
    || die "Couldn't make the front door's user, $DOOR_USER."
fi
chown "$(id -u "$DOOR_USER"):$(id -g "$DOOR_USER")" "$DOOR/data"
chmod 700 "$DOOR/data"
# The keys the install took (above), the front door's to take.
[ ! -f "$DOOR/data/install-keys.json" ] || { chown "$(id -u "$DOOR_USER"):$(id -g "$DOOR_USER")" "$DOOR/data/install-keys.json"; chmod 600 "$DOOR/data/install-keys.json"; }
# Where the front door asks for new accounts: it may add and remove files there, and root's step reads their names.
# Sticky, so the front door may rename or remove only its own files there, never a request root made (the console's
# agent writes BACKUP, RESTORE, KEYS and others there as root): without it the front door could rename root's BACKUP to
# RESTORE, which by_root would take as root's. On an update too, for a machine installed before.
mkdir -p "$REQUESTS"
chown "0:$(id -g "$DOOR_USER")" "$REQUESTS"
chmod 1770 "$REQUESTS"
# What root's step says back: the version installed and the last update. Only root writes there.
mkdir -p "$DOOR/status"
chown 0:0 "$DOOR/status"
chmod 755 "$DOOR/status"
# Where root's step writes the load the admin page shows: root's, read by the front door's group alone.
mkdir -p "$LOAD"
chown "0:$(id -g "$DOOR_USER")" "$LOAD"
chmod 750 "$LOAD"
set_env "$ENV" FRONT_DOOR_USER "$(id -u "$DOOR_USER"):$(id -g "$DOOR_USER")"
set_env "$ENV" BOT_DOT_SOCKETS "$SOCKETS"
set_env "$ENV" COMPOSE_PROJECT_NAME botdot
# The Android app's signing keys, whose passkey sign-in the front door takes (docs/api.md): given once, kept.
[ -z "${FRONT_DOOR_ANDROID_KEYS:-}" ] || set_env "$ENV" FRONT_DOOR_ANDROID_KEYS "$FRONT_DOOR_ANDROID_KEYS"
# The terms and the privacy policy an owner agrees to at sign-up, and their version (#987): given once, kept; a
# new FRONT_DOOR_TERMS_VERSION asks every owner once more at their next sign-in. Unset, nothing is asked.
for setting in FRONT_DOOR_TERMS_URL FRONT_DOOR_PRIVACY_URL FRONT_DOOR_TERMS_VERSION; do
  eval "given=\${$setting:-}"
  [ -z "$given" ] || set_env "$ENV" "$setting" "$given"
done
# Bots' interactive pages (#399, ADR 072): the same name on port 8443, an origin of its own, which the front door
# answers on its second port. An update sets it up on an install made before it.
if [ "$REACH" = local ]; then set_env "$ENV" FRONT_DOOR_SITES_ORIGIN "http://localhost:$SITES_PORT"
else set_env "$ENV" FRONT_DOOR_SITES_ORIGIN "https://$NAME:$SITES_HTTPS"; fi
set_env "$ENV" FRONT_DOOR_SITES_PORT "$SITES_PORT"
CADDY_CHANGED=''
if [ "$REACH" = public ]; then
  set_env "$ENV" COMPOSE_PROFILES public
  TLS="${BOT_DOT_TLS:-$(get_env "$ENV" BOT_DOT_TLS)}"
  [ "$TLS" != internal ] || set_env "$ENV" BOT_DOT_TLS internal
  {
    printf '# botdot (install.sh): HTTPS for the front door on its public domain. Caddy fetches the certificate.\n'
    printf '%s {\n' "$DOMAIN"
    [ "$TLS" != internal ] || printf '\ttls internal\n'
    printf '\treverse_proxy 127.0.0.1:%s\n' "$DOOR_PORT"
    # HTTPS only, for a year, on this domain alone: the owner's other subdomains aren't botdot's (#72).
    printf '\theader Strict-Transport-Security "max-age=31536000"\n}\n'
    # The sandbox's address, with the same certificate: the front door adds the sandbox's rules to every answer.
    printf '%s:%s {\n' "$DOMAIN" "$SITES_HTTPS"
    [ "$TLS" != internal ] || printf '\ttls internal\n'
    printf '\treverse_proxy 127.0.0.1:%s\n}\n' "$SITES_PORT"
  } > "$DOOR/Caddyfile.new"
  # Caddy reads its file when it starts: one that changed (an update that adds the sandbox's address) restarts it.
  cmp -s "$DOOR/Caddyfile.new" "$DOOR/Caddyfile" 2>/dev/null || CADDY_CHANGED=1
  mv -f "$DOOR/Caddyfile.new" "$DOOR/Caddyfile"
else
  set_env "$ENV" COMPOSE_PROFILES ''
fi

DOOR_COMPOSE="$D compose --project-directory $DOOR"
# start_door: the front door (and Caddy) on what .env names, until it answers. An update starts it in its phase
# front-door, after the accounts.
start_door() {
  # A front door that doesn't know one account would make the admin's sign-up link and an admin page on this computer.
  [ "$REACH" != local ] || grep -q FRONT_DOOR_ONE_ACCOUNT "$DOOR/compose.yaml" \
    || die "This version of botdot can't run on this computer only: its front door has no one-account mode. Take a newer one."
  # Nor one without a managed mode on a managed machine: it would make an admin page.
  [ -z "$MANAGED" ] || grep -q FRONT_DOOR_MANAGED "$DOOR/compose.yaml" \
    || die "This version of botdot has no managed mode, so it can't run on this machine. Take a newer one."
  $DOOR_COMPOSE up -d --remove-orphans </dev/null >/dev/null 2>&1 || $DOOR_COMPOSE up -d --remove-orphans </dev/null
  [ -z "$CADDY_CHANGED" ] || $DOOR_COMPOSE restart caddy </dev/null >/dev/null 2>&1 || warn "Caddy didn't restart with its new settings. Restart it: cd $DOOR && docker compose restart caddy"
  CADDY_CHANGED=''
  i=0
  until curl -fsS -o /dev/null -H "Host: $NAME" "http://127.0.0.1:$DOOR_PORT/api/version" 2>/dev/null; do
    i=$((i + 1))
    [ "$i" -lt 60 ] || die "The front door didn't start. See what went wrong with: cd $DOOR && docker compose logs front-door"
    sleep 1
  done
  ok "The front door is running"
}
[ "$MODE" != install ] || start_door
fi

# ---------------------------------------------------------------------------------------------
# 5. The accounts: the admin's, and on a rerun every account this machine has

# The unit that starts an account's rootless Docker as its own user, when systemd runs this machine. It mounts the
# account's disk as its home first (as root, `+`), and doesn't start without it: rootless Docker would fill the bare
# folder beneath. Its CPU and RAM share are set on it (systemctl set-property, kept in /etc/systemd/system.control).
if [ -n "$SYSTEMD" ] && { [ "$MODE" = install ] || [ "$MODE" = update ]; }; then
  # On a managed machine, and on the owner's own computer, it starts only behind the guard of its computers (#984).
  EGRESS_UNIT=''
  [ -z "$GUARD" ] || EGRESS_UNIT='
Requires=botdot-egress.service
After=botdot-egress.service'
  cat > "$ETC/systemd/system/botdot-account@.service.new" <<UNIT
# botdot (install.sh): the rootless Docker of the account %i, as its own Linux user, botdot-%i (ADR 028).
[Unit]
Description=botdot: the rootless Docker of the account %i
Wants=network-online.target
After=network-online.target$EGRESS_UNIT

[Service]
User=botdot-%i
Environment=HOME=$ACCOUNTS/%i
Environment=XDG_RUNTIME_DIR=$RUN/%i
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
RuntimeDirectory=${RUN#/run/}/%i
RuntimeDirectoryMode=0700
ExecStartPre=+/bin/sh -c '[ ! -f $DISKS/%i.img ] || mountpoint -q $ACCOUNTS/%i || mount -o loop $DISKS/%i.img $ACCOUNTS/%i'
ExecStart=$ROOTLESS
Delegate=yes
Restart=always
RestartSec=2
KillMode=mixed
TimeoutStopSec=90

[Install]
WantedBy=multi-user.target
UNIT
  mv "$ETC/systemd/system/botdot-account@.service.new" "$ETC/systemd/system/botdot-account@.service"
  systemctl daemon-reload </dev/null
fi

# disk NAME GB: the account NAME's disk, an ext4 image of GB, mounted as its home: it fills that and no more, and a run
# that fills it fails with "No space left on the server". A bigger share grows it at once; a smaller one applies to
# accounts made from then on (ext4 doesn't shrink while it is mounted). An account whose home was made before disk
# shares keeps it as it is, without one. Without the machine's tools (mkfs.ext4, losetup) no account has one.
disk() {
  img="$DISKS/$1.img"
  dhome="$ACCOUNTS/$1"
  if ! command -v mkfs.ext4 >/dev/null 2>&1 || ! command -v losetup >/dev/null 2>&1; then
    warn "This machine has no mkfs.ext4 or losetup, so the account $1 has no disk share: it may fill this machine's disk."
    mkdir -p "$dhome"
    return 0
  fi
  if [ ! -f "$img" ]; then
    if [ -n "$(ls -A "$dhome" 2>/dev/null)" ] && ! mountpoint -q "$dhome"; then
      warn "The account $1 was made before disk shares, so it has none: it may fill this machine's disk."
      return 0
    fi
    mkdir -p "$DISKS"
    chmod 700 "$DISKS"
    rm -f "$img.new"
    truncate -s "${2}G" "$img.new"
    mkfs.ext4 -q -F -m 0 "$img.new" </dev/null >/dev/null || die "Couldn't make the disk of the account $1."
    mv "$img.new" "$img"
    chmod 600 "$img"
  fi
  mkdir -p "$dhome"
  mountpoint -q "$dhome" || mount -o loop "$img" "$dhome" </dev/null || die "Couldn't mount the disk of the account $1 ($img)."
  if [ "$(wc -c < "$img" | tr -d ' ')" -lt "$(($2 * 1073741824))" ]; then
    truncate -s "${2}G" "$img"
    dev="$(losetup -j "$img" | head -n 1 | cut -d: -f1)"
    { [ -n "$dev" ] && losetup -c "$dev" </dev/null && resize2fs "$dev" </dev/null >/dev/null 2>&1; } || warn "Couldn't grow the disk of the account $1 to $2 GB now; it grows the next time root's step makes it match."
  fi
}

# share NAME CPU RAM: the account NAME's share of CPU and RAM, hard limits on its unit, applied at once and kept (with
# no MemoryHigh: gVisor's memory cannot be reclaimed, so under one the account stalls for good, at MemoryMax a process
# is ended and the rest goes on, #831), and the limits of its one computer (#108), in a file
# only root writes, which its docker-helper reads as the computer starts (lib/computers.js). It never shows in the
# account.
share() {
  if [ -n "$SYSTEMD" ]; then
    systemctl set-property "botdot-account@$1.service" "CPUQuota=$(($2 * 100))%" "MemoryHigh=infinity" "MemoryMax=$3G" </dev/null \
      || warn "systemd didn't take the CPU and RAM share of the account $1."
  else
    warn "This machine has no systemd, so the CPU and RAM share of the account $1 aren't applied."
  fi
  mkdir -p "$ACCOUNTS/$1/share"
  chown 0:0 "$ACCOUNTS/$1/share"
  chmod 755 "$ACCOUNTS/$1/share"
  printf '{"cpu":%s,"ram":%s}\n' "$2" "$3" > "$ACCOUNTS/$1/share/share.json.new"
  chmod 644 "$ACCOUNTS/$1/share/share.json.new"
  mv "$ACCOUNTS/$1/share/share.json.new" "$ACCOUNTS/$1/share/share.json"
  runsc_share "$ACCOUNTS/$1/share/runsc"
}

# runsc_share FILE: the runtime the account's Docker runs gVisor through (its daemon.json), beside its share.json
# (ADR 152). Under --ignore-cgroups runsc sizes a sandbox by the machine, not the account's unit: a computer on a share
# of 9 GB and 4 CPUs of a 16 GB, 8 CPU machine saw 16 GB and 8 CPUs, and tools that size themselves by that (Chrome,
# make -j, Node's workers) ran past the share and were ended at its limit. As a sandbox is made, runsc reads the RAM
# from a /proc/meminfo whose MemTotal is the share's, in a mount namespace of its own, and runs on as many of the CPUs
# as the share, from a place the account's name picks, so that accounts spread over the machine. Any other call, a
# share that isn't smaller, or a machine without unshare or taskset, is runsc as it is.
runsc_share() {
  cat > "$1.new" <<'SCRIPT'
#!/bin/sh
# botdot (install.sh): gVisor's runsc, sized by the account's share (share.json beside it, ADR 152).
RUNSC='@RUNSC@'
case " $* " in *" create "*|*" run "*|*" restore "*) ;; *) exec "$RUNSC" "$@" ;; esac
here="$(dirname "$0")"
share="$(cat "$here/share.json" 2>/dev/null || true)"
ram="$(printf '%s' "$share" | sed -n 's/.*"ram":\([0-9][0-9]*\).*/\1/p')"
cpu="$(printf '%s' "$share" | sed -n 's/.*"cpu":\([0-9][0-9]*\).*/\1/p')"
cpus=''
if [ -n "$cpu" ] && command -v taskset >/dev/null 2>&1; then
  start="$(basename "$(dirname "$here")" | cksum | cut -d ' ' -f 1)"
  cpus="$(awk -v want="$cpu" -v start="$start" '/^Cpus_allowed_list:/ {
    k = split($2, r, ","); n = 0
    for (i = 1; i <= k; i++) { m = split(r[i], e, "-"); for (c = e[1]; c <= (m > 1 ? e[2] : e[1]); c++) all[n++] = c }
    if (want >= n) exit
    for (i = 0; i < want; i++) out = out (i ? "," : "") all[(start + i) % n]
    print out }' /proc/self/status 2>/dev/null || true)"
fi
mem=''
if [ -n "$ram" ] && command -v unshare >/dev/null 2>&1 && unshare -m true 2>/dev/null; then
  mem="$(mktemp 2>/dev/null || true)"
  awk -v kb="$((ram * 1048576))" '/^MemTotal:/ { if ($2 <= kb) exit 1; print "MemTotal:       " kb " kB"; next } { print }' /proc/meminfo > "$mem" 2>/dev/null || { rm -f "$mem"; mem=''; }
fi
if [ -n "$mem" ]; then
  exec unshare -m sh -c 'mount --bind "$1" /proc/meminfo 2>/dev/null; rm -f "$1"; cpus="$2"; shift 2; if [ -n "$cpus" ]; then exec taskset -c "$cpus" "$@"; fi; exec "$@"' sh "$mem" "$cpus" "$RUNSC" "$@"
fi
if [ -n "$cpus" ]; then exec taskset -c "$cpus" "$RUNSC" "$@"; fi
exec "$RUNSC" "$@"
SCRIPT
  sed -i "s|@RUNSC@|$RUNSC|" "$1.new"
  chmod 755 "$1.new"
  mv "$1.new" "$1"
}

# answers FOLDER HOME: the botdot server whose socket is in FOLDER (an account's, named as it, its compose file in HOME)
# answers, as the front door asks it, within about 2 minutes (90 tries, each a second apart and at most a second long).
# A socket alone isn't enough: a botdot server that stopped leaves its socket behind, and the next one removes it only
# once it starts. One whose container still runs after that is still starting, and gets up to 10 minutes: an account
# held at its memory limit started in 6, and was rolled back and said not to run (#519). BOT_DOT_ANSWER_TRIES sets the
# 90 tries for `make install-real`, whose releases that never start would otherwise wait them out on every run.
answers() {
  i=0
  tries="${BOT_DOT_ANSWER_TRIES:-90}"
  until [ -S "$1/botdot.sock" ] && curl -fsS -o /dev/null --max-time 1 -H "X-Botdot-Account: $(basename "$1")" --unix-socket "$1/botdot.sock" http://botdot/api/version </dev/null 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -ge "$tries" ]; then
      [ "$i" -lt 600 ] && [ -n "$($A compose --project-directory "$2" ps -q --status running bot-dot </dev/null 2>/dev/null)" ] || return 1
      [ "$i" -gt "$tries" ] || say "  The account $(basename "$1")'s botdot server is still starting. Waiting up to 10 minutes."
    fi
    sleep 1
  done
}

# compose_up HOME: the account's botdot server ($A) started from the compose file in HOME, tried twice.
compose_up() {
  $A compose --project-directory "$1" up -d --remove-orphans </dev/null >/dev/null 2>&1 || $A compose --project-directory "$1" up -d --remove-orphans </dev/null
}

# The snapshot of an account (#979, ADR 155): before it switches to another signed version, its botdot server stops and
# a copy of its data folder, with the compose.yaml and .env it ran, is kept in its home as `snapshot`, root's alone, on
# its own disk. The one of its switch before goes first: an account has at most one. A server that doesn't answer gets
# its data back with its version (ADR 044), and a rollback request (ROLLBACK-<name>) takes it back to the snapshot later.
# The snapshot goes as soon as the new server answers: it holds a whole copy of the account's data on its disk, and an
# account of much data would live on a nearly full one. So a rollback request finds one only after a switch that
# didn't finish. None is made when the account's disk wouldn't keep a fifth free after it: the account then switches
# without one.
# snapshot_of NAME: the account's snapshot folder, when it has one this step made: root's own folder (the account's
# user, who owns its home, can rename one but can't make one root's), with the data, compose.yaml and .env in it.
snapshot_of() {
  so_s="$ACCOUNTS/$1/snapshot"
  [ -d "$so_s" ] && [ ! -L "$so_s" ] && [ "$(stat -c %u "$so_s")" = "$(stat -c %u "$ACCOUNTS")" ] || return 1
  [ -d "$so_s/data" ] && [ ! -L "$so_s/data" ] && [ -f "$so_s/compose.yaml" ] && [ ! -L "$so_s/compose.yaml" ] && [ -f "$so_s/.env" ] && [ ! -L "$so_s/.env" ] || return 1
  printf '%s' "$so_s"
}
# take_snapshot NAME: the account NAME's snapshot, made now ($A is its Docker). What fails leaves it running the version
# it runs, and stops its switch. With rsync it is copied twice: once while its botdot server runs, which takes as long
# as the data is big (an account's data can be 100 GB in millions of files), then again with the server stopped, which
# copies only what changed meanwhile, so that the account is down for seconds, not for the whole copy. Without rsync
# the server is stopped for one whole copy.
take_snapshot() {
  ts_home="$ACCOUNTS/$1"
  rm -rf -- "$ts_home/snapshot" "$ts_home/snapshot.new"
  # Room for it, with a fifth of its disk left after it: else it switches without one, and can't be rolled back.
  ts_data="$(du -sk "$ts_home/data" 2>/dev/null | awk '{ print $1 }' || true)"
  ts_disk="$(df -Pk "$ts_home" 2>/dev/null | awk 'NR == 2 { print $2, $4 }' || true)"
  if [ -n "$ts_data" ] && [ -n "$ts_disk" ] && [ "$(printf '%s %s\n' "$ts_data" "$ts_disk" | awk '{ print ($3 - $1 < $2 / 5) ? 1 : 0 }')" = 1 ]; then
    warn "The account $1's disk has no room for a snapshot of its data ($(awk -v k="$ts_data" 'BEGIN { printf "%.1f", k / 1048576 }') GB), so it switches without one and can't be rolled back to this version."
    return 1
  fi
  say "Keeping a snapshot of the account $1's data before it switches"
  ts_first=''
  if command -v rsync >/dev/null 2>&1 && mkdir -m 700 "$ts_home/snapshot.new"; then
    # A file that changes or goes while it is copied is copied again below.
    rsync -aHAX --numeric-ids "$ts_home/data/" "$ts_home/snapshot.new/data/" </dev/null >/dev/null 2>&1
    case $? in 0 | 23 | 24) ts_first=1 ;; esac
  fi
  # Stopped, so that the copy is of data nothing writes meanwhile; the switch starts it again on the new version.
  $A compose --project-directory "$ts_home" stop bot-dot </dev/null >/dev/null 2>&1 \
    || { rm -rf -- "$ts_home/snapshot.new"; die "Couldn't stop its botdot server to keep a snapshot of its data, so it wasn't switched."; }
  if [ -n "$ts_first" ]; then
    rsync -aHAX --numeric-ids --delete "$ts_home/data/" "$ts_home/snapshot.new/data/" </dev/null >/dev/null 2>&1
  else
    rm -rf -- "$ts_home/snapshot.new"
    mkdir -m 700 "$ts_home/snapshot.new" && cp -a "$ts_home/data" "$ts_home/snapshot.new/data"
  fi
  if [ "$?" = 0 ] && cp -p "$ts_home/compose.yaml" "$ts_home/.env" "$ts_home/snapshot.new/" && date -u +%Y-%m-%dT%H:%M:%SZ > "$ts_home/snapshot.new/at"; then
    mv "$ts_home/snapshot.new" "$ts_home/snapshot"
  else
    rm -rf -- "$ts_home/snapshot.new"
    compose_up "$ts_home" || true
    die "Couldn't keep a snapshot of its data (is its disk full?), so it wasn't switched."
  fi
}
# restore_data NAME SNAPSHOT: the account NAME's data folder is the snapshot's again; its botdot server is stopped first.
restore_data() {
  $A compose --project-directory "$ACCOUNTS/$1" stop bot-dot </dev/null >/dev/null 2>&1 || true
  rm -rf -- "$ACCOUNTS/$1/data"
  cp -a "$2/data" "$ACCOUNTS/$1/data"
}

# egress_guard: on a managed machine (ADR 154, #984), what the accounts' computers can't reach. A computer's traffic
# leaves as its account's slirp4netns does, as the account's Linux user, through this machine's OUTPUT: there, a new
# connection of an account's user to a private range, to link-local (the cloud's metadata at 169.254.169.254) or to
# TCP 25 or 465 is refused, over IPv4 and IPv6. DNS to the machine's resolvers stays open, and so does this machine
# itself (loopback: the front door and Caddy) and every answer. The front door, Caddy and anything else of the machine's
# own run as other users, and aren't touched. The rules are rebuilt at once (iptables-restore), from each account in
# ACCOUNTS: at boot before Docker (botdot-egress, which every account's unit requires), and whenever an account is made.
egress_guard() {
  mkdir -p "$BIN"
  chmod 700 "$BIN"
  eg_dns="$(for f in /run/systemd/resolve/resolv.conf "$ETC/resolv.conf"; do [ ! -f "$f" ] || awk '$1 == "nameserver" { print $2 }' "$f"; done | sort -u | tr '\n' ' ')"
  {
    cat <<HEAD
#!/bin/sh
# botdot (install.sh): what a managed machine's computers can't reach (ADR 154, #984). Rebuilt by the installer.
set -e
ACCOUNTS='$ACCOUNTS'
RESOLV='/run/systemd/resolve/resolv.conf $ETC/resolv.conf'
RESOLVERS='$eg_dns'
HEAD
    cat <<'BODY'
uids=''
for home in "$ACCOUNTS"/*/; do
  [ -d "$home" ] || continue
  u="$(id -u "botdot-$(basename "$home")" 2>/dev/null)" || continue
  uids="$uids $u"
done
# shellcheck disable=SC2086 # addresses and files, one a word
dns="$({ printf '%s\n' $RESOLVERS; for f in $RESOLV; do [ ! -f "$f" ] || awk '$1 == "nameserver" { print $2 }' "$f"; done; } | sed 's/%.*//' | sort -u)"
rules() {
  echo '*filter'
  echo ':BOTDOT-EGRESS - [0:0]'
  echo ':BOTDOT-GUARD - [0:0]'
  for u in $uids; do echo "-A BOTDOT-EGRESS -m owner --uid-owner $u -j BOTDOT-GUARD"; done
  echo '-A BOTDOT-GUARD -m conntrack ! --ctstate NEW -j RETURN'
  echo '-A BOTDOT-GUARD -o lo -j RETURN'
  for d in $dns; do
    case "$1:$d" in 4:*:* | 6:*.*) continue ;; esac
    echo "-A BOTDOT-GUARD -d $d -p udp --dport 53 -j RETURN"
    echo "-A BOTDOT-GUARD -d $d -p tcp --dport 53 -j RETURN"
  done
  echo '-A BOTDOT-GUARD -p tcp -m multiport --dports 25,465 -j REJECT --reject-with tcp-reset'
  if [ "$1" = 4 ]; then nets='0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 198.18.0.0/15'
  else nets='fc00::/7 fe80::/10 ::ffff:0:0/96'; fi
  for n in $nets; do echo "-A BOTDOT-GUARD -d $n -j REJECT"; done
  echo 'COMMIT'
}
rules 4 | iptables-restore -n
iptables -C OUTPUT -j BOTDOT-EGRESS 2>/dev/null || iptables -I OUTPUT -j BOTDOT-EGRESS
ip6tables -L -n >/dev/null 2>&1 || exit 0
rules 6 | ip6tables-restore -n
ip6tables -C OUTPUT -j BOTDOT-EGRESS 2>/dev/null || ip6tables -I OUTPUT -j BOTDOT-EGRESS
BODY
  } > "$BIN/egress.sh.new"
  mv "$BIN/egress.sh.new" "$BIN/egress.sh"
  chmod 700 "$BIN/egress.sh"
  if [ -n "$SYSTEMD" ]; then
    cat > "$ETC/systemd/system/botdot-egress.service.new" <<UNIT
# botdot (install.sh): what a managed machine's computers can't reach, in place before any account's Docker starts
# (ADR 154, #984).
[Unit]
Description=botdot: keep the accounts' computers from private addresses, the cloud's metadata and SMTP
DefaultDependencies=no
After=local-fs.target
Wants=network-pre.target
Before=network-pre.target docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh $BIN/egress.sh

[Install]
WantedBy=multi-user.target
UNIT
    if ! cmp -s "$ETC/systemd/system/botdot-egress.service.new" "$ETC/systemd/system/botdot-egress.service" 2>/dev/null; then
      mv "$ETC/systemd/system/botdot-egress.service.new" "$ETC/systemd/system/botdot-egress.service"
      systemctl daemon-reload </dev/null
    else rm -f "$ETC/systemd/system/botdot-egress.service.new"; fi
    systemctl enable botdot-egress </dev/null >/dev/null 2>&1 || die "systemd didn't enable botdot-egress. See: systemctl status botdot-egress"
  fi
  # Run here, not restarted: every account's unit requires it, and a restart would restart them all.
  sh "$BIN/egress.sh" </dev/null || die "The firewall that keeps the accounts' computers from private addresses and SMTP didn't start, so no account was started. See: sh $BIN/egress.sh"
}

# account NAME [CPU RAM DISK]: makes or updates the account NAME with that share (DEFAULT_SHARE without one) and
# starts its botdot server.
account() {
  name="$1"
  shift
  # shellcheck disable=SC2086 # three numbers
  valid_share "$@" || set -- $DEFAULT_SHARE
  user="botdot-$name"
  home="$ACCOUNTS/$name"
  folder="$SOCKETS/$name"
  run="$RUN/$name"
  A="env DOCKER_HOST=unix://$run/docker.sock docker"

  # Its disk, mounted as its home before anything is in it.
  disk "$name" "$3"
  # Its Linux user, with subordinate IDs for its containers' users (the Chief, the bots, the tools user).
  if ! id -u "$user" >/dev/null 2>&1; then
    useradd --no-create-home --home-dir "$home" --shell /usr/sbin/nologin --comment "botdot account $name" "$user" </dev/null \
      || die "Couldn't make the Linux user $user."
  fi
  uid="$(id -u "$user")"
  gid="$(id -g "$user")"
  chown "$uid:$gid" "$home"
  chmod 700 "$home"
  for map in subuid subgid; do
    if ! grep -q "^$user:" "$ETC/$map" 2>/dev/null; then
      start="$(awk -F: '{ e = $2 + $3; if (e > m) m = e } END { print (m > 100000 ? m : 100000) }' "$ETC/$map" 2>/dev/null || echo 100000)"
      printf '%s:%s:65536\n' "$user" "$start" >> "$ETC/$map"
    fi
  done
  # On a managed machine, and on the owner's own computer, its user's way out is guarded before its Docker starts (#984).
  [ -z "$GUARD" ] || egress_guard
  sub_uid="$(awk -F: -v u="$user" '$1 == u { print $2; exit }' "$ETC/subuid")"
  sub_gid="$(awk -F: -v u="$user" '$1 == u { print $2; exit }' "$ETC/subgid")"

  # Its rootless Docker, whose every container runs under gVisor. The cgroups are its systemd unit's.
  mkdir -p "$home/.config/docker"
  cat > "$home/.config/docker/daemon.json.new" <<JSON
{
  "default-runtime": "runsc",
  "runtimes": {
    "runsc": { "path": "$home/share/runsc", "runtimeArgs": [$RUNSC_FLAGS] },
    "runsc-uds": { "path": "$home/share/runsc", "runtimeArgs": [$RUNSC_UDS_FLAGS] }
  },
  "exec-opts": ["native.cgroupdriver=cgroupfs"],
  $LOG_OPTS
}
JSON
  changed=''
  cmp -s "$home/.config/docker/daemon.json.new" "$home/.config/docker/daemon.json" 2>/dev/null || changed=1
  mv "$home/.config/docker/daemon.json.new" "$home/.config/docker/daemon.json"
  chown -R "$uid:$gid" "$home/.config"
  share "$name" "$1" "$2"
  if [ -n "$SYSTEMD" ]; then
    systemctl enable "botdot-account@$name" </dev/null >/dev/null 2>&1 || true
    if [ -n "$changed" ]; then systemctl restart "botdot-account@$name" </dev/null; else systemctl start "botdot-account@$name" </dev/null; fi
  elif ! $A info </dev/null >/dev/null 2>&1; then
    mkdir -p "$run"
    chown "$uid:$gid" "$run"
    chmod 700 "$run"
    su -s /bin/sh "$user" -c "cd '$home' && exec env HOME='$home' XDG_RUNTIME_DIR='$run' PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin nohup '$ROOTLESS' >> '$home/docker.log' 2>&1 &" </dev/null 9>&- 8>&-
    warn "This machine has no systemd, so the account $name's Docker was started now and doesn't start again after a restart. Run this installer again after one."
  fi
  i=0
  until $A info </dev/null >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -lt 60 ] || die "The account $name's rootless Docker didn't start.$( [ -n "$SYSTEMD" ] && printf ' See: journalctl -u botdot-account@%s' "$name" || printf ' See: %s/docker.log' "$home")"
    sleep 1
  done
  runtimes_ok "$name"

  # Its socket folder: botdot's server user (60000 in its containers) owns it, and the front door's group may only
  # pass through it to the socket. Nobody else, and none of the account's bots, gets in.
  mkdir -p "$folder"
  chown "$((sub_uid + 59999)):$((sub_gid + 59999))" "$folder"
  chmod 700 "$folder"
  setfacl -m "g:$DOOR_USER:x,m::x" "$folder" </dev/null || die "Couldn't let the front door into $folder."

  hand_images "$name"

  # Its botdot server, from the compose file and the settings of this run.
  aenv="$home/.env"
  # What it ran until now, put back when its new server doesn't start (#194, ADR 044). Its old images are still in its
  # Docker: they go only once the new server answers (below), and the cleanup before a download keeps them.
  rm -f "$home/compose.yaml.before" "$home/.env.before"
  snapped=''
  if [ -f "$home/compose.yaml" ] && [ -f "$aenv" ]; then
    # A switch to another signed version keeps a snapshot of its data first (#979).
    if [ -n "$REGISTRY" ] && [ -d "$home/data" ] && [ "$(get_env "$aenv" BOT_DOT_IMAGE)" != "$IMAGE" ]; then ! take_snapshot "$name" || snapped=1; fi
    cp -p "$home/compose.yaml" "$home/compose.yaml.before"
    cp -p "$aenv" "$home/.env.before"
  fi
  printf '%s\n' "$ACCOUNT_COMPOSE" > "$home/compose.yaml"
  touch "$aenv"
  [ "$IMAGE" = "$IMAGES/bot-dot:latest" ] || set_env "$aenv" BOT_DOT_IMAGE "$IMAGE"
  set_env "$aenv" BOT_DOT_COMPUTER_IMAGE "$COMPUTER_IMAGE"
  if [ -n "$TOKEN" ]; then set_env "$aenv" BOT_DOT_REGISTRY_TOKEN "$TOKEN"; fi
  set_env "$aenv" TZ "$TZ_NAME"
  set_env "$aenv" BOT_DOT_ACCOUNT "$name"
  set_env "$aenv" BOT_DOT_INSTANCE "$INSTANCE"
  set_env "$aenv" BOT_DOT_FRONT_DOOR_FOLDER "$folder"
  set_env "$aenv" DOCKER_SOCKET "$run/docker.sock"
  # A disk of its own (disk below): what Storage shows in all is then what that disk uses.
  if mountpoint -q "$home" 2>/dev/null; then set_env "$aenv" BOT_DOT_OWN_DISK 1; else set_env "$aenv" BOT_DOT_OWN_DISK ''; fi
  # Its data folder, the account's own when it is made: botdot's privilege supervisor gives it to the server's user
  # when the server starts, and that stays. Its Docker restarted the server already when this step starts it again
  # (a resume, a rerun), so changing the owner now would leave the server unable to write its data.
  [ -d "$home/data" ] || { mkdir -p "$home/data"; chown "$uid:$gid" "$home/data"; }
  # From here on what fails puts back what it ran (in an if, so that set -e doesn't end the account first).
  if ! { chown "$uid:$gid" "$home/compose.yaml" "$aenv" && compose_up "$home" && answers "$folder" "$home"; }; then
    [ -f "$home/compose.yaml.before" ] || die "The account $name's botdot server didn't start. See what went wrong with: sudo DOCKER_HOST=unix://$run/docker.sock docker compose --project-directory $home logs"
    # The new version's logs, before its container is replaced by the old one's.
    $A compose --project-directory "$home" logs --no-color --tail 40 </dev/null 2>&1 | sed 's/^/    /' || true
    warn "The account $name's new botdot server didn't start, so it goes back to the version it ran."
    # Its data as the snapshot kept it, in case the new version changed it already.
    if [ -n "$snapped" ] && snap="$(snapshot_of "$name")"; then restore_data "$name" "$snap"; say "  Its data is the snapshot's again."; fi
    mv "$home/compose.yaml.before" "$home/compose.yaml"
    mv "$home/.env.before" "$aenv"
    compose_up "$home" || true
    answers "$folder" "$home" || { ACCOUNT_RESULT=failed; die "Its botdot server didn't start, neither the new version nor the one it ran. See what went wrong with: sudo DOCKER_HOST=unix://$run/docker.sock docker compose --project-directory $home logs"; }
    die "Its new botdot server didn't start, so it runs the version it ran before."
  fi
  rm -f "$home/compose.yaml.before" "$home/.env.before"
  # Its snapshot was for a new server that doesn't start: it answers, so the copy of its data goes.
  rm -rf -- "$home/snapshot"
  trim_disk "$name"
  ok "The account $name is running"
  # One that waited, or was switching, runs the version the front door pins now (ADR 053).
  [ ! -f "$DOOR/status/account-$name.json" ] || account_said "$name" updated
  # An update removes what it replaced in its phase clean, once the front door runs the new version too.
  [ "$MODE" = update ] || clean_account "$name"
}

# clean_account NAME: the images this run replaced in the account NAME's Docker go. botdot decides which
# (lib/image-cleanup.js); this script removes none.
clean_account() {
  home="$ACCOUNTS/$1"
  A="env DOCKER_HOST=unix://$RUN/$1/docker.sock docker"
  remove_unnamed
  CLEANED="$($A compose --project-directory "$home" exec -T --user 60000:60000 bot-dot node /opt/bot-dot/lib/update-install.js --clean </dev/null 2>/dev/null || true)"
  CLEANED="$(printf '%s' "$CLEANED" | json 'j.failed ? "" : j.removed ? "Removed " + j.removed + " old image" + (j.removed === 1 ? "" : "s") + (j.bytes >= 5e7 ? " (" + (j.bytes / 1e9).toFixed(1) + " GB freed)" : j.bytes >= 5e5 ? " (" + Math.round(j.bytes / 1e6) + " MB freed)" : "") : "No old images to remove"' || true)"
  if [ -n "$CLEANED" ]; then ok "$CLEANED"
  else warn "Couldn't remove every old image now; the next update tries again."; fi
}

# door_state NAME: what the front door's data says of the account NAME, read with the image's own Node (NAME on its
# command line, never in the script): "running", "suspended" (the admin suspended it) or "deleted" (the admin deleted
# it, and no account of that name was made since), and after "running" or "suspended" its share, its own or the
# default when the front door has one: CPUs, GB of RAM and GB of disk (a share kept before #108 also has computers at
# once, which is ignored). Nothing when it has no such account or its data can't be read, so that an account is erased
# only when the front door says so. Nothing else of that file is used.
door_state() {
  [ -f "$DOOR/data/front-door.json" ] || return 0
  $D run --rm -i --entrypoint node "$IMAGE" -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{try{const j=JSON.parse(s),n=process.argv[1],a=j.accounts||{};if(!Object.hasOwn(a,n)){process.stdout.write(Object.hasOwn(j.deleted||{},n)?"deleted":"");return}const h=a[n].share||j.share||{},k=["cpu","ram","disk"];process.stdout.write((a[n].suspended?"suspended":"running")+(k.every((x)=>Number.isInteger(h[x]))?" "+k.map((x)=>h[x]).join(" "):""))}catch{}})' "$1" < "$DOOR/data/front-door.json" 2>/dev/null || true
}

# settle NAME STATE [CPU RAM DISK]: the machine made to match what the front door says of the account NAME
# (door_state), with its share.
settle() {
  n="$1" s="${2:-}"
  shift
  [ "$#" = 0 ] || shift
  case "$s" in
    running)
      # Its Docker answers when it runs: suspending stops it. One that runs gets its share now. One whose Docker runs
      # but whose botdot server doesn't answer (the front door asks when it finds it down) is started again below.
      if [ -f "$ACCOUNTS/$n/compose.yaml" ] && env DOCKER_HOST="unix://$RUN/$n/docker.sock" docker info </dev/null >/dev/null 2>&1 \
        && curl -fsS -o /dev/null --max-time 5 -H "X-Botdot-Account: $n" --unix-socket "$SOCKETS/$n/botdot.sock" http://botdot/api/version </dev/null 2>/dev/null; then
        # shellcheck disable=SC2086 # three numbers
        valid_share "$@" || set -- $DEFAULT_SHARE
        disk "$n" "$3"
        share "$n" "$1" "$2"
        ok "The account $n is made already, and runs, with its share: $1 CPUs, $2 GB of RAM, $3 GB of disk"
      elif [ -f "$ACCOUNTS/$n/compose.yaml" ]; then
        say "Starting the account $n again, which the admin resumed or which stopped"
        account "$n" "$@"
      else
        say "Making the account $n, which a sign-up link made at the front door"
        account "$n" "$@"
      fi ;;
    suspended)
      if [ -f "$ACCOUNTS/$n/compose.yaml" ]; then stop_account "$n"; ok "The account $n is suspended: it is stopped, and its data kept"
      else ok "The account $n is suspended and wasn't made, so nothing was stopped"; fi ;;
    deleted)
      if id -u "botdot-$n" >/dev/null 2>&1 || [ -e "$ACCOUNTS/$n" ] || [ -e "$SOCKETS/$n" ] || [ -e "$RUN/$n" ] || [ -e "$DISKS/$n.img" ]; then erase_account "$n"
      else ok "The account $n is deleted, and nothing of it is on this machine"; fi ;;
    *) warn "The front door has no account $n, so nothing was done." ;;
  esac
}

# Root's step: each account the front door asked about (a file named as it in REQUESTS) that is an account's name is
# made to match what the front door's data says of it: made or started, stopped (suspended) or erased (deleted). The
# request stays while that is done (the front door shows "being made" by it), then goes, and the data is read once
# more: the front door changes its data before it asks, so a change the admin made meanwhile, whose request found this
# one still there, is read here, and one made after that is a request of its own. Each request goes, done or not; why
# one wasn't is in this step's log.
#
# The admin page's update (#473) is the request named UPDATE, which no account can be named: this copy runs the update
# (--update), in phases that ask nothing, and moves the front door and every account to the newest version (ADR 045).
# What it did is in update.json beside version.json, for the admin page: the phase it is in, and after a failure the
# phase it stopped in and the last lines of all it said, which is in BOT_DOT_DIR/update.log.
UPDATE=UPDATE
# account_results FILE: the lines each_account and wait_for wrote (NAME<tab>updated|kept|failed|waiting<tab>version<tab>why), as
# update.json's "accounts" after a comma, each why as plain text; nothing when there are none (an installer from before
# #194).
account_results() {
  [ -s "$1" ] || return 0
  printf ',"accounts":['
  sep=''
  while IFS='	' read -r a_name a_result a_version a_why; do
    valid_account "$a_name" || continue
    case "$a_result" in updated | kept | failed | waiting) ;; *) continue ;; esac
    a_why="$(printf '%s' "$a_why" | plain_line 300)"
    printf '%s{"name":"%s","result":"%s"' "$sep" "$a_name" "$a_result"
    case "$a_version" in '' | *[!0-9a-f]*) ;; *) [ "$a_result" != kept ] && [ "$a_result" != waiting ] || printf ',"version":"%s"' "$a_version" ;; esac
    [ "$a_result" = updated ] || [ "$a_result" = waiting ] || printf ',"error":"%s"' "$a_why"
    printf '}'
    sep=','
  done < "$1"
  printf ']'
}
# log_tail: the last 40 lines of the update's log that say something, as a JSON list of plain lines: no colours, nothing
# but printable ASCII, at most 300 characters each.
log_tail() {
  tr -d '\033\r' < "$DIR/update.log" | sed 's/\[[0-9;]*m//g; s/✓/ok/g; s/✗/x/g; s/…/.../g' | LC_ALL=C tr -c '\040-\176\n' ' ' \
    | sed 's/[[:space:]]*$//; /^$/d' | tail -n 40 | cut -c1-300 | sed 's/\\/\\\\/g; s/"/\\"/g' \
    | awk 'BEGIN { printf "[" } { printf "%s\"%s\"", (NR > 1 ? "," : ""), $0 } END { printf "]" }'
}
# update_all [TO]: the update, to the version TO when the request named one (#979).
update_all() {
  from="$(version_now)"
  at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  write_status update.json "{\"state\":\"updating\",\"at\":\"$at\",\"from\":\"$from\"$(named_field "${1:-}")}"
  set +e
  results="$RUN/update-results"
  rm -f "$results"
  BOT_DOT_LOCKED="${BOT_DOT_LOCKED:-}" BOT_DOT_UPDATE_RESULTS="$results" BOT_DOT_UPDATE_AT="$at" BOT_DOT_UPDATE_FROM="$from" BOT_DOT_UPDATE_TO="${1:-}" sh "$SOURCE/install.sh" --update > "$DIR/update.log" 2>&1 </dev/null
  updated=$?
  set -e
  chmod 600 "$DIR/update.log"
  accounts="$(account_results "$results")"
  rm -f "$results"
  if [ "$updated" = 0 ]; then
    write_status update.json "{\"state\":\"updated\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"from\":\"$from\",\"to\":\"$(version_now)\"$(named_field "${1:-}")$accounts}"
    ok "botdot is updated, the front door and every account"
  else
    # The installer's last ✗ line, as plain text.
    why="$(tr -d '\033' < "$DIR/update.log" | sed -n 's/\[[0-9;]*m//g; s/^✗ //p' | tail -n 1 | plain_line 500)"
    # The phase it stopped in, as it wrote it last (none from an installer before phases).
    stopped="$(sed -n 's/.*\("phase":"[a-z-]*"\(,"account":"[a-z0-9-]*"\)\{0,1\}\).*/,\1/p' "$DOOR/status/update.json" 2>/dev/null || true)"
    write_status update.json "{\"state\":\"failed\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"from\":\"$from\",\"to\":\"$(version_now)\",\"error\":\"${why:-The update stopped without saying why}\"$(named_field "${1:-}")$accounts$stopped,\"log\":$(log_tail)}"
    warn "The update stopped: ${why:-see $DIR/update.log}"
  fi
}

# switch_one NAME: the account NAME alone switched to the version the front door pins (ADR 053), as its owner or the
# admin asked with "Update now", or the front door when its deadline passed: the version the admin's update downloaded
# into its Docker already, with ADR 044's way back. One that runs it already, or doesn't run, is left as it is. How it
# went is in status/account-NAME.json, and why it wasn't in this step's log.
switch_one() {
  so_state="$(door_state "$1")"
  case "$so_state" in running*) ;; *) warn "The account $1 isn't running, so it wasn't switched."; return 0 ;; esac
  if ! { [ -f "$ACCOUNTS/$1/compose.yaml" ] && env DOCKER_HOST="unix://$RUN/$1/docker.sock" docker info </dev/null >/dev/null 2>&1; }; then
    warn "The account $1's Docker isn't running, so it wasn't switched."
    # Said, so that the front door doesn't ask again past the deadline; "Update now" may ask again.
    account_said "$1" kept '"error":"Its botdot server was not running, so it was not switched. Ask the admin."'
    return 0
  fi
  if [ "$(get_env "$ACCOUNTS/$1/.env" BOT_DOT_IMAGE)" = "$IMAGE" ]; then
    account_said "$1" updated
    ok "The account $1 runs the newest version already"
    return 0
  fi
  say "Switching the account $1 to the new version, as asked"
  account_said "$1" switching
  so_why="$RUN/switch-$1"
  rm -f "$so_why"
  set +e
  # shellcheck disable=SC2086 # its share's three numbers, after its state
  ( set -e; ACCOUNT_WHY="$so_why"; account "$1" ${so_state#* } )
  so_done=$?
  set -e
  [ "$so_done" != 0 ] || return 0
  so_line="$(cat "$so_why" 2>/dev/null || true)"
  rm -f "$so_why"
  so_result="${so_line%%	*}"
  so_text="${so_line#*	}"
  case "$so_result" in kept | failed) ;; *) so_result=kept so_text="see what the installer said in root's step's log" ;; esac
  account_said "$1" "$so_result" "\"error\":\"$(printf '%s' "$so_text" | plain_line 300)\""
  warn "The account $1 wasn't switched: $so_text"
}

# A backup set (#986): a complete copy of this machine in one folder, SET, that only root reads, for the fleet
# console's agent to take off the machine (restic). Root asks for one with an empty file named BACKUP in REQUESTS, and
# puts one back on a fresh install of the same version with one named RESTORE; only a request root made is taken, as
# the front door may write in REQUESTS. Neither name can be an account's. How each went is in status/backup.json and
# status/restore.json: state (backing-up, done or failed; restoring, restored, failed or refused), when, the phase it
# is in or stopped in, and why it failed.
#
# A set holds, as plain tar files that restic can deduplicate, with a sha256 of each in manifest.json beside the
# version, the instance id, the admin's name and the accounts:
#   front-door/data.tar          the front door's data: accounts, passkeys, sign-up links, the audit log
#   accounts/<name>/data.tar     the account's data folder, without its own backups (data/backups); its memory.db is a
#                                consistent copy its botdot server made for the set (memory_copy), or, when the server
#                                doesn't run or can't make one, the file as it is ("memory" in the manifest says which)
#   accounts/<name>/env          its .env
#   accounts/<name>/config.tar   its server's /config volume, with the Vault's key
#   accounts/<name>/<volume>.tar its computer's volumes: workspace (the bots' files and project folders), home and
#                                browser (the browser profiles, without their lock files)
# An account's files are read from its disk as root, so a suspended account is in the set too and a running computer
# keeps running untouched, and their owners are written as its rootless Docker sees them (from 0 to 65536), so that
# the restore, which writes them through the new account's own Docker, gives them to the same users there whatever
# sub-IDs the new machine gave it. A new set is made beside the last one and takes its place only once it is complete.
SET="$DIR/backup"
BACKUP=BACKUP
# set_drop NAME: the erased account NAME's part of the set gone at once (#1019), and the manifest without it; a set
# whose manifest can't be written so goes whole, as it would no longer restore.
set_drop() {
  [ -d "$SET/accounts/$1" ] || return 0
  sd_manifest="$(json "JSON.stringify({ ...j, accounts: j.accounts.filter((a) => a !== '$1'), memory: Object.fromEntries(Object.entries(j.memory || {}).filter(([a]) => a !== '$1')), parts: j.parts.filter((p) => !p.path.startsWith('accounts/$1/')) })" < "$SET/manifest.json" 2>/dev/null || true)"
  rm -rf -- "${SET:?}/accounts/$1"
  if [ -n "$sd_manifest" ]; then
    printf '%s\n' "$sd_manifest" > "$SET/manifest.json.new"
    chmod 600 "$SET/manifest.json.new"
    mv "$SET/manifest.json.new" "$SET/manifest.json"
    ok "The account $1 is out of the backup set"
  else
    rm -rf -- "$SET"
    warn "The backup set held the account $1 and couldn't be rewritten without it, so it is gone; the next one is whole."
  fi
}
RESTORE=RESTORE

# set_said backup|restore STATE [FIELDS]: status/backup.json or status/restore.json; a restore's ends with
# RESTORE_FROM, the fields of a restore from the off-site repository (OFFSITE-RESTORE, below).
RESTORE_FROM=''
set_said() { write_status "$1.json" "{\"state\":\"$2\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"${3:+,$3}$([ "$1" != restore ] || printf '%s' "$RESTORE_FROM")}"; }
# by_root FILE: FILE was made by root, as BOT_DOT_DIR was, and not by the front door: a regular file, not a link, owned
# as BOT_DOT_DIR is, with one name only (a hard link the front door made to a file of root's has two).
by_root() { [ -f "$1" ] && [ ! -L "$1" ] && [ "$(stat -c '%u %h' -- "$1" 2>/dev/null)" = "$(stat -c %u -- "$DIR") 1" ]; }
# set_tar FOLDER FILE [TAR OPTION…]: FOLDER's contents in FILE. A file that changed while it was read (a running
# account) is no failure; anything else is.
set_tar() {
  st_from="$1" st_to="$2"
  shift 2
  set +e
  tar -C "$st_from" --numeric-owner "$@" -cf "$st_to" . 2> "$st_to.err"
  st_done=$?
  set -e
  [ "$st_done" -le 1 ] || die "Couldn't copy $st_from: $(tail -n 1 "$st_to.err")"
  rm -f "$st_to.err"
}

# make_set: the set, in SET.new, then in SET's place.
make_set() {
  tar --help 2>/dev/null | grep -q -- --owner-map || die "This machine's tar can't write a backup set: it needs GNU tar 1.29 or newer."
  new="$SET.new"
  rm -rf -- "$new"
  mkdir -p "$new/front-door" "$new/accounts"
  chown 0:0 "$new"
  chmod 700 "$new"
  ms_accounts=''
  ms_memory=''
  for home in "$ACCOUNTS"/*/; do
    n="$(basename "$home")"
    valid_account "$n" && [ -f "$ACCOUNTS/$n/compose.yaml" ] || continue
    ms_accounts="$ms_accounts $n"
  done
  # Room for it, on the machine's own disk, beside the last set.
  # shellcheck disable=SC2046 # one folder per word
  ms_need="$(du -sk "$DOOR/data" $(for n in $ms_accounts; do printf '%s/%s/data %s/%s/.local/share/docker/volumes ' "$ACCOUNTS" "$n" "$ACCOUNTS" "$n"; done) 2>/dev/null | awk '{ s += $1 } END { printf "%.0f", s }')"
  ms_free="$(df -Pk "$DIR" | awk 'NR == 2 { print $4 }')"
  [ -z "$ms_free" ] || [ "$ms_free" -gt "$((ms_need + ms_need / 10))" ] || die "This machine's disk has $((ms_free / 1024)) MB free, and the set needs about $((ms_need / 1024)) MB."

  set_said backup backing-up '"phase":"front-door"'
  set_tar "$DOOR/data" "$new/front-door/data.tar"
  for n in $ms_accounts; do
    set_said backup backing-up "\"phase\":\"account\",\"account\":\"$n\""
    home="$ACCOUNTS/$n"
    out="$new/accounts/$n"
    mkdir -p "$out"
    ns_maps "$n" "$out"
    maps="--owner-map=$out/uids --group-map=$out/gids"
    # shellcheck disable=SC2086 # two options
    if memory_copy "$n"; then
      set_tar "$home/data" "$out/data.tar" $maps --anchored --exclude=./backups --exclude=./memory.db --exclude=./memory.db-wal \
        --exclude=./memory.db-shm --transform='s,^\./\.snapshot/memory\.db$,./memory.db,'
      ms_memory="$ms_memory${ms_memory:+,}\"$n\":\"copy\""
    else
      set_tar "$home/data" "$out/data.tar" $maps --anchored --exclude=./backups --exclude=./.snapshot
      ms_memory="$ms_memory${ms_memory:+,}\"$n\":\"as-is\""
    fi
    rm -f -- "$home/data/.snapshot/memory.db"
    cp "$home/.env" "$out/env"
    for v in config $SET_VOLUMES; do
      [ -d "$(account_volume "$n" "$v")" ] || continue
      skip=''
      [ "$v" != browser ] || for l in $SET_LOCKS; do skip="$skip --exclude=$l"; done
      # shellcheck disable=SC2086 # options
      set_tar "$(account_volume "$n" "$v")" "$out/$v.tar" $maps $skip
    done
    rm -f "$out/uids" "$out/gids"
  done

  # The manifest, with a checksum of each part.
  parts=''
  for f in $(cd "$new" && find . -type f | sed 's#^\./##' | sort); do
    parts="$parts${parts:+,}{\"path\":\"$f\",\"sha256\":\"$(sha256sum "$new/$f" | cut -d' ' -f1)\",\"bytes\":$(wc -c < "$new/$f" | tr -d ' ')}"
  done
  names=''
  for n in $ms_accounts; do names="$names${names:+,}\"$n\""; done
  printf '{"kind":"botdot-backup-set","format":1,"version":"%s","instance":"%s","admin":"%s","at":"%s","accounts":[%s],"memory":{%s},"parts":[%s]}\n' \
    "$(version_now)" "$INSTANCE" "$(get_env "$ENV" FRONT_DOOR_ADMIN)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$names" "$ms_memory" "$parts" > "$new/manifest.json"
  find "$new" -type d -exec chmod 700 {} + -o -type f -exec chmod 600 {} +
  chown -R 0:0 "$new"

  # The last set goes only now that this one is complete.
  rm -rf -- "$SET.old"
  [ ! -e "$SET" ] || mv -- "$SET" "$SET.old"
  mv -- "$new" "$SET"
  rm -rf -- "$SET.old"
}

# backup_set: the set asked for, and how it went in status/backup.json. One that fails leaves the last one as it was.
backup_set() {
  say "Making a backup set of this machine in $SET"
  set_said backup backing-up '"phase":"check"'
  bs_why="$RUN/backup-why"
  rm -f "$bs_why"
  set +e
  ( set -e; umask 077; ACCOUNT_WHY="$bs_why"; make_set )
  bs_done=$?
  set -e
  if [ "$bs_done" = 0 ]; then
    set_said backup done "\"version\":\"$(version_now)\",\"bytes\":$(du -sk "$SET" | awk '{ printf "%.0f", $1 * 1024 }')"
    ok "The backup set is in $SET"
    return 0
  fi
  bs_text="$(cut -f2- "$bs_why" 2>/dev/null || true)"
  rm -f "$bs_why"
  rm -rf -- "$SET.new"
  bs_stopped="$(sed -n 's/.*\("phase":"[a-z-]*"\(,"account":"[a-z0-9-]*"\)\{0,1\}\).*/,\1/p' "$DOOR/status/backup.json" 2>/dev/null || true)"
  set_said backup failed "\"error\":\"$(printf '%s' "${bs_text:-The backup set stopped without saying why}" | plain_line 300)\"$bs_stopped"
  warn "The backup set wasn't made${bs_text:+: $bs_text}. The last one is as it was."
}

# put_part FILE NAME FOLDER|VOLUME: the part FILE of a set put in the account NAME's bind folder or volume, emptied
# first, through the account's own Docker ($A), whose root gives each file the owner it had there.
put_part() {
  $A run --rm -i --pull never --network none --user 0:0 -v "$3:/v" --entrypoint sh "$IMAGE" -c 'find /v -mindepth 1 -delete && tar -x -p --numeric-owner -f - -C /v' < "$1" \
    || die "Couldn't put back $(basename "$1") of the account $2."
}
# restore_account NAME: the account NAME made as the restored front door says, its server stopped, its data, .env,
# Vault key and computer's volumes put back from the set, and started again through the usual phases.
restore_account() {
  ra="$1"
  ra_from="$SET/accounts/$ra"
  ra_state="$(door_state "$ra")"
  case "$ra_state" in running* | suspended*) ;; *) die "The set's front door has no account $ra." ;; esac
  # shellcheck disable=SC2086 # its share's three numbers, after its state
  set -- ${ra_state#* }
  [ "$ra_state" != "${ra_state%% *}" ] || set --
  account "$ra" "$@"
  ra_home="$ACCOUNTS/$ra"
  A="env DOCKER_HOST=unix://$RUN/$ra/docker.sock docker"
  $A compose --project-directory "$ra_home" down </dev/null >/dev/null 2>&1 || die "Couldn't stop the account $ra's botdot server."
  for ra_c in $($A ps -aq </dev/null 2>/dev/null); do $A rm -f "$ra_c" </dev/null >/dev/null 2>&1 || true; done
  put_part "$ra_from/data.tar" "$ra" "$ra_home/data"
  cp "$ra_from/env" "$ra_home/.env"
  chown "$(id -u "botdot-$ra"):$(id -g "botdot-$ra")" "$ra_home/.env"
  chmod 600 "$ra_home/.env"
  for ra_v in config $SET_VOLUMES; do
    [ -f "$ra_from/$ra_v.tar" ] || continue
    case "$ra_v" in
      config) ra_vol="${ra}_bot-dot-config" ;;
      *) ra_vol="botdot-$ra.account.computer-$ra_v"
        $A volume inspect "$ra_vol" </dev/null >/dev/null 2>&1 || $A volume create --label botdot.volume=account --label "botdot.instance=$ra" "$ra_vol" </dev/null >/dev/null ;;
    esac
    put_part "$ra_from/$ra_v.tar" "$ra" "$ra_vol"
  done
  account "$ra" "$@"
  case "$ra_state" in suspended*) stop_account "$ra"; ok "The account $ra is back, and suspended as it was" ;; *) ok "The account $ra is back" ;; esac
}
# restore_set: the set in SET put back on this machine, the front door's data first, then each account. It is checked
# whole first: a set of another version, of another admin, or with a part whose checksum doesn't match is refused, and
# nothing changes.
restore_set() {
  say "Putting back the backup set in $SET"
  set_said restore restoring '"phase":"check"'
  rs_why="$RUN/restore-why"
  rm -f "$rs_why"
  set +e
  ( set -e; ACCOUNT_WHY="$rs_why"; ACCOUNT_RESULT=refused; check_set; ACCOUNT_RESULT=failed; put_set )
  rs_done=$?
  set -e
  # The set's instance, which put_set gave .env in its subshell, for what this run does next (an account it makes).
  INSTANCE="$(get_env "$ENV" BOT_DOT_INSTANCE)"
  if [ "$rs_done" = 0 ]; then
    set_said restore restored "\"version\":\"$(version_now)\""
    ok "The backup set is back on this machine"
    return 0
  fi
  rs_line="$(cat "$rs_why" 2>/dev/null || true)"
  rm -f "$rs_why"
  rs_result="${rs_line%%	*}"
  rs_text="${rs_line#*	}"
  case "$rs_result" in refused | failed) ;; *) rs_result=failed rs_text='' ;; esac
  rs_stopped=''
  [ "$rs_result" = refused ] || rs_stopped="$(sed -n 's/.*\("phase":"[a-z-]*"\(,"account":"[a-z0-9-]*"\)\{0,1\}\).*/,\1/p' "$DOOR/status/restore.json" 2>/dev/null || true)"
  set_said restore "$rs_result" "\"error\":\"$(printf '%s' "${rs_text:-The restore stopped without saying why}" | plain_line 300)\"$rs_stopped"
  warn "The backup set wasn't put back${rs_text:+: $rs_text}"
}
check_set() {
  [ -f "$SET/manifest.json" ] || die "There is no backup set in $SET."
  manifest="$(cat "$SET/manifest.json")"
  field() { printf '%s' "$manifest" | json "$1"; }
  [ "$(field 'j.kind + "/" + j.format')" = botdot-backup-set/1 ] || die "$SET/manifest.json is not a backup set this version reads."
  cs_version="$(field 'j.version')"
  [ -n "$cs_version" ] && [ "$cs_version" = "$(version_now)" ] || die "The set is of version ${cs_version:-unknown}, and this machine runs $(version_now): install version ${cs_version:-unknown} and put it back there."
  cs_admin="$(field 'j.admin')"
  [ "$cs_admin" = "$(get_env "$ENV" FRONT_DOOR_ADMIN)" ] || die "The set's admin is $cs_admin, and this machine's is $(get_env "$ENV" FRONT_DOOR_ADMIN): install with BOT_DOT_ADMIN=$cs_admin."
  SET_ACCOUNTS="$(field 'j.accounts.join(" ")')"
  for n in $SET_ACCOUNTS; do valid_account "$n" || die "The set names an account that can't be one."; done
  sums="$RUN/set-sums"
  field 'j.parts.map((p) => p.sha256 + "  " + p.path).join("\n")' > "$sums"
  while read -r cs_sum cs_path; do
    case "$cs_path" in front-door/data.tar | accounts/*/data.tar | accounts/*/env | accounts/*/*.tar) ;; *) die "The set has a part that can't be one: $cs_path." ;; esac
    case "$cs_path" in *..* | */*/*/*/*) die "The set has a part that can't be one: $cs_path." ;; esac
    case "$cs_sum" in *[!0-9a-f]* | '') die "The set's checksum of $cs_path can't be one." ;; esac
  done < "$sums"
  [ -f "$SET/front-door/data.tar" ] && grep -q '  front-door/data.tar$' "$sums" || die "The set has no front door's data."
  for n in $SET_ACCOUNTS; do grep -q "  accounts/$n/data.tar$" "$sums" && grep -q "  accounts/$n/env$" "$sums" || die "The set has no data of the account $n."; done
  (cd "$SET" && sha256sum -c --quiet "$sums" >/dev/null 2>&1) || { rm -f "$sums"; die "A part of the set doesn't match its checksum: the set is damaged, so nothing was put back."; }
  rm -f "$sums"
  SET_INSTANCE="$(field 'j.instance')"
}
put_set() {
  set_said restore restoring '"phase":"front-door"'
  $D compose --project-directory "$DOOR" stop </dev/null >/dev/null 2>&1 || die "Couldn't stop the front door."
  rm -rf -- "$DOOR/data.new"
  mkdir -p "$DOOR/data.new"
  tar -x -p --numeric-owner -f "$SET/front-door/data.tar" -C "$DOOR/data.new" || die "Couldn't put back the front door's data."
  chown -R "$(id -u "$DOOR_USER"):$(id -g "$DOOR_USER")" "$DOOR/data.new"
  chmod 700 "$DOOR/data.new"
  rm -rf -- "$DOOR/data"
  mv -- "$DOOR/data.new" "$DOOR/data"
  case "$SET_INSTANCE" in '' | *[!0-9a-f]*) ;; *) set_env "$ENV" BOT_DOT_INSTANCE "$SET_INSTANCE"; INSTANCE="$SET_INSTANCE" ;; esac
  $D compose --project-directory "$DOOR" up -d </dev/null >/dev/null 2>&1 || $D compose --project-directory "$DOOR" up -d </dev/null || die "The front door didn't start again."
  ps_host="$(get_env "$ENV" FRONT_DOOR_ORIGIN | sed 's#^https*://##')"
  ps_port="$(get_env "$ENV" FRONT_DOOR_PORT)"
  i=0
  until curl -fsS -o /dev/null -H "Host: $ps_host" "http://127.0.0.1:${ps_port:-$DOOR_PORT}/api/version" </dev/null 2>/dev/null; do
    i=$((i + 1))
    [ "$i" -lt 120 ] || die "The front door didn't answer after the restore."
    sleep 1
  done
  for n in $SET_ACCOUNTS; do
    set_said restore restoring "\"phase\":\"account\",\"account\":\"$n\""
    # A set restored from the off-site backup has each account's born stamp (offsite_fetch): the account is that one.
    if [ -s "$SET/born/$n" ]; then mkdir -p "$BORN"; chmod 700 "$BORN"; cp -- "$SET/born/$n" "$BORN/$n"; fi
    restore_account "$n"
  done
  for home in "$ACCOUNTS"/*/; do
    n="$(basename "$home")"
    valid_account "$n" && [ -f "$home/compose.yaml" ] || continue
    case " $SET_ACCOUNTS " in *" $n "*) ;; *) warn "The account $n isn't in the set, and the front door no longer knows it: it was left as it is." ;; esac
  done
}

# A machine put back from its off-site repository (ADR 159), root's alone: OFFSITE-RESTORE, whose first line names the
# snapshot of a backup's manifest (its id, or at least its first 8 hex digits) or latest, and whose second, when there is
# one, the instance whose backups to read (a new machine taking a lost one's, or the one it is moved from). Root's step
# restores the manifest and each part it names with `restic restore --verify` into a set's layout in OFFSITE_SCRATCH on
# the machine's disk, writes a set's manifest for them (each part's sha256 of what restic read back and verified), and
# hands the folder to the restore above, which checks it as it checks a set (version, admin, the parts' sha256) and puts
# it back. The folder goes however it ends. It holds the off-site lock throughout, so the nightly backup never runs
# beside it, nor it beside one. It needs room for the backup twice (in the folder, and its data put back) and
# OFFSITE_TEST_ROOM to spare. How it went is in status/restore.json, as for RESTORE, with "from":"offsite", the snapshot
# (as asked until its manifest is found, then its whole id) and, when the request named one, the instance. What stops it
# before the set is whole (no repository, no room, no such backup, one with failed parts, a part restic can't restore,
# an off-site backup running) is failed in the phase download; the set's own checks refuse as for RESTORE.
OFFSITE_RESTORE=OFFSITE-RESTORE
# offsite_fetch SNAPSHOT [INSTANCE]: the backup SNAPSHOT (latest or an id) of the machine INSTANCE (this one's when none)
# in OFFSITE_SCRATCH, as a set.
offsite_fetch() {
  offsite_prepare open
  fr_host="${2:-$INSTANCE}"
  fr_meta="$OFFSITE_SCRATCH/.offsite"
  rm -rf -- "$OFFSITE_SCRATCH"
  mkdir -p "$fr_meta"
  chown 0:0 "$OFFSITE_SCRATCH"
  chmod 700 "$OFFSITE_SCRATCH"
  # The manifest, among that machine's: its snapshots carry its instance as their host and in their tags.
  fr_latest=''
  [ "$1" != latest ] || fr_latest='--latest 1'
  # shellcheck disable=SC2086 # options
  r snapshots --json --host "$fr_host" --tag "instance=$fr_host,part=manifest" $fr_latest > "$fr_meta/snapshots" 2> "$fr_meta/err" \
    || die "Couldn't list the off-site backups: $(offsite_why "$fr_meta/err")"
  { grep -o '"id":"[0-9a-f]\{64\}"' "$fr_meta/snapshots" || true; } | cut -d'"' -f4 > "$fr_meta/ids"
  if [ "$1" = latest ]; then fr_id="$(tail -n 1 "$fr_meta/ids")"
  else fr_id="$(grep "^$1" "$fr_meta/ids" || true)"; fi
  [ -n "$fr_id" ] || die "The off-site repository holds no backup$([ "$1" = latest ] || printf ' %s' "$1") of the machine $fr_host."
  [ "$(printf '%s\n' "$fr_id" | wc -l)" = 1 ] || die "More than one backup of the machine $fr_host begins with $1: name it with more of its id."
  RESTORE_FROM="$(restore_from "$fr_id" "${2:-}")"
  set_said restore restoring '"phase":"download"'
  r restore "$fr_id" --target "$fr_meta" --verify > "$fr_meta/out" 2> "$fr_meta/err" || die "Couldn't restore the manifest of the backup $fr_id: $(offsite_why "$fr_meta/out" "$fr_meta/err")"
  fr_manifest="$(cat "$fr_meta/manifest.json" 2>/dev/null || true)"
  fr_field() { printf '%s' "$fr_manifest" | json "$1"; }
  [ "$(fr_field 'j.kind + "/" + j.format')" = botdot-offsite/1 ] || die "The snapshot $fr_id isn't the manifest of an off-site backup this version reads."
  fr_failed="$(fr_field 'j.failed.join(" ")')"
  [ -z "$fr_failed" ] || die "The backup $fr_id is incomplete, as these parts of it failed: $fr_failed. Name another snapshot."
  { fr_field 'Object.entries(j.snapshots).map(([p, id]) => p + " " + id).join("\n")'; echo; } > "$fr_meta/parts"
  # Each part, checked as a set's is, and its size, before anything is restored.
  fr_need=0
  : > "$fr_meta/sizes"
  while read -r fr_p fr_s; do
    [ -n "$fr_p" ] || continue
    case "$fr_p" in front-door/data.tar | accounts/*/data.tar | accounts/*/env | accounts/*/*.tar) ;; *) die "The backup has a part that can't be one: $fr_p." ;; esac
    case "$fr_p" in *..* | */*/*/*/*) die "The backup has a part that can't be one: $fr_p." ;; esac
    case "$fr_s" in *[!0-9a-f]* | '') die "The backup's snapshot of $fr_p can't be one." ;; esac
    r stats --json --mode restore-size "$fr_s" > "$fr_meta/stats" 2> "$fr_meta/err" || die "Couldn't read the size of $fr_p: $(offsite_why "$fr_meta/err")"
    fr_size="$(sed -n 's/.*"total_size":\([0-9][0-9]*\).*/\1/p' "$fr_meta/stats")"
    [ -n "$fr_size" ] || die "Couldn't read the size of $fr_p: restic said no total_size."
    fr_need=$((fr_need + fr_size))
    printf '%s %s %s\n' "$fr_p" "$fr_s" "$fr_size" >> "$fr_meta/sizes"
  done < "$fr_meta/parts"
  grep -q '^front-door/data.tar ' "$fr_meta/sizes" || die "The backup $fr_id holds no front door's data."
  # Each account's born stamp (#1019), from the tags of its data's snapshot, for put_set: the account put back is that
  # one, so that its erase here forgets the snapshots made of it before too (they carry that stamp, and this machine's
  # own would be new).
  mkdir -p "$OFFSITE_SCRATCH/born"
  fr_data="$(sed -n 's#^accounts/[^/]*/data\.tar \([0-9a-f]*\) .*#\1#p' "$fr_meta/sizes")"
  if [ -n "$fr_data" ]; then
    # shellcheck disable=SC2086 # one id per word
    r snapshots --json $fr_data > "$fr_meta/tags" 2> "$fr_meta/err" || die "Couldn't read the tags of the backup's snapshots: $(offsite_why "$fr_meta/err")"
    json 'j.map((s) => s.id + " " + ((s.tags || []).find((t) => t.startsWith("born=")) || "").slice(5)).join("\n")' < "$fr_meta/tags" > "$fr_meta/born"
    while read -r fr_p fr_s fr_size; do
      case "$fr_p" in accounts/*/data.tar) ;; *) continue ;; esac
      fr_n="${fr_p#accounts/}"
      fr_n="${fr_n%/data.tar}"
      valid_account "$fr_n" || continue
      fr_born="$(awk -v id="$fr_s" '$1 == id { print $2; exit }' "$fr_meta/born")"
      if printf '%s' "$fr_born" | grep -Eqx '[0-9]{8}T[0-9]{6}Z'; then printf '%s\n' "$fr_born" > "$OFFSITE_SCRATCH/born/$fr_n"; fi
    done < "$fr_meta/sizes"
  fi
  fr_free=$(($(df -Pk "$DIR" | awk 'NR == 2 { print $4 }') * 1024))
  [ $((2 * fr_need + OFFSITE_TEST_ROOM)) -le "$fr_free" ] \
    || die "It needs $(rt_gb $((2 * fr_need + OFFSITE_TEST_ROOM))) free in $DIR (the backup, its data put back, and 512 MB to spare), and has $(rt_gb "$fr_free")."
  say "Restoring the off-site backup $fr_id of the machine $fr_host into $OFFSITE_SCRATCH"
  fr_parts=''
  while read -r fr_p fr_s fr_size; do
    r restore "$fr_s" --target "$OFFSITE_SCRATCH" --verify > "$fr_meta/out" 2> "$fr_meta/err" || die "Couldn't restore $fr_p: $(offsite_why "$fr_meta/out" "$fr_meta/err")"
    [ -f "$OFFSITE_SCRATCH/$fr_p" ] && [ ! -L "$OFFSITE_SCRATCH/$fr_p" ] || die "The snapshot of $fr_p doesn't hold it."
    fr_got="$(wc -c < "$OFFSITE_SCRATCH/$fr_p" | tr -d ' ')"
    [ "$fr_got" = "$fr_size" ] || die "$fr_p came back with $fr_got bytes, and restic recorded $fr_size."
    fr_parts="$fr_parts${fr_parts:+,}{\"path\":\"$fr_p\",\"sha256\":\"$(sha256sum "$OFFSITE_SCRATCH/$fr_p" | cut -d' ' -f1)\",\"bytes\":$fr_got}"
  done < "$fr_meta/sizes"
  # The set's manifest, of the backup's version, instance, admin and accounts.
  fr_head="$(fr_field 'JSON.stringify({ kind: "botdot-backup-set", format: 1, version: j.version, instance: j.instance, admin: j.admin, at: j.at, accounts: j.accounts, memory: {} }).slice(0, -1)')"
  [ -n "$fr_head" ] || die "Couldn't read the manifest of the backup $fr_id."
  rm -rf -- "$fr_meta"
  printf '%s,"from":"offsite","parts":[%s]}\n' "$fr_head" "$fr_parts" > "$OFFSITE_SCRATCH/manifest.json"
  find "$OFFSITE_SCRATCH" -type d -exec chmod 700 {} + -o -type f -exec chmod 600 {} +
  chown -R 0:0 "$OFFSITE_SCRATCH"
}
# restore_from SNAPSHOT [INSTANCE]: restore.json's fields of an off-site restore, after a comma.
restore_from() { printf ',"from":"offsite","snapshot":"%s"%s' "$1" "${2:+,\"instance\":\"$2\"}"; }
# offsite_restore REQUEST: the restore the request REQUEST asks, which is removed as it is read.
offsite_restore() {
  RESTORE_FROM=',"from":"offsite"'
  if ! by_root "$1"; then
    rm -f -- "$1"
    set_said restore refused '"error":"Only root asks for this."'
    warn "An off-site restore request that root didn't make was refused."
    RESTORE_FROM=''
    return 0
  fi
  fr_snap="$(head -c 200 "$1" 2>/dev/null | sed -n 1p | tr -d ' \t\r')"
  fr_from="$(head -c 200 "$1" 2>/dev/null | sed -n 2p | tr -d ' \t\r')"
  rm -f -- "$1"
  # One line each (sed took one), so grep's -x holds for the whole value.
  if ! printf '%s' "$fr_snap" | grep -Eqx 'latest|[0-9a-f]{8,64}'; then
    set_said restore failed '"phase":"download","error":"The request named no snapshot: latest, or a snapshot id of 8 to 64 hex digits."'
    warn "An off-site restore request named no snapshot."
    RESTORE_FROM=''
    return 0
  fi
  if [ -n "$fr_from" ] && ! printf '%s' "$fr_from" | grep -Eqx '[0-9a-f]{8}'; then
    set_said restore failed '"phase":"download","error":"The request named no instance: an instance id is 8 hex digits."'
    warn "An off-site restore request named no instance."
    RESTORE_FROM=''
    return 0
  fi
  RESTORE_FROM="$(restore_from "$fr_snap" "$fr_from")"
  if [ -z "$(offsite_repo)" ]; then
    set_said restore failed '"phase":"download","error":"This machine has no off-site repository: give it one with OFFSITE-SET."'
    warn "This machine has no off-site repository, so it wasn't restored from one."
    RESTORE_FROM=''
    return 0
  fi
  say "Restoring this machine from the off-site backup $fr_snap${fr_from:+ of the machine $fr_from}"
  set_said restore restoring '"phase":"download"'
  fr_why="$RUN/offsite-restore-why"
  mkdir -p "$RUN"
  rm -f "$fr_why"
  set +e
  (
    set -e
    umask 077
    ACCOUNT_WHY="$fr_why"
    if command -v flock >/dev/null 2>&1; then
      exec 8>"$RUN/offsite.lock"
      flock -n 8 || die "An off-site backup runs now: restore from it when it is done."
    fi
    offsite_fetch "$fr_snap" "$fr_from"
    SET="$OFFSITE_SCRATCH"
    restore_set
  ) </dev/null
  fr_done=$?
  set -e
  rm -rf -- "$OFFSITE_SCRATCH"
  INSTANCE="$(get_env "$ENV" BOT_DOT_INSTANCE)"
  if [ "$fr_done" != 0 ]; then
    fr_text="$(cut -f2- "$fr_why" 2>/dev/null || true)"
    fr_text="${fr_text:-The off-site restore stopped without saying why}"
    # The snapshot as the status named it last: its whole id once the manifest was found.
    fr_named="$(sed -n 's/.*"snapshot":"\([0-9a-f]\{64\}\)".*/\1/p' "$DOOR/status/restore.json" 2>/dev/null || true)"
    RESTORE_FROM="$(restore_from "${fr_named:-$fr_snap}" "$fr_from")"
    set_said restore failed "\"phase\":\"download\",\"error\":\"$(printf '%s' "$fr_text" | plain_line 300)\""
    warn "This machine wasn't restored from its off-site backup: $fr_text"
  fi
  rm -f "$fr_why"
  RESTORE_FROM=''
}

# A restore test asked by root (the fleet console's restore-test, #1018): RESTORE-TEST, whose first line is the account,
# runs what `install.sh --restore-test ACCOUNT` runs, refused while an off-site backup runs, with how it went in
# status/restore-test.json as there.
RESTORE_TEST_REQUEST=RESTORE-TEST
# restore_test_request REQUEST: the test the request REQUEST asks, which is removed as it is read.
restore_test_request() {
  # Read only once it is root's: the front door may swap a file of its own for a pipe, which a read would wait on.
  RESTORE_TEST=''
  if ! by_root "$1"; then
    rm -f -- "$1"
    restore_test_said refused '"error":"Only root asks for this."'
    warn "A restore test request that root didn't make was refused."
    return 0
  fi
  RESTORE_TEST="$(head -c 100 "$1" 2>/dev/null | head -n 1 | tr -d ' \t\r' || true)"
  valid_account "$RESTORE_TEST" || RESTORE_TEST=''
  rm -f -- "$1"
  if [ -z "$RESTORE_TEST" ]; then
    restore_test_said refused '"error":"The request named no account."'
    warn "A restore test request named no account."
    return 0
  fi
  restore_test </dev/null
  [ -z "$RT_TEXT" ] || warn "The restore test of $RESTORE_TEST didn't pass: $RT_TEXT"
}

# revision_of IMAGE [DOCKER]: the source revision IMAGE was built from, 7 characters, or nothing.
revision_of() {
  ro_="$(${2:-$D} image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$1" </dev/null 2>/dev/null | cut -c1-7 || true)"
  case "$ro_" in '' | *[!0-9a-f]*) ;; *) printf '%s' "$ro_" ;; esac
}
# rollback_one NAME: the account NAME back to its snapshot (#979, ADR 155), as asked with ROLLBACK-NAME: its data,
# compose.yaml and .env as they were before its last switch, its botdot server started on the version it ran then and
# made to answer. One that doesn't answer gets what it ran just before back, data and all. How it went is in
# status/account-NAME.json: rolledback, with the version it runs, or kept or failed, with why. A snapshot used goes.
rollback_one() {
  ro_state="$(door_state "$1")"
  case "$ro_state" in running*) ;; *) warn "The account $1 isn't running, so it wasn't rolled back."; return 0 ;; esac
  ro_home="$ACCOUNTS/$1"
  A="env DOCKER_HOST=unix://$RUN/$1/docker.sock docker"
  if ! { [ -f "$ro_home/compose.yaml" ] && [ -f "$ro_home/.env" ] && $A info </dev/null >/dev/null 2>&1; }; then
    account_said "$1" kept '"error":"Its botdot server was not running, so it was not rolled back."'
    warn "The account $1's Docker isn't running, so it wasn't rolled back."
    return 0
  fi
  if ! ro_snap="$(snapshot_of "$1")"; then
    account_said "$1" kept '"error":"It has no snapshot to go back to."'
    warn "The account $1 has no snapshot to go back to."
    return 0
  fi
  ro_image="$(get_env "$ro_snap/.env" BOT_DOT_IMAGE)"
  # The version it ran then, which the cleanup after its switch removed from its Docker: downloaded again, pinned by the
  # digest that was checked when it was installed.
  if [ -n "$ro_image" ] && ! $A image inspect "$ro_image" </dev/null >/dev/null 2>&1; then
    if [ -z "$(registry_of "$ro_image")" ] || ! pull "$ro_image" "$A"; then
      account_said "$1" kept "\"error\":\"$(printf "Couldn't download the version it ran before%s" "$(because)" | plain_line 300)\""
      warn "The account $1 wasn't rolled back: couldn't download $ro_image$(because)."
      return 0
    fi
  fi
  say "Rolling the account $1 back to its snapshot"
  cp -p "$ro_home/compose.yaml" "$ro_home/compose.yaml.before"
  cp -p "$ro_home/.env" "$ro_home/.env.before"
  $A compose --project-directory "$ro_home" stop bot-dot </dev/null >/dev/null 2>&1 || true
  rm -rf -- "$ro_home/data.after"
  mv "$ro_home/data" "$ro_home/data.after"
  if cp -a "$ro_snap/data" "$ro_home/data" && cp -p "$ro_snap/compose.yaml" "$ro_home/compose.yaml" && cp -p "$ro_snap/.env" "$ro_home/.env" \
    && compose_up "$ro_home" && answers "$SOCKETS/$1" "$ro_home"; then
    rm -rf -- "$ro_home/data.after" "$ro_snap"
    trim_disk "$1"
    rm -f "$ro_home/compose.yaml.before" "$ro_home/.env.before"
    ro_version="$(revision_of "$ro_image" "$A")"
    account_said "$1" rolledback "${ro_version:+\"version\":\"$ro_version\"}"
    ok "The account $1 is rolled back to its snapshot${ro_version:+, on version $ro_version}"
    return 0
  fi
  $A compose --project-directory "$ro_home" logs --no-color --tail 40 </dev/null 2>&1 | sed 's/^/    /' || true
  warn "The account $1's botdot server didn't start from its snapshot, so it goes back to what it ran."
  $A compose --project-directory "$ro_home" stop bot-dot </dev/null >/dev/null 2>&1 || true
  rm -rf -- "$ro_home/data"
  mv "$ro_home/data.after" "$ro_home/data"
  mv "$ro_home/compose.yaml.before" "$ro_home/compose.yaml"
  mv "$ro_home/.env.before" "$ro_home/.env"
  compose_up "$ro_home" || true
  if answers "$SOCKETS/$1" "$ro_home"; then account_said "$1" kept '"error":"Its botdot server did not start from its snapshot, so it runs the version it ran."'
  else account_said "$1" failed '"error":"Its botdot server did not start, neither from its snapshot nor on the version it ran."'; fi
}

# A link asked by root alone (#985), on a machine with no admin page to make it (ADR 154): SIGN-IN-<account> asks for a
# sign-in link that makes that account a new passkey, and SIGN-UP for a sign-up link, for the account named on its
# first line or, empty, for any name. The front door makes it as the admin page does, with the same expiry and single
# use, and keeps an audit entry by the console; root writes it in status/sign-in-<account>.json, status/sign-up.json or
# status/sign-up-<account>.json, which only root and the front door read: state (made, refused or failed), at, kind,
# account, and url and expires once made, or error. The link is printed nowhere else: not in root's step's log, not in
# the audit log.
SIGN_IN=SIGN-IN-
SIGN_UP=SIGN-UP

# door_link sign-in|sign-up STATUS [ACCOUNT]: the link asked of the front door, in status/STATUS.json.
door_link() {
  dl_kind="$1" dl_file="$DOOR/status/$2.json" dl_name="${3:-}"
  dl_err="$RUN/link-err"
  mkdir -p "$DOOR/status"
  set +e
  dl_line="$($D compose --project-directory "$DOOR" exec -T front-door node front-door.js "$dl_kind-link" ${dl_name:+--account "$dl_name"} --by console </dev/null 2>"$dl_err" | head -n 1)"
  set -e
  dl_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  case "$dl_line" in
    '{"state":"made",'*'}' | '{"state":"refused",'*'}')
      put "$dl_file" "{\"at\":\"$dl_at\",${dl_line#\{}"
      case "$dl_line" in
        '{"state":"made",'*) ok "A $dl_kind link${dl_name:+ for $dl_name} is in $dl_file" ;;
        *) warn "The $dl_kind link${dl_name:+ for $dl_name} was refused: $(printf '%s' "$dl_line" | sed -n 's/.*"error":"\([^"]*\)".*/\1/p' | plain_line 200)" ;;
      esac ;;
    *)
      dl_why="$(head -n 1 "$dl_err" 2>/dev/null | plain_line 200)"
      put "$dl_file" "{\"state\":\"failed\",\"at\":\"$dl_at\",\"kind\":\"$dl_kind\"${dl_name:+,\"account\":\"$dl_name\"},\"error\":\"The front door made no link${dl_why:+: $dl_why}\"}"
      warn "The front door made no $dl_kind link${dl_name:+ for $dl_name}${dl_why:+: $dl_why}" ;;
  esac
  rm -f "$dl_err"
}
# link_request FILE: the link request FILE taken: refused unless root made it.
link_request() {
  lr="$1"
  lr_base="${lr##*/}"
  lr_name=''
  case "$lr_base" in
    "$SIGN_UP") lr_kind=sign-up
      lr_name="$(head -c 100 "$lr" 2>/dev/null | head -n 1 | tr -d ' \t\r' || true)" ;;
    *) lr_kind=sign-in lr_name="${lr_base#"$SIGN_IN"}" ;;
  esac
  if [ -n "$lr_name" ] && ! valid_account "$lr_name"; then
    rm -f -- "$lr"
    warn "Not an account's name, so no $lr_kind link was made: $(printf '%s' "$lr_name" | tr -cd 'A-Za-z0-9._-' | cut -c1-40)"
    return 0
  fi
  lr_status="$lr_kind${lr_name:+-$lr_name}"
  if ! by_root "$lr"; then
    rm -f -- "$lr"
    put "$DOOR/status/$lr_status.json" "{\"state\":\"refused\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"kind\":\"$lr_kind\"${lr_name:+,\"account\":\"$lr_name\"},\"error\":\"Only root asks for this.\"}"
    warn "A $lr_kind link request that root didn't make was refused."
    return 0
  fi
  rm -f -- "$lr"
  door_link "$lr_kind" "$lr_status" "$lr_name"
}

# The fleet console's keys for a managed machine (ADR 162), root's alone: KEYS, lines of `openrouter KEY` and
# `composio KEY`, written 600 by the console's agent and removed as soon as it is read. They reach the front door the
# way the installer's do, in data/install-keys.json, which it takes within a minute. status/keys.json says which were
# handed on, never a key.
KEYS_REQUEST=KEYS
keys_request() {
  kr="$REQUESTS/$KEYS_REQUEST"
  if ! by_root "$kr"; then
    rm -f -- "$kr"
    write_status keys.json "{\"state\":\"refused\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"error\":\"Only root asks for this.\"}"
    warn "A keys request that root didn't make was refused."
    return 0
  fi
  kr_openrouter="$(head -c 2000 "$kr" | sed -n 's/^openrouter \([A-Za-z0-9_-]\{8,300\}\)$/\1/p' | head -n 1)"
  kr_composio="$(head -c 2000 "$kr" | sed -n 's/^composio \([A-Za-z0-9_-]\{8,300\}\)$/\1/p' | head -n 1)"
  rm -f -- "$kr"
  if [ -z "$kr_openrouter$kr_composio" ]; then
    write_status keys.json "{\"state\":\"refused\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"error\":\"The request named no key.\"}"
    warn "A keys request named no key."
    return 0
  fi
  kr_json() { if [ -n "$1" ]; then printf '"%s"' "$1"; else printf null; fi; }
  mkdir -p "$DOOR/data"
  (umask 077; printf '{"openrouter":%s,"boat":null,"composio":%s}\n' "$(kr_json "$kr_openrouter")" "$(kr_json "$kr_composio")" > "$DOOR/data/install-keys.json.new")
  chown "$(id -u "$DOOR_USER"):$(id -g "$DOOR_USER")" "$DOOR/data/install-keys.json.new" 2>/dev/null || true
  mv "$DOOR/data/install-keys.json.new" "$DOOR/data/install-keys.json"
  write_status keys.json "{\"state\":\"handed\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"openrouter\":$([ -n "$kr_openrouter" ] && echo true || echo false),\"composio\":$([ -n "$kr_composio" ] && echo true || echo false)}"
  ok "The console's keys are handed to the front door"
  unset kr_openrouter kr_composio
}

# The whole machine paused by the fleet console (its customer suspended), root's alone: SUSPEND suspends every account
# in the front door's data, as the admin page suspends one (its owner sees only that it is paused, its botdot server
# and computers stop, its data stays), and RESUME starts every one again. With both there, the newer is taken.
# status/suspend.json says how it went: state (suspended, resumed, refused or failed), at, and error.
SUSPEND_REQUEST=SUSPEND
RESUME_REQUEST=RESUME
pause_said() { write_status suspend.json "{\"state\":\"$1\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"${2:+,$2}}"; }
# pause_request FILE: SUSPEND or RESUME taken: the front door's data changed, then every account made to match it.
pause_request() {
  pr="$1"
  pr_kind=resume
  [ "${pr##*/}" != "$SUSPEND_REQUEST" ] || pr_kind=suspend
  if ! by_root "$pr"; then
    rm -f -- "$pr"
    pause_said refused '"error":"Only root asks for this."'
    warn "A $pr_kind request that root didn't make was refused."
    return 0
  fi
  rm -f -- "$pr"
  pr_err="$RUN/pause-err"
  set +e
  pr_line="$($D compose --project-directory "$DOOR" exec -T front-door node front-door.js "$pr_kind" --by console </dev/null 2>"$pr_err" | head -n 1)"
  set -e
  case "$pr_line" in
    '{"state":"suspended",'*'}' | '{"state":"resumed",'*'}') ;;
    *)
      pr_why="$(head -n 1 "$pr_err" 2>/dev/null | plain_line 200)"
      rm -f "$pr_err"
      pause_said failed "\"error\":\"The front door changed nothing${pr_why:+: $pr_why}\""
      warn "The front door didn't $pr_kind the machine's accounts${pr_why:+: $pr_why}"
      return 0 ;;
  esac
  rm -f "$pr_err"
  pr_failed=''
  for pr_home in "$ACCOUNTS"/*/; do
    pr_name="$(basename "$pr_home")"
    valid_account "$pr_name" && [ -f "$ACCOUNTS/$pr_name/compose.yaml" ] || continue
    pr_state="$(door_state "$pr_name")"
    set +e
    # shellcheck disable=SC2086 # the state, then its share's three numbers
    ( set -e; settle "$pr_name" $pr_state )
    pr_done=$?
    set -e
    [ "$pr_done" = 0 ] || pr_failed="$pr_failed${pr_failed:+, }$pr_name"
  done
  if [ -n "$pr_failed" ]; then
    pause_said failed "\"error\":\"The front door's data says $([ "$pr_kind" = suspend ] && echo suspended || echo resumed), but these accounts don't match it yet: $pr_failed\""
    warn "These accounts weren't made to match the front door: $pr_failed"
  else
    pause_said "$([ "$pr_kind" = suspend ] && echo suspended || echo resumed)"
    ok "Every account of this machine is $([ "$pr_kind" = suspend ] && echo suspended || echo running again)"
  fi
}

if [ "$MODE" = requested ]; then
  # The console's keys (ADR 162), first: they take nothing else's time.
  if [ -f "$REQUESTS/$KEYS_REQUEST" ] && [ ! -L "$REQUESTS/$KEYS_REQUEST" ]; then keys_request; fi
  # The whole machine paused or started again (the console's customer suspended or activated), the newer of the two.
  pr_s="$REQUESTS/$SUSPEND_REQUEST" pr_r="$REQUESTS/$RESUME_REQUEST"
  if [ -f "$pr_s" ] && [ ! -L "$pr_s" ] && [ -f "$pr_r" ] && [ ! -L "$pr_r" ]; then
    if [ "$pr_r" -nt "$pr_s" ]; then rm -f -- "$pr_s"; else rm -f -- "$pr_r"; fi
  fi
  for request in "$pr_s" "$pr_r"; do
    if [ -f "$request" ] && [ ! -L "$request" ]; then pause_request "$request"; fi
  done
  # A backup set's requests (#986), root's alone: one the front door made is refused. A restore comes first, and a
  # set is made before an update, of what ran until then.
  for request in "$REQUESTS/$RESTORE" "$REQUESTS/$BACKUP"; do
    [ -f "$request" ] && [ ! -L "$request" ] || continue
    kind=backup
    [ "$request" != "$REQUESTS/$RESTORE" ] || kind=restore
    if ! by_root "$request"; then
      rm -f -- "$request"
      set_said "$kind" refused '"error":"Only root asks for this."'
      warn "A $kind request that root didn't make was refused."
      continue
    fi
    rm -f -- "$request"
    if [ "$kind" = restore ]; then restore_set; else backup_set; fi
  done
  # The off-site backup set up (ADR 161), by root or by the front door for the admin page.
  request="$REQUESTS/$OFFSITE_SET"
  if [ -f "$request" ] && [ ! -L "$request" ]; then offsite_set "$request"; fi
  # This machine put back from its off-site repository (ADR 159), root's alone: after OFFSITE-SET, which a move to this
  # machine sends first, and before a backup is started.
  request="$REQUESTS/$OFFSITE_RESTORE"
  if [ -f "$request" ] && [ ! -L "$request" ]; then offsite_restore "$request"; fi
  # A restore test (#1018), root's alone, before a backup is started that would hold the lock it needs.
  request="$REQUESTS/$RESTORE_TEST_REQUEST"
  if [ -f "$request" ] && [ ! -L "$request" ]; then restore_test_request "$request"; fi
  # An off-site backup now (#1016), asked by root or by the admin page's "Back up now" (ADR 161): in a run of its own,
  # as it can take hours.
  request="$REQUESTS/$OFFSITE_REQUEST"
  if [ -f "$request" ] && [ ! -L "$request" ]; then
    rm -f -- "$request"
    if [ -z "$(offsite_repo)" ]; then
      # off, not failed: a machine without off-site has no backup to miss, so nobody is told one failed (#1017).
      offsite_said off "\"error\":\"This machine has no off-site repository: name one with BOT_DOT_OFFSITE_REPO.\""
      warn "This machine has no off-site repository, so it wasn't backed up off-site."
    else
      offsite_start
    fi
  fi
  if [ -f "$REQUESTS/$UPDATE" ] && [ ! -L "$REQUESTS/$UPDATE" ]; then
    # An update to a version named in the request (#979): its first line, sha256: and the server image's 64 hex digits.
    # An empty request takes the newest, and so does the time a front door from before #979 wrote in it (the admin
    # page's Update); anything else is refused by the update, at check.
    to="$(head -c 200 "$REQUESTS/$UPDATE" 2>/dev/null | head -n 1 | tr -d ' \t\r' || true)"
    rm -f -- "$REQUESTS/$UPDATE"
    if printf '%s' "$to" | grep -Eqx '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z'; then to=''; fi
    if [ -n "$to" ] && ! printf '%s' "$to" | grep -Eqx 'sha256:[0-9a-f]{64}'; then to=invalid; fi
    update_all "$to"
  fi
  # "Update now" for one account (ADR 053), after the admin's update, which would have switched or left it anyway.
  for request in "$REQUESTS"/SWITCH-*; do
    [ -f "$request" ] && [ ! -L "$request" ] || continue
    name="${request##*/SWITCH-}"
    rm -f -- "$request"
    if valid_account "$name"; then switch_one "$name"
    else warn "Not an account's name, so nothing was switched: $(printf '%s' "$name" | tr -cd 'A-Za-z0-9._-' | cut -c1-40)"; fi
  done
  # A rollback for one account to its snapshot (#979), after any switch.
  for request in "$REQUESTS"/ROLLBACK-*; do
    [ -f "$request" ] && [ ! -L "$request" ] || continue
    name="${request##*/ROLLBACK-}"
    rm -f -- "$request"
    if valid_account "$name"; then
      # In a subshell of its own, which stops at its first failure, so that the requests after it are taken.
      set +e
      ( set -e; rollback_one "$name" )
      [ "$?" = 0 ] || warn "The account $name wasn't rolled back (see above)."
      set -e
    else warn "Not an account's name, so nothing was rolled back: $(printf '%s' "$name" | tr -cd 'A-Za-z0-9._-' | cut -c1-40)"; fi
  done
  # The links root asked for (#985).
  for request in "$REQUESTS/$SIGN_UP" "$REQUESTS/$SIGN_IN"*; do
    [ -f "$request" ] && [ ! -L "$request" ] || continue
    link_request "$request"
  done
  for request in "$REQUESTS"/* "$REQUESTS"/.[!.]* "$REQUESTS"/..?*; do
    [ -e "$request" ] || [ -L "$request" ] || continue
    name="$(basename "$request")"
    taken=''
    # Asked again while it ran: the next run, which systemd starts for it, updates once more.
    if { [ "$name" = "$UPDATE" ] || [ "$name" = "$BACKUP" ] || [ "$name" = "$RESTORE" ] || [ "$name" = "$OFFSITE_REQUEST" ] || [ "$name" = "$OFFSITE_SET" ] || [ "$name" = "$OFFSITE_RESTORE" ] || [ "$name" = "$RESTORE_TEST_REQUEST" ] || [ "$name" = "$KEYS_REQUEST" ] || [ "$name" = "$SUSPEND_REQUEST" ] || [ "$name" = "$RESUME_REQUEST" ]; } && [ -f "$request" ] && [ ! -L "$request" ]; then continue
    # So is "Update now" asked while it ran.
    elif case "$name" in SWITCH-* | ROLLBACK-* | "$SIGN_IN"* | "$SIGN_UP") [ -f "$request" ] && [ ! -L "$request" ] ;; *) false ;; esac; then continue
    elif ! valid_account "$name"; then
      warn "Not an account's name, so nothing was done: $(printf '%s' "$name" | tr -cd 'A-Za-z0-9._-' | cut -c1-40)"
    else
      settled='-'
      for _ in 1 2 3; do
        state="$(door_state "$name")"
        [ "$state" != "$settled" ] || break
        # In a subshell of its own, which stops at its first failure: a `||` here would turn that off.
        set +e
        # shellcheck disable=SC2086 # the state, then its share's three numbers
        ( set -e; settle "$name" $state )
        done_=$?
        set -e
        if [ "$done_" != 0 ]; then
          warn "The account $name wasn't made to match the front door (see above). Its owner sees that its botdot server isn't running."
          break
        fi
        settled="$state"
        rm -rf -- "$request" || true
        taken=1
      done
    fi
    # Gone whatever it was (a folder too), so that the next run isn't started for it again. Not once it was taken
    # above: one there now is a new request, made while the data was read once more (a resume right after a suspend),
    # and the next run takes it.
    [ -n "$taken" ] || rm -rf -- "$request" || warn "Couldn't remove the request $(basename "$request")"
  done
  # The admin page shows what changed now, not at the next minute.
  write_load || true
  exit 0
fi

# each_account NAME [CPU RAM DISK]: account NAME, on its own when it ran already (#194, ADR 044): one that fails
# (a download, its Docker, its new server) keeps the version it ran, and the others go on. What became of each is a
# line "NAME<tab>updated|kept|failed<tab>the version it runs<tab>why" in BOT_DOT_UPDATE_RESULTS, which the admin page's update hands this run;
# the run ends failed, naming the accounts that weren't updated, once everything else is done. A new account (the
# admin's on the first install) stops the run as before.
NOT_UPDATED=''
each_account() {
  [ -f "$ACCOUNTS/$1/compose.yaml" ] || { account "$@"; return 0; }
  why_file="$HELD/$1"
  if [ -s "$why_file" ]; then done_=1
  else
    rm -f "$why_file"
    set +e
    ( set -e; ACCOUNT_WHY="$why_file"; account "$@" )
    done_=$?
    set -e
  fi
  if [ "$done_" = 0 ]; then
    [ -z "${BOT_DOT_UPDATE_RESULTS:-}" ] || printf '%s\tupdated\t-\t-\n' "$1" >> "$BOT_DOT_UPDATE_RESULTS"
    return 0
  fi
  line="$(cat "$why_file" 2>/dev/null || true)"
  rm -f "$why_file"
  result="${line%%	*}"
  why="${line#*	}"
  case "$result" in kept | failed) ;; *) result=kept why="see what the installer said above" ;; esac
  [ -n "$why" ] || why="see what the installer said above"
  if [ "$result" = kept ]; then warn "The account $1 wasn't updated, and runs the version it ran: $why"
  else warn "The account $1 wasn't updated, and doesn't run: $why"; fi
  # The version it runs, as version.json names one: its image's source revision ("-" when it has none).
  ran_image="$(get_env "$ACCOUNTS/$1/.env" BOT_DOT_IMAGE)"
  ran="$(env DOCKER_HOST="unix://$RUN/$1/docker.sock" docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "${ran_image:-$IMAGES/bot-dot:latest}" </dev/null 2>/dev/null | cut -c1-7 || true)"
  case "$ran" in '' | *[!0-9a-f]*) ran=- ;; esac
  [ -z "${BOT_DOT_UPDATE_RESULTS:-}" ] || printf '%s\t%s\t%s\t%s\n' "$1" "$result" "$ran" "$why" >> "$BOT_DOT_UPDATE_RESULTS"
  # One that waited doesn't wait any more: its owner sees why it wasn't switched (ADR 053).
  [ ! -f "$DOOR/status/account-$1.json" ] || account_said "$1" "$result" "\"error\":\"$(printf '%s' "$why" | plain_line 300)\""
  NOT_UPDATED="${NOT_UPDATED:+$NOT_UPDATED, }$1"
}

# door_waits NAME: the account NAME's owner turned "Update automatically" off (ADR 053), as the front door's data says,
# read as door_state reads it.
door_waits() {
  [ -f "$DOOR/data/front-door.json" ] || return 1
  [ "$($D run --rm -i --entrypoint node "$IMAGE" -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{try{const a=JSON.parse(s).accounts||{},n=process.argv[1];if(Object.hasOwn(a,n)&&a[n].autoUpdate===false)process.stdout.write("off")}catch{}})' "$1" < "$DOOR/data/front-door.json" 2>/dev/null || true)" = off ]
}
# waits NAME: the admin page's update leaves the account NAME on the version it runs (ADR 053): its owner turned
# "Update automatically" off, the new version is in its Docker, and it ran the version the front door pinned until now,
# or it waits already for this very one. One that would be two versions behind, or one an earlier update kept back, is
# switched. The front door's .env still pins the version before here: door_files writes the new one after the accounts.
waits() {
  [ "$MODE" = update ] && [ -n "$REGISTRY" ] && [ ! -s "$HELD/$1" ] || return 1
  # Only one whose Docker runs got the new version: one that doesn't is started on it, as before.
  env DOCKER_HOST="unix://$RUN/$1/docker.sock" docker info </dev/null >/dev/null 2>&1 || return 1
  w_ran="$(get_env "$ACCOUNTS/$1/.env" BOT_DOT_IMAGE)"
  w_pin="$(get_env "$ENV" BOT_DOT_IMAGE)"
  [ "$w_ran" != "$IMAGE" ] || return 1
  [ "$w_ran" = "$w_pin" ] || { [ "$w_pin" = "$IMAGE" ] && [ "$(account_was "$1")" = waiting ]; } || return 1
  door_waits "$1"
}
# wait_for NAME: the account NAME stays on the version it runs, waits for this one since it first did, and keeps its
# old images (ADR 053).
WAITING=''
wait_for() {
  wf_since=''
  wf_new="$(revision_of "$IMAGE")"
  # Waiting already for this very version: since it began, also when an update stopped before the front door pinned it.
  if [ "$(account_was "$1")" = waiting ] && { [ "$(get_env "$ENV" BOT_DOT_IMAGE)" = "$IMAGE" ] || { [ -n "$wf_new" ] && grep -q "\"version\":\"$wf_new\"" "$DOOR/status/account-$1.json" 2>/dev/null; }; }; then
    wf_since="$(sed -n 's/.*"since":"\([0-9T:Z-]*\)".*/\1/p' "$DOOR/status/account-$1.json" 2>/dev/null || true)"
  fi
  wf_since="${wf_since:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
  wf_ran="$(revision_of "$(get_env "$ACCOUNTS/$1/.env" BOT_DOT_IMAGE)" "env DOCKER_HOST=unix://$RUN/$1/docker.sock docker")"
  account_said "$1" waiting "\"since\":\"$wf_since\",\"version\":\"$wf_new\",\"from\":\"$wf_ran\""
  ok "The account $1 waits for its owner on the version it runs: the new one is in its Docker"
  [ -z "${BOT_DOT_UPDATE_RESULTS:-}" ] || printf '%s\twaiting\t%s\t-\n' "$1" "${wf_ran:--}" >> "$BOT_DOT_UPDATE_RESULTS"
  WAITING="${WAITING:+$WAITING, }$1"
}

# The admin's own account first, then the others. The admin's waits by the same rule as any other's (#274).
state="$(door_state "$ADMIN")"
# shellcheck disable=SC2086 # its share's three numbers, after its state
if waits "$ADMIN"; then wait_for "$ADMIN"; else phase switch "$ADMIN"; each_account "$ADMIN" ${state#* }; fi
for other in "$ACCOUNTS"/*/; do
  other="$(basename "$other")"
  [ "$other" != "$ADMIN" ] && [ -f "$ACCOUNTS/$other/compose.yaml" ] || continue
  # An update leaves a suspended account stopped (resuming it brings it up to date), and erases a deleted one.
  state="$(door_state "$other")"
  case "$state" in
    suspended*) ok "The account $other is suspended, so it stays stopped" ;;
    deleted) erase_account "$other" ;;
    # shellcheck disable=SC2086 # its share's three numbers, after its state
    *) if waits "$other"; then wait_for "$other"; else phase switch "$other"; each_account "$other" ${state#* }; fi ;;
  esac
done
rm -rf "$HELD"

# An update moves the front door last, once every account it could update runs the new version, and then removes in
# each of them what it replaced.
if [ "$MODE" = update ]; then
  phase front-door
  door_files
  start_door
  for other in $(running_accounts); do
    # One kept on the version it ran keeps its old images too (#194), and so does one that waits (ADR 053).
    case ", $NOT_UPDATED, $WAITING, " in *", $other, "*) continue ;; esac
    phase clean "$other"
    clean_account "$other"
  done
  phase clean
fi

# The images this run replaced in the machine's own Docker, the front door's, go as in each account's: botdot's rule
# decides which (lib/image-cleanup.js), run from the image now installed. Images built on this machine are the admin's.
if [ -n "$REGISTRY" ]; then
  CLEANED="$($D run --rm --pull never --network none --user 0:0 -v /var/run/docker.sock:/var/run/docker.sock --entrypoint node "$IMAGE" /opt/bot-dot/lib/image-cleanup.js "$IMAGE" "$COMPUTER_IMAGE" </dev/null 2>/dev/null || true)"
  CLEANED="$(printf '%s' "$CLEANED" | json 'j.failed ? "" : j.removed ? "Removed " + j.removed + " old image" + (j.removed === 1 ? "" : "s") + " of the front door" : "No old images of the front door to remove"' || true)"
  if [ -n "$CLEANED" ]; then ok "$CLEANED"
  else warn "Couldn't remove every old image of the front door now; the next update tries again."; fi
fi

# Seed only an explicitly created demo; never touch the data of a normal account.
if [ -n "$(get_env "$ENV" FRONT_DOOR_DEMO_CODE_SHA256)" ] && [ ! -f "$DIR/demo-seeded" ]; then
  demo_seed="$RUN/seed-demo.js"
  if [ -f "$SOURCE/deploy/seed-demo.js" ]; then cp "$SOURCE/deploy/seed-demo.js" "$demo_seed";
  else image_file deploy/seed-demo.js > "$demo_seed"; fi
  $D run --rm -i --network none --user 0:0 -e "BOT_DOT_ACCOUNT=$ADMIN" -v "$SOCKETS/$ADMIN:/socket:ro" -v "$demo_seed:/seed-demo.js:ro" --entrypoint node "$IMAGE" /seed-demo.js \
    || die "Couldn't prepare the fictional demo data. Retry this install."
  rm -f "$demo_seed"
  touch "$DIR/demo-seeded"
fi

# The version every account and the front door now run, for the admin page (#473): the source's revision the image
# carries, or the image's own id. And whether it is self-built, which the admin builds again before an update.
VERSION="$($D image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE" </dev/null 2>/dev/null || true)"
case "$VERSION" in
  *[!0-9a-f]* | '') VERSION="$($D image inspect --format '{{.Id}}' "$IMAGE" </dev/null 2>/dev/null | sed 's/^sha256://' | cut -c1-12 || true)" ;;
  *) VERSION="$(printf '%s' "$VERSION" | cut -c1-7)" ;;
esac
case "$VERSION" in *[!0-9a-f]*) VERSION='' ;; esac
write_status version.json "{\"version\":\"$VERSION\",\"selfBuilt\":$([ -n "$REGISTRY" ] && echo false || echo true),\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
# The signed release just checked and installed is the newest there is, until root's step finds a newer one (#193).
[ -z "$REGISTRY" ] || say_newest "$VERSION"

# Root's step for the front door: a copy of this installer only root may change, started by systemd whenever the front
# door asked for an account, and every minute to write the load the admin page shows (botdot-load.timer). Without
# systemd a loop started now does both, until the machine restarts. Beside it, the four files of botdot's source it
# checks the signature of an update with (step 2). The admin running the installer from the source again changes them,
# and so does an update from the admin page, with the installer and the four files of the signed image it installs
# (ADR 036).
mkdir -p "$BIN"
chown 0:0 "$BIN"
chmod 700 "$BIN"
if [ -f "$SOURCE/install.sh" ] && [ "$SOURCE" != "$BIN" ]; then
  cp "$SOURCE/install.sh" "$BIN/install.sh.new"
  chmod 600 "$BIN/install.sh.new"
  mv "$BIN/install.sh.new" "$BIN/install.sh"
  mkdir -p "$BIN/lib"
  chmod 755 "$BIN/lib"
  for f in signed-image registry release-manifest release-trust; do
    [ -f "$SOURCE/lib/$f.js" ] || continue
    cp "$SOURCE/lib/$f.js" "$BIN/lib/$f.js.new"
    chmod 644 "$BIN/lib/$f.js.new"
    mv "$BIN/lib/$f.js.new" "$BIN/lib/$f.js"
  done
elif [ ! -f "$SOURCE/install.sh" ]; then
  warn "This installer isn't in a file of its own, so sign-up links can't make accounts yet. Run it from botdot's source."
fi
# A separate worker and lock keep the optional computer download out of the install and root's request lock.
if [ -d "$DIR/computer-preparation" ]; then
  if [ -f "$SOURCE/deploy/prepare-computers.sh" ]; then
    cp "$SOURCE/deploy/prepare-computers.sh" "$BIN/prepare-computers.sh"
  else
    image_file deploy/prepare-computers.sh > "$BIN/prepare-computers.sh"
  fi
  chmod 700 "$BIN/prepare-computers.sh"
  if [ -n "$SYSTEMD" ]; then
    cat > "$ETC/systemd/system/botdot-computers.service" <<UNIT
[Unit]
Description=Prepare botdot computers in the background
After=docker.service network-online.target
[Service]
Type=oneshot
Environment=BOT_DOT_DIR=$DIR
Environment=BOT_DOT_RUN=$RUN
ExecStart=/bin/sh $BIN/prepare-computers.sh
TimeoutStartSec=95min
Nice=10
[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
    cat > "$ETC/systemd/system/botdot-computers.timer" <<UNIT
[Unit]
Description=Retry pending botdot computer preparation
[Timer]
OnBootSec=2min
OnUnitInactiveSec=5min
[Install]
WantedBy=timers.target
UNIT
    systemctl enable --now botdot-computers.timer
    systemctl start --no-block botdot-computers.service
  else
    BOT_DOT_DIR="$DIR" BOT_DOT_RUN="$RUN" nohup sh "$BIN/prepare-computers.sh" >> "$DIR/computer-preparation.log" 2>&1 </dev/null 9>&- 8>&- &
  fi
fi

if [ -n "$SYSTEMD" ]; then
  cat > "$ETC/systemd/system/botdot-accounts.path.new" <<UNIT
# botdot (install.sh): the front door asked for a new account (ADR 028, #467).
[Unit]
Description=botdot: an account the front door asked for

[Path]
DirectoryNotEmpty=$REQUESTS

[Install]
WantedBy=paths.target
UNIT
  cat > "$ETC/systemd/system/botdot-accounts.service.new" <<UNIT
# botdot (install.sh): root's one step for the front door. It makes the accounts named in $REQUESTS, as the install
# made the admin's, and takes nothing else from there.
[Unit]
Description=botdot: make the accounts the front door asked for

[Service]
Type=oneshot
Environment=BOT_DOT_DIR=$DIR BOT_DOT_RUN=$RUN BOT_DOT_ETC=$ETC
ExecStart=/bin/sh $BIN/install.sh --requested
UNIT
  cat > "$ETC/systemd/system/botdot-load.timer.new" <<UNIT
# botdot (install.sh): every minute, the machine's load and each account's use of its share, for the admin page (#471).
[Unit]
Description=botdot: measure the load for the admin page

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=10s

[Install]
WantedBy=timers.target
UNIT
  cat > "$ETC/systemd/system/botdot-load.service.new" <<UNIT
# botdot (install.sh): root's step writes the machine's load and each account's use of its share in $LOAD, measured
# from outside the accounts, for the admin page.
[Unit]
Description=botdot: measure the load for the admin page

[Service]
Type=oneshot
Environment=BOT_DOT_DIR=$DIR BOT_DOT_RUN=$RUN BOT_DOT_ETC=$ETC
ExecStart=/bin/sh $BIN/install.sh --load
UNIT
  for unit in botdot-accounts.path botdot-accounts.service botdot-load.timer botdot-load.service; do
    mv "$ETC/systemd/system/$unit.new" "$ETC/systemd/system/$unit"
  done
  systemctl daemon-reload </dev/null
  systemctl enable --now botdot-accounts.path </dev/null >/dev/null 2>&1 || warn "systemd didn't start botdot-accounts.path, so sign-up links can't make accounts yet. See: systemctl status botdot-accounts.path"
  systemctl enable --now botdot-load.timer </dev/null >/dev/null 2>&1 || warn "systemd didn't start botdot-load.timer, so the admin page shows no load. See: systemctl status botdot-load.timer"
  offsite_units
elif ! { [ -f "$RUN/requests.pid" ] && kill -0 "$(cat "$RUN/requests.pid")" 2>/dev/null; }; then
  mkdir -p "$RUN"
  nohup sh -c "i=0; while :; do [ -z \"\$(ls -A '$REQUESTS' 2>/dev/null)\" ] || BOT_DOT_DIR='$DIR' BOT_DOT_RUN='$RUN' BOT_DOT_ETC='$ETC' sh '$BIN/install.sh' --requested; [ \$((i % 20)) != 0 ] || BOT_DOT_DIR='$DIR' BOT_DOT_RUN='$RUN' BOT_DOT_ETC='$ETC' sh '$BIN/install.sh' --load; i=\$((i + 1)); sleep 3; done" >> "$DIR/requests.log" 2>&1 </dev/null 9>&- &
  echo "$!" > "$RUN/requests.pid"
  warn "This machine has no systemd, so the accounts sign-up links make are made by a loop started now, which doesn't start again after a restart. Run this installer again after one. Its log: $DIR/requests.log"
fi
# An off-site repository given now or kept (#1016): its key, password, restic and repository made ready now, so that
# what is new of them is said to the admin running this, not in the night. One that isn't ready stops nothing.
if { [ "$MODE" = install ] || [ "$MODE" = update ]; } && [ -n "$(offsite_repo)" ]; then
  set +e
  ( ACCOUNT_WHY=''; offsite_prepare )
  op_ready=$?
  set -e
  [ "$op_ready" = 0 ] || warn "The off-site backup isn't ready (see above). It tries again tonight, and sudo sh $BIN/install.sh --offsite tries now."
fi

# On this computer only, the VM's way out is the computer itself: its gateway is the computer's own localhost, and
# past that lies the home network (ADR 136, #880). Nothing here may open a new connection to either, a bot's computer
# least of all, whose traffic leaves as the account's slirp4netns does: through this machine's OUTPUT. Only the VM's
# DNS, which is on the gateway, stays open. What leaves for the front door's Docker or lands on loopback stays inside.
if [ "$REACH" = local ] && [ -n "$LOCAL_HOST" ]; then
  ok "botdot's computers can't reach this computer's network"
elif [ "$REACH" = local ]; then
  RESOLVERS="$(awk '$1 == "nameserver" && $2 !~ /^127\./ && $2 !~ /:/ { print $2 }' /run/systemd/resolve/resolv.conf 2>/dev/null || true)"
  [ -n "$RESOLVERS" ] || RESOLVERS="$(awk '$1 == "nameserver" && $2 !~ /^127\./ && $2 !~ /:/ { print $2 }' "$ETC/resolv.conf" 2>/dev/null || true)"
  cat > "$BIN/local-firewall.sh.new" <<SCRIPT
#!/bin/sh
# botdot (install.sh): keeps this VM from the computer it runs on and from that computer's network (ADR 136).
set -e
iptables -N BOTDOT-LOCAL 2>/dev/null || iptables -F BOTDOT-LOCAL
iptables -C OUTPUT -j BOTDOT-LOCAL 2>/dev/null || iptables -I OUTPUT -j BOTDOT-LOCAL
iptables -A BOTDOT-LOCAL -m conntrack ! --ctstate NEW -j RETURN
for inside in lo docker+ br-+; do iptables -A BOTDOT-LOCAL -o "\$inside" -j RETURN; done
for dns in $(printf '%s ' $RESOLVERS); do
  iptables -A BOTDOT-LOCAL -d "\$dns" -p udp --dport 53 -j RETURN
  iptables -A BOTDOT-LOCAL -d "\$dns" -p tcp --dport 53 -j RETURN
done
for private in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 198.18.0.0/15; do
  iptables -A BOTDOT-LOCAL -d "\$private" -j REJECT
done
ip6tables -L -n >/dev/null 2>&1 || exit 0
ip6tables -N BOTDOT-LOCAL 2>/dev/null || ip6tables -F BOTDOT-LOCAL
ip6tables -C OUTPUT -j BOTDOT-LOCAL 2>/dev/null || ip6tables -I OUTPUT -j BOTDOT-LOCAL
ip6tables -A BOTDOT-LOCAL -m conntrack ! --ctstate NEW -j RETURN
for private in fc00::/7 fe80::/10; do ip6tables -A BOTDOT-LOCAL ! -o lo -d "\$private" -j REJECT; done
SCRIPT
  mv "$BIN/local-firewall.sh.new" "$BIN/local-firewall.sh"
  chmod 700 "$BIN/local-firewall.sh"
  if [ -n "$SYSTEMD" ]; then
    cat > "$ETC/systemd/system/botdot-local-firewall.service.new" <<UNIT
# botdot (install.sh): the VM's rules, in place before anything in it can reach out (ADR 136).
[Unit]
Description=botdot: keep this VM from the computer it runs on
DefaultDependencies=no
After=local-fs.target
Wants=network-pre.target
Before=network-pre.target docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh $BIN/local-firewall.sh

[Install]
WantedBy=multi-user.target
UNIT
    mv "$ETC/systemd/system/botdot-local-firewall.service.new" "$ETC/systemd/system/botdot-local-firewall.service"
    systemctl daemon-reload </dev/null
    systemctl enable botdot-local-firewall </dev/null >/dev/null 2>&1 || die "systemd didn't enable botdot-local-firewall. See: systemctl status botdot-local-firewall"
    systemctl restart botdot-local-firewall </dev/null >/dev/null 2>&1 || die "The VM's firewall didn't start. See: systemctl status botdot-local-firewall"
  else
    sh "$BIN/local-firewall.sh" || die "The VM's firewall didn't start."
  fi
  ok "This VM can't reach the computer it runs on or that computer's network"
fi

# ready_line [SIGN_UP]: the run's last line, for a program (#981): BOTDOT_READY and JSON with the origin, the version,
# how botdot is reached, the accounts this machine runs and, while the admin's account doesn't exist yet, the link that
# makes it. Every value is checked where it is made (a domain, hex, account names, a link of the front door's own), so
# none needs escaping.
ready_line() {
  rl_accounts=''
  for rl in "$ACCOUNTS"/*/; do
    rl="$(basename "$rl")"
    [ -f "$ACCOUNTS/$rl/compose.yaml" ] && valid_account "$rl" || continue
    rl_accounts="$rl_accounts${rl_accounts:+,}\"$rl\""
  done
  rl_link=''
  case "${1:-}" in "$ORIGIN"/sign-up/*) printf '%s' "$1" | grep -Eq '^https?://[A-Za-z0-9.:/_-]+$' && rl_link="$1" ;; esac
  rl_variant=''
  [ -z "$MANAGED" ] || rl_variant="$(get_env "$ENV" BOT_DOT_VARIANT)"
  case "$rl_variant" in one | several) ;; *) rl_variant='' ;; esac
  say "BOTDOT_READY {\"origin\":\"$ORIGIN\",\"version\":\"$VERSION\",\"reach\":\"$REACH\"${rl_variant:+,\"variant\":\"$rl_variant\"},\"accounts\":[$rl_accounts]${rl_link:+,\"signUp\":\"$rl_link\"}}"
}

# serve_sites: on a tailnet, Tailscale Serve passes the name's port 8443 to the front door's second port, for bots'
# interactive pages (#399). Kept as it is when it is there already; a failure leaves botdot working without them.
serve_sites() {
  [ "$REACH" = tailnet ] || return 0
  if tailscale serve status </dev/null 2>/dev/null | grep -Eq "127\.0\.0\.1:$SITES_PORT([^0-9]|$)"; then return 0; fi
  tailscale serve --bg --https=$SITES_HTTPS "$SITES_PORT" </dev/null >/dev/null 2>&1 \
    || warn "Tailscale Serve didn't take port $SITES_HTTPS, so bots' interactive pages don't open. Run: sudo tailscale serve --bg --https=$SITES_HTTPS $SITES_PORT"
}

# An update ends here: how people reach botdot and the admin's link are the install's.
if [ "$MODE" = update ]; then
  serve_sites
  phase done
  # The accounts this run couldn't update, once the rest is done (#194).
  [ -z "$NOT_UPDATED" ] || die "Not every account was updated: $NOT_UPDATED. The others run the new version."
  ready_line
  exit 0
fi

# ---------------------------------------------------------------------------------------------
# 6. Reached on the domain or the tailnet

if [ "$REACH" = public ]; then
  # caddy_answers: Caddy answers on the domain with its certificate within a minute.
  caddy_answers() {
    i=0
    until curl -fsSk -o /dev/null --resolve "$NAME:443:127.0.0.1" "https://$NAME/api/version" 2>/dev/null; do
      i=$((i + 1))
      [ "$i" -lt 60 ] || return 1
      sleep 1
    done
  }
  if caddy_answers; then
    ok "Caddy answers on https://$NAME"
  elif [ "$TLS" != internal ] && DNS_SAID="$(dns_check)"; then
    say "$DNS_SAID"
    # The DNS was set while the installer ran: Caddy waits longer after each failed try, so a restart tries now.
    $DOOR_COMPOSE restart caddy </dev/null >/dev/null 2>&1 || true
    if caddy_answers; then ok "Caddy answers on https://$NAME"
    else warn "Caddy has no certificate for $NAME yet. Keep ports 80, 443 and 8443 open to this machine. See: cd $DOOR && sudo docker compose logs caddy"; fi
  else
    warn "Caddy doesn't answer on https://$NAME yet. It fetches the certificate by itself once the DNS points at this machine and ports 80, 443 and 8443 are open. See: cd $DOOR && sudo docker compose logs caddy"
    [ "$TLS" = internal ] || say "$DNS_SAID"
  fi
elif [ "$REACH" = local ]; then
  ok "Reachable on this computer only, at $ORIGIN"
else
  # What tailscale serve says goes to the screen: why it failed, or the link to enable Serve that it waits on.
  tailscale serve --bg "$DOOR_PORT" </dev/null || die "Tailscale Serve didn't start (its message is above). Fix that and run this installer again."
  serve_sites
  ok "Reachable on your tailnet only, at https://$NAME"
fi

# The accounts this run couldn't update, once the rest is done (#194).
[ -z "$NOT_UPDATED" ] || die "Not every account was updated: $NOT_UPDATED. The others run the new version."

# ---------------------------------------------------------------------------------------------
# 7. The admin's sign-up link

# On this computer only (ADR 136): one line for the desktop app, with the setup key's sign-up address until the account
# exists. The key is nowhere else on the screen.
if [ "$REACH" = local ]; then
  say ""
  bold "Done. botdot is at $ORIGIN"
  SIGN_UP=''
  [ -n "$(door_state "$ADMIN")" ] || SIGN_UP=",\"signUp\":\"$ORIGIN/sign-up/$(get_env "$ENV" FRONT_DOOR_SETUP_KEY)\""
  say "BOTDOT_LOCAL {\"origin\":\"$ORIGIN\"$SIGN_UP}"
  # The setup key stays in the app's line alone (ADR 136).
  ready_line
  exit 0
fi

# A managed machine (ADR 154): no admin page, and the setup key's sign-up link, until the first account exists, in its
# BOTDOT_READY line alone, for the fleet console.
if [ -n "$MANAGED" ]; then
  say ""
  warn "Whoever is root on this machine can reach every account on it: its data, its bots and the logins they hold. Keep root to yourself."
  say ""
  bold "Done. botdot is at $ORIGIN"
  LINK=''
  [ -n "$(door_state "$ADMIN")" ] || LINK="$ORIGIN/sign-up/$(get_env "$ENV" FRONT_DOOR_SETUP_KEY)"
  ready_line "$LINK"
  exit 0
fi

say ""
warn "Whoever is root on this machine can reach every account on it: its data, its bots and the logins they hold. Keep root to yourself."
LINK="$($DOOR_COMPOSE exec -T front-door node front-door.js sign-up-link --account "$ADMIN" </dev/null 2>/dev/null | head -n 1 || true)"
say ""
bold "Done. botdot is at https://$NAME"
if [ -n "$LINK" ]; then
  say "Open this link to make your account, $ADMIN, the admin's (it works once, for 7 days):"
  say ""
  say "  $LINK"
  say ""
  say "Until it is used, botdot shows only \"Open the link from your server's install\"."
  say "Then sign in to Claude on your account's setup page (it takes a minute)."
elif [ -z "$(door_state "$ADMIN")" ]; then
  warn "The sign-up link couldn't be made. Make it with: cd $DOOR && sudo docker compose exec front-door node front-door.js sign-up-link --account $ADMIN"
fi
say "Make sign-up links for other people on the admin page: https://$NAME/admin"
say "Update every account later on the admin page, or by running this installer again. Each account's data is in $ACCOUNTS/<account>/data."
ready_line "$LINK"
