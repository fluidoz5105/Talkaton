# Talkaton Desktop

Talkaton Desktop now ships as real platform installers:

- `Talkaton-1.0.0-mac-universal.dmg` contains a small native AppKit/WebKit application for Apple Silicon and Intel Macs.
- `Talkaton-1.0.0-windows-x64-setup.exe` contains a 64-bit Electron application with an NSIS setup wizard.

Both applications load `https://talkaton.org/chat?desktop=1`, retain the user’s web account session, permit microphone access only for Talkaton voice, open untrusted external links in the system browser, and show an offline recovery screen when the service cannot be reached.

Build the macOS installer with `bash scripts/build-mac-installer.sh`. Build the Windows installer by running `pnpm install` and `pnpm build:windows` inside `desktop/electron`. Production signing and notarization require separate Apple Developer and Microsoft code-signing certificates; this repository does not contain private signing credentials.
