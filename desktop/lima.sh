#!/bin/sh
# Lima for the Mac's bundle (ADR 136): the release's limactl, which holds the virtualization entitlement, its guest
# agent for the VM and its templates, in src-tauri/lima. Run by `tauri build` before it bundles, for the arch it builds.
set -eu

VERSION=2.2.1
case "${TAURI_ENV_ARCH:-$(uname -m)}" in
  aarch64 | arm64) ARCH=arm64 GUEST=aarch64 SHA=9e9eacce88f37e185c346bad73aa6136f738d8cdf8c3bb23cd42b071824bc66e ;;
  x86_64) ARCH=x86_64 GUEST=x86_64 SHA=6b776e4bc41f358e6ee01fefcc78e2eb26f11635a0fcff632234af77a566c6c4 ;;
  *) echo "No Lima for ${TAURI_ENV_ARCH:-$(uname -m)}" >&2; exit 1 ;;
esac

cd "$(dirname "$0")/src-tauri"
[ "$(cat lima/version 2>/dev/null)" != "$VERSION $ARCH" ] || exit 0

FILE="lima-$VERSION-Darwin-$ARCH.tar.gz"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
curl -fsSL --retry 5 --retry-all-errors --retry-delay 10 -o "$WORK/$FILE" "https://github.com/lima-vm/lima/releases/download/v$VERSION/$FILE"
echo "$SHA  $WORK/$FILE" | shasum -a 256 -c -
tar -xzf "$WORK/$FILE" -C "$WORK" ./bin/limactl "./share/lima/lima-guestagent.Linux-$GUEST.gz" ./share/lima/templates ./share/doc/lima/LICENSE
rm -rf lima
mkdir lima
mv "$WORK/bin" "$WORK/share" lima/
echo "$VERSION $ARCH" > lima/version
