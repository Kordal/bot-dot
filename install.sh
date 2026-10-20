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
#      Tailscale Serve, and the name of the admin's own account
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
# have to ask, and says how it went in BOT_DOT_DIR/front-door/status (update.json; its output in BOT_DOT_DIR/update.log):
#
#   sh BOT_DOT_DIR/bin/install.sh --update
#
# It downloads the newest signed release of the repositories .env pins (or takes the images built on this machine)
# into the machine's Docker and every account's first, then restarts the front door and every account on it.
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
# Where the machine's processes and mounts are read (the installer's tests point it elsewhere).
PROC="${BOT_DOT_PROC:-/proc}"
# Where the accounts' cgroups are read (the installer's tests point it elsewhere).
CGROUP="${BOT_DOT_CGROUP:-/sys/fs/cgroup}"
# The front door's own user of the machine; its group alone is let into each account's socket folder.
DOOR_USER=botdot-door
DOOR_PORT=4700
# botdot's source, which this installer is part of.
SOURCE="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)"
# runsc's flags in a rootless Docker (ADR 028, "Spike result"): it cannot make cgroups there, and a computer's
# firewall needs gVisor's iptables, which need raw sockets.
# --overlay2=none: what a container writes goes to its own layer on the account's disk. runsc's default
# (root:self) keeps it in an overlay of the sandbox, dropped when the container stops, so a bot's computer lost its
# home, its SSH keys, its Tailscale login and what it installed on every stop (#68).
RUNSC_FLAGS='"--ignore-cgroups", "--net-raw", "--overlay2=none"'
# runsc-uds, the runtime of botdot's server and its Docker helper alone (compose.yaml): they meet through Unix sockets
# in their mounts, which gVisor lets a container reach only with --host-uds. Every other container, a bot's computer
# first of all, runs under the default runsc, without it (#72).
RUNSC_UDS_FLAGS="$RUNSC_FLAGS, \"--host-uds=all\""
# The runtimes an account's Docker knows (its daemon.json, below, and Docker's own runc). A compose.yaml that names
# another is from a newer version than this installer (#142).
RUNTIMES='runc runsc runsc-uds'
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
# say_newest VERSION: status/latest.json, for the admin page's "Version X is available" (#193): VERSION, a source
# revision of 7 characters, is the newest signed release, found now. An image's id (an image without a revision) isn't one.
say_newest() {
  case "$1" in *[!0-9a-f]* | '') return 0 ;; esac
  [ "${#1}" = 7 ] || return 0
  write_status latest.json "{\"version\":\"$1\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
}
# version_now: the version root's step last said the front door and every account run.
version_now() { sed -n 's/.*"version":"\([0-9a-f]*\)".*/\1/p' "$DOOR/status/version.json" 2>/dev/null || true; }

