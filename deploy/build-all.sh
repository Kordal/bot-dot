#!/usr/bin/env bash
# Starts and follows the release workflows for Build all (.github/workflows/build-all.yml). Each one runs as its own
# workflow run, as if the owner had started it by hand, so its version (its own run number), its tests gate and its
# publishing stay exactly as they are.
#
#   build-all.sh start <workflow>          starts it on main, prints its run id
#   build-all.sh find <workflow> <since>   the first run by hand of it on main created at or after <since>, or nothing
#   build-all.sh wait <run id> <label>     waits for it to end, adds a line to the job summary; fails when it failed
#
# Needs GH_TOKEN (actions: write to start, read to follow) and GITHUB_REPOSITORY.
set -euo pipefail

POLL="${BUILD_ALL_POLL:-20}"     # seconds between looks at a run
TRIES="${BUILD_ALL_TRIES:-30}"   # looks for a run just started, before giving up

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

find_run() {
  gh run list --repo "$GITHUB_REPOSITORY" --workflow "$1" --event workflow_dispatch --branch main --limit 20 \
    --json databaseId,createdAt --jq "[.[] | select(.createdAt >= \"$2\")] | sort_by(.createdAt) | first | .databaseId // empty"
}

# A dispatch answers with no run id, so the run is found by when it was created.
start_run() {
  local since id
  since="$(now)"
  gh workflow run "$1" --repo "$GITHUB_REPOSITORY" --ref main >&2
  for _ in $(seq "$TRIES"); do
    id="$(find_run "$1" "$since")"
    [ -z "$id" ] || { echo "$id"; return 0; }
    sleep "$POLL"
  done
  echo "$1 was started but no run of it showed up" >&2
  return 1
}

wait_run() {
  local id="$1" label="$2" state url conclusion
  [ -n "$id" ] || { echo "$label: no run to follow" >&2; return 1; }
  url="https://github.com/$GITHUB_REPOSITORY/actions/runs/$id"
  echo "Following $label: $url" >&2
  while :; do
    state="$(gh run view "$id" --repo "$GITHUB_REPOSITORY" --json status,conclusion --jq '.status + " " + .conclusion')"
    [ "${state%% *}" = completed ] && break
    sleep "$POLL"
  done
  conclusion="${state#* }"
  echo "$label: $conclusion" >&2
  [ -z "${GITHUB_STEP_SUMMARY:-}" ] || echo "- $label: [$conclusion]($url)" >> "$GITHUB_STEP_SUMMARY"
  [ "$conclusion" = success ]
}

case "${1:-}" in
  start) start_run "$2" ;;
  find) find_run "$2" "$3" ;;
  wait) wait_run "$2" "$3" ;;
  *) echo "usage: build-all.sh start <workflow> | find <workflow> <since> | wait <run id> <label>" >&2; exit 2 ;;
esac
