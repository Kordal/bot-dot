#!/bin/sh
# Stage 2 only: put Selkies into one account's computer, and take out exactly what that put there (#1737, trial only).
# Run as root inside the computer: docker exec -u root <computer> /opt/selkies-trial/stage2.sh install | undo
#
#   install  records the installed packages in /var/lib/selkies-trial (not /tmp, which may be cleared), then installs
#            /tmp/selkies.deb, x11-utils and x11-xserver-utils. A package the image already has is left as it was.
#   undo     purges only the packages that were not in that record (the selkies package and the dependencies the trial
#            pulled in), deletes /opt/selkies-trial, /tmp/selkies.deb, /tmp/selkies-*.log and the record. It never names
#            a package itself: x11-xserver-utils is the desktop image's own (botdot-desktop calls xhost) and stays.
#            It runs no autoremove. If removing the added packages would also remove one that was there before, it stops
#            and removes nothing.
set -eu
STATE=/var/lib/selkies-trial
DEB="${DEB:-/tmp/selkies.deb}"
[ "$(id -u)" = 0 ] || { echo "stage2.sh: run as root" >&2; exit 1; }

installed() { dpkg --get-selections | awk '$2 == "install" { print $1 }' | sort -u; }
bare() { sed 's/:.*//' | sort -u; }

case "${1:-}" in
install)
  [ ! -e "$STATE/packages-before.txt" ] || { echo "stage2.sh: already installed; run undo first" >&2; exit 1; }
  [ -f "$DEB" ] || { echo "stage2.sh: no $DEB (docker cp the pinned .deb there first)" >&2; exit 1; }
  mkdir -p "$STATE"
  installed >"$STATE/packages-before.txt.new"
  # The desktop image keeps no apt lists, so apt-get update fills them: note that, to empty them again.
  if [ -z "$(find /var/lib/apt/lists -type f ! -name lock 2>/dev/null | head -n 1)" ]; then : >"$STATE/lists-were-empty"; fi
  mv "$STATE/packages-before.txt.new" "$STATE/packages-before.txt"   # the record exists only when it is complete
  apt-get update
  apt-get install -y --no-install-recommends "$DEB" x11-utils x11-xserver-utils
  echo "recorded $(wc -l <"$STATE/packages-before.txt") packages before; added: $(installed | comm -13 "$STATE/packages-before.txt" - | tr '\n' ' ')"
  ;;
undo)
  [ -f "$STATE/packages-before.txt" ] || { echo "stage2.sh: no record of the packages before the trial in $STATE: nothing removed" >&2; exit 1; }
  pkill -x selkies 2>/dev/null || true
  installed | comm -13 "$STATE/packages-before.txt" - >"$STATE/added.txt"
  if [ -s "$STATE/added.txt" ]; then
    echo "the trial added: $(tr '\n' ' ' <"$STATE/added.txt")"
    # What apt would purge must be what the trial added, nothing else (a package from before would break the computer).
    # shellcheck disable=SC2046
    apt-get -s purge $(cat "$STATE/added.txt") | awk '$1 == "Purg" { print $2 }' | bare >"$STATE/would-purge.txt"
    bare <"$STATE/added.txt" >"$STATE/added-bare.txt"
    if [ -n "$(comm -13 "$STATE/added-bare.txt" "$STATE/would-purge.txt")" ]; then
      echo "stage2.sh: purging would also remove: $(comm -13 "$STATE/added-bare.txt" "$STATE/would-purge.txt" | tr '\n' ' ')" >&2
      echo "stage2.sh: nothing removed; look at it by hand" >&2
      exit 1
    fi
    # shellcheck disable=SC2046
    apt-get purge -y $(cat "$STATE/added.txt")
  fi
  rm -rf /opt/selkies /opt/selkies-trial /tmp/selkies.deb /tmp/selkies-*.log
  if [ -e "$STATE/lists-were-empty" ]; then rm -rf /var/lib/apt/lists/*; fi
  apt-get clean
  rm -rf "$STATE"
  echo "undone"
  ;;
*)
  echo "usage: stage2.sh install | undo" >&2
  exit 2
  ;;
esac
