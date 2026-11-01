# Feather Browser — WebKit

Feather Browser is a native macOS browser built with AppKit and Apple's system `WKWebView`. The application does not bundle Chromium, Electron, Node.js, or another browser engine.

## Features

- Native WebKit tabs and back/forward navigation
- Google search and address input
- Native `WKDownload` save flow and completed-download list
- New-window links open in Feather tabs
- Connection failure page with retry
- Persistent cookies and website data through the default WebKit data store
- 12-tab limit to keep resource use bounded

## Build

From the repository root:

```sh
./scripts/build-feather-webkit.sh
```

The script builds a universal macOS application and DMG in `downloads/installers/feather-webkit/`.

The built `.app` is approximately 608 KB because WebKit is provided by macOS instead of bundled with the application.

## Compatibility limits

Chromium extensions do not run in WebKit. Feather Browser therefore does not expose Chrome Web Store or unpacked Chromium extension installation. It also does not bypass Wi-Fi, DNS, firewall, parental-control, workplace, school, or administrator restrictions.
