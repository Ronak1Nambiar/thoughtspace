# Your data in Thoughtspace

Thoughtspace can bring in what you have already thought through somewhere else: your ChatGPT and Claude conversations, and your notes. It reads them, finds **your** ideas (projects, decisions, open questions), groups them into themes, and puts them on your map. The full conversations stay one click away.

Open it from the **book icon** in the header, or **File → Import your data**.

## What you can bring in

| Source | How to get it |
|---|---|
| ChatGPT | ChatGPT → Settings → Data controls → **Export data**. OpenAI emails you a zip. |
| Claude | Claude → Settings → Privacy → **Export data**. Anthropic emails you a zip. |
| Notes | Any folder of `.md` files, including an Obsidian vault. Hidden folders (`.obsidian`, `.git`, `.trash`) are skipped. Windows app only. |

ChatGPT and Claude do not offer apps a way to read your chat history, so the export file is the only route. Your API key (in **AI model** settings) lets Thoughtspace *use* a model. It cannot see your past chats.

Importing the same service again (a newer export) updates the existing source: unchanged conversations are recognised and skipped, and only new or edited ones are read again.

## Finding your ideas

After an import, the Library shows how many items are ready. **Find my ideas** reads them in the background. You can keep working, pause, or close the app; it resumes where it stopped.

- **By default it uses your current model.** With Ollama that is private and free, but a large history (thousands of conversations) can take hours on a laptop.
- **Speed up with a cloud model**: pick any provider you have saved a key for. Thoughtspace shows a **cost estimate** before you start. This sends those conversations to that provider.
- Quick look-ups ("what's the capital of France") are recognised and skipped. They stay searchable.
- Every idea must quote your own words exactly. The model cannot put something on your map you never said.

## On the map

- Ideas arrive grouped by **theme**. The theme pills and an **All sources / Captured / Imported** filter appear above the map once you have imported anything.
- To keep the map readable, at most **300** imported ideas are placed. The rest stay in the Library.
- Your edits to an imported card (title, position, notes) are kept when you import again.
- Card details show **Where this came from**. It opens the source conversation with your quoted words highlighted.
- Notes that link to each other with `[[wikilinks]]` are connected on the map.

## Where it is stored

Everything stays on this computer:

- The Library (conversations, notes, ideas, search index) is `library.db` in the app's data folder (`%APPDATA%\Thoughtspace`).
- Map cards stay in the workspace, which is small because cards point to the Library instead of copying conversations.

Removing a source deletes its conversations from the Library. Cards already on your map stay.

## What is sent when you talk

| What | Where it goes |
|---|---|
| Your voice | **Transcribed on this computer** by whisper.cpp (base English model) by default. With **Settings → Voice → Speech-to-text → Cloud**, or Automatic with a Groq/OpenAI key saved, the finished recording goes to that provider. Wake listening never leaves the computer. |
| What you said (text) | Your chosen model, to extract ideas and to reply. |
| Map focus | Your chosen model gets the **titles** of up to 200 thoughts (not their text or notes) to pick which 1–2 you mean. |
| The thoughts you're discussing | Your chosen model gets their title, excerpt, notes and item titles, to reply and suggest items. |
| Spoken replies | Groq or OpenAI voices get the reply text. The Windows voice stays on this computer. |

With Ollama as the model, on-device speech-to-text and the Windows voice, **nothing leaves your computer**.

## Limits

- Export zips up to 2 GB, and up to 100,000 conversations or notes per source. Notes larger than 2 MB are skipped.
- Only the conversation branch you last saw in ChatGPT is kept (edited prompts create hidden branches).
- Images, files and tool output inside conversations are not imported. Only text is.

## Live connections

In the Library, **Live connections** keep a service in sync by themselves: shortly after launch, then every six hours, and whenever you press **Sync now**. Each sync reads only what changed since the last one. New pages are read into ideas automatically when your current model runs on this computer. With a cloud model you start the reading yourself, because it costs money.

| Service | How to connect | What is read |
|---|---|---|
| Notion | Create an internal integration at notion.so/my-integrations, copy its secret (`ntn_…`), paste it into Thoughtspace, then share the pages you want with the integration (••• → Connections). | Pages shared with the integration, including nested blocks up to three levels deep. Trashed pages are removed. |
| Google Drive | **Connect** opens Google sign-in in your browser (read-only access). Requires `THOUGHTSPACE_GOOGLE_CLIENT_ID` (and `THOUGHTSPACE_GOOGLE_CLIENT_SECRET`) from a Google Cloud OAuth client of type *Desktop app*. | Google Docs, `.md` and `.txt` files up to 2 MB. Deleted or trashed files are removed. |

Sign-ins are encrypted with Windows credential protection, like API keys, and the app window never receives them. **Disconnect** deletes the sign-in and that service's items from the Library. Cards already on your map stay.

### Known limitations

- **Notion one-click sign-in** needs a small hosted token exchange, because Notion's OAuth requires a client secret that a desktop app cannot keep. Until then, users paste an integration secret.
- **Google Drive**: the `drive.readonly` scope works for up to 100 test users while the Google Cloud app is in *Testing*. A public release needs either Google's restricted-scope security assessment, or a switch to the `drive.file` scope plus the Google Picker, where users choose files explicitly.
