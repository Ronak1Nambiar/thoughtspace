# ThoughtSpace

**Think out loud. Your ideas land on a map.**

ThoughtSpace is a desktop app for thinking. You speak or type, and each idea becomes a card on a visual map. Related ideas get linked. When you talk about something already on your map, the map brings it forward and the assistant's suggestions land under it as items you can keep. An AI partner helps you develop any idea you select, using the model **you** choose: Claude, GPT, Gemini, Groq, OpenRouter, or a local model through Ollama.

Free and open source (MIT). Windows only for now. **Talking needs no key:** speech-to-text runs on your computer.

![Talking about a candle shop and a craft fair: the map glides to both thoughts and the suggestions land under them](docs/live-map.gif)

*"How do I keep the candle shop going while I get ready for the craft fair?" The map finds the two thoughts you mean, brings them forward, and the assistant's next steps land as items you can keep. Transcribed on the computer, no key needed.*

## Download

Get the latest installer from **[Releases](https://github.com/Ronak1Nambiar/thoughtspace/releases/latest)**:

- `Thoughtspace-x.y.z-Setup.exe` installs it with Start menu and desktop shortcuts.
- `Thoughtspace-x.y.z-Windows.exe` is portable. It runs without installing.

**Windows will warn you.** The builds aren't code-signed yet, so SmartScreen shows "Windows protected your PC". Click **More info → Run anyway**. Code signing is in progress. If you'd rather not trust a binary, [build it yourself](#build-from-source).

## Your first two minutes

1. **Open the app.** Setup asks you to pick a look, an accent colour, a text size and a name for your assistant. The default name is Atlas.
2. **Connect a model.** The quickest way is **Sign in with OpenRouter**: one click gives you access to Claude, GPT, Gemini and more, with no key to copy. You can also paste an API key, or use Ollama if it's already running on your computer.
3. **Capture a thought.** Type in **What's on your mind?** and press Ctrl+Enter, or click **Start conversation** and talk. One turn can hold several ideas, and each becomes its own card. Talk about a card that's already there and the map glides to it instead of making a duplicate.
4. **Work the map.** Keep the dashed items the assistant suggests, or add your own under any card. Drag cards around, connect them, and group them. Select a card and **Discuss** it with your assistant. Click **Find deeper connections** to have the model suggest links you missed.

## Bring your own model

| Provider | What you need |
|---|---|
| OpenRouter | Sign in (no key to copy) |
| Anthropic (Claude) | API key |
| OpenAI | API key |
| Google Gemini | API key |
| Groq | API key (free tier available) |
| Any OpenAI-compatible server | Its `/v1` address and an optional key |
| Ollama | Ollama running on this computer, free and fully local |

You can switch models at any time from the model menu. Switching doesn't need a restart. Keys are encrypted with Windows' secure storage and never leave your computer except to reach the provider you chose. See [docs/BRING-YOUR-OWN-MODEL.md](docs/BRING-YOUR-OWN-MODEL.md).

**Voice:** speech-to-text runs **on your computer** (a small Whisper model ships with the app), so talking works with any provider, or none. Prefer the cloud? Add a Groq (free) or OpenAI key and pick it in Settings → Voice. Spoken replies use Groq or OpenAI voices, or the free Windows voice.

## Privacy

- **Your map stays on your computer**, under `%APPDATA%\Thoughtspace`. There's no account and no ThoughtSpace server.
- **Your voice is transcribed on your computer** unless you choose cloud speech-to-text.
- Text is sent **only to the model provider you chose**, and only when you use an AI feature. With Ollama and on-device speech, nothing leaves your machine at all.
- The app's background service listens only on this computer (loopback) and requires a private per-launch token.
- Wake-by-name ("Hey Atlas") uses Windows' on-device speech recognizer. Wake audio never leaves the computer.
- You can import ChatGPT/Claude exports and Markdown folders (including Obsidian vaults). See [docs/YOUR-DATA.md](docs/YOUR-DATA.md) for what's read and where it goes.

## Build from source

Requires Node.js 22.13+ and Windows. The wake listener compiles with the `csc.exe` that ships with Windows (.NET Framework).

```powershell
npm install
npm run desktop          # run the desktop app
npm run package:desktop  # build installers into release/
```

On Linux, `npm run package:desktop:cross` builds the same Windows installers. It needs the .NET SDK (or [mise](https://mise.jdx.dev), which fetches it) and `wine`.

Web version for development: `npm run build && npm start`, then open http://localhost:3000 (`npm run dev` for hot reload). See [setup](docs/SETUP.md) for running it with environment variables.

The demo GIF and screenshot are recorded from invented thoughts: with `npm run dev` running, `node scripts/record-demo.mjs` rewrites `docs/live-map.gif`, `site/media/live-map.gif` and `docs/screenshot.png` (needs ffmpeg). Every AI call is mocked, so no key is used and no real workspace is shown.

The website is `site/` (plain HTML, published to GitHub Pages by `.github/workflows/pages.yml`).

Tests: `npm test` for unit tests. Run `npm run test:browser` with the server on :3000 and Microsoft Edge installed.

## Docs

| | |
|---|---|
| [User guide](docs/USER-GUIDE.md) | Every control, voice behaviour and setting |
| [Desktop app](docs/DESKTOP.md) | Storage, backups, moving browser work into the app |
| [Bring your own model](docs/BRING-YOUR-OWN-MODEL.md) | Providers, saved models, OpenRouter sign-in |
| [Your data](docs/YOUR-DATA.md) | Importing ChatGPT, Claude and notes, and what gets sent where |
| [Local models](docs/LOCAL-LLM.md) | Running fully on Ollama |
| [Wake by name](docs/WAKE-NAME.md) | Hands-free start with your assistant's name |
| [Tester guide](docs/TESTERS.md) | 15 minutes from install to feedback |
| [Live map](docs/LIVE-MAP.md) | Focus on what you talk about, suggested items, reply voices |
| [Setup (dev)](docs/SETUP.md) | Environment variables and provider setup for the web version |

## Feedback

**Want to help test?** Follow the 15-minute [tester guide](docs/TESTERS.md) and fill in the short feedback form at the end.

Found a bug or have an idea? [Open an issue](https://github.com/Ronak1Nambiar/thoughtspace/issues), or start a thread in [Discussions](https://github.com/Ronak1Nambiar/thoughtspace/discussions).

## License

[MIT](LICENSE) © 2026 The ThoughtSpace contributors