# install: install or update (the default). requested: root's step that makes the accounts the front door asked for.
# --update: the update the admin asked for on the admin page, which root's step runs: an install again, that asks
# nothing (#473).
MODE=install
case "${1:-}" in
  '') ;;
  --requested) MODE=requested ;;
  --update) UNATTENDED=1 ;;
  --load) MODE=load ;;
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
    computers=''
    [ ! -S "$RUN/$n/docker.sock" ] || computers="$(env DOCKER_HOST="unix://$RUN/$n/docker.sock" docker ps -q --filter label=botdot.computer=account --filter status=running </dev/null 2>/dev/null | wc -l | tr -d ' ' || true)"
    size='' used='' full=false
    if mountpoint -q "$ACCOUNTS/$n" 2>/dev/null; then
      # shellcheck disable=SC2046
      set -- $(df -Pk "$ACCOUNTS/$n" 2>/dev/null | awk 'NR == 2 { printf "%.0f %.0f %.0f", $2 * 1024, $3 * 1024, $4 * 1024 }' || true)
      size="${1:-}" used="${2:-}"
      [ -z "${3:-}" ] || [ "$3" -ge "$FULL_BELOW" ] || full=true
    fi
    put "$LOAD/account-$n.json" "{\"at\":\"$at\",\"cpu\":$(num "$cpu"),\"ram\":$(num "$ram"),\"computers\":$(num "$computers"),\"diskSize\":$(num "$size"),\"diskUsed\":$(num "$used"),\"full\":$full}"
  done
  # The files of accounts that are gone.
  for f in "$LOAD"/account-*.json; do
    [ -e "$f" ] || continue
    n="$(basename "$f" .json)"
    n="${n#account-}"
    [ -f "$ACCOUNTS/$n/compose.yaml" ] || rm -f "$f" "$RUN/load/$n"
  done
}
# An image from a registry is installed only once its signature is botdot's, checked before anything is
# downloaded by the updater's own check (lib/signed-image.js, the release key pinned in lib/release-trust.js)
# from the source this installer is in. It runs on the Node of botdot's image, pinned by its digest (the
# Dockerfile's NODE_IMAGE), as nobody, read-only and with nothing but the network, trusting the certificates
# this machine trusts, as Docker does. A registry token goes to it on its input.
CHECK_NODE="node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6"
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
  say_newest "$(printf '%s' "$wl_rev" | cut -c1-7)"
}
if [ "$MODE" = load ]; then
  [ "$(id -u)" = 0 ] || die "Root's step measures the accounts, so it runs as root."
  write_load
  # The machine's Docker, as below: this step ends before it.
  D=docker
  look_for_newest || true
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
  rm -rf -- "${ACCOUNTS:?}/$1" "${SOCKETS:?}/$1" "${RUN:?}/$1" "${RUN:?}/load/$1" "${DISKS:?}/$1.img" "${LOAD:?}/account-$1.json"
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
UNITS="botdot-account@.service botdot-accounts.path botdot-accounts.service botdot-load.timer botdot-load.service"
OWN="front-door accounts sockets disks bin update.log requests.log"
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
  here=''
  for f in $OWN; do [ ! -e "$DIR/$f" ] || here=1; done
  pkgs=''
  if command -v dpkg-query >/dev/null 2>&1; then
    for p in $PACKAGES; do
      # shellcheck disable=SC2016 # dpkg-query's own field
      case "$(dpkg-query -W --showformat='${Status}' "$p" </dev/null 2>/dev/null || true)" in 'install ok installed') pkgs="$pkgs $p" ;; esac
    done
  fi
  gvisor=''
  [ ! -f "$ETC/apt/sources.list.d/gvisor.list" ] || gvisor=1
  found="$NAMES$door$units$profile$serve$here"

  # What goes, and a typed yes.
  if [ -z "$found" ]; then ok "Nothing of botdot is on this machine."
  else
    say "This removes botdot from this machine for good:"
    [ -z "$door" ] || say "  - the front door: its containers and volumes in this machine's Docker, and its Linux user $DOOR_USER"
    for n in $NAMES; do say "  - the account $n: its botdot server, its bots' computers, its rootless Docker, its Linux user botdot-$n, its disk and its data"; done
    [ -z "$units" ] || say "  - botdot's systemd units: $units${shares:+, and the accounts' shares}"
    [ -z "$profile" ] || say "  - the AppArmor profile botdot-rootlesskit"
    [ -z "$serve" ] || say "  - Tailscale Serve's setting for botdot"
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
  if [ -n "$pkgs$gvisor" ]; then
    list=''
    for p in $pkgs; do list="$list${list:+, }$p"; done
    [ -z "$gvisor" ] || list="$list${list:+ and }gVisor's apt source"
    say ""
    say "botdot's installer may have installed these: $list."
    if [ "${BOT_DOT_YES:-}" = 1 ]; then
      how="${pkgs:+sudo apt-get remove$pkgs}"
      [ -z "$gvisor" ] || how="$how${how:+ && }sudo rm $ETC/apt/sources.list.d/gvisor.list $ETC/apt/keyrings/gvisor.gpg"
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
      systemctl disable --now botdot-accounts.path botdot-load.timer </dev/null >/dev/null 2>&1 || true
      systemctl stop botdot-accounts.service botdot-load.service </dev/null >/dev/null 2>&1 || true
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
    if [ -n "$serve" ]; then tailscale serve --https=443 off </dev/null >/dev/null 2>&1 || left "Tailscale Serve's setting for botdot: sudo tailscale serve --https=443 off"; fi
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
  if [ -n "$remove_packages" ]; then
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
case "$(uname -m)" in
  x86_64 | amd64) [ "$MODE" != install ] || ok "Linux on Intel/AMD" ;;
  aarch64 | arm64) [ "$MODE" != install ] || ok "Linux on ARM" ;;
  *) die "botdot's images are for Intel/AMD (x86_64) and ARM (aarch64), not $(uname -m)." ;;
esac
# Everything below needs it, also to see that botdot has started.
command -v curl >/dev/null 2>&1 || die "The installer needs curl. Install it (sudo apt install curl) and run this again."
# Each account gets a Linux user of its own, so the installer makes users and their folders.
[ "$(id -u)" = 0 ] || die "The installer makes a Linux user for each account, so it runs as root. Run it with: sudo sh install.sh"
# One installer at a time: a person's run, root's step and the admin page's update all change the same accounts, and
# two at once left an account half on each version. A run waits for the one before it to finish. The update root's step
# runs for the admin page, and the installer an update hands over to, go on under its hold (BOT_DOT_LOCKED, given to
# them alone).
# What the installer leaves running (an account's Docker, the loop without systemd) is started without the lock's
# descriptor (9>&-), or it would hold the lock after the run ends.
if [ -z "${BOT_DOT_LOCKED:-}" ] && command -v flock >/dev/null 2>&1; then
  mkdir -p "$RUN"
  exec 9>"$RUN/install.lock"
  if ! flock -n 9; then
    [ "$MODE" = requested ] || say "Another botdot installer is running here: this one waits for it to finish…"
    flock 9
  fi
  BOT_DOT_LOCKED=1
