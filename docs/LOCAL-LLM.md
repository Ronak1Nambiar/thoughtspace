# Local LLM prototype

Thoughtspace can now use Ollama for extraction, discussion and map connections. Set `LLM_PROVIDER=ollama` and `AI_ENABLED=true`; the default local model is `llama3.1:8b`. The packaged Windows app is local-first by default. The server talks to Ollama over loopback and never sends these prompts to Groq.

The local path is intentionally incremental. Transcription and natural speech still use the existing Groq endpoints until local speech models are added. Text capture and all saved workspace features remain available if Ollama is stopped.

## Try it

```powershell
ollama serve
ollama list
$env:AI_ENABLED='true'
$env:LLM_PROVIDER='ollama'
$env:LOCAL_MODEL='llama3.1:8b'
node server.mjs --dev
```

For a separate test server, use `PORT=3010` and run `node scripts/verify-local-llm.mjs` with `LOCAL_TEST_URL=http://localhost:3010`.

Larger models need more memory (a 26B model wants about 32 GB of RAM). Expect the first request to load the model and take longer than the cloud path; subsequent requests depend on Ollama's keep-alive and available hardware.
