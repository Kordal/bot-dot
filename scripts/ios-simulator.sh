#!/usr/bin/env bash
# The iPhone simulator `make ios` and .github/workflows/ios.yml build and test on: IOS_SIMULATOR when it is set, else
# the first iPhone this Mac's Xcode has. Prints its name; prints nothing when there is none.
set -euo pipefail
if [ -n "${IOS_SIMULATOR:-}" ]; then
  echo "$IOS_SIMULATOR"
  exit 0
fi
xcrun simctl list devices available 2>/dev/null | grep -m1 -oE 'iPhone[^(]*' | sed -E 's/ +$//' || true