fi

[ "$MODE" = install ] || command -v docker >/dev/null 2>&1 || die "Docker isn't installed: run the installer again."
if ! command -v docker >/dev/null 2>&1; then
  warn "Docker isn't installed."
  ask "Install Docker now, with Docker's official install script (get.docker.com)?" y \
    || die "botdot needs Docker. Install it (https://docs.docker.com/engine/install/) and run this again."
  curl -fsSL https://get.docker.com | sh
fi
# The machine's own Docker: the front door, and Caddy for a public domain.
D="docker"
if ! docker info >/dev/null 2>&1; then
  systemctl start docker 2>/dev/null || true
  docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start it (sudo systemctl start docker) and run this again."
fi
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
MISSING=''
need() { command -v "$1" >/dev/null 2>&1 || MISSING="$MISSING $2"; }
need dockerd-rootless.sh docker-ce-rootless-extras
need newuidmap uidmap
command -v slirp4netns >/dev/null 2>&1 || command -v pasta >/dev/null 2>&1 || command -v vpnkit >/dev/null 2>&1 || MISSING="$MISSING slirp4netns"
need setfacl acl
need runsc runsc
[ "$MODE" = install ] || [ -z "$MISSING" ] || die "Missing:$MISSING. Run the installer again."
if [ -n "$MISSING" ]; then
  warn "Each account runs in a rootless Docker under gVisor, which needs:$MISSING"
  command -v apt-get >/dev/null 2>&1 || die "Install them with your system's packages (gVisor: https://gvisor.dev/docs/user_guide/install/) and run this again."
  ask "Install them now with apt-get (gVisor's runsc from gVisor's own repository)?" y || die "botdot needs them. Install them and run this again."
  case "$MISSING" in
    *runsc*)
      mkdir -p "$ETC/apt/keyrings" "$ETC/apt/sources.list.d"
      [ -f "$ETC/apt/keyrings/gvisor.gpg" ] || curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor -o "$ETC/apt/keyrings/gvisor.gpg"
      printf 'deb [arch=%s signed-by=/etc/apt/keyrings/gvisor.gpg] https://storage.googleapis.com/gvisor/releases release main\n' "$(dpkg --print-architecture)" > "$ETC/apt/sources.list.d/gvisor.list"
      ;;
  esac
  apt-get update -qq </dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $MISSING </dev/null \
    || die "apt-get couldn't install$MISSING. Install them yourself and run this again."
fi
ROOTLESS="$(command -v dockerd-rootless.sh)"
RUNSC="$(command -v runsc)"
# Ubuntu 24.04 lets a program make the user namespace rootless Docker needs only when AppArmor names it.
KIT="$(command -v rootlesskit 2>/dev/null || true)"
if [ "$MODE" = install ] && [ -n "$KIT" ] && command -v apparmor_parser >/dev/null 2>&1 && [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" = 1 ] \
  && ! grep -rqs "$KIT" "$ETC/apparmor.d/" 2>/dev/null; then
  printf '# botdot (install.sh): rootless Docker for each account needs user namespaces.\nabi <abi/4.0>,\ninclude <tunables/global>\n\nprofile botdot-rootlesskit %s flags=(unconfined) {\n  userns,\n}\n' "$KIT" > "$ETC/apparmor.d/botdot-rootlesskit"
  apparmor_parser -r "$ETC/apparmor.d/botdot-rootlesskit" </dev/null || die "AppArmor didn't take the profile that lets rootless Docker run ($KIT)."
fi
[ "$MODE" != install ] || ok "Rootless Docker and gVisor ($("$RUNSC" --version </dev/null 2>/dev/null | head -n 1 | sed 's/^runsc version //'))"

# ---------------------------------------------------------------------------------------------
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
  v="${v%@sha256:*}"
  case "${v##*/}" in *:*) v="${v%:*}" ;; esac
  printf '%s:latest' "$v"
}
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

