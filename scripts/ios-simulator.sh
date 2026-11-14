#!/usr/bin/env bash
# The iPhone simulator `make ios` and .github/workflows/ios.yml build and test on, as its UDID (for
# `-destination id=…` and simctl): IOS_SIMULATOR when it is set (a UDID), else the first available iPhone on an iOS
# runtime of 26.0 or later, the app's minimum. Prints nothing when there is none.
set -euo pipefail
if [ -n "${IOS_SIMULATOR:-}" ]; then
  echo "$IOS_SIMULATOR"
  exit 0
fi
xcrun simctl list devices available --json 2>/dev/null | python3 -c '
import json, re, sys
devices = json.load(sys.stdin).get("devices", {})
def version(runtime):
    m = re.search(r"\.iOS-(\d+)-(\d+)$", runtime)  # a plain iOS runtime, not one made for one device
    return (int(m.group(1)), int(m.group(2))) if m else None
for runtime in sorted(devices, key=lambda r: version(r) or (0, 0), reverse=True):
    v = version(runtime)
    if v is None or v < (26, 0):
        continue
    for d in devices[runtime]:
        if d.get("isAvailable", True) and d.get("name", "").startswith("iPhone"):
            print(d["udid"])
            sys.exit(0)
' || true
