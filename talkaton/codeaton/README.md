# Codeaton

Codeaton is Talkaton's local-first, conversational coding agent and multi-model change studio. Explain mode supports focused coding questions and follow-ups. Build, Debug, and Audit missions are anchored to an active source file: a first model drafts one bounded change, an optional second model challenges it through Model Relay, and the Proofrail keeps the scope, draft, and proof stages visible. Replies stream from Talkaton's server-side OpenRouter integration; the browser never receives the private API key. The browser/desktop edition uses an operating-system file picker to work with folders that the user explicitly chooses.

## Safety model

- No folder is accessible until the user selects it in the operating-system picker.
- Only the active text file is sent as model context.
- Model output is presented as a proposed replacement and line diff.
- Model Relay moves a proposal to a different selected model for an adversarial review and revised proof.
- Applying a proposal changes the in-memory editor. Saving to disk remains a separate user action.
- Workspace contents are never stored in localStorage or the service-worker cache.
- Enter sends a mission. Shift+Enter inserts a new line.
- Codeaton uses Talkaton's server-enforced account plan limits. The header shows daily mission, Tavily research, and image allowances and updates from authoritative API usage results.
- The Web tool calls Tavily, adds up to five cited results as explicitly untrusted research context, and shows the source links with the answer.
- Image Studio calls the server-side OpenAI image endpoint and returns a downloadable WebP image.
- Prompt memory is separate from project context. Prompts are saved privately in browser storage and can be explicitly mirrored to a computer folder and a removable-drive folder. Project-file contents are never copied into the prompt archive.

## Surfaces

- `/codeaton` — product, install, and source-download page.
- `/codeaton/app` — functional coding workspace.
- `/downloads/installers/Codeaton-1.0.0-mac-universal.dmg` — native macOS installer for Apple Silicon and Intel.
- `/downloads/installers/Codeaton-1.0.0-windows-x64-setup.exe` — native Windows 10+ installer.
- `/codeaton/manifest.webmanifest` — optional browser-app metadata.
- `/codeaton/sw.js` — narrow application-shell cache; it never caches project files or model requests.