# check NAME server|desktop: $SIGNED is what NAME installs as. A refusal ends the installer.
check() {
  if SIGNED="$(signed "$1" "$2")"; then return 0; else status=$?; fi
  if [ "$status" = 2 ] && [ -z "$TOKEN" ]; then
    say ""
    say "The registry refused to hand over botdot's images without a token (a private fork or a mirror?)."
    say "Paste a GitHub token that can only read packages"
    say "(github.com → Settings → Developer settings → Tokens (classic) → scope: read:packages)."
    ask_secret "Token:"
    TOKEN="$REPLY"
    [ -n "$TOKEN" ] || die "No token, so the images can't be downloaded."
    if SIGNED="$(signed "$1" "$2")"; then return 0; else status=$?; fi
  fi
  [ "$status" != 2 ] || die "That token didn't work for $REGISTRY. Check that it has the read:packages scope."
  die "Refused $1: ${SIGNED:-it could not be checked}. Nothing was downloaded or started."
}
# pull NAME [DOCKER]: downloads it into the machine's Docker, or DOCKER (an account's), signing in with the token when
# the registry wants one. A download that fails leaves Docker's last line of error in PULLED, so that what stops the
# update says why ("no space left on device"), not only that it couldn't.
pull() {
  into="${2:-$D}"
  PULLED="$($into pull -q "$1" </dev/null 2>&1 >/dev/null)" && return 0
  PULLED="$(printf '%s\n' "$PULLED" | sed '/^[[:space:]]*$/d' | tail -n 1)"
  [ -n "$TOKEN" ] || return 1
  printf '%s' "$TOKEN" | $D login "$REGISTRY" -u "$(owner_of "$IMAGE")" --password-stdin >/dev/null 2>&1 \
    || die "That token didn't work for $REGISTRY. Check that it has the read:packages scope."
  PULLED="$($into pull -q "$1" </dev/null 2>&1 >/dev/null)" && return 0
  PULLED="$(printf '%s\n' "$PULLED" | sed '/^[[:space:]]*$/d' | tail -n 1)"
  return 1
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
    clean_images "$RUN/$rf/docker.sock" "$rf_runner" "$(get_env "$ACCOUNTS/$rf/.env" BOT_DOT_IMAGE)" "$(get_env "$ACCOUNTS/$rf/.env" BOT_DOT_COMPUTER_IMAGE)" "$SERVER_SIGNED" "$COMPUTER_SIGNED"
    rf_ids="$($rf_docker image ls -q --no-trunc </dev/null 2>/dev/null | sort -u || true)"
    # shellcheck disable=SC2086 # one id per word
    rf_have="$([ -z "$rf_ids" ] || $rf_docker image inspect --format '{{range .RootFS.Layers}}{{println .}}{{end}}' $rf_ids </dev/null 2>/dev/null || true)"
    # The bytes of the layers it lacks, each counted once, three times over and 1 GB; 0 when it lacks none.
    rf_need="$({ printf '%s\n' "$rf_have" | sed 's/^/have /'; printf '%s\n' "$rf_layers" | sed 's/^/new /'; } \
      | awk '$1 == "have" { h[$2] = 1 } $1 == "new" && !($2 in h) && !($2 in s) { s[$2] = 1; t += $3 } END { printf "%.0f", (t > 0 ? t * 3 + 1e9 : 0) }')"
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
  [ -f "$SOURCE/lib/signed-image.js" ] || die "The installer checks the signature of botdot's images with botdot's source, and it isn't next to this installer. Get the source and run the install.sh in it."
  $D image inspect "$CHECK_NODE" </dev/null >/dev/null 2>&1 || pull "$CHECK_NODE" \
    || die "Couldn't download $CHECK_NODE, which checks the signature of botdot's images$(because)."
  check "$IMAGE" server
  SERVER_SIGNED="$SIGNED"
  # The bots' computer is downloaded into each account now, so the first bot that needs one doesn't wait for it.
  # One on another registry is downloaded and checked by botdot when a bot needs it.
  COMPUTER_SIGNED=''
  if [ "$(registry_of "$COMPUTER_IMAGE")" = "$REGISTRY" ]; then
    check "$COMPUTER_IMAGE" desktop
    COMPUTER_SIGNED="$SIGNED"
  fi
  # The admin page's update finds nothing new: the front door and every running account run these very images, so
  # it changes nothing, restarts nothing and stops no bot's run (#193).
  if [ -n "$UNATTENDED" ] && runs_signed; then
    say_newest "$(version_now)"
    ok "It was the newest already: the front door and every account run it, so nothing was restarted"
    exit 0
  fi
  # Room first, in the machine's Docker too, by the rule of the version it runs now (#190).
  clean_images /var/run/docker.sock "$(get_env "$ENV" BOT_DOT_IMAGE)" "$(get_env "$ENV" BOT_DOT_IMAGE)" "$(get_env "$ENV" BOT_DOT_COMPUTER_IMAGE)"
  room_for_accounts
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
if [ "$MODE" = install ]; then
  image_file compose.front-door.yaml > "$DOOR/compose.yaml.new" || die "Couldn't read compose.front-door.yaml from the image."
  mv "$DOOR/compose.yaml.new" "$DOOR/compose.yaml"
  [ "$IMAGE" = "$IMAGES/bot-dot:latest" ] || set_env "$ENV" BOT_DOT_IMAGE "$IMAGE"
  # Only the pin of an earlier run stays when the newer computer could not be downloaded now.
  set_env "$ENV" BOT_DOT_COMPUTER_IMAGE "$COMPUTER_IMAGE"
fi
# From here .env names the images: the names this run was given would beat it in compose, and a tag there
# would be downloaded unchecked.
unset BOT_DOT_IMAGE BOT_DOT_COMPUTER_IMAGE

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
    pull "$IMAGE" "$A" || die "Couldn't download $IMAGE for the account $1$(because)."
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
        pull "$COMPUTER_IMAGE" "$A" && ok "Bots' computer image is up to date" || warn "Couldn't download the bots' computer now; botdot tries again when a bot needs it."
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
[ "$MODE" != install ] || ok "Time zone $TZ_NAME (change TZ in $ENV)"

if [ "$MODE" = install ]; then

# A passkey belongs to one address, so it is chosen once: a rerun keeps it.
REACH="$(get_env "$ENV" BOT_DOT_REACH)"
if [ -z "$REACH" ]; then
  REACH="${BOT_DOT_REACH:-}"
  while [ "$REACH" != public ] && [ "$REACH" != tailnet ]; do
    unanswered "How will people reach botdot?"
    say ""
    say "How will people reach botdot?"
    say "  1) a public domain: HTTPS from Caddy, which fetches its own certificate (ports 80 and 443 must be free)"
    say "  2) a tailnet only: Tailscale Serve gives it an HTTPS name, and nothing is on the internet"
    printf 'Choose 1 or 2: '
    read_line
    case "$REPLY" in 1 | public) REACH=public ;; 2 | tailnet) REACH=tailnet ;; '') die "No answer, so nothing more was changed." ;; esac
  done
