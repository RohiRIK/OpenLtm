# Local embeddings with llama.cpp

OpenLTM searches memories two ways: full-text (FTS5, always on) and by meaning (vector embeddings). The second one needs an embedding server. Without one, recall still works, but only on matching words: *"how we handle async errors"* will not find a memory that says *"wrap awaited calls in try/catch"*.

The default embedding provider is a local [llama.cpp](https://github.com/ggml-org/llama.cpp) server. Nothing leaves your machine, there is no API key, and OpenLTM never falls back to a cloud provider when the server is down. This page gets it running in about five minutes.

---

## 1. Install llama.cpp

| Platform | Command |
|---|---|
| macOS / Linux (Homebrew) | `brew install llama.cpp` |
| Windows | `winget install llama.cpp` |
| Anything else | Download a prebuilt `llama-server` from the [llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases), or build from source |

Check it: `llama-server --version`.

## 2. Get the model

OpenLTM expects **bge-m3** (multilingual, 1024-dimension vectors). Download a GGUF build of it from Hugging Face (search for *bge-m3 GGUF*; a `Q8_0` file is about 600 MB and loses almost nothing against full precision). Save it somewhere stable, for example `~/models/bge-m3-Q8_0.gguf`.

A different embedding model works too: set `LTM_EMBED_MODEL` to its name. OpenLTM stamps every stored vector with the model and its size, so a switch never mixes vector spaces; the janitor re-embeds old rows.

## 3. Start the server

```bash
llama-server -m ~/models/bge-m3-Q8_0.gguf --embeddings --pooling mean --port 8080 -b 2048 -ub 2048
```

- `--embeddings` turns on the `/v1/embeddings` endpoint OpenLTM calls.
- `--pooling mean` is the pooling bge-m3 uses for dense vectors.
- `-b` / `-ub` raise the batch size so a long memory fits in one pass. With the defaults, a memory longer than about 512 tokens fails with *"input is too large to process"* and is stored without a vector.
- `--port 8080` matches OpenLTM's default URL. For another host or port, set `LTM_LLAMA_CPP_URL` (for example `http://127.0.0.1:8081`).

## 4. Check it

```bash
curl -s http://127.0.0.1:8080/health
curl -s http://127.0.0.1:8080/v1/embeddings -H 'Content-Type: application/json' \
  -d '{"model":"bge-m3","input":"hello"}' | head -c 200
```

Then, in Claude Code, run `/openltm:doctor`. The **Embeddings (semantic recall)** section should say:

```
  ✅  llamacpp at http://127.0.0.1:8080 returns 1024-d vectors (model bge-m3)
```

It also counts how many memories already have a vector. Memories stored while the server was down get one on the janitor's next run; to do it now:

```bash
bunx @rohirik/openltm-core janitor run
```

From any host, the `stats` tool (`ltm_stats` in OpenCode, `openltm_brain_stats` in OpenClaw) reports the same count as `embedded`. `embedded: 0` means recall is on full-text search only.

## 5. Keep it running

The server has to be up whenever an agent recalls. OpenLTM probes it once per process with a short timeout, so a server that is down costs nothing, but it also means semantic recall is off until the next session.

**Linux (systemd user service)** — save as `~/.config/systemd/user/llama-embeddings.service`:

```ini
[Unit]
Description=llama.cpp embeddings for OpenLTM

[Service]
ExecStart=/usr/local/bin/llama-server -m %h/models/bge-m3-Q8_0.gguf --embeddings --pooling mean --port 8080 -b 2048 -ub 2048
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload && systemctl --user enable --now llama-embeddings
```

Use the path `which llama-server` prints in `ExecStart`.

**macOS (launchd)** — save as `~/Library/LaunchAgents/dev.openltm.llama-embeddings.plist`, with your own paths:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.openltm.llama-embeddings</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/llama-server</string>
    <string>-m</string><string>/Users/YOU/models/bge-m3-Q8_0.gguf</string>
    <string>--embeddings</string>
    <string>--pooling</string><string>mean</string>
    <string>--port</string><string>8080</string>
    <string>-b</string><string>2048</string>
    <string>-ub</string><string>2048</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/dev.openltm.llama-embeddings.plist
```

## Troubleshooting

| `/openltm:doctor` says | Cause | Fix |
|---|---|---|
| `embedding server not reachable` | Nothing listens on `LTM_LLAMA_CPP_URL` | Start the server (step 3), or point `LTM_LLAMA_CPP_URL` at it |
| `is up but returned no embedding` | The server runs without `--embeddings`, or with a chat model | Restart it with `--embeddings` and an embedding model |
| `Embedded memories: 40/120` | Those were stored while the server was down | `bunx @rohirik/openltm-core janitor run` |
| `Embeddings are disabled` | `LTM_EMBED_PROVIDER=disabled` or `"provider": "disabled"` in config.json | Unset it to use llama.cpp |

Other providers (Ollama, or opt-in cloud providers) and every setting are in [Configuration → Embeddings](04-configuration.md#embeddings).
