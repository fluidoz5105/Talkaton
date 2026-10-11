#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_DIR="$PROJECT_DIR/desktop/feather-webkit"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/feather-webkit.XXXXXX")"
APP_DIR="$WORK_DIR/Feather Browser.app"
OUTPUT_DIR="$PROJECT_DIR/downloads/installers/feather-webkit"
OUTPUT_APP="$OUTPUT_DIR/Feather Browser.app"
OUTPUT_DMG="$OUTPUT_DIR/Feather-Browser-WebKit-1.0.0-mac-universal.dmg"

cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources" "$OUTPUT_DIR"

clang "$SOURCE_DIR/FeatherBrowser.m" -target arm64-apple-macos13.0 -fobjc-arc -fmodules-cache-path="$WORK_DIR/module-cache-arm64" -framework Cocoa -framework WebKit -o "$WORK_DIR/FeatherBrowser-arm64"
clang "$SOURCE_DIR/FeatherBrowser.m" -target x86_64-apple-macos13.0 -fobjc-arc -fmodules-cache-path="$WORK_DIR/module-cache-x64" -framework Cocoa -framework WebKit -o "$WORK_DIR/FeatherBrowser-x64"
lipo -create "$WORK_DIR/FeatherBrowser-arm64" "$WORK_DIR/FeatherBrowser-x64" -output "$APP_DIR/Contents/MacOS/Feather Browser"
cp "$SOURCE_DIR/Info.plist" "$APP_DIR/Contents/Info.plist"

cp "$SOURCE_DIR/FeatherBrowser.icns" "$APP_DIR/Contents/Resources/FeatherBrowser.icns"
xattr -cr "$APP_DIR"

chmod +x "$APP_DIR/Contents/MacOS/Feather Browser"
if [[ -n "${APPLE_DEVELOPER_IDENTITY:-}" ]]; then
  codesign --force --deep --options runtime --timestamp --sign "$APPLE_DEVELOPER_IDENTITY" "$APP_DIR"
else
  codesign --force --deep --sign - "$APP_DIR"
fi
codesign --verify --deep --strict "$APP_DIR"

rm -rf "$OUTPUT_APP"
cp -R "$APP_DIR" "$OUTPUT_APP"
xattr -cr "$OUTPUT_APP"
codesign --verify --deep --strict "$OUTPUT_APP"
"$SCRIPT_DIR/create-polished-dmg.sh" "$APP_DIR" "Feather Browser" "green" "$OUTPUT_DMG"

if [[ -n "${APPLE_DEVELOPER_IDENTITY:-}" ]]; then codesign --timestamp --sign "$APPLE_DEVELOPER_IDENTITY" "$OUTPUT_DMG"; fi
if [[ -n "${APPLE_NOTARY_PROFILE:-}" ]]; then
  xcrun notarytool submit "$OUTPUT_DMG" --keychain-profile "$APPLE_NOTARY_PROFILE" --wait
  xcrun stapler staple "$OUTPUT_DMG"
  xcrun stapler validate "$OUTPUT_DMG"
fi

file "$OUTPUT_APP/Contents/MacOS/Feather Browser"
hdiutil verify "$OUTPUT_DMG"