fi
# valid_domain NAME: a host name of letters, digits, dashes and dots, with a dot.
valid_domain() { printf '%s' "$1" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$'; }
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
else
  if ! command -v tailscale >/dev/null 2>&1; then
    ask "botdot on a tailnet needs Tailscale. Install it now?" y || die "botdot on a tailnet needs Tailscale (https://tailscale.com/download). Install it and run this again."
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
set_env "$ENV" BOT_DOT_REACH "$REACH"
[ "$REACH" != public ] || set_env "$ENV" BOT_DOT_DOMAIN "$DOMAIN"
set_env "$ENV" FRONT_DOOR_ORIGIN "$ORIGIN"

# The admin's own account: an ordinary account, made by the install's sign-up link.
ADMIN="$(get_env "$ENV" FRONT_DOOR_ADMIN)"
ADMIN="${ADMIN:-${BOT_DOT_ADMIN:-}}"
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

# The new version goes into every running account's Docker before anything restarts (#473). An account whose download
# fails keeps the version it runs, and the others go on (#194): its reason waits in HELD for each_account. A stopped
# (suspended) account gets it when it is resumed.
HELD="$RUN/update-held"
rm -rf "$HELD"
mkdir -p "$HELD"
for other in "$ACCOUNTS"/*/; do
  other="$(basename "$other")"
  [ -f "$ACCOUNTS/$other/compose.yaml" ] || continue
  A="env DOCKER_HOST=unix://$RUN/$other/docker.sock docker"
  $A info </dev/null >/dev/null 2>&1 || continue
  set +e
  ( set -e; ACCOUNT_WHY="$HELD/$other"; hand_images "$other" ) || [ -s "$HELD/$other" ] \
    || printf 'kept\tThe new version could not be put in its Docker.\n' > "$HELD/$other"
  set -e
done

# ---------------------------------------------------------------------------------------------
# 4. The front door

if ! id -u "$DOOR_USER" >/dev/null 2>&1; then
  useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$DOOR_USER" </dev/null \
    || die "Couldn't make the front door's user, $DOOR_USER."
fi
chown "$(id -u "$DOOR_USER"):$(id -g "$DOOR_USER")" "$DOOR/data"
chmod 700 "$DOOR/data"
# Where the front door asks for new accounts: it may add and remove files there, and root's step reads their names.
mkdir -p "$REQUESTS"
chown "0:$(id -g "$DOOR_USER")" "$REQUESTS"
chmod 770 "$REQUESTS"
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
  } > "$DOOR/Caddyfile"
else
  set_env "$ENV" COMPOSE_PROFILES ''
fi

DOOR_COMPOSE="$D compose --project-directory $DOOR"
$DOOR_COMPOSE up -d --remove-orphans </dev/null >/dev/null 2>&1 || $DOOR_COMPOSE up -d --remove-orphans </dev/null
i=0
until curl -fsS -o /dev/null -H "Host: $NAME" "http://127.0.0.1:$DOOR_PORT/api/version" 2>/dev/null; do
  i=$((i + 1))
  [ "$i" -lt 60 ] || die "The front door didn't start. See what went wrong with: cd $DOOR && docker compose logs front-door"
  sleep 1
done
ok "The front door is running"
fi

# ---------------------------------------------------------------------------------------------
# 5. The accounts: the admin's, and on a rerun every account this machine has

# The unit that starts an account's rootless Docker as its own user, when systemd runs this machine. It mounts the
# account's disk as its home first (as root, `+`), and doesn't start without it: rootless Docker would fill the bare
# folder beneath. Its CPU and RAM share are set on it (systemctl set-property, kept in /etc/systemd/system.control).
if [ -n "$SYSTEMD" ] && [ "$MODE" = install ]; then
  cat > "$ETC/systemd/system/botdot-account@.service.new" <<UNIT
# botdot (install.sh): the rootless Docker of the account %i, as its own Linux user, botdot-%i (ADR 028).
[Unit]
Description=botdot: the rootless Docker of the account %i
Wants=network-online.target
After=network-online.target

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

# share NAME CPU RAM: the account NAME's share of CPU and RAM, hard limits on its unit, applied at once and kept (its
# work slows down near its RAM before anything is ended at it), and the limits of its one computer (#108), in a file
# only root writes, which its docker-helper reads as the computer starts (lib/computers.js). It never shows in the
# account.
share() {
  if [ -n "$SYSTEMD" ]; then
    systemctl set-property "botdot-account@$1.service" "CPUQuota=$(($2 * 100))%" "MemoryHigh=$(($3 * 1024 * 9 / 10))M" "MemoryMax=$3G" </dev/null \
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
}

# answers FOLDER: the botdot server whose socket is in FOLDER (an account's, named as it) answers, as the front door
# asks it, within about 2 minutes (90 tries, each a second apart and at most a second long). A socket alone isn't enough: a botdot server that stopped leaves its socket behind,
# and the next one removes it only once it starts.
answers() {
  i=0
  until [ -S "$1/botdot.sock" ] && curl -fsS -o /dev/null --max-time 1 -H "X-Botdot-Account: $(basename "$1")" --unix-socket "$1/botdot.sock" http://botdot/api/version </dev/null 2>/dev/null; do
    i=$((i + 1))
    [ "$i" -lt 90 ] || return 1
    sleep 1
  done
}

# compose_up HOME: the account's botdot server ($A) started from the compose file in HOME, tried twice.
compose_up() {
  $A compose --project-directory "$1" up -d --remove-orphans </dev/null >/dev/null 2>&1 || $A compose --project-directory "$1" up -d --remove-orphans </dev/null
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
  sub_uid="$(awk -F: -v u="$user" '$1 == u { print $2; exit }' "$ETC/subuid")"
  sub_gid="$(awk -F: -v u="$user" '$1 == u { print $2; exit }' "$ETC/subgid")"

  # Its rootless Docker, whose every container runs under gVisor. The cgroups are its systemd unit's.
  mkdir -p "$home/.config/docker"
  cat > "$home/.config/docker/daemon.json.new" <<JSON
{
  "default-runtime": "runsc",
  "runtimes": {
    "runsc": { "path": "$RUNSC", "runtimeArgs": [$RUNSC_FLAGS] },
    "runsc-uds": { "path": "$RUNSC", "runtimeArgs": [$RUNSC_UDS_FLAGS] }
  },
  "exec-opts": ["native.cgroupdriver=cgroupfs"]
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
    su -s /bin/sh "$user" -c "cd '$home' && exec env HOME='$home' XDG_RUNTIME_DIR='$run' PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin nohup '$ROOTLESS' >> '$home/docker.log' 2>&1 &" </dev/null 9>&-
    warn "This machine has no systemd, so the account $name's Docker was started now and doesn't start again after a restart. Run this installer again after one."
  fi
  i=0
  until $A info </dev/null >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -lt 60 ] || die "The account $name's rootless Docker didn't start.$( [ -n "$SYSTEMD" ] && printf ' See: journalctl -u botdot-account@%s' "$name" || printf ' See: %s/docker.log' "$home")"
    sleep 1
  done
  [ "$($A info --format '{{.DefaultRuntime}}' </dev/null 2>/dev/null)" = runsc ] || die "The account $name's Docker doesn't run its containers under gVisor."
  # Every runtime the version's compose file names (runsc-uds): a Docker without one stops the account's server half
  # updated ("unknown or invalid runtime name"), so the installer stops here, before it writes the new compose file.
  have=" $($A info --format '{{range $k, $v := .Runtimes}}{{$k}} {{end}}' </dev/null 2>/dev/null) "
  for rt in $(printf '%s\n' "$ACCOUNT_COMPOSE" | sed -n 's/^ *runtime: *\([A-Za-z0-9_.-]*\).*/\1/p' | sort -u); do
    case "$have" in *" $rt "*) ;; *) die "The account $name's Docker has no $rt runtime, which this version's compose file needs.$( [ -n "$SYSTEMD" ] && printf ' Restart it (systemctl restart botdot-account@%s) and run this again.' "$name" || printf ' Restart it and run this again.')" ;; esac
  done

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
  if [ -f "$home/compose.yaml" ] && [ -f "$aenv" ]; then
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
  set_env "$aenv" BOT_DOT_FRONT_DOOR_FOLDER "$folder"
  set_env "$aenv" DOCKER_SOCKET "$run/docker.sock"
  # Its data folder, the account's own when it is made: botdot's privilege supervisor gives it to the server's user
  # when the server starts, and that stays. Its Docker restarted the server already when this step starts it again
  # (a resume, a rerun), so changing the owner now would leave the server unable to write its data.
  [ -d "$home/data" ] || { mkdir -p "$home/data"; chown "$uid:$gid" "$home/data"; }
  # From here on what fails puts back what it ran (in an if, so that set -e doesn't end the account first).
  if ! { chown "$uid:$gid" "$home/compose.yaml" "$aenv" && compose_up "$home" && answers "$folder"; }; then
    [ -f "$home/compose.yaml.before" ] || die "The account $name's botdot server didn't start. See what went wrong with: sudo DOCKER_HOST=unix://$run/docker.sock docker compose --project-directory $home logs"
    # The new version's logs, before its container is replaced by the old one's.
    $A compose --project-directory "$home" logs --no-color --tail 40 </dev/null 2>&1 | sed 's/^/    /' || true
    warn "The account $name's new botdot server didn't start, so it goes back to the version it ran."
    mv "$home/compose.yaml.before" "$home/compose.yaml"
    mv "$home/.env.before" "$aenv"
    compose_up "$home" || true
    answers "$folder" || { ACCOUNT_RESULT=failed; die "Its botdot server didn't start, neither the new version nor the one it ran. See what went wrong with: sudo DOCKER_HOST=unix://$run/docker.sock docker compose --project-directory $home logs"; }
    die "Its new botdot server didn't start, so it runs the version it ran before."
  fi
  rm -f "$home/compose.yaml.before" "$home/.env.before"
  ok "The account $name is running"
  remove_unnamed

  # The images this run replaced go now. botdot decides which (lib/image-cleanup.js); this script removes none.
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
      # Its Docker answers when it runs: suspending stops it. One that runs gets its share now.
      if [ -f "$ACCOUNTS/$n/compose.yaml" ] && env DOCKER_HOST="unix://$RUN/$n/docker.sock" docker info </dev/null >/dev/null 2>&1; then
        # shellcheck disable=SC2086 # three numbers
        valid_share "$@" || set -- $DEFAULT_SHARE
        disk "$n" "$3"
        share "$n" "$1" "$2"
        ok "The account $n is made already, and runs, with its share: $1 CPUs, $2 GB of RAM, $3 GB of disk"
      elif [ -f "$ACCOUNTS/$n/compose.yaml" ]; then
        say "Starting the account $n again, which the admin resumed"
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
# The admin page's update (#473) is the request named UPDATE, which no account can be named: the installer runs again
# from this copy (--update), asking nothing, and moves the front door and every account to the newest version together.
# What it did is in update.json beside version.json, for the admin page, and all it said in BOT_DOT_DIR/update.log.
UPDATE=UPDATE
# plain_line N: its input as one line of plain text of at most N characters, for update.json.
plain_line() { tr -d '"\\' | tr -c "A-Za-z0-9 .,:;()/_@+='-" ' ' | sed 's/ *$//' | cut -c1-"$1"; }
# account_results FILE: the lines each_account wrote (NAME<tab>updated|kept|failed<tab>version<tab>why), as
# update.json's "accounts" after a comma, each why as plain text; nothing when there are none (an installer from before
# #194).
account_results() {
  [ -s "$1" ] || return 0
  printf ',"accounts":['
  sep=''
  while IFS='	' read -r a_name a_result a_version a_why; do
    valid_account "$a_name" || continue
    case "$a_result" in updated | kept | failed) ;; *) continue ;; esac
    a_why="$(printf '%s' "$a_why" | plain_line 300)"
    printf '%s{"name":"%s","result":"%s"' "$sep" "$a_name" "$a_result"
    case "$a_version" in '' | *[!0-9a-f]*) ;; *) [ "$a_result" != kept ] || printf ',"version":"%s"' "$a_version" ;; esac
    [ "$a_result" = updated ] || printf ',"error":"%s"' "$a_why"
    printf '}'
    sep=','
  done < "$1"
  printf ']'
}
update_all() {
  from="$(version_now)"
  write_status update.json "{\"state\":\"updating\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"from\":\"$from\"}"
  set +e
  results="$RUN/update-results"
  rm -f "$results"
  BOT_DOT_LOCKED="${BOT_DOT_LOCKED:-}" BOT_DOT_UPDATE_RESULTS="$results" sh "$SOURCE/install.sh" --update > "$DIR/update.log" 2>&1 </dev/null
  updated=$?
  set -e
  chmod 600 "$DIR/update.log"
  accounts="$(account_results "$results")"
  rm -f "$results"
  if [ "$updated" = 0 ]; then
    write_status update.json "{\"state\":\"updated\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"from\":\"$from\",\"to\":\"$(version_now)\"$accounts}"
    ok "botdot is updated, the front door and every account"
  else
    # The installer's last ✗ line, as plain text.
    why="$(tr -d '\033' < "$DIR/update.log" | sed -n 's/\[[0-9;]*m//g; s/^✗ //p' | tail -n 1 | plain_line 500)"
    write_status update.json "{\"state\":\"failed\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"from\":\"$from\",\"to\":\"$(version_now)\",\"error\":\"${why:-See $DIR/update.log}\"$accounts}"
    warn "The update stopped: ${why:-see $DIR/update.log}"
  fi
}

