# Thoughtspace for Windows

Thoughtspace runs in its own desktop window. It includes its Chromium/Node runtime and starts and stops its private background service automatically. Node.js, a browser tab, and a separately running server are not required to use the packaged application.

## Open the app

- `release/Thoughtspace-1.5.0-Windows.exe`: portable executable, no installation required.
- `release/Thoughtspace-1.5.0-Setup.exe`: optional per-user installer with desktop and Start menu shortcuts.
- `release/win-unpacked/Thoughtspace.exe`: directly runnable application folder; keep its adjacent files together.

Builds are not code-signed yet.

## Your workspace

The application keeps its workspace, original transcripts, corrections, notes, and pending recordings under `%APPDATA%/Thoughtspace`. Its stable internal origin keeps this data independent of the private service's temporary port. Closing and reopening the application preserves saved work. File > Export workspace backup saves a portable JSON backup through a native save dialog. File > Workspace settings and restore opens the existing restore control.

Automatic backups: once a day while the app runs, and again when it quits, a copy of the workspace is written to `%APPDATA%/Thoughtspace/backups` (the last 14 are kept). A copy is only written when the workspace changed, and a workspace that cannot be read is never written, so it cannot push good copies out. Settings > Automatic backups lists them with their date and card count, can back up now, opens the folder, and restores one. Restoring first backs up the current workspace, so it can be undone.

In the background: closing the window keeps Thoughtspace running in the tray, so the wake word and the quick-capture shortcut keep working. Quit from the tray icon menu or File > Quit. Ctrl+Shift+Space brings the window forward with the cursor in a new thought. Start with Windows (installed app only, off by default) launches it into the tray at sign-in. All three are in Settings > In the background.

Browser storage and desktop storage are separate. To bring existing browser work into the application, export it from the previous browser workspace, then restore that JSON backup in the app's workspace settings. The browser workspace is not deleted or modified. Pending audio is not part of the JSON backup: use Download audio in browser Source transcripts to keep any untranscribed recordings.

## Groq and voice

The desktop app uses the same Groq transcription and discussion integration. An existing `GROQ_API_KEY` environment credential is imported on launch into Windows-protected storage using Electron safeStorage. The encrypted configuration stays outside the executable and renderer. If no credential is available, local text capture remains functional.

For another installation, choose Connection > Import Groq configuration and select a local environment file containing `GROQ_API_KEY=...`, optionally `AI_ENABLED=true`, `CHAT_MODEL=openai/gpt-oss-120b`, and `TRANSCRIPTION_MODEL=whisper-large-v3-turbo`. The file is read by the background process; keys are not entered into or exposed to the workspace page. Importing does not delete the source configuration file. Use Check connection in workspace settings afterward. Groq requires an account; the same provider usage charges in [SETUP.md](SETUP.md) apply.

Starting voice prompts for microphone permission inside the application. Camera, screen-capture, and unrelated permissions are not granted. Connection > Reset microphone permission resets the app's grant; Windows privacy settings can independently deny access. Start/Stop/Mute, automatic turn detection, finalized transcription, optional on-device preview, spoken replies, and interruption use the same workspace code. Live preview remains dependent on runtime support. Physical microphone and audible-response acceptance still require a real person; packaging does not establish that acceptance.

## Build and verify

```powershell
npm install
npm run desktop
npm run package:desktop
npm run test:desktop
```

The executable uses an isolated renderer with no Node integration, context isolation, and a sandbox. A privileged local protocol forwards API requests to a loopback service with a per-launch private token. The app uses a random port and does not depend on or take over an existing server on port 3000. External HTTPS links open in the system browser; they cannot replace the workspace window.

Official references checked for this implementation: [Electron protocol](https://www.electronjs.org/docs/latest/api/protocol), [context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation), [sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox), [protected credential storage](https://www.electronjs.org/docs/latest/api/safe-storage), [Windows packaging](https://www.electron.build/v26/docs/win/).

## Atlas wake mode

Version 1.2 adds optional local wake listening. See [WAKE-NAME.md](WAKE-NAME.md) for activation, mute/stop behavior, Windows speech requirements and verification limits. No additional provider account or wake-word API charge is required.

## Thought map

Version 1.3 opens on a map of all your ideas with automatic local connections. Use More tools for the existing workbench.

The window opens maximized with the menu bar hidden. Press **Alt** to show File, Edit, View, Connection and Help; their shortcuts always work. **F11** toggles full screen.
