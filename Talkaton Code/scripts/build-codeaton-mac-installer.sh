#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/codeaton-macos.XXXXXX")"
APP_DIR="$WORK_DIR/Codeaton.app"
OUTPUT_DIR="$PROJECT_DIR/downloads/installers"
OUTPUT_FILE="$OUTPUT_DIR/Codeaton-1.0.0-mac-universal.dmg"
SOURCE_FILE="$PROJECT_DIR/desktop/codeaton-macos/CodeatonApp.m"

cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources" "$OUTPUT_DIR"
clang "$SOURCE_FILE" -target arm64-apple-macos13.0 -fobjc-arc -fmodules-cache-path="$WORK_DIR/module-cache-arm64" -framework Cocoa -framework WebKit -o "$WORK_DIR/Codeaton-arm64"
clang "$SOURCE_FILE" -target x86_64-apple-macos13.0 -fobjc-arc -fmodules-cache-path="$WORK_DIR/module-cache-x64" -framework Cocoa -framework WebKit -o "$WORK_DIR/Codeaton-x64"
lipo -create "$WORK_DIR/Codeaton-arm64" "$WORK_DIR/Codeaton-x64" -output "$APP_DIR/Contents/MacOS/Codeaton"
cp "$PROJECT_DIR/desktop/codeaton-macos/Info.plist" "$APP_DIR/Contents/Info.plist"
cp "$PROJECT_DIR/desktop/codeaton-assets/Codeaton.icns" "$APP_DIR/Contents/Resources/Codeaton.icns"
chmod +x "$APP_DIR/Contents/MacOS/Codeaton"
if [[ -n "${APPLE_DEVELOPER_IDENTITY:-}" ]]; then
  codesign --force --deep --options runtime --timestamp --sign "$APPLE_DEVELOPER_IDENTITY" "$APP_DIR"
else
  codesign --force --deep --sign - "$APP_DIR"
fi
codesign --verify --deep --strict "$APP_DIR"
"$PROJECT_DIR/scripts/create-polished-dmg.sh" "$APP_DIR" "Codeaton" "green" "$OUTPUT_FILE"
if [[ -n "${APPLE_DEVELOPER_IDENTITY:-}" ]]; then codesign --timestamp --sign "$APPLE_DEVELOPER_IDENTITY" "$OUTPUT_FILE"; fi
if [[ -n "${APPLE_NOTARY_PROFILE:-}" ]]; then
  xcrun notarytool submit "$OUTPUT_FILE" --keychain-profile "$APPLE_NOTARY_PROFILE" --wait
  xcrun stapler staple "$OUTPUT_FILE"
  xcrun stapler validate "$OUTPUT_FILE"
fi
file "$APP_DIR/Contents/MacOS/Codeaton"
hdiutil verify "$OUTPUT_FILE"