if [ "$MODE" = requested ]; then
  if [ -f "$REQUESTS/$UPDATE" ] && [ ! -L "$REQUESTS/$UPDATE" ]; then
    rm -f -- "$REQUESTS/$UPDATE"
    update_all
  fi
  for request in "$REQUESTS"/* "$REQUESTS"/.[!.]* "$REQUESTS"/..?*; do
    [ -e "$request" ] || [ -L "$request" ] || continue
    name="$(basename "$request")"
    taken=''
    # Asked again while it ran: the next run, which systemd starts for it, updates once more.
    if [ "$name" = "$UPDATE" ] && [ -f "$request" ] && [ ! -L "$request" ]; then continue
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
  NOT_UPDATED="${NOT_UPDATED:+$NOT_UPDATED, }$1"
}

state="$(door_state "$ADMIN")"
# shellcheck disable=SC2086 # its share's three numbers, after its state
each_account "$ADMIN" ${state#* }
for other in "$ACCOUNTS"/*/; do
  other="$(basename "$other")"
  [ "$other" != "$ADMIN" ] && [ -f "$ACCOUNTS/$other/compose.yaml" ] || continue
  # An update leaves a suspended account stopped (resuming it brings it up to date), and erases a deleted one.
  state="$(door_state "$other")"
  case "$state" in
    suspended*) ok "The account $other is suspended, so it stays stopped" ;;
    deleted) erase_account "$other" ;;
    # shellcheck disable=SC2086 # its share's three numbers, after its state
    *) each_account "$other" ${state#* } ;;
  esac
done
rm -rf "$HELD"

# The images this run replaced in the machine's own Docker, the front door's, go as in each account's: botdot's rule
# decides which (lib/image-cleanup.js), run from the image now installed. Images built on this machine are the admin's.
if [ -n "$REGISTRY" ]; then
  CLEANED="$($D run --rm --pull never --network none --user 0:0 -v /var/run/docker.sock:/var/run/docker.sock --entrypoint node "$IMAGE" /opt/bot-dot/lib/image-cleanup.js "$IMAGE" "$COMPUTER_IMAGE" </dev/null 2>/dev/null || true)"
  CLEANED="$(printf '%s' "$CLEANED" | json 'j.failed ? "" : j.removed ? "Removed " + j.removed + " old image" + (j.removed === 1 ? "" : "s") + " of the front door" : "No old images of the front door to remove"' || true)"
  if [ -n "$CLEANED" ]; then ok "$CLEANED"
  else warn "Couldn't remove every old image of the front door now; the next update tries again."; fi
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
elif ! { [ -f "$RUN/requests.pid" ] && kill -0 "$(cat "$RUN/requests.pid")" 2>/dev/null; }; then
  mkdir -p "$RUN"
  nohup sh -c "i=0; while :; do [ -z \"\$(ls -A '$REQUESTS' 2>/dev/null)\" ] || BOT_DOT_DIR='$DIR' BOT_DOT_RUN='$RUN' BOT_DOT_ETC='$ETC' sh '$BIN/install.sh' --requested; [ \$((i % 20)) != 0 ] || BOT_DOT_DIR='$DIR' BOT_DOT_RUN='$RUN' BOT_DOT_ETC='$ETC' sh '$BIN/install.sh' --load; i=\$((i + 1)); sleep 3; done" >> "$DIR/requests.log" 2>&1 </dev/null 9>&- &
  echo "$!" > "$RUN/requests.pid"
  warn "This machine has no systemd, so the accounts sign-up links make are made by a loop started now, which doesn't start again after a restart. Run this installer again after one. Its log: $DIR/requests.log"
fi

# ---------------------------------------------------------------------------------------------
# 6. Reached on the domain or the tailnet

if [ "$REACH" = public ]; then
  i=0
  until curl -fsSk -o /dev/null --resolve "$NAME:443:127.0.0.1" "https://$NAME/api/version" 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -ge 60 ]; then
      warn "Caddy doesn't answer on https://$NAME yet. Point the domain's DNS at this machine and keep ports 80 and 443 open: it fetches the certificate by itself. See: cd $DOOR && docker compose logs caddy"
      break
    fi
    sleep 1
  done
  [ "$i" -ge 60 ] || ok "Caddy answers on https://$NAME"
else
  # What tailscale serve says goes to the screen: why it failed, or the link to enable Serve that it waits on.
  tailscale serve --bg "$DOOR_PORT" </dev/null || die "Tailscale Serve didn't start (its message is above). Fix that and run this installer again."
  ok "Reachable on your tailnet only, at https://$NAME"
fi

# The accounts this run couldn't update, once the rest is done (#194).
[ -z "$NOT_UPDATED" ] || die "Not every account was updated: $NOT_UPDATED. The others run the new version."

# ---------------------------------------------------------------------------------------------
# 7. The admin's sign-up link

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
fi
say "Make sign-up links for other people on the admin page: https://$NAME/admin"
say "Update every account later on the admin page, or by running this installer again. Each account's data is in $ACCOUNTS/<account>/data."
