# Feather Browser

> Legacy Chromium prototype. The current Feather Browser uses native WebKit and lives in [`../feather-webkit`](../feather-webkit/README.md).

Feather is a deliberately small desktop browser built on Electron's Chromium runtime. It uses one browser shell and isolated `WebContentsView` instances for tabs, with no account sync, sidebars, or unnecessary background services.

## Included

- Tabs with close, middle-click close, cycling, and reopen-closed-tab
- Address/search bar with HTTPS promotion and Google search
- Back, forward, reload/stop, and home controls
- Downloads manager with native save prompts, progress, pause/resume, cancel, open, and reveal actions
- Persistent installation and removal of unpacked Chromium extensions
- A local connection-error page with retry and Google search actions
- Chromium's normal site isolation plus sandboxed renderers and no Node.js access
- Conservative permission defaults and a 12-live-tab limit
- 64 MB disk cache and 32 MB media cache targets
- macOS, Windows, and Linux packaging configuration

## Run locally

```sh
cd desktop/feather-browser
pnpm install --ignore-workspace
pnpm start
```

Run the fast unit tests with `pnpm test`. Use `pnpm test:smoke` to launch Chromium briefly and verify that the shell and first tab initialize together.

## Build an installer

```sh
pnpm build:mac
pnpm build:windows
pnpm build:linux
```

Installers are written to `downloads/installers/feather/`.

## Intentional limits

Feather currently denies camera, microphone, geolocation, and notification permissions. It also omits profiles, bookmark sync, password management, and automatic updates. Electron supports only a subset of the Chromium extension APIs and only unpacked extension folders—Chrome Web Store `.crx` packages cannot be installed directly.

Connection failures show a retry page. Feather does not bypass Wi-Fi, DNS, firewall, parental-control, workplace, school, or administrator restrictions.
