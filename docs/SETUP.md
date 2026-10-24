# Account, server credentials, and usage costs

## Required account

Create a **GroqCloud account** and a project API key in the [Groq console](https://console.groq.com/keys), following the [official setup instructions](https://console.groq.com/docs/quickstart). The application calls Groq directly from its own server. It does not require an OpenAI API credential.


The Free tier has usage restrictions. Higher paid capacity requires upgrading the Groq account and adding a payment method. Check the account's limits and billing before sustained use; the app does not upgrade accounts or change spending limits. [Groq billing documentation](https://console.groq.com/docs/billing-faqs)

For the packaged Windows app, use [DESKTOP.md](DESKTOP.md); Node.js is not needed. The steps below apply to the development web version.

## Fresh installation

1. Install Node.js 22.13 or newer and run `npm install` in the project directory.
2. If `.env` does not exist, copy `.env.example` to `.env`. Preserve an existing configuration.
3. Set `GROQ_API_KEY` in the **server process environment**, or edit the ignored `.env` file locally. Never enter it into the app, a chat message, client-side code, `VITE_*` settings, a screenshot, or a committed file.
4. Set these non-secret server options:

   ```dotenv
   AI_ENABLED=true
   PORT=3000
   CHAT_MODEL=openai/gpt-oss-120b
   TRANSCRIPTION_MODEL=whisper-large-v3-turbo
   ```

5. Run `npm run build`, then `npm start`. Open `http://localhost:3000` in the same browser for subsequent visits.
6. In Privacy and settings, use **Check connection**. Then choose **Start conversation** and allow microphone access. Groq Orpheus supplies natural spoken replies using the same server key. An organization administrator must accept the English Orpheus model terms in that key’s Groq organization. Choose a voice and use Preview voice in settings. Device voice remains an explicit alternative.

Changing server credentials or models requires restarting the server. Keep credentials in a secret manager or server environment if this app is later deployed. The current server binds to loopback for personal local use.

## Published usage rates

USD list rates for the default models at the time of writing (check Groq for current prices):

| Usage | Rate |
| --- | --- |
| Whisper Turbo transcription | $0.04 per audio hour |
| GPT-OSS 120B input | $0.15 per million tokens |
| GPT-OSS 120B output | $0.60 per million tokens |
| Orpheus English speech | $22 per million characters |

Source: [Groq model pricing](https://console.groq.com/docs/models). Transcription has a **10-second minimum billed duration per request**. Each utterance is a separate request, so many short turns can cost more than their combined speaking duration suggests. [Speech billing details](https://console.groq.com/docs/speech-to-text)

For illustration, 10 billed audio minutes cost about $0.0067. Separately, 100,000 input tokens and 10,000 output tokens cost $0.021. These are arithmetic examples, not estimates of a particular conversation or account bill.

New-idea voice turns normally use transcription plus two language-model calls (extraction and response). Selected-idea turns normally use transcription plus discussion. Resent notes/history, corrections, and retries add usage. Cancelling locally may not stop provider billing. Natural replies make paid Groq text-to-speech calls, segmented to the documented 200-character request limit. 1,000 reply characters cost approximately $0.022 at the listed English rate. Device voice does not incur Groq speech-generation charges. [Official speech pricing and limits](https://console.groq.com/docs/text-to-speech/orpheus). Rates, account allowances, taxes, and terms may change. The Groq console is authoritative for actual charges.

## Credential handling

The server reads the credential and attaches the provider Authorization header. Browser requests use same-origin `/api/*` routes. The credential is absent from frontend sources, the generated client bundle, test artifacts, and the health response. `.env` is ignored by version control and is not served by the production static server.

## Missing credentials and voice acceptance

If credentials are absent or rejected, **live voice verification is BLOCKED**. The integration and manual workspace remain available; configure the server and retry the connection. Do not label a simulation as a passed voice test.

Synthesized-speech tests prove API behavior only, not the full microphone-to-speaker experience. Try it with a real microphone before relying on it.

