#!/bin/sh
# Build botdot for Mac and put it in Applications in place of the one there, then open it
# (`make mac-install`; see README.md). $1 is another folder to put it in.
set -e
cd "$(dirname "$0")"
to="${1:-/Applications}"

# The full Xcode: the selected one or DEVELOPER_DIR, else the one in /Applications.
if ! xcodebuild -version >/dev/null 2>&1; then
  xcode=/Applications/Xcode.app/Contents/Developer
  if [ -z "$DEVELOPER_DIR" ] && [ -x "$xcode/usr/bin/xcodebuild" ]; then
    export DEVELOPER_DIR="$xcode"
  else
    echo "Xcode is missing: the Mac targets need the full Xcode, not only its command line tools (xcode-select, or DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer)"
    exit 1
  fi
fi
[ -d "$to" ] && [ -w "$to" ] || { echo "Can't put botdot in $to: the folder is missing or you can't change it"; exit 1; }

echo "Building botdot for Mac…"
# Its warnings fill pages: they go to a file, shown only when the build fails.
mkdir -p build
xcodebuild -project BotDot.xcodeproj -scheme BotDot -configuration Release -derivedDataPath build build -quiet >build/install.log 2>&1 \
  || { tail -n 30 build/install.log; echo "The build failed: macos/build/install.log has all of it"; exit 1; }
built=build/Build/Products/Release/botdot.app
[ -d "$built" ] || { echo "The build left no app in macos/$built"; exit 1; }

# Every running botdot app, wherever it was started from: asked to quit as from its menu, so it
# tells its botdot server that no chat is on screen any more. Prints how many there were.
botdot_apps() {
  osascript -l JavaScript -e 'ObjC.import("AppKit")
    const apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier("dev.botdot.mac")
    if ("'"$1"'" === "quit") for (let i = 0; i < apps.count; i++) apps.objectAtIndex(i).terminate
    apps.count'
}
if [ "$(botdot_apps quit)" != 0 ]; then
  echo "Asking botdot to quit…"
  n=0
  while [ "$(botdot_apps)" != 0 ]; do
    n=$((n + 1))
    [ "$n" -le 30 ] || { echo "botdot is still running: quit it and run this again. The app in $to is as it was"; exit 1; }
    sleep 0.5
  done
fi

# Copied beside the old one first, so a failed copy leaves the old one in place.
rm -rf "$to/.botdot.app.new"
ditto "$built" "$to/.botdot.app.new"
rm -rf "$to/botdot.app"
mv "$to/.botdot.app.new" "$to/botdot.app"
echo "botdot is in $to"
open "$to/botdot.app"
