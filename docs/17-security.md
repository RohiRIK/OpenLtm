# Security and privacy

What OpenLTM stores, what can leave your machine, and the settings that control it.

---

## What stays local

- **The database.** Every memory lives in one SQLite file (`openltm.db`). There is no account, no server-side copy and no sync unless you turn it on. Location: [Configuration → DB path](04-configuration.md#db-path).
- **No telemetry.** No analytics or usage reporting in any configuration.

## What can leave the machine

| Component | Default | Leaves the machine? |
|---|---|---|
| Embeddings (search by meaning) | local [llama.cpp](https://github.com/ggerganov/llama.cpp) server (`llama-server --embeddings`, model `bge-m3`, `POST /v1/embeddings`) | No. If the server is not running, recall uses full-text search only and nothing is sent. |
| Janitor LLM (summaries, dedup review) | local [Ollama](https://ollama.com) (`LTM_LLM_PROVIDER` unset → `ollama`) | No. |
| Cloud embedding or LLM providers | off | Only when you set `LTM_EMBED_PROVIDER` / `LTM_LLM_PROVIDER` to a cloud provider. |

Setup: [Local embeddings](15-local-embeddings.md). Provider settings: [Configuration → Embeddings](04-configuration.md#embeddings).

## Secrets and personal data

- **Secret scrubbing.** Durable write paths (`learn`, janitor promote and dedup, context capture, collections, capsule import) run text through a pattern scrubber before storing it. On an internal error the scrubber fails closed and stores a placeholder, never the original text. It is a pattern denylist, not a guarantee: don't store credentials on purpose.
- **PII masking.** Emails, phone numbers, card numbers, SSNs and IP addresses are replaced with placeholders before text reaches an LLM or embedding provider (`LTM_MASK_PII`, default `providers`). See [Personal data masking](04-configuration.md#personal-data-masking-2230).
- **Private memories.** Tag a memory `private` to keep it out of default recall, session injection and exports. This is a visibility filter, not encryption: SQLite still stores the text in plain form.
- **Encrypted capsules.** `ltm export --encrypt` writes an AES-256-GCM capsule keyed from `LTM_CAPSULE_PASSPHRASE`. See [Commands](05-commands.md#terminal-cli-integrity-capsules-facts-2230).

## Native code loading

`LTM_SQLITE_LIB` and `LTM_HONKER_EXT` are filesystem paths handed to a SQLite extension loader. There is no allowlist and no signature check. Set them only to paths you trust, or turn the loaders off with `LTM_DISABLE_VEC=1` and `LTM_DISABLE_HONKER=1`.

## What the git-clone installer changes

`bash install.sh` writes `~/.claude.json`, creates `~/.claude/settings.json` if it is missing, and adds `mcp__plugin_openltm_memory` to `permissions.allow` so the memory tools stop prompting for approval. That widens your agent's tool permissions on purpose. Read [`scripts/install-wiring.ts`](../scripts/install-wiring.ts) before running it if you want to check first.

## Releases

npm packages are published through GitHub OIDC trusted publishing with provenance. No `NPM_TOKEN` is stored in the repository. See [Publishing](11-publishing.md).
