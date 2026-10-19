#!/usr/bin/env bash
# Type checks, part of `make lint` (#77): the files tsconfig.json includes, each marked // @ts-check and typed with
# JSDoc, checked by TypeScript's tsc. botdot has no npm dependencies, so TypeScript and Node's types are fetched
# with npm into a folder of their own outside the repository, pinned, and kept there for the next run. Without
# npm or the network it says so and passes: CI runs it.
set -euo pipefail
cd "$(dirname "$0")/.."
TOOLS="${BOT_DOT_TSC_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/botdot-tsc}"
TYPESCRIPT=typescript@5.6.3
NODE_TYPES=@types/node@22.10.1
if [ ! -x "$TOOLS/node_modules/.bin/tsc" ] || [ "$(cat "$TOOLS/versions" 2>/dev/null)" != "$TYPESCRIPT $NODE_TYPES" ]; then
  if ! command -v npm >/dev/null 2>&1 || ! npm install --silent --no-save --no-package-lock --no-audit --no-fund --prefix "$TOOLS" "$TYPESCRIPT" "$NODE_TYPES" >/dev/null 2>&1; then
    echo "typecheck.sh skipped: it fetches $TYPESCRIPT with npm, which didn't work here"
    exit 0
  fi
  echo "$TYPESCRIPT $NODE_TYPES" > "$TOOLS/versions"
fi
"$TOOLS/node_modules/.bin/tsc" -p tsconfig.json --typeRoots "$TOOLS/node_modules/@types"
echo "PASS  the files tsconfig.json includes type-check"
