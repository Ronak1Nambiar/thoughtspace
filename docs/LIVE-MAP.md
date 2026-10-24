# Live map: focus, suggested items and voice

## The map follows the conversation
When you talk without selecting anything, ThoughtSpace asks your model which **one or two existing thoughts** you mean (`/api/relate`; only the thought titles are sent, plus the previous turn's thoughts as a hint). If it finds them:
- the map glides to them and they glow;
- their items and linked thoughts fan out around them (two thoughts sit side by side, each fanning outward);
- the rest of the map dims;
- what you said is added as a note on those thoughts instead of becoming a duplicate card.

If nothing matches, your words become new thoughts as before. Click empty map space, or drag a card, to release the focus. Focus is never saved. The map goes back to its normal layout.

## Suggested items
When the assistant proposes concrete next steps for a thought ("secure data access", "block two study evenings"), each becomes a small **item** linked to that thought:
- **Dashed** = suggested. Select it and choose **Keep item** or **Remove**.
- **Add an item…** in the selection panel adds your own item under any thought or item, so you can build a list several levels deep.
- Items are thoughts too: open their notes, move them, and connect them. Removing an item removes the items under it.
- Items never create "shared words" suggestions, so assistant text is never counted as evidence for links.

This works for spoken replies and for **Discuss selected**. At most 4 suggestions per reply, and it never repeats an item that already exists.

## Talking without a key
Speech-to-text runs **on this computer** by default (whisper.cpp base English, about 1–3 s per turn on a laptop CPU), so a new install can talk straight away. **Settings → Voice → Speech-to-text**:
- **Automatic**: Groq or OpenAI if you saved a key, otherwise this computer.
- **On this computer**: always local, even with a key saved.
- **Cloud**: always Groq or OpenAI.

Recordings are converted to 16 kHz WAV in the app before transcription. The local engine writes them to a private temporary file that is deleted as soon as it's read.

## Changing the voice
The voice picker beside **Start conversation** switches the reply voice instantly and says a short line in it (not while a conversation is running):
- **Groq Orpheus**: 6 voices (needs a Groq key).
- **OpenAI**: 11 voices with `gpt-4o-mini-tts` (needs an OpenAI key; set `OPENAI_TTS_MODEL` to change the model).
- **Windows voice**: free and on-device.

The same choice is in **Settings → Voice**.

Code: `assist.mjs` (relate and suggestion prompts and their validation), `src/thought-map.js` (`focusLayout`, item links), `src/core.js` (`addItems`, `keepItem`, `removeItem`), `src/voices.js`, `src/voice-picker.jsx`, `desktop/local-transcribe.cjs` and `src/wav.js` (speech-to-text on this computer). Tests: `tests/live-map.test.mjs`, `tests/local-speech.test.mjs`.
