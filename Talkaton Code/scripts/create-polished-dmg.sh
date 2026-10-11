#!/bin/bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "Usage: create-polished-dmg.sh <app-path> <product> <accent> <output.dmg>" >&2
  exit 2
fi

APP_PATH="$1"
PRODUCT="$2"
ACCENT="$3"
OUTPUT_FILE="$4"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/installer-dmg.XXXXXX")"
BACKGROUND_FILE="$WORK_DIR/background.png"
SETTINGS_FILE="$WORK_DIR/dmg-settings.json"
VOLUME_NAME="$PRODUCT Installer"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

mkdir -p "$(dirname "$OUTPUT_FILE")"
clang "$SCRIPT_DIR/make-dmg-background.m" -fobjc-arc -fmodules-cache-path="$WORK_DIR/module-cache" -framework Cocoa -o "$WORK_DIR/make-dmg-background"
"$WORK_DIR/make-dmg-background" "$BACKGROUND_FILE" "$PRODUCT" "$ACCENT"
if [[ "$(uname -m)" == "arm64" ]]; then
  DMGBUILD_ARCHIVE="dmgbuild-bundle-arm64-75c8a6c.tar.gz"
  DMGBUILD_SHA256="793404d0c96687e27d5ee40a668d498c92e36a64d6c2906df511031adb33cbeb"
else
  DMGBUILD_ARCHIVE="dmgbuild-bundle-x86_64-75c8a6c.tar.gz"
  DMGBUILD_SHA256="1664972f9cc2d6e8fce3b63e42cd30078aff602669c5856939c4519921200433"
fi
DMGBUILD_BUNDLE_URL="${DMGBUILD_BUNDLE_URL:-https://mirrors.huaweicloud.com/electron-builder-binaries/dmg-builder%401.2.5/$DMGBUILD_ARCHIVE}"
DMGBUILD_CACHE_DIR="${DMGBUILD_CACHE_DIR:-$PROJECT_DIR/.build-cache/dmgbuild-1.2.5}"
DMGBUILD_BIN="$DMGBUILD_CACHE_DIR/dmgbuild"

if [[ ! -x "$DMGBUILD_BIN" ]]; then
  mkdir -p "$DMGBUILD_CACHE_DIR"
  curl --fail --location --silent --show-error "$DMGBUILD_BUNDLE_URL" -o "$WORK_DIR/dmgbuild.tar.gz"
  echo "$DMGBUILD_SHA256  $WORK_DIR/dmgbuild.tar.gz" | shasum -a 256 -c -
  tar -xzf "$WORK_DIR/dmgbuild.tar.gz" -C "$DMGBUILD_CACHE_DIR"
  [[ -x "$DMGBUILD_BIN" ]] || { echo "The verified DMG builder bundle did not contain dmgbuild." >&2; exit 1; }
fi

cat > "$SETTINGS_FILE" <<JSON
{
  "title": "$VOLUME_NAME",
  "background": "$BACKGROUND_FILE",
  "icon-size": 96,
  "text-size": 13,
  "format": "UDZO",
  "filesystem": "HFS+",
  "compression-level": 9,
  "contents": [
    { "path": "$APP_PATH", "x": 160, "y": 220, "name": "$PRODUCT.app", "type": "file" },
    { "path": "/Applications", "x": 480, "y": 220, "name": "Applications", "type": "link" }
  ]
}
JSON

rm -f "$OUTPUT_FILE"
"$DMGBUILD_BIN" -s "$SETTINGS_FILE" "$VOLUME_NAME" "$OUTPUT_FILE"
hdiutil verify "$OUTPUT_FILE" >/dev/null
