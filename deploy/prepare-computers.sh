#!/bin/sh
# Root's optional download worker. Tasks contain only a digest already checked by install.sh, never account data.
set -eu
DIR="${BOT_DOT_DIR:-/var/lib/botdot}"
RUN="${BOT_DOT_RUN:-/run/botdot-accounts}"
TASKS="$DIR/computer-preparation"
STATUS="$DIR/front-door/status/computer-preparation.json"
mkdir -p "$RUN" "${STATUS%/*}"
exec 7>"$RUN/computer-preparation.lock"
flock -n 7 || exit 0
state() {
  printf '{"state":"%s","at":"%s","account":"%s","attempt":%s,"error":"%s"}\n' "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${account:-}" "${attempt:-0}" "${2:-}" > "$STATUS.new"
  chmod 640 "$STATUS.new"
  chown "0:$(id -g botdot-door 2>/dev/null || echo 0)" "$STATUS.new"
  mv "$STATUS.new" "$STATUS"
}
# Recover an interrupted claim after a reboot. A newer task always wins.
for claim in "$TASKS"/*.running; do
  [ -f "$claim" ] || continue
  task="${claim%.running}"
  if [ -f "$task" ]; then rm -f "$claim"; else mv "$claim" "$task"; fi
done
# Permanent failures wait for an explicit retry or a new task from an install.
if [ "${1:-}" = --retry ]; then
  for blocked in "$TASKS"/*.blocked; do
    [ -f "$blocked" ] || continue
    task="${blocked%.blocked}"
    if [ -f "$task" ]; then rm -f "$blocked"; else mv "$blocked" "$task"; fi
  done
fi
transient() {
  [ "${pull_rc:-0}" = 124 ] || grep -Eiq 'timeout|timed out|connection reset|connection refused|temporary failure|unexpected EOF|TLS handshake|too many requests|429|50[0234]' "$RUN/computer-pull.log"
}
failed=0
for task in "$TASKS"/*; do
  [ -f "$task" ] || continue
  account="${task##*/}"
  case "$account" in '' | [!a-z]* | *[!a-z0-9-]*) continue ;; esac
  [ "${#account}" -ge 2 ] && [ "${#account}" -le 24 ] || continue
  [ -f "$DIR/accounts/$account/compose.yaml" ] || { rm -f "$task"; continue; }
  claim="$task.running"
  mv "$task" "$claim"
  image="$(cat "$claim")"
  # The source of a task is root's checked release. Never accept a tag or command text.
  printf '%s' "$image" | grep -Eqx '[a-zA-Z0-9./:_-]+@sha256:[0-9a-f]{64}' || { state failed 'Invalid computer image task'; rm -f "$claim"; failed=1; continue; }
  attempt=1
  while :; do
    state preparing
    if timeout 1800 env DOCKER_HOST="unix://$RUN/$account/docker.sock" docker pull "$image" > "$RUN/computer-pull.log" 2>&1; then
      rm -f "$claim"
      break
    else pull_rc=$?; fi
    if [ "$attempt" -ge 3 ] || ! transient; then
      state failed 'Computer download failed; see the computer preparation service log'
      cat "$RUN/computer-pull.log" >&2
      if [ -f "$task" ]; then rm -f "$claim";
      elif transient; then mv "$claim" "$task";
      else mv "$claim" "$task.blocked"; fi
      failed=1
      break
    fi
    sleep "$((attempt * 10))"
    attempt=$((attempt + 1))
  done
done
for blocked in "$TASKS"/*.blocked; do
  [ ! -f "$blocked" ] || failed=1
done
rm -f "$RUN/computer-pull.log"
[ "$failed" = 0 ] || { state failed 'Computer download failed; see the computer preparation service log'; exit 1; }
# A newer task remains preparing and will be picked up on the next service start or boot.
if find "$TASKS" -type f ! -name '*.new' -print -quit 2>/dev/null | grep -q .; then state preparing; else account='' attempt=0; state ready; fi
