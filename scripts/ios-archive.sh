#!/usr/bin/env bash
# The iOS app's App Store archive (#1365, #1409, ADR 242), on a Mac with Xcode, XcodeGen, a JDK 21 and the Android SDK.
#
#   IOS_VERSION=1.0 IOS_BUILD=7 scripts/ios-archive.sh --unsigned
#   IOS_VERSION=1.0 IOS_BUILD=7 APPLE_TEAM_ID=… ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=AuthKey.p8 scripts/ios-archive.sh --upload
#
# It builds the shared data layer's Release framework (make ios and the iOS CI job link the Debug one, which links in
# seconds where Release takes minutes), makes the Xcode project from ios/project.yml with that framework, and archives
# the Release configuration for a device. --unsigned stops there: no Apple account, the check that the Release build
# links (ios.yml). --upload signs with the App Store Connect API key (automatic signing: Xcode makes or fetches the
# distribution certificate and the profiles) and uploads the build to App Store Connect, where TestFlight's internal
# testers get it (ios-release.yml).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-}"
case "$MODE" in
  --unsigned|--upload) ;;
  *) echo "usage: $0 --unsigned | --upload" >&2; exit 2 ;;
esac

VERSION="${IOS_VERSION:-}"
BUILD="${IOS_BUILD:-}"
# The App Store takes a version of one to three numbers and a build number that only grows.
echo "$VERSION" | grep -qE '^(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*)){0,2}$' || { echo "Not a version: '$VERSION' (IOS_VERSION, like 1.0 or 1.0.1)" >&2; exit 2; }
echo "$BUILD" | grep -qE '^[1-9][0-9]*$' || { echo "Not a build number: '$BUILD' (IOS_BUILD)" >&2; exit 2; }

AUTH=()
if [ "$MODE" = --upload ]; then
  for NAME in APPLE_TEAM_ID ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH; do
    [ -n "${!NAME:-}" ] || { echo "$NAME is missing: --upload needs the team and the App Store Connect API key" >&2; exit 2; }
  done
  [ -f "$ASC_KEY_PATH" ] || { echo "No key file at ASC_KEY_PATH" >&2; exit 2; }
  AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi

# The Release framework, as the archive links it.
(cd "$ROOT/android" && "${IOS_ARCHIVE_GRADLEW:-./gradlew}" :shared:assembleBotdotSharedReleaseXCFramework --console=plain)

# The project from project.yml with the Release framework for the app and the share extension, and a device build that
# may be signed (project.yml turns signing off for a device, as make ios builds no device app). The copy is not in git.
SPEC="$ROOT/ios/project-release.yml"
sed -e 's#XCFrameworks/debug/BotdotShared\.xcframework#XCFrameworks/release/BotdotShared.xcframework#' \
    -e '/CODE_SIGNING_ALLOWED\[sdk=iphoneos\*\]/d' "$ROOT/ios/project.yml" > "$SPEC"
if grep -q 'XCFrameworks/debug' "$SPEC" || ! grep -q 'XCFrameworks/release/BotdotShared\.xcframework' "$SPEC"; then
  echo "ios/project.yml no longer names XCFrameworks/debug/BotdotShared.xcframework: change $0 with it" >&2
  exit 1
fi
(cd "$ROOT/ios" && xcodegen generate --spec project-release.yml --quiet)

SETTINGS=(MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD")
if [ "$MODE" = --unsigned ]; then
  SETTINGS+=(CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO)
else
  SETTINGS+=(CODE_SIGNING_ALLOWED=YES CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$APPLE_TEAM_ID")
fi

OUT="$ROOT/ios/build/release"
ARCHIVE="$OUT/BotDot.xcarchive"
rm -rf "$OUT"
mkdir -p "$OUT"
# ${AUTH[@]+…}: an empty list under set -u, in the Mac's own bash 3.2 too.
(cd "$ROOT/ios" && xcodebuild archive -project BotDot.xcodeproj -scheme BotDot -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" ${AUTH[@]+"${AUTH[@]}"} "${SETTINGS[@]}")

if [ "$MODE" = --unsigned ]; then
  echo "botdot $VERSION ($BUILD): the Release archive is built, unsigned; nothing is uploaded."
  exit 0
fi

# Exported for App Store Connect and uploaded in the same step; the export changes the push entitlement to production.
cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$APPLE_TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
PLIST
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist "$OUT/ExportOptions.plist" -exportPath "$OUT/export" "${AUTH[@]}"
echo "botdot $VERSION ($BUILD) is uploaded to App Store Connect: TestFlight's internal testers get it once Apple has processed it."
