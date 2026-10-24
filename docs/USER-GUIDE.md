# Thoughtspace

**1.9:** first-run setup (pick one of four looks, an accent and text size; name your assistant; connect a model), a custom wake name, and **Sign in with OpenRouter** for Claude, GPT, Gemini and more without copying a key. See [bring your own model](BRING-YOUR-OWN-MODEL.md) and [wake by name](WAKE-NAME.md).

A map of your thoughts and ideas. Capture by typing or speaking; every idea appears automatically on the map. Related wording and groups produce suggested links. Select a thought to explore connections, keep or remove suggestions, and open notes. **More tools** opens the existing engineering workbench.

Version 1.5 adds a more inviting thought map: starter prompts, a softly dotted charcoal canvas, gentle card arrivals, connected-card highlights, and brief capture feedback. The composer and Atlas activity indicators respond clearly to focus and conversation state. Motion respects the system's reduced-motion preference.

## Windows application

Open **release/Thoughtspace-1.9.0-Windows.exe** for the standalone desktop app, or use **release/Thoughtspace-1.9.0-Setup.exe** to install it. The app includes its runtime and background service; no browser or terminal is needed. See [DESKTOP.md](DESKTOP.md) for desktop storage, credentials, and moving existing browser work into the application.

## Run the web development version

Requires Node.js 22.13+ (tested with Node 24) and a modern browser.

```powershell
npm install
npm run build
npm start
```

Open **http://localhost:3000**. For development with hot reload, use `npm run dev`.

Manual capture, arrangement, edits, grouping, connections, priorities, tasks, notes, export, and restore also work without AI. Fresh installations remain disabled until configured.

## Wake by name

You name your assistant during setup (default Atlas). In the Windows app, enable **<name> wake**, say **<name>** or **Hey <name>**, pause for the chime and Listening, then speak. Setup can test how well Windows hears the name. Wake recognition stays on this device. While a conversation is going, say the name again to interrupt a reply: the assistant stops talking and listens. Mute pauses it; disabling wake mode or quitting the app stops it. Closing the window keeps the app in the tray, so wake keeps listening; quit from the tray icon. See [wake by name](WAKE-NAME.md).

## Speak and think together

Click **Start conversation**, allow the microphone, and speak naturally. A pause of about 1.6 seconds finishes an utterance. Its transcript is saved before processing. With no cards selected, distinct ideas appear in the inbox and the assistant responds. Select an idea or group to develop it: your spoken additions and the assistant's reply are appended to that context.

Start once and talk through several thoughts in the same turn. One transcript can create multiple idea cards; you do not need a recording for each idea. After processing and any spoken reply, **Listening** returns automatically for your next thoughts. Continue until you choose **Stop conversation**.

The voice transcript strip shows **Provisional / Not saved** words where the browser supports on-device speech recognition and already has its language pack for your browser language. Changing hypotheses replace earlier preview text; they never create cards. Groq's completed transcript appears separately as **Latest finalized transcript**, with its save status and a correction link. Without local recognition, the strip explains that live preview is unavailable and finalized text appears after a pause or Stop. Preview recognition stops on mute, processing, or Stop; no browser cloud recognition fallback is used.

Spoken replies are enabled when you first start a conversation; choose **Text-only replies** if preferred. The microphone waits during processing and playback, then automatically listens again. **Interrupt and listen** stops a reply and returns to listening. **Finish thought** submits the current utterance without waiting for a pause. **Stop conversation** releases the microphone and preserves the current finalized turn. Utterances are limited to two minutes; this is turn-based conversation, not simultaneous full-duplex audio.

**Start conversation**, **Stop conversation**, and **Mute mic / Unmute mic** are grouped at the top of the workspace. The status explicitly shows **Listening**, **Processing**, **Speaking**, or **Microphone muted**. Muting disables microphone input and pauses the current recording without discarding speech already captured. Unmute continues that thought; Stop saves its captured audio for processing. Mute remains in effect through a reply until you unmute. Microphone mute and text-only replies are separate controls.

Your canvas stays visible and new capture never rearranges it. Move and organize cards yourself while continuing the conversation. The turn's selected context is frozen when speech begins and displayed during processing, so changing selection does not redirect an in-flight reply.

Each extracted project appears as a compact inbox card above the canvas. Toggle **Inbox** to show its matching readable list. Use the card arrow or **Place** to arrange it on the canvas; **Cards** shows every saved idea. New capture never changes existing positions.

AI extraction creates an engineering brief: outcome, approach, risk, first experiment and open question. Related constraints stay with their project. These are **AI proposals**, saved as attributed notes rather than substituted for the user's words. Cards show the proposed approach. **Source & notes** opens the original wording, summary editor, corrections and full source transcript. Previous proposals and notes survive corrections.

**Engineer** develops selected ideas through conversation. Captured cards, AI proposals and manual notes have distinct provenance. Settings offers natural **Groq Orpheus** speech (six English voices), explicit device voice, and a voice preview. Natural speech requires Orpheus terms acceptance in the Groq organization associated with the configured API key.

## Use

