#!/bin/sh
# Build botdot for Mac and open it (needs Xcode; see README.md).
set -e
cd "$(dirname "$0")"
command -v xcodegen >/dev/null && xcodegen generate --quiet
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
xcodebuild -project BotDot.xcodeproj -scheme BotDot -configuration "${CONFIG:-Debug}" -derivedDataPath build/dd build -quiet
pkill -x botdot 2>/dev/null && sleep 1 || true
open "build/dd/Build/Products/${CONFIG:-Debug}/botdot.app"
