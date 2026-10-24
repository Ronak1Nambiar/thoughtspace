# Bring your own model (1.6, saved models in 1.8, sign-in in 1.9)

Thoughtspace no longer depends on one AI vendor. Any of these services can be the model your assistant thinks with:

| Provider | Needs | Default model |
|---|---|---|
| Ollama (on this computer) | Ollama running locally, free | `llama3.1:8b` |
| OpenAI (ChatGPT models) | API key | `gpt-4o-mini` |
| Anthropic (Claude) | API key | `claude-sonnet-5` |
| Google Gemini | API key | `gemini-2.5-flash` |
| Groq | API key | `openai/gpt-oss-120b` |
| OpenRouter | API key | `openai/gpt-4o-mini` |
| Custom OpenAI-compatible server | address ending in `/v1`, optional key | — |

Pick a model from the list the provider returns, or type any model name. **Save and test connection** switches over immediately. No restart needed.

## Sign in with OpenRouter (1.9)

**Sign in with OpenRouter** (in setup, the model menu and Settings → Your models) connects without copying a key. Your browser opens OpenRouter's approval page; approve it and ThoughtSpace receives a key made for this app (labelled "ThoughtSpace"), saves it encrypted like any other key, and switches to it. One sign-in gives access to Claude, GPT, Gemini, Llama and hundreds of other models, billed to your OpenRouter account. The saved model shows **signed in**; **Sign out** deletes the key from this computer (you can also revoke it at openrouter.ai/settings/keys).

How it works: OAuth with PKCE and a one-time listener on this computer (`http://localhost:<port>/callback/<random state>`), which closes after one answer or five minutes. `POST /api/provider/signin {provider:'openrouter'}` returns `{id, authUrl, opened}` (the desktop app opens the link itself); `POST /api/provider/signin/wait {id}` waits for approval and returns the new configuration.

**Why no "Sign in with ChatGPT" or "Sign in with Claude":** neither company allows third-party apps to use a ChatGPT or Claude.ai subscription login (as of September 2026). Apps that do it reuse the official apps' logins against the terms, which can get accounts restricted. Use OpenRouter sign-in, or an OpenAI or Anthropic API key.

## Switching and adding models (1.8)

- **Switch:** the model button at the top of the workspace (for example `● llama3.1:8b · Ollama ▾`) lists your saved models. Pick one and your assistant, idea extraction and Library reading use it straight away, with no Save step. The dot is green when the model is reachable.
- **Add your model:** in the same menu, choose **Add your model…**. Pick the service, type the model name (suggestions appear once it connects), and add an address for Ollama or your own server and a key if the service needs one. You can also give it a name. **Test and add** checks the connection first. If the test fails, you can still **Save anyway**, for example for a server that is off right now.
- **Manage:** **Settings → Your models** lists every saved model, with Use, Edit and Delete. The current model cannot be deleted. Deleting a model also deletes its key from this computer.
- Each saved model can have **its own key and address**, so two OpenAI-compatible servers, or two Ollama machines, never overwrite each other. Without its own key, a model uses the service's saved key.
- **Upgrading:** from 1.7 or earlier, your current model and each service you had a key for become saved models automatically. Going back to 1.7 still works: it keeps its keys and ignores the saved list.
- You can save up to 30 models.

## What each part uses

- **Thinking** (idea extraction, assistant discussion, map connections, Library reading) uses the current saved model.
- **Transcription** uses Groq Whisper if a Groq key is saved (on the service or on any saved Groq model), otherwise OpenAI `whisper-1` if an OpenAI key is saved. Typed capture needs neither.
- **Natural spoken replies** use Groq Orpheus when a Groq key is saved. Device voice works without one.

So a fully local setup is Ollama for thinking plus typed capture or device voice. Nothing leaves the computer.

## Where keys live

- **Desktop app:** each key is encrypted with Windows credential protection (`safeStorage`) in `%APPDATA%/Thoughtspace/provider-config.json`. A 1.5 Groq-only file is migrated automatically.
- **Browser/dev server:** keys entered in settings are held in memory until the server stops. For a persistent setup, use `.env` (see `.env.example`).
- The renderer never receives a key back, only `hasKey` and the last four characters.

## API

- `GET /api/provider`: the public configuration (providers, models, which keys are saved).
- `POST /api/provider` with an action:
  - `{action:'activate', id}` switches to a saved model.
  - `{action:'saveProfile', profile:{id?, name?, provider, model, baseUrl?, apiKey?, clearKey?}, activate?}` adds a model, or edits one when `id` is given.
  - `{action:'deleteProfile', id}` deletes one.

  The 1.6 form `{provider, model?, baseUrl?, apiKey?, clearKey?, enabled?}` still works. Every call responds with the new configuration (`profiles` show only key hints) and a fresh connection check. An empty `apiKey` keeps the saved key.
- `POST /api/provider/test` `{profile}`: tries a model without saving it. It returns `{ready, message, available}`.
- `GET /api/health`: the active provider's connection check, the models it offers, and voice availability.

The code is in `llm-providers.mjs`. Adding a provider that speaks the OpenAI chat format is one entry in `PROVIDERS`.

## What happens when a model fails

Every failure says what happened, what to do, and that your capture is saved: a rejected key (401/403), an unknown model (404), being out of credit (402), rate limits (429), a provider outage (5xx), a conversation that is too long for the model, a service that can't be reached (Ollama and custom servers are named, with their address), a timeout, and an Ollama model that hasn't been pulled. Pressing Stop yourself never shows an error.

## Verified against the live service

| Service | Extract | Discuss | Bad key message |
|---|---|---|---|
| Groq | ✓ | ✓ | ✓ |
| Ollama | ✓ | ✓ | n/a |
| OpenRouter (openai/gpt-4o-mini) | ✓ | ✓ | — |
| OpenAI | not yet | not yet | — |
| Anthropic | not yet | not yet | — |
| Gemini | not yet | not yet | — |

The request formats for the rest are covered by unit tests with a fake server (`tests/providers.test.mjs`), not by a live call.
