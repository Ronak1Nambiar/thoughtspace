# Wake by name

Your assistant is called whatever you name it during setup (default **Atlas**). Change it any time in **Settings → Your assistant**. The name is used everywhere: the wake word, the conversation tab, the assistant's own replies ("Your name is …" in its instructions) and the microphone prompt.

In the Windows application, turn on **<name> wake** beside Start conversation. Say **“<name>”** or **“Hey <name>”** on its own, pause for the chime and **Listening**, then say your thought. Wake activation brings the window forward if minimized. Once activated, the continuous conversation handles multiple thoughts and selected-card context.

**Test the name** (in setup and Settings) listens for about 10 seconds while you say the name three times, and reports how many times Windows heard it clearly (confidence ≥ 0.60):
- **3 of 3:** wake by name will work well.
- **1–2:** saying “Hey <name>” is more reliable, or pick a longer name.
- **0:** Windows didn't catch it. You can keep the name; use “Hey <name>” or the Start button.

Names are 1–24 characters: letters (any language), spaces, hyphens and apostrophes, starting with a letter. Names of one syllable are harder for Windows to pick out, and setup says so. For the default name, the recognizer also accepts the common Windows mishearings **Atlus** and **Atless**.

**Stop conversation** returns to local wake listening while wake mode remains enabled. **Mute microphone** pauses both conversation input and standby wake detection. **Disable wake word** turns standby detection off. Closing or reloading the app turns it off; there is no startup service, system-wide assistant, or hidden microphone activation on launch.

Wake listening uses the installed Windows English `System.Speech` recognizer with a phrase grammar built from your name and a competing background dictation grammar to reduce accidental matches. The native helper (`WakeListener.exe --phrases "<name>|Hey <name>"`) makes no network requests, stores no recordings, and passes only ready/detected/error events (and, for the name test, heard/confidence events) to the application. Ambient words are discarded. After activation, finalized conversation audio goes to your transcription provider, as before.

No extra service account or wake-word API charge is required. The packaged helper requires Windows .NET Framework and an installed English speech recognizer. Wake mode does not operate in the browser development version. It is a general speech recognizer using a phrase grammar, not a separately trained wake-word model; background speech may occasionally trigger it and pronunciations may be missed.

## Testing

`node scripts/verify-wake-name.mjs <name>` checks a name with Windows-synthesised speech: the name and "Hey <name>" should wake, and unrelated phrases ("Hello there", "Pass me the hammer") should not. `node scripts/verify-wake.mjs` runs the source-runtime integration test with a development-only waveform input; packaged apps always use the default microphone. Human pronunciation into a real microphone and room-noise reliability are not yet verified.

Build: `npm run build:wake`, then `npm run package:desktop`. The native helper is bundled under `resources/wake`, outside the app archive; it launches without a console window and exits when its parent pipe closes.

Official implementation references: [Windows local recognition engine](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine?view=netframework-4.8.1), [default microphone input](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine.setinputtodefaultaudiodevice?view=netframework-4.8.1), [continuous recognition](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.recognizemode?view=netframework-4.8.1).