The default screen is the thought map. Drag the background (or hold the middle mouse button) to pan. The mouse wheel zooms toward the cursor; on a touchpad, pinch to zoom and swipe with two fingers to pan; on a touch screen, pinch with two fingers. Double-click empty space to zoom in there; double-click a thought to open it. Keys: **+** / **-** zoom, **0** fits everything, **1** is actual size, the arrows pan (Shift for faster), **Esc** clears the selection. The percentage next to the zoom buttons resets to 100%. Drag thoughts to arrange them. **Find deeper connections** uses Groq to suggest relationships beyond shared words (2-200 thoughts). Dashed links are suggestions; solid links are confirmed. The controls below are available through **More tools**. The web workbench can also be opened directly at `/?view=workbench`.

- Type in **New thought** and press the arrow or Ctrl+Enter. In local mode, a conservative sentence/clause splitter creates cards. It separates the supplied proposal/dashboard/meeting example into three cards. It is not a semantic AI extractor; complex speech may need manual correction. **Save as one card · no AI** preserves the whole capture as a single card.
- Move inbox cards onto the canvas using their arrow button. Drag to arrange; arrow keys also move a focused card (Shift+arrow for larger steps). Capturing never moves existing cards.
- Shift-click to select multiple cards. Name a group and click **Group**, or select two cards and click **Connect**. Group chips select all their cards. Group assignment and connection removal are available in **Notes**.
- Select a card and open **Notes** to edit its title, priority, task status, group, source excerpt, or add notes. Source excerpt edits retain earlier wording. Finalized transcript corrections retain their original text and revision history. Local transcript correction does not silently rewrite card excerpts or generate replacement cards.
- **Discuss selected** visibly identifies the active context. When AI is enabled, replies append to the original selection even if you select another card while a request is pending. They never overwrite existing notes or change card arrangement. Organization advice can be applied with the manual grouping/connection controls.
- Settings includes an optional single-recording control (maximum five minutes per recording). Finalized audio is stored locally before transcription. Failed audio can be retried, downloaded, or deleted under **Source transcripts**. With AI disabled, transcription is unavailable and the recording remains local.
- Spoken questions in discussion mode are transcribed into the composer for review before sending. Groq Orpheus reads replies aloud; device speech is an explicit alternative. **Interrupt reply** cancels playback or an in-flight request. Text-only replies are the default.


Account requirements, server-only credential setup, and current published usage rates are in [SETUP.md](SETUP.md).

## Groq configuration

Real Groq endpoints have been tested using synthesized speech. This is provider-integration evidence; real-user microphone-to-speaker acceptance is NOT VERIFIED and is required before considering voice complete. For a fresh installation, copy `.env.example` to `.env`, set `GROQ_API_KEY` locally (or use an existing environment variable), set `AI_ENABLED=true`, and restart the server. Never commit `.env` or put credentials in client code.

Defaults: `openai/gpt-oss-120b` for extraction/discussion and `whisper-large-v3-turbo` for transcription. Both model names can be configured in `.env`. Another provider requires replacing the small adapter in `server.mjs` while keeping the same API contracts.

The chat model is one of Groq's [recommended replacements for retired models](https://console.groq.com/docs/deprecations). The implementation follows Groq's [speech-to-text API](https://console.groq.com/docs/speech-to-text) and [API reference](https://console.groq.com/docs/api-reference). Check availability and account limits before enabling.

## Persistence and privacy

- Workspace data is stored in browser localStorage under `thoughtspace.workspace.v1`; audio awaiting transcription uses IndexedDB. No workspace database is written to the server. Use the same browser and origin to reopen your work.
- Export JSON backups before clearing browser data. Restore exports the existing workspace first, then replaces it with the selected backup. Audio downloads are separate from workspace backups.
- Save failures are visible; in-memory content stays exportable. Cross-tab changes block further writes from the stale tab until reload, so that tab cannot overwrite another tab's work.
- Stopped audio is sent to the provider only when AI is enabled. Successful transcription removes local audio only after the transcript is saved. The server does not retain recordings or log their contents.
- Extraction sends the capture and source-linked card titles/excerpts. Discussion sends selected card titles, excerpts, notes, the prompt, and at most eight prior messages from that selection. Without a selection, conversation mode sends newly captured cards and the recent capture-conversation history.
- Reply playback prefers an available local voice. If none matches, the browser may use its default voice service and send reply text to that provider. Privacy and settings shows the selected voice. Read reply retries playback without regenerating or replacing saved notes. Stopping the local connection does not guarantee that upstream inference or billing stops.
- Provider retention is controlled by the provider/account; this app does not configure zero data retention. See [Groq's data policy](https://console.groq.com/docs/your-data).
- The local server binds only to loopback and rejects cross-origin API requests. This is a personal local application, not a hosted multi-user service. Typography uses installed system fonts and makes no external font request.
- Text capture remains usable in an already loaded app during connection loss. Reopening the app requires the local server to be running; the app is not a service-worker-backed offline installation. An active recording can be lost if the page closes before it is stopped.

The connection status checks that both configured models are available to the account. Use **Check connection** in Privacy and settings to refresh model availability after changing server settings or recovering a connection.

## Tests

```powershell
npm test
npm run test:browser
```

Browser tests require a running server on port 3000 and Microsoft Edge. The regression tests use isolated browser contexts, synthetic microphone audio, and mocked provider replies; they do not touch your workspace or call a live AI provider. Separate scripts, `scripts/verify-live.mjs` and `scripts/verify-speech.mjs`, verify live Groq processing and real browser speech playback. The live script needs two WAV recordings you generate yourself (Windows speech synthesis works) in `artifacts/`, and makes billable provider requests.
